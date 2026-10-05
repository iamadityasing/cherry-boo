/* =====================================================================
   verify-threeui.mjs

   Regression guard for the Generative Tree background.

   Expected values were captured by rendering the REAL published component
   (@designcodeio/threeui@1.2.0, GenerativeTree.js) under a stub React and
   reading the srcDoc + inline styles it actually produces. This script
   re-derives the same values from this project's dependency-free port and
   compares them.

   Run:  node tools/verify-threeui.mjs
   Exits non-zero on any mismatch.
   ===================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const REGISTERED_SOURCE_SHA =
  '8ea51733bddf5cc44df338ef9af3a21633d62daa92c17fde5faa2fcab90fa0ef';

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* ---- ground truth captured from the published component ---- */

const CASES = [
  { name: 'configured', size: 1, particleAmount: 1, sha: '39126cce63c9e4b9df257cac18ce3dc53cc3944ae3bb84867eae34b2b832f2bf' },
  { name: 'defaults',   size: 1, particleAmount: 1, sha: '39126cce63c9e4b9df257cac18ce3dc53cc3944ae3bb84867eae34b2b832f2bf' },
  { name: 'size-0.65',  size: 0.65, particleAmount: 1, sha: '13faa5f64f32b3a099ad5460272a0a3e227ccb35c4f0f801eb6567136a166f05' },
  { name: 'size-0.8',   size: 0.8, particleAmount: 1, sha: '2fe24cc983a2da11638701ac0208db994ee86e227708317c2f51ebb25ea224a0' },
  { name: 'size-1.4',   size: 1.4, particleAmount: 1, sha: 'd71582e17d53d6199e2f4e6c583bd009dced73fdeff7811a9d980716a35689bf' },
  { name: 'size-1.5',   size: 1.5, particleAmount: 1, sha: '4c77cfa6bf1fb7ff7ac611f2e17fc830b68732a37b118303c8999ef3cd42afe6' },
  { name: 'pa-0.2',     size: 1, particleAmount: 0.2, sha: 'ae89f2899df4ff6884239c3e8868f9614bb92d0abf8662fc49c0e301404678fb' },
  { name: 'pa-1.4',     size: 1, particleAmount: 1.4, sha: 'de1301ac913c410f8da5e43b1ded24ba228c37ad23cc7df38e5d46a1132ea74f' },
];

const EXPECTED = {
  hostClassName: 'threeui-background generative-tree',
  hostStyle: { background: '#0a0a0a', pointerEvents: 'auto' },
  iframeTitle: 'Generative Tree background',
  iframeSandbox: 'allow-scripts',
  iframeAriaHidden: 'true',
  iframeTabIndex: -1,
  iframeStyle: {
    position: 'absolute',
    inset: 0,
    display: 'block',
    width: '100%',
    height: '100%',
    border: 0,
    background: '#0a0a0a',
    opacity: 1,
    filter: 'hue-rotate(0deg) saturate(1) brightness(1)',
  },
};

/* ---- minimal DOM so mountGenerativeTree() can run under node ---- */

function makeEl(tag) {
  const el = {
    tagName: tag,
    className: '',
    style: {},
    attrs: {},
    children: [],
    listeners: {},
    title: '',
    tabIndex: undefined,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
  };
  return el;
}

const sandbox = {
  window: {},
  document: {
    hidden: false,
    createElement: makeEl,
    addEventListener() {},
  },
  IntersectionObserver: undefined,
  console,
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);

const load = (rel) =>
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        expected: ${expected}\n        actual:   ${actual}`);
};

load('js/threeui-generative-tree-source.js');
load('js/threeui-generative-tree.js');
const api = sandbox.window.__THREEUI_GENERATIVE_TREE__;
check('port exposes its API', typeof api?.buildFocusedDocument, 'function');
check('port defaults match published defaults',
  JSON.stringify(api.GENERATIVE_TREE_DEFAULTS),
  JSON.stringify({ speed: 1, size: 1, particleAmount: 1, opacity: 1, hue: 0, saturation: 1, brightness: 1 }));

/* ---- 1. the canonical source is the registered file, unmodified ---- */

const rawSrc = sandbox.window.__GENERATIVE_TREE_SOURCE__;
check('canonical source sha256 matches registered file', sha(rawSrc), REGISTERED_SOURCE_SHA);
check('cloudflare beacon still present in raw source (so the strip has a target)',
  /cloudflareinsights\.com/.test(rawSrc), true);

/* ---- 2. buildFocusedDocument() == the real component's srcDoc ---- */

for (const c of CASES) {
  const doc = api.buildFocusedDocument(c.size, c.particleAmount);
  check(`buildFocusedDocument(${c.size}, ${c.particleAmount}) -> ${c.name}`, sha(doc), c.sha);
}

/* ---- 3. all eight string transforms actually fired ---- */

const focused = api.buildFocusedDocument(1, 1);
check('transform 1  cloudflare beacon stripped', focused.includes('cloudflareinsights.com'), false);
check('transform 2  focus style injected', focused.includes('<style data-generative-tree-focus>'), true);
check('transform 2  controls script injected', focused.includes('<script data-generative-tree-controls>'), true);
check('transform 3  PARTICLE_COUNT rewritten', focused.includes('const PARTICLE_COUNT = 50;'), true);
check('transform 4  _pad pinned to size', focused.includes('const _pad = 1.0000;'), true);
check('transform 4  URLSearchParams pad lookup gone', focused.includes("get('p')"), false);
check('transform 5  paused guard in frame()', focused.includes('if (window.__GENERATIVE_TREE_CONTROLS.paused)'), true);
check('transform 6  growth step scaled by speed', focused.includes('b.growthSpeed * window.__GENERATIVE_TREE_CONTROLS.speed'), true);
check('transform 7  holdTimer scaled', focused.includes('holdTimer += window.__GENERATIVE_TREE_CONTROLS.speed;'), true);
check('transform 8  fadeTimer scaled', focused.includes('fadeTimer += window.__GENERATIVE_TREE_CONTROLS.speed;'), true);
check('transform 9  waitTimer scaled', focused.includes('waitTimer += window.__GENERATIVE_TREE_CONTROLS.speed;'), true);
check('transform 10 sizing gate replaces eager boot', focused.includes('function startTreeWhenSized()'), true);
check('transform 10 no eager createTree(); rAF', focused.includes('  createTree();\n  requestAnimationFrame(frame);'), false);

/* ---- 4. clamping matches the component ---- */

check('size clamps low  (0.2 -> 0.65)', api.buildFocusedDocument(0.2, 1).includes('const _pad = 1.5385;'), true);
check('size clamps high (9   -> 1.5)',  api.buildFocusedDocument(9, 1).includes('const _pad = 0.6667;'), true);
check('particle clamps high (9 -> 100)', api.buildFocusedDocument(1, 9).includes('const PARTICLE_COUNT = 100;'), true);
check('particle clamps low  (9 -> 0)',   api.buildFocusedDocument(1, -9).includes('const PARTICLE_COUNT = 0;'), true);

/* ---- 5. mounted DOM + inline styles match the published component ---- */

const container = makeEl('div');
const mounted = api.mountGenerativeTree(container, {
  speed: 1, size: 1, particleAmount: 1, opacity: 1, hue: 0, saturation: 1, brightness: 1,
});
const host = mounted.host;
const iframe = mounted.iframe;

check('host className', host.className, EXPECTED.hostClassName);
for (const [k, v] of Object.entries(EXPECTED.hostStyle)) {
  check(`host style.${k}`, host.style[k], v);
}
check('iframe title', iframe.title, EXPECTED.iframeTitle);
check('iframe sandbox', iframe.getAttribute('sandbox'), EXPECTED.iframeSandbox);
check('iframe aria-hidden', iframe.getAttribute('aria-hidden'), EXPECTED.iframeAriaHidden);
check('iframe tabIndex', iframe.tabIndex, EXPECTED.iframeTabIndex);
for (const [k, v] of Object.entries(EXPECTED.iframeStyle)) {
  check(`iframe style.${k}`, iframe.style[k], String(v));
}
check('host appended to container', container.children[0] === host, true);
check('iframe appended to host', host.children[0] === iframe, true);
check('iframe srcdoc matches configured document', sha(iframe.srcdoc), CASES[0].sha);
check('load listener registered for controls sync', Boolean(iframe.listeners.load), true);

console.log(
  failures === 0
    ? '\nAll checks passed — port is byte-identical to the published component.'
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
