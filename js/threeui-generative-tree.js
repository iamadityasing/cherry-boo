/* =====================================================================
   threeui-generative-tree.js

   Dependency-free port of the @designcodeio/threeui `GenerativeTree`
   element for this static project. Rendered markup, inline styles and
   lifecycle are reproduced 1:1 from the published component; the only
   difference is that it mounts with plain DOM calls instead of React.

   Registered source (revision 7a6871fe99fa):
     src/shaders/elements/GenerativeTree.tsx
       sha256 bb6bf95154f38e7a9772eef6fe2aa89ff72284a13345d56e66fba234894c2127
     src/shaders/elements/sources/generative-tree.html
       sha256 8ea51733bddf5cc44df338ef9af3a21633d62daa92c17fde5faa2fcab90fa0ef

   The canonical document is NOT hand-written. It ships verbatim in
   threeui-generative-tree-source.js, and buildFocusedDocument() applies
   the same ordered string transforms as the published buildFocusedDocument.
   `node tools/verify-threeui.mjs` asserts the result is byte-identical to
   the srcDoc the real component produces.
   ===================================================================== */
(function (global) {
  'use strict';

  var GENERATIVE_TREE_DEFAULTS = {
    speed: 1,
    size: 1,
    particleAmount: 1,
    opacity: 1,
    hue: 0,
    saturation: 1,
    brightness: 1
  };

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /* ---------------------------------------------------------------------
     Injected in place of </head>. Byte-for-byte the same markup the
     published component injects.
     --------------------------------------------------------------------- */
  var FOCUS_HEAD = `<style data-generative-tree-focus>
html, body, canvas { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #0a0a0a; }
.label { display: none !important; }
</style><script data-generative-tree-controls>
(function () {
  var nativeFrame = window.requestAnimationFrame.bind(window);
  var clock = { last: null, time: null };
  window.__GENERATIVE_TREE_CONTROLS = { speed: 1, paused: false };
  window.requestAnimationFrame = function (callback) {
    return nativeFrame(function (realTime) {
      var state = window.__GENERATIVE_TREE_CONTROLS;
      if (clock.last === null) {
        clock.last = realTime;
        clock.time = realTime;
      } else {
        if (!state.paused) clock.time += (realTime - clock.last) * state.speed;
        clock.last = realTime;
      }
      callback(clock.time);
    });
  };
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'generative-tree-controls') return;
    var next = event.data.controls || {};
    if (Number.isFinite(next.speed)) {
      window.__GENERATIVE_TREE_CONTROLS.speed = Math.max(0, Math.min(3, next.speed));
    }
    window.__GENERATIVE_TREE_CONTROLS.paused = Boolean(next.paused);
  });
})();
</script></head>`;

  var FRAME_HEAD_MATCH = `function frame(time) {
    // Decay shake`;

  var FRAME_HEAD_PATCH = `function frame(time) {
    if (window.__GENERATIVE_TREE_CONTROLS.paused) { requestAnimationFrame(frame); return; }

    // Decay shake`;

  var BOOT_TAIL = `  createTree();
  requestAnimationFrame(frame);`;

  var BOOT_TAIL_PATCHED = `  function startTreeWhenSized() {
    resize();
    if (W <= 0 || H <= 0) {
      requestAnimationFrame(startTreeWhenSized);
      return;
    }
    createTree();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(startTreeWhenSized);`;

  var GROWTH_STEP =
    'b.growthProgress = Math.min(1, b.growthProgress + b.growthSpeed);';
  var GROWTH_STEP_PATCHED =
    'b.growthProgress = Math.min(1, b.growthProgress + b.growthSpeed * window.__GENERATIVE_TREE_CONTROLS.speed);';

  function buildFocusedDocument(size, particleAmount) {
    var particleCount = Math.max(0, Math.round(50 * clamp(particleAmount, 0, 2)));
    var treePadding = 1 / clamp(size, 0.65, 1.5);

    return global.__GENERATIVE_TREE_SOURCE__
      .replace(/<script[^>]+cloudflareinsights\.com[^>]*><\/script>/gi, '')
      .replace('</head>', FOCUS_HEAD)
      .replace('const PARTICLE_COUNT = 50;', 'const PARTICLE_COUNT = ' + particleCount + ';')
      .replace(
        "const _pad = parseFloat(new URLSearchParams(location.search).get('p')) || 1;",
        'const _pad = ' + treePadding.toFixed(4) + ';'
      )
      .replace(FRAME_HEAD_MATCH, FRAME_HEAD_PATCH)
      .replace(GROWTH_STEP, GROWTH_STEP_PATCHED)
      .replace('holdTimer++;', 'holdTimer += window.__GENERATIVE_TREE_CONTROLS.speed;')
      .replace('fadeTimer++;', 'fadeTimer += window.__GENERATIVE_TREE_CONTROLS.speed;')
      .replace('waitTimer++;', 'waitTimer += window.__GENERATIVE_TREE_CONTROLS.speed;')
      .replace(BOOT_TAIL, BOOT_TAIL_PATCHED);
  }

  /* ---------------------------------------------------------------------
     Mount. Mirrors GenerativeTree's render + its three effects:
       - IntersectionObserver on the iframe -> pause when off-screen
       - document visibilitychange         -> pause in a hidden tab
       - postMessage {speed, paused} on load and whenever those change
     --------------------------------------------------------------------- */
  function mountGenerativeTree(container, options) {
    var props = {};
    var key;
    for (key in GENERATIVE_TREE_DEFAULTS) props[key] = GENERATIVE_TREE_DEFAULTS[key];
    if (options) {
      for (key in options) {
        if (Object.prototype.hasOwnProperty.call(options, key) && options[key] !== undefined) {
          props[key] = options[key];
        }
      }
    }

    var className = props.className || '';
    var speed = clamp(props.speed, 0, 3);

    var intersecting = true;
    var pageVisible = typeof document === 'undefined' || !document.hidden;

    var host = document.createElement('div');
    host.className =
      'threeui-background generative-tree' + (className ? ' ' + className : '');
    host.style.background = '#0a0a0a';
    host.style.pointerEvents = 'auto';

    var iframe = document.createElement('iframe');
    iframe.title = 'Generative Tree background';
    iframe.srcdoc = buildFocusedDocument(props.size, props.particleAmount);
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;

    var style = iframe.style;
    style.position = 'absolute';
    style.inset = '0';
    style.display = 'block';
    style.width = '100%';
    style.height = '100%';
    style.border = '0';
    style.background = '#0a0a0a';
    style.opacity = String(clamp(props.opacity, 0.05, 1));
    style.filter =
      'hue-rotate(' + clamp(props.hue, -180, 180) + 'deg) ' +
      'saturate(' + clamp(props.saturation, 0, 2) + ') ' +
      'brightness(' + clamp(props.brightness, 0.35, 1.8) + ')';

    host.appendChild(iframe);

    function isPaused() {
      return !intersecting || !pageVisible || speed === 0;
    }

    function syncControls() {
      if (!iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        {
          type: 'generative-tree-controls',
          controls: { speed: speed, paused: isPaused() }
        },
        '*'
      );
    }

    iframe.addEventListener('load', syncControls);

    if (typeof IntersectionObserver !== 'undefined') {
      var observer = new IntersectionObserver(function (entries) {
        var entry = entries[0];
        intersecting = entry ? entry.isIntersecting !== false : true;
        syncControls();
      });
      observer.observe(iframe);
    }

    document.addEventListener('visibilitychange', function () {
      pageVisible = !document.hidden;
      syncControls();
    });

    if (container) container.appendChild(host);
    syncControls();

    return { host: host, iframe: iframe, syncControls: syncControls };
  }

  global.__THREEUI_GENERATIVE_TREE__ = {
    GENERATIVE_TREE_DEFAULTS: GENERATIVE_TREE_DEFAULTS,
    clamp: clamp,
    buildFocusedDocument: buildFocusedDocument,
    mountGenerativeTree: mountGenerativeTree
  };
})(typeof window !== 'undefined' ? window : this);
