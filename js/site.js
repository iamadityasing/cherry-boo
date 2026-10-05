/* =====================================================================
   site.js
   ---------------------------------------------------------------------
   A direct port of the sketchbook state machine from matthewyu.dev
   (app/(home)/layout-b76a4a2ab04d91ee.js):

     d -> cur      u -> turn      f -> page count
     g -> stacked  v -> riffling  E -> riffleQueue
     P -> riffleIdx  m -> seq     w -> coarse

   The page turn itself is CSS: `.sb-flap.next|prev` runs
   `sb-fold-next|prev` for .85s and JS only listens for animationend.
   Nothing here touches the transform.
   ===================================================================== */
(function () {
  'use strict';

  var RIBBLE_KEY = 'sb-intro-done';

  function boot() {
    var dataEl = document.getElementById('sketchbook-data');
    var wrap = document.querySelector('.sb-wrap');
    var book = document.querySelector('.sb-book');
    var caps = document.querySelector('.sb-captions');
    if (!dataEl || !wrap || !book) return;

    var pages;
    try { pages = JSON.parse(dataEl.textContent); } catch (e) { return; }
    if (!pages || pages.length < 2) return;

    var f = pages.length;

    var cur = 0;             // d
    var turn = null;         // u  {id, dir, from, to, dur?, bell?}
    var seq = 0;             // m
    var riffling = false;    // v
    var riffleQueue = [];    // E
    var riffleIdx = 0;       // P
    var stacked = false;     // g
    var fullEl = null;       // the .sb-full node
      var land = [];           // land[i] === true once page i is known landscape
                              // declared up here because the .sb-full adoption
                              // below runs before the render helpers, and it
                              // already calls watchOrientation
    var stackEl = null;
    var flipEl = null;       // the live halves + flap, removed on animationend

    var coarse = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches; // w
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ----------------------------------------------------------------
       images
       ---------------------------------------------------------------- */
    function img(src, cls, sync, alt) {
      var el = new Image();
      el.src = src;
      if (cls) el.className = cls;
      el.alt = alt || '';
      el.draggable = false;
      el.decoding = sync ? 'sync' : 'auto';
      return el;
    }

    /* The markup ships a static .sb-full holding page-01. Adopt it rather
       than creating a second one — a leftover .sb-full would keep painting
       Poster 01 over every slide. */
    Array.prototype.slice.call(book.querySelectorAll('.sb-full')).forEach(function (el, n) {
      if (n === 0) fullEl = el;
      else el.remove();
    });
    /* The markup's static .sb-full is an existing <img>, not one we made, so
       it never passed through watchOrientation. Cover page 01 here. */
    if (fullEl) {
      var seed = fullEl.querySelector('img');
      if (seed) watchOrientation(seed, 0);
    }

    /* `.sb-full`: one image before stacking, the full stack after. */
    function renderFull() {
      if (stacked) {
        if (!stackEl) {
          stackEl = document.createElement('div');
          stackEl.className = 'sb-full sb-stack';
          pages.forEach(function (p, i) {
            var im = img(p.src, '', true);
            im.style.visibility = 'hidden';
            watchOrientation(im, i);
            stackEl.appendChild(im);
          });
          book.insertBefore(stackEl, book.firstChild);
        }
        Array.prototype.forEach.call(stackEl.children, function (im, n) {
          im.style.visibility = n === cur ? 'visible' : 'hidden';
          im.alt = n === cur ? pages[n].title : '';
        });
        return;
      }
      // Before stacking there is a single .sb-full, and the original
      // removes it entirely while a turn is in flight.
      if (turn) { if (fullEl) { fullEl.remove(); fullEl = null; } return; }
      if (!fullEl) {
        fullEl = document.createElement('div');
        fullEl.className = 'sb-full';
        book.insertBefore(fullEl, book.firstChild);
      }
      // querySelector, not firstChild: the markup's .sb-full has a
      // whitespace text node before the <img>.
      var im = fullEl.querySelector('img');
      if (!im) { im = img(pages[cur].src, '', true); fullEl.appendChild(im); }
      if (im.getAttribute('src') !== pages[cur].src) im.src = pages[cur].src;
      im.alt = pages[cur].title;
    }

    function renderCaptions() {
      if (!caps) return;
      caps.textContent = '';
      var p = document.createElement('p');
      p.className = 'sb-caption';
      p.textContent = pages[turn ? turn.to : cur].title;
      caps.appendChild(p);
      if (turn) {
        var old = document.createElement('p');
        old.className = 'sb-caption cap-out';
        old.textContent = pages[turn.from].title;
        caps.insertBefore(old, p);
      }
    }

    function renderWrap() {
      // `intro` drives the fast riffle timings; b1/b2 pick the blur.
      var cls = 'sb-wrap';
      if (riffling) {
        var bell = turn && turn.bell != null ? turn.bell : 0;
        cls += ' intro' + (bell > 0.6 ? ' b2' : bell > 0.25 ? ' b1' : '');
      }
      wrap.className = cls;
      if (riffling && turn) wrap.style.setProperty('--riffle-dur', (turn.dur != null ? turn.dur : 0.16) + 's');
      else wrap.style.removeProperty('--riffle-dur');
    }

/* Posters arrive in both shapes. A landscape photo forced into the
         portrait book reads as small and letterboxed, so the book takes its
         aspect from whatever is currently on the page. Orientation is read
         from the decoded image rather than hardcoded per filename, so adding
         artwork later needs no JS change. */
      function syncOrientation() {
        var isLand = land[cur] === true;
        book.classList.toggle('is-landscape', isLand);
      }

      /* Record orientation as soon as each image knows its own size. load can
         fire before the class flips, so re-check on every render too. */
      function watchOrientation(im, i) {
        function read() {
          if (!im.naturalWidth) return;
          land[i] = im.naturalWidth > im.naturalHeight;
          if (i === cur) syncOrientation();
        }
        im.addEventListener('load', read);
        if (im.complete) read();
      }

      function render() {
        syncOrientation();
        renderWrap();
        renderFull();
        renderCaptions();
        announce();
      }

    /* The one place that says which poster is showing. The tree listens
       for this to shift its palette; a custom event keeps the two halves
       of the page decoupled, so the sketchbook never has to know the
       tree exists. */
    function announce() {
      var idx = turn ? turn.to : cur;
      /* published for the artwork viewer, which opens on whatever is
         showing rather than resetting to page 1 */
      try { document.body.setAttribute('data-poster', String(idx)); } catch (e) { /* ignore */ }
      try {
        document.dispatchEvent(new CustomEvent('sb:change', {
          detail: { index: idx, riffling: riffling, count: f }
        }));
      } catch (e) { /* CustomEvent unsupported: the tree just keeps its hue */ }
      syncDots(idx);
    }

    /* ----------------------------------------------------------------
       progress dots
       ---------------------------------------------------------------- */
    var dotsEl = wrap.querySelector('.sb-dots');
    var dots = [];
    if (dotsEl) {
      for (var di = 0; di < f; di++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'sb-dot';
        /* aria-current rather than role=tab: there is no tabpanel behind
           these, so the tab pattern would be theatre */
        dot.setAttribute('aria-current', 'false');
        dot.setAttribute('aria-label', 'Poster ' + (di + 1));
        dot.addEventListener('click', (function (n) {
          return function () { poke(); jump(n); };
        })(di));
        dotsEl.appendChild(dot);
        dots.push(dot);
      }
    }

    function syncDots(idx) {
      for (var i = 0; i < dots.length; i++) {
        dots[i].setAttribute('aria-current', i === idx ? 'true' : 'false');
      }
    }

    /* Walk to a page. step() commits any turn already in flight before
       starting the next, so calling it a few times in a row collapses into
       one visible flip that lands on the target -- no queue of animations
       to wait out. The direction is the shorter way round, so jumping
       from page 1 to page 10 is one step backwards, not nine forwards. */
    function jump(n) {
      n = ((n % f) + f) % f;
      var guard = 0;
      while (((turn ? turn.to : cur) !== n) && guard++ <= f) {
        var at = turn ? turn.to : cur;
        var fwd = (n - at + f) % f;
        var back = (at - n + f) % f;
        step(fwd <= back ? 'next' : 'prev');
      }
    }

    /* ----------------------------------------------------------------
       the page turn — CSS does the work
       ---------------------------------------------------------------- */
    function sideImg(p, side, sync) { return img(p.src, 'sb-half-img ' + side, sync); }

    function mountTurn() {
      // Always clear the previous fold first. The intro riffle re-mounts on
      // every animationend, so skipping this stacks orphaned flaps.
      unmountTurn();

      var next = turn.dir === 'next';
      var group = document.createElement('div');
      group.style.display = 'contents';

      // Left half, right half. The incoming side fades in, the outgoing
      // side fades out — this crossfade is what makes it read as paper.
      var hl = document.createElement('div');
      hl.className = 'sb-half left ' + (next ? 'sb-out' : 'sb-in');
      hl.appendChild(sideImg(pages[next ? turn.from : turn.to], 'left', !stacked));

      var hr = document.createElement('div');
      hr.className = 'sb-half right ' + (next ? 'sb-in' : 'sb-out');
      hr.appendChild(sideImg(pages[next ? turn.to : turn.from], 'right', !stacked));

      var flap = document.createElement('div');
      flap.className = 'sb-flap ' + turn.dir;
      var front = document.createElement('div');
      front.className = 'sb-face front';
      front.appendChild(sideImg(pages[turn.from], next ? 'right' : 'left', !stacked));
      var back = document.createElement('div');
      back.className = 'sb-face back';
      back.appendChild(sideImg(pages[turn.to], next ? 'left' : 'right', !stacked));
      flap.appendChild(front);
      flap.appendChild(back);

      group.appendChild(hl);
      group.appendChild(hr);
      group.appendChild(flap);

      var zones = book.querySelectorAll('.sb-zone');
      book.insertBefore(group, zones.length ? zones[0] : null);

      flap.addEventListener('animationend', function (e) {
        if (e.target !== e.currentTarget) return;   // only the flap's own animation
        onTurnEnd();
      });

      flipEl = group;
    }

    function unmountTurn() {
      if (flipEl) { flipEl.remove(); flipEl = null; }
    }

    function onTurnEnd() {
      cur = turn.to;
      renderFull();

      if (riffling && riffleIdx + 1 < riffleQueue.length) {
        riffleIdx++;
        turn = { id: ++seq, dir: 'next' };
        var step = riffleQueue[riffleIdx];
        turn.from = step.from; turn.to = step.to;
        turn.dur = step.dur; turn.bell = step.bell;
        render();
        mountTurn();
        return;
      }
      if (riffling) { riffling = false; renderWrap(); }

      /* the intro riffle has just ended -- the first moment auto-advance
         is allowed to own the deck. `poke` may already have armed it if
         the reader interrupted the riffle, so this only fills the gap. */
      if (!autoStarted) { autoStarted = true; scheduleAuto(); }

      var done = turn;
      if (coarse) {
        // Let the last frame finish before the flap is torn down.
        setTimeout(function () { if (turn && turn.id === done.id) { turn = null; unmountTurn(); render(); } }, 90);
        return;
      }
      turn = null;
      unmountTurn();
      render();
    }

    /* L(dir) — commit any in-flight turn, then start the next one.
       Chaining like this is what makes rapid clicks stay in sync. */
    function step(dir) {
      if (riffling) { riffling = false; renderWrap(); }
      var from = turn ? turn.to : cur;
      if (turn) cur = turn.to;
      turn = {
        id: ++seq,
        dir: dir,
        from: from,
        to: dir === 'next' ? (from + 1) % f : (from - 1 + f) % f
      };
      unmountTurn();
      render();
      mountTurn();
    }

    /* ----------------------------------------------------------------
       auto-advance: one flip every 6s, and the person always wins
       ---------------------------------------------------------------- */
    var AUTO_MS = 6000;
    var auto = null;
    var autoIdle = false;   // set once the page has been read, not flipped
    var autoStarted = false;

    function stopAuto() {
      if (auto) { clearTimeout(auto); auto = null; }
    }

    /* A plain setTimeout, not setInterval. The turn takes ~850ms, so an
       interval would sometimes fire mid-flip and `step` would have to
       refuse it -- which is exactly the kind of race that makes auto-play
       look broken. Re-arming one shot after the previous flip lands keeps
       the spacing honest. */
    function scheduleAuto() {
      stopAuto();
      if (autoIdle) return;
      auto = setTimeout(function () {
        auto = null;
        /* never talk over the intro riffle, a turn already in flight, or
           a page the reader has walked away from */
        if (riffling || turn || document.hidden) return;
        step('next');
        scheduleAuto();
      }, AUTO_MS);
    }

    /* Any deliberate interaction defers the next auto-flip by a full
       period, so a reader can read a page for as long as they like. */
    function poke() {
      stopAuto();
      autoIdle = false;
      scheduleAuto();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopAuto();
      else scheduleAuto();
    });

    /* ----------------------------------------------------------------
       wiring
       ---------------------------------------------------------------- */
    function on(sel, fn) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        el.addEventListener('click', fn);
      });
    }
    /* The artwork viewer's scrim covers the deck, so clicks cannot reach
       these. Keys can: the keydown listener is on document, so it needs an
       explicit guard or an open viewer and the deck would both respond to
       the arrow keys. */
    function deckLive() { return !document.body.classList.contains('lb-open'); }

    on('.sb-arrow.right', function () { if (!deckLive()) return; poke(); step('next'); });
    on('.sb-arrow.left', function () { if (!deckLive()) return; poke(); step('prev'); });
    on('.sb-zone.sb-next', function () { if (!deckLive()) return; poke(); step('next'); });
    on('.sb-zone.sb-prev', function () { if (!deckLive()) return; poke(); step('prev'); });

    /* the viewer drives the deck, so the flip keeps up with full-size
       browsing and closing lands on the poster you were looking at */
    document.addEventListener('lb:index', function (e) {
      if (!e.detail) return;
      var n = ((e.detail.index % f) + f) % f;
      if (n === (turn ? turn.to : cur)) return;
      stopAuto();
      autoIdle = true;
      jump(n);
    });

    /* autoplay holds while the viewer is open, and resumes on close */
    document.addEventListener('lb:open', function (e) {
      var open = !!(e.detail && e.detail.open);
      if (open) { autoIdle = true; stopAuto(); }
      else { poke(); }
    });

    document.addEventListener('keydown', function (e) {
      if (!deckLive()) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      poke();
      step(e.key === 'ArrowRight' ? 'next' : 'prev');
    });

    // Touch swipe, additive to the original's tap zones.
    var sx = 0, sy = 0, tracking = false;
    book.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    book.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { poke(); step(dx < 0 ? 'next' : 'prev'); }
    }, { passive: true });

    // ----------------------------------------------------------------
    // preload, then stack, then (first visit only) riffle through
    // ----------------------------------------------------------------
    var pre = document.createElement('div');
    pre.className = 'sb-preload';
    pre.setAttribute('aria-hidden', 'true');
    pages.forEach(function (p, i) {
        var im = img(p.src, '', true);
        watchOrientation(im, i);
        pre.appendChild(im);
      });
    book.appendChild(pre);

    render();

    var cancel = false;
    setTimeout(function () {
      var decodes = Array.prototype.map.call(
        document.querySelectorAll('.sb-preload img, .sb-stack img'),
        function (im) { return im.decode ? im.decode().catch(function () {}) : null; }
      );
      Promise.race([
        Promise.allSettled(decodes),
        new Promise(function (r) { setTimeout(r, 1500); })
      ]).then(function () {
        setTimeout(function () {
          if (cancel) return;
          if (stacked) return;

          // Stacking replaces the single image with all ten at once, so
          // the last flip never waits on a network/decode.
          stacked = true;
          if (fullEl) { fullEl.remove(); fullEl = null; }
          pre.remove();
          renderFull();

          // Intro riffle, once per browser session.
          var already = false;
          try { already = sessionStorage.getItem(RIBBLE_KEY) === '1'; } catch (e) {}
          if (already || coarse || reduced) { render(); autoStarted = true; scheduleAuto(); return; }
          try { sessionStorage.setItem(RIBBLE_KEY, '1'); } catch (e) {}

          var count = f;
          riffling = true;
          riffleQueue = Array.from({ length: count }, function (_, r) {
            var s = Math.sin(Math.PI * (count <= 1 ? 1 : r / (count - 1)));
            return { from: r % f, to: (r + 1) % f, dur: 0.2 - 0.15 * s, bell: s };
          });
          riffleIdx = 0;
          var s0 = riffleQueue[0];
          turn = { id: ++seq, dir: 'next', from: s0.from, to: s0.to, dur: s0.dur, bell: s0.bell };
          render();
          mountTurn();
        }, 200);
      });
    }, 50);

    window.addEventListener('pagehide', function () { cancel = true; });
  }

  /* ===================================================================
     ThreeUI Generative Tree background.

     Mounted at the configured props. In the published package these are
     passed to <ElementsCollection variant="generative-tree" .../>, which
     strips `variant` and forwards the rest to GenerativeTree — so the
     effect here is the same document the real component builds.

     `variant` is listed for parity with that usage; mountGenerativeTree
     ignores it, exactly as ElementsCollection does after unwrapping.
     =================================================================== */
  function mountGenerativeTreeBackground() {
    var slot = document.querySelector('.shader-frame');
    var threeui = window.__THREEUI_GENERATIVE_TREE__;
    if (!slot || !threeui) return;

    /* Colour. The component ships a warm sienna/amber branch palette on a
       near-black field, which is correct but reads flat at full-screen
       size. These three props are the only colour controls it exposes and
       they are applied as a CSS filter on the iframe, so they tint the
       whole document rather than just the branches -- safe here because
       the field is #0a0a0a, and hue-rotate/saturate barely touch a colour
       that is already almost black.

         saturation 1.3  richer amber, less mud
         brightness 1.25 lifts the highlights so the twigs read as lit
         hue 8          rotates sienna a few degrees toward gold, which is
                        what "shiny" reads as against the blue display line

       Bounded by the component: brightness clamps to [0.35, 1.8] and
       saturation to [0, 2]. */
    threeui.mountGenerativeTree(slot, {
      variant: 'generative-tree',
      speed: 1,
      size: 1,
      particleAmount: 1,
      opacity: 1,
      hue: 8,
      saturation: 1.3,
      brightness: 1.25
    });

    /* Density.

       The component's only density control is MAX_DEPTH, the branch
       recursion depth, and it defaults to 10. It is not a mount prop --
       but the component ships a postMessage channel for it:

         window.addEventListener('message', ...) case 'MAX_DEPTH'

       So this is the component's own supported API rather than an edit to
       its source, and the srcDoc stays byte-identical to the published
       build. That matters: the whole integration is verified against the
       real component's output hash.

       The sandbox is allow-scripts WITHOUT allow-same-origin, so the frame
       is an opaque origin and its DOM is unreachable -- but postMessage
       crosses origins by design, and contentWindow is a live WindowProxy,
       so the channel works. Confirmed the listener survives
       buildFocusedDocument().

       MAX_DEPTH is read when a tree is created, and the tree re-creates
       every cycle, so a message sent after load applies from the next
       tree onward. Resend a couple of times to beat the race with the
       very first tree.

       12 instead of 10 is roughly 1.5x the branches: the tree spawns
       2-3 children per node with progressively harsher pruning at the
       outer depths, and the source explicitly calls that pruning the
       "airy canopy" -- so depth is the intended lever for closing the
       canopy up. Kept at 11 rather than 12 because branch count grows
       geometrically and every branch costs 2-5 painterly strokes plus a
       glow gradient: at 12 the page got heavy enough to stall headless
       frame capture, which is a bad sign for a background animation. */
    var frame = slot.querySelector('iframe');
    if (!frame) return;
    var pushDepth = function () {
      try {
        frame.contentWindow.postMessage(
          { type: 'param', name: 'MAX_DEPTH', value: 11 }, '*');
      } catch (e) { /* opaque origin: postMessage still works, but never throw */ }
    };
    frame.addEventListener('load', pushDepth);
    pushDepth();
    window.setTimeout(pushDepth, 400);
    window.setTimeout(pushDepth, 1200);

    mountDeckPalette(frame);
  }

  /* ==================================================================
     DECK-REACTIVE PALETTE   (experimental -- one flag reverts it)

     The branch colours themselves are a hard-coded warm ramp inside the
     component, and its postMessage channel only accepts MAX_DEPTH and
     GROWTH_SPEED_BASE. So the branches cannot be recoloured directly
     without editing the published source, which the port contract
     forbids.

     What CAN move is the CSS filter the port already puts on the iframe
     to apply hue/saturation/brightness. Retinting that filter is exactly
     as capable as the mount props were, and it needs no remount -- the
     tree keeps growing on the same canvas, so nothing flickers and the
     animation phase is preserved.

     The moods stay in the warm family on purpose. A large hue-rotate on
     a gold canopy turns it acid green, which would fight everything else
     on the page, so the range only ever travels amber -> copper -> rose.
     Negative rotation is the useful direction: gold sits near 45deg, so
     -30deg lands on rose, while +30deg would land on yellow-green.

     Mood 0 is exactly the current mount palette, so the first poster
     looks identical to how the page looks today.

     To A/B it without editing anything, load the page with `?treereact=0`
     to get the old fixed palette back, and drop that to compare the same
     poster both ways. Setting TREE_REACT to false is the real revert. */
  var TREE_REACT = !/[?&]treereact=0(&|$)/.test(location.search);

  var TREE_MOODS = [
    { hue: 8,  sat: 1.30, bright: 1.25 },   // 0: the current amber/gold
    { hue: -5, sat: 1.38, bright: 1.22 },   // 1: deeper amber
    { hue: -16, sat: 1.45, bright: 1.19 },  // 2: copper
    { hue: -27, sat: 1.36, bright: 1.21 }   // 3: rose gold
  ];
  function mountDeckPalette(frame) {
    if (!TREE_REACT || !frame) return;

    function smooth(t) { return t * t * (3 - 2 * t); }

    function moodFor(index, count) {
      /* Sweep the moods across the whole deck rather than stepping one
         mood per poster: at 10 posters and 4 moods that puts real
         intermediate colours between the anchors instead of four hard
         jumps, and it lands the last poster most of the way back to
         mood 0, so the wrap from poster 10 to poster 1 is barely a step.
         Index 0 sits exactly on mood 0, which is today's palette. */
      var n = Math.max(1, count || 1);
      var x = ((index % n) / n) * TREE_MOODS.length;
      var i = Math.min(TREE_MOODS.length - 1, Math.floor(x));
      var a = TREE_MOODS[i];
      var b = TREE_MOODS[(i + 1) % TREE_MOODS.length];
      var t = smooth(Math.min(1, x - i));
      return {
        hue: a.hue + (b.hue - a.hue) * t,
        sat: a.sat + (b.sat - a.sat) * t,
        bright: a.bright + (b.bright - a.bright) * t
      };
    }

    var last = '';
    document.addEventListener('sb:change', function (e) {
      var d = e.detail || {};
      /* the intro riffle flips all ten posters in about a second, and a
         palette chase during that would strobe. The riffle's final
         render fires with riffling=false, so the settled page still
         lands on the right colour. */
      if (d.riffling) return;
      var m = moodFor(d.index || 0, d.count);
      var next = 'hue-rotate(' + m.hue.toFixed(2) + 'deg) saturate(' +
        m.sat.toFixed(3) + ') brightness(' + m.bright.toFixed(3) + ')';
      if (next === last) return;
      last = next;
      frame.style.filter = next;
    });
  }

  /* ==================================================================
     MUSIC PLAYER

     Plays exactly one video, and only when asked. Two decisions drive
     the whole module:

     1. The IFrame Player API is loaded on the FIRST CLICK, not on page
        load. A third-party script on the critical path would delay first
        paint for something most visitors never touch, and the background
        tree is already heavy enough to stall frame capture.

     2. For the same reason the player is constructed inside that click's
        task. Every browser blocks audible autoplay without a user
        gesture, and building the player here is what makes
        playVideo() inside onReady count as gesture-initiated. Lazy
        loading is what makes this work at all, not just an optimisation.

     The radio playlist on the source link is not passed through: only the
     video id goes to the player, so there is no related-video chain to
     roll into.

     Failure is a real branch, not a theoretical one -- YouTube refuses
     to be embedded for some videos (errors 101/150) and this needs no
     network of its own. When the player cannot start, the button turns
     into a link out to the song rather than a control that does nothing.
     ================================================================== */
  var YT_API = 'https://www.youtube.com/iframe_api';
  var YT_API_TIMEOUT = 12000;

  function mountMusicPlayer(root) {
    if (!root) return;
    var btn = root.querySelector('.np-btn');
    var seek = root.querySelector('.np-seek');
    var cur = root.querySelector('.np-cur');
    var dur = root.querySelector('.np-dur');
    var note = root.querySelector('.np-note');
    var host = root.querySelector('.np-frame');
    if (!btn || !seek || !cur || !dur || !note || !host) return;

    var videoId = root.getAttribute('data-video-id');
    var watchUrl = root.getAttribute('data-video-url');
    var player = null;
    var ready = false;
    var loading = false;
    var failed = false;
    var timer = null;
    var scrubbing = false;
    /* What the USER asked for. Kept separately from the player's own
       state, because the two disagree: flipping a poster starves the
       video pipeline and YouTube can answer a stall with PAUSED, which
       has nothing to do with the user wanting silence. */
    var wantPlaying = false;
    var resumes = 0;
    var MAX_RESUMES = 6;

    var fmt = function (s) {
      if (!isFinite(s) || s < 0) s = 0;
      var m = Math.floor(s / 60);
      var r = Math.floor(s % 60);
      return m + ':' + (r < 10 ? '0' : '') + r;
    };

    var label = function (playing) {
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      btn.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + ' O Rangrez');
    };

    var setPlaying = function (on) {
      root.classList.toggle('is-playing', !!on);
      label(on);
    };

    /* Reads position from the player and mirrors it into the UI. Runs on a
       timer rather than a rAF loop: the tree already owns the animation
       budget, and a 4Hz poll for a time readout is imperceptible while
       costing nothing between ticks. */
    var paint = function () {
      if (!ready || !player || failed) return;
      var t = 0, d = 0;
      try { t = player.getCurrentTime() || 0; d = player.getDuration() || 0; } catch (e) { return; }
      if (d) {
        var dt = fmt(d);
        if (dur.textContent !== dt) dur.textContent = dt;
      }
      var p = d ? Math.min(1, Math.max(0, t / d)) : 0;
      cur.textContent = fmt(t);
      seek.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
      /* while a drag is in progress the thumb owns the position, so
         writing --p here would fight the finger */
      if (!scrubbing) {
        seek.value = String(Math.round(p * 1000));
        seek.style.setProperty('--p', p.toFixed(4));
      }
    };

    var stopTimer = function () {
      if (timer) { window.clearInterval(timer); timer = null; }
    };
    var startTimer = function () {
      if (timer) return;
      paint();
      timer = window.setInterval(paint, 250);
    };

    /* WATCHDOG

       The player cannot be trusted to report that it has stopped. Turning
       a poster was observed to put it into PAUSED for a moment, and
       reported state is not the question anyway -- the question is
       whether the music is still advancing. So this measures the one
       thing that actually matters, getCurrentTime(), and if the clock
       has not moved for a few seconds while the user asked for sound, it
       puts it back.

       This also covers the case the state label hides: a player sitting
       on PLAYING with a frozen clock, which no state-change event would
       ever announce. Waiting for a PAUSED event is waiting for a
       symptom that may never be reported.

       playVideo() is a no-op on a healthy player, so the first attempt
       is always safe. Only if that fails to move the clock does it seek,
       because a wedged decoder usually needs the pipeline re-primed --
       and the frame is audio-only, so a re-seek costs nothing visible.
    */
    var lastT = -1;
    var lastTAt = 0;
    var lastAction = 0;
    /* 1500ms, not 3000. The point of this is to make a stall invisible,
       and a two-second gap in a background song is already long enough
       for someone to click the poster again -- which is what the report
       described. A short window also means a genuine buffering pause
       still resolves itself before most people notice it. */
    var STALL_MS = 1500;
    var guard = null;

    var watchdog = function () {
      if (!ready || failed || !wantPlaying || !player) return;
      var t = 0;
      try { t = player.getCurrentTime() || 0; } catch (e) { return; }
      var now = Date.now();

      if (t > lastT + 0.05) {
        /* genuinely playing: forgive the past and reset the attempt log */
        lastT = t;
        lastTAt = now;
        resumes = 0;
        return;
      }
      if (lastT < 0) { lastT = t; lastTAt = now; return; }
      /* a short gap is just buffering; only a sustained freeze counts */
      if (now - lastTAt < STALL_MS) return;
      lastTAt = now;
      if (resumes >= MAX_RESUMES) return;
      resumes++;
      lastAction++;
      try {
        if (lastAction === 1) {
          player.playVideo();
        } else {
          player.seekTo(t, true);
          player.playVideo();
        }
        root.classList.add('is-buffering');
      } catch (e) { /* frame gone; fail() will take over on the next event */ }
    };

    var fail = function (why) {
      failed = true;
      ready = false;
      wantPlaying = false;
      stopTimer();
      if (guard) { window.clearInterval(guard); guard = null; }
      root.classList.remove('is-loading', 'is-playing', 'is-buffering');
      root.classList.add('is-error');
      btn.setAttribute('aria-label', 'Open O Rangrez on YouTube');
      note.textContent = why;
      setPlaying(false);
    };

    var onState = function (e) {
      var s = e.data;
      var P = window.YT && window.YT.PlayerState ? window.YT.PlayerState : {};
      if (s === P.PLAYING) {
        root.classList.remove('is-error', 'is-loading', 'is-buffering');
        setPlaying(true);
        startTimer();
      } else if (s === P.PAUSED) {
        /* A poster turn must not be able to stop the music. If the user
           never asked for silence, a PAUSED here is the pipeline being
           starved, not a decision -- so put it back, with a cap so a
           genuinely wedged player cannot spin here forever. */
        if (wantPlaying && !failed && resumes < MAX_RESUMES) {
          resumes++;
          try { player.playVideo(); } catch (e) { /* fall through to the UI */ }
        } else {
          setPlaying(false);
        }
        stopTimer();
      } else if (s === P.ENDED) {
        /* The song reached its end -- but ENDED also arrives when the
           media pipeline gives up under load, so it cannot be trusted as
           "the user is finished". Treating it that way used to clear
           wantPlaying, which DISARMS the watchdog, leaving the music
           stopped with nothing able to restart it. That is the "stuck"
           bug. So as long as the user still wants sound, start it again.
           The song loops; there is no silent end while play is wanted. */
        seek.value = '0';
        seek.style.setProperty('--p', '0');
        if (wantPlaying && !failed) {
          try {
            player.seekTo(0, true);
            player.playVideo();
          } catch (e) { /* frame gone; the watchdog will notice */ }
        } else {
          setPlaying(false);
          stopTimer();
          paint();
        }
      } else if (s === P.BUFFERING) {
        /* deliberately NOT is-loading: see the .is-buffering note in
           site.css. A stall keeps the pause icon. */
        root.classList.remove('is-loading');
        root.classList.add('is-buffering');
      } else if (s === P.UNSTARTED) {
        root.classList.remove('is-loading', 'is-buffering');
      }
    };

    var create = function () {
      if (player || failed) return;
      try {
        player = new window.YT.Player(host, {
          videoId: videoId,
          playerVars: {
            /* no list / no related chain: this is the single song */
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            fs: 0,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: function (e) {
              player = e.target;
              ready = true;
              wantPlaying = true;
              lastT = -1;
              lastTAt = Date.now();
              lastAction = 0;
              /* Debug handle. The player is otherwise unreachable from the
                 page -- it lives in an opaque-origin iframe that replaced
                 .np-frame, so there is no element to query and no
                 closure to reach. This is the only way to inspect or drive
                 it from the outside, which is what proved necessary when
                 tracking why a poster turn could stall the audio. */
              root.__player = player;
              root.classList.remove('is-loading', 'is-error', 'is-buffering');
              /* one timer for the whole transport, always on once the
                 player exists; it early-returns unless sound is wanted */
              if (!guard) guard = window.setInterval(watchdog, 500);
              /* explicit, because autoplay can still lose the race
                 against a slow handshake */
              try { player.playVideo(); } catch (err) { /* retried by the user */ }
              setPlaying(true);
              startTimer();
            },
            onStateChange: onState,
            onError: function (e) {
              /* 2 invalid param, 5 HTML5 error, 100/101 not found or
                 embedding refused, 150 embedding disallowed */
              fail('Can\'t play here - open on YouTube');
            }
          }
        });
      } catch (err) {
        fail('Can\'t play here - open on YouTube');
      }
    };

    var loadApi = function (done) {
      if (window.YT && window.YT.Player) return done();
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        window.clearTimeout(guard);
        done();
      };
      /* if the script never arrives -- offline, blocked by an extension --
         fail instead of spinning forever */
      var guard = window.setTimeout(function () {
        if (!window.YT || !window.YT.Player) fail('YouTube unavailable - open the song');
        else finish();
      }, YT_API_TIMEOUT);

      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') { try { prev(); } catch (e) { /* previous handler's problem */ } }
        finish();
      };

      if (!document.querySelector('script[src="' + YT_API + '"]')) {
        var tag = document.createElement('script');
        tag.src = YT_API;
        tag.async = true;
        tag.onerror = function () { fail('YouTube unavailable - open the song'); };
        document.head.appendChild(tag);
      }
    };

    btn.addEventListener('click', function () {
      /* once it has failed the control is a link out, not a transport */
      if (failed) {
        window.open(watchUrl, '_blank', 'noopener');
        return;
      }
      if (loading) return;

      if (!ready) {
        loading = true;
        root.classList.add('is-loading');
        btn.setAttribute('aria-label', 'Loading O Rangrez');
        loadApi(function () {
          loading = false;
          if (failed) return;
          if (!window.YT || !window.YT.Player) { fail('YouTube unavailable - open the song'); return; }
          create();
        });
        return;
      }

      try {
        var P = window.YT.PlayerState;
        if (player.getPlayerState() === P.PLAYING) {
          wantPlaying = false;
          player.pauseVideo();
        } else {
          /* a real press is the gesture that clears the resume cap */
          wantPlaying = true;
          resumes = 0;
          player.playVideo();
        }
      } catch (e) {
        fail('Can\'t play here - open on YouTube');
      }
    });

    /* live position while dragging, committed on release */
    seek.addEventListener('pointerdown', function () { scrubbing = true; });
    seek.addEventListener('input', function () {
      var p = Math.min(1, Math.max(0, seek.value / 1000));
      seek.style.setProperty('--p', p.toFixed(4));
      if (!ready) return;
      var d = 0;
      try { d = player.getDuration() || 0; } catch (e) { return; }
      if (!d) return;
      var t = p * d;
      cur.textContent = fmt(t);
      seek.setAttribute('aria-valuetext', fmt(t) + ' of ' + fmt(d));
    });
    var commit = function () {
      scrubbing = false;
      if (!ready) return;
      var d = 0;
      try { d = player.getDuration() || 0; } catch (e) { return; }
      if (d) player.seekTo(d * (seek.value / 1000), true);
    };
    seek.addEventListener('change', commit);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', function () { scrubbing = false; });

    /* no polling while the tab is hidden: the tree already stops itself
       there, and a 4Hz timer against a YouTube player is pure waste.
       Coming back is the riskier moment -- a background tab is exactly
       where a decoder gets suspended -- so re-assert playback then. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopTimer(); return; }
      if (ready && player && wantPlaying) {
        try { player.playVideo(); } catch (e) { /* not ready */ }
      }
      startTimer();
    });
    /* a tab restored from bfcache comes back with its media suspended */
    window.addEventListener('pageshow', function () {
      if (ready && player && wantPlaying) {
        try { player.playVideo(); } catch (e) { /* not ready */ }
      }
    });
    window.addEventListener('focus', function () {
      if (!ready || !player || !wantPlaying) return;
      /* only if the clock is actually frozen; focus alone is not a reason
         to restart a healthy player */
      try {
        var a = player.getCurrentTime();
        window.setTimeout(function () {
          try {
            if (player.getCurrentTime() <= a + 0.05) player.playVideo();
          } catch (e) { /* frame gone */ }
        }, 600);
      } catch (e) { /* not ready */ }
    });

    /* the song ends, or the page is closed mid-play: leave no sound behind */
    window.addEventListener('pagehide', function () {
      if (guard) { window.clearInterval(guard); guard = null; }
      if (!ready || !player) return;
      try { player.stopVideo(); } catch (e) { /* frame already gone */ }
    });
  }

  /* ==================================================================
     BOOK PARALLAX   (tier 4)

     A few degrees of tilt toward the pointer, eased with a per-frame
     lerp so it trails the cursor instead of snapping to it. The tilt is
     written as two custom properties rather than a transform string so
     the transform itself stays in CSS, next to the media queries that
     switch it off.

     Skipped entirely for reduced-motion and for coarse pointers: a tilt
     that follows a finger is just jitter, and there is no cursor to
     anticipate.
     ================================================================== */
  function mountBookParallax() {
    var stage = document.querySelector('.sb-stage');
    if (!stage) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var MAX = 3.2;              // degrees
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;

    function loop() {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      stage.style.setProperty('--tilt-y', cx.toFixed(3) + 'deg');
      stage.style.setProperty('--tilt-x', cy.toFixed(3) + 'deg');
      /* stop the loop once it has settled, rather than burning a rAF on
         an animation that is visually finished */
      if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) {
        raf = window.requestAnimationFrame(loop);
      } else {
        raf = 0;
      }
    }
    function start() { if (!raf) raf = window.requestAnimationFrame(loop); }

    function aim(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var nx = (e.clientX / window.innerWidth) * 2 - 1;
      var ny = (e.clientY / window.innerHeight) * 2 - 1;
      tx = Math.max(-1, Math.min(1, nx)) * MAX;
      ty = Math.max(-1, Math.min(1, ny)) * -MAX;   // inverted: tilt away
      start();
    }
    function recentre() { tx = 0; ty = 0; start(); }

    window.addEventListener('pointermove', aim, { passive: true });
    document.addEventListener('mouseleave', recentre, { passive: true });
    window.addEventListener('blur', recentre);
  }

  /* ==================================================================
     CANOPY TREMOR   (tier 4)

     The intuitive version of this is the canopy shaking when a page
     turns, and that is not reachable here: `.hero` wins the hit test, so
     the component's own click/shake handler never sees the click, and
     its postMessage channel only accepts MAX_DEPTH and GROWTH_SPEED_BASE.
     Reaching into the frame is out too -- the sandbox has no
     allow-same-origin, so the document is a unique opaque origin and its
     events cannot be dispatched from here. Doing it properly would mean
     editing the published source and losing the byte-identical guarantee.

     So this shakes the whole tree layer instead. It is a camera tremor
     rather than a per-branch sway, but at this scale it reads the same
     and it needs no access to anything.

     Web Animations API rather than a class toggle, so re-triggering it
     mid-tremor restarts cleanly instead of depending on animationend
     timing.
     ================================================================== */
  function mountCanopyTremor() {
    var slot = document.querySelector('.shader-frame');
    if (!slot || !slot.animate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.addEventListener('sb:change', function (e) {
      var d = e.detail || {};
      /* the intro riffle fires ten of these in about a second; a tremor
         per event would be a shudder, not an effect */
      if (d.riffling) return;
      slot.animate([
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(-2px, .6px, 0)', offset: .28 },
        { transform: 'translate3d(1.2px, -.5px, 0)', offset: .62 },
        { transform: 'translate3d(0, 0, 0)' }
      ], { duration: 240, easing: 'cubic-bezier(.25, .6, .3, 1)' });
    });
  }

  /* ==================================================================
     ARTWORK VIEWER

     The posters flip at min(52svh, 500px), which is the right size for
     browsing and the wrong size for looking at art. This opens one at
     full size and walks the whole deck from there.

     It does not keep its own copy of the deck state. Every move dispatches
     `lb:index`, and the sketchbook turns to match behind the scrim, so the
     flip, the palette and the canopy tremor all keep running in step while
     you browse full size -- and closing leaves the deck on the poster you
     were last looking at rather than wherever autoplay had wandered to.
     ================================================================== */
  function mountArtworkViewer() {
    var lb = document.querySelector('.lb');
    var dataEl = document.getElementById('sketchbook-data');
    var openBtn = document.querySelector('.sb-expand');
    if (!lb || !dataEl || !openBtn) return;

    var pages;
    try { pages = JSON.parse(dataEl.textContent); } catch (e) { return; }
    if (!pages || pages.length < 2) return;

    var f = pages.length;
    var img = lb.querySelector('.lb-img');
    var title = lb.querySelector('.lb-title');
    var count = lb.querySelector('.lb-count');
    var btnClose = lb.querySelector('.lb-close');
    var btnPrev = lb.querySelector('.lb-prev');
    var btnNext = lb.querySelector('.lb-next');
    if (!img || !title || !count || !btnClose || !btnPrev || !btnNext) return;

    var at = 0;
    var isOpen = false;
    var restore = null;

    /* Where the deck currently is. Written by the sketchbook on every
       render, so the viewer opens on whatever the visitor was looking at
       rather than resetting to page 1. */
    function deckIndex() {
      var raw = document.body.getAttribute('data-poster');
      var n = raw == null ? NaN : parseInt(raw, 10);
      return isNaN(n) ? 0 : ((n % f) + f) % f;
    }

    /* Preload the neighbours, so arrow navigation is instant instead of
       flashing empty. */
    var warmed = {};
    function warm(n) {
      if (warmed[n]) return;
      warmed[n] = new Image();
      warmed[n].src = pages[n].src;
    }
    function warmAround(n) {
      warm(n); warm((n + 1) % f); warm((n - 1 + f) % f);
    }

    function show(n) {
      at = ((n % f) + f) % f;
      var p = pages[at];
      if (img.getAttribute('src') !== p.src) img.src = p.src;
      img.alt = p.title;
      title.textContent = p.title;
      count.textContent = (at < 9 ? '0' : '') + (at + 1) + ' / ' + (f < 10 ? '0' : '') + f;
      warmAround(at);
    }

    function tellDeck() {
      try {
        document.dispatchEvent(new CustomEvent('lb:index', { detail: { index: at } }));
      } catch (e) { /* no CustomEvent: the deck just does not follow */ }
    }

    function go(d) { show(at + d); tellDeck(); }

    function open(n) {
      if (isOpen) return;
      restore = document.activeElement;
      show(n);
      lb.hidden = false;
      isOpen = true;
      document.body.classList.add('lb-open');
      /* focus the close button, not the dialog: the dialog is not
         focusable and the first Tab would otherwise escape the trap */
      btnClose.focus();
      try {
        document.dispatchEvent(new CustomEvent('lb:open', { detail: { open: true } }));
      } catch (e) { /* ignore */ }
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      lb.hidden = true;
      document.body.classList.remove('lb-open');
      if (restore && restore.focus) restore.focus();
      restore = null;
      try {
        document.dispatchEvent(new CustomEvent('lb:open', { detail: { open: false } }));
      } catch (e) { /* ignore */ }
    }

    function focusables() {
      return Array.prototype.filter.call(
        lb.querySelectorAll('button'),
        function (b) { return !b.disabled; }
      );
    }

    openBtn.addEventListener('click', function () { open(deckIndex()); });
    btnClose.addEventListener('click', close);
    btnPrev.addEventListener('click', function () { go(-1); });
    btnNext.addEventListener('click', function () { go(1); });

    /* scrim and backdrop-filter-free close target */
    Array.prototype.forEach.call(lb.querySelectorAll('[data-lb-close]'), function (el) {
      el.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;

      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }

      /* Focus trap. Without this, Tab walks straight out of the dialog and
         into the deck behind the scrim, which is still in the tab order
         and is not visible. */
      if (e.key !== 'Tab') return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  }

  function start() {
    mountGenerativeTreeBackground();
    mountMusicPlayer(document.querySelector('.np'));
    boot();
    mountBookParallax();
    mountCanopyTremor();
    mountArtworkViewer();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
