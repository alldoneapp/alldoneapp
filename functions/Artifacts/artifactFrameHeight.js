'use strict'

// Natural-height artifact frames (AT-2881).
//
// An HTML artifact is framed on serveArtifact's own origin with a sandbox that leaves out
// allow-same-origin, so the app can never look inside the frame to measure it. Without help the
// frame therefore had a fixed height and its own scrollbar, nested in the scrolling page around it.
// The page has to say how tall it is, and only the page can:
//
//   - serveArtifact appends FRAME_HEIGHT_SCRIPT to an HTML response only when the browser loads it
//     INTO a frame (`Sec-Fetch-Dest: iframe`). Opening the artifact full screen, downloading it or
//     fetching it never gets the script, so the stored file is what those see. The response varies
//     on that header, so a cached copy of one shape is never served as the other.
//   - The script measures the document and posts `{ protocol, type: 'height', height }` to its
//     parent, and nothing else: no data goes in, the number goes out.
//   - The app (useArtifactFrameHeight) accepts the number only from that frame's own window and
//     only from an opaque origin, clamps it, and ignores sub-pixel jitter.
//
// Nothing about the sandbox or the CSP changes: the script runs with exactly the rights the page's
// own script already has, and the bridge policy already allows inline script.
//
// Resize loops. A page whose height follows its viewport (`min-height: calc(100vh + 40px)`) grows
// every time the frame grows; one whose bottom element is absolutely positioned can flip between
// two heights. The script detects both (a growth that keeps overflowing by the same amount, and an
// A→B→A alternation) and settles; a runaway that slips past them stops after a burst limit, and the
// app caps the height. A settled frame simply keeps its inner scrollbar — today's behaviour.

const ARTIFACT_FRAME_PROTOCOL = 'alldone-frame-v1'
const MIN_FRAME_CONTENT_HEIGHT = 40
const MAX_FRAME_CONTENT_HEIGHT = 60000

// Plain ES5, appended after the document so it never disturbs the doctype or the head. It removes
// its own element so a page's `body > :last-child` styling is not affected.
const FRAME_HEIGHT_SCRIPT = `(function () {
  try {
    var me = document.currentScript;
    if (me && me.parentNode) me.parentNode.removeChild(me);
  } catch (e) {}
  if (!window.parent || window.parent === window) return;
  var PROTOCOL = '${ARTIFACT_FRAME_PROTOCOL}';
  var MAX = ${MAX_FRAME_CONTENT_HEIGHT};
  var REACTION_MS = 250;
  var last = 0, lastAt = 0, previous = 0, previousAt = 0, floor = 0, coupled = 0, lastOverflow = -1, frozenGrowth = false;
  var BURST = 30, MAX_PAUSES = 5;
  var burst = [], pauses = 0, paused = false, stopped = false, queued = false;
  function num(value) { var n = parseFloat(value); return isFinite(n) ? n : 0; }
  function measure() {
    var root = document.documentElement, body = document.body;
    if (!root) return 0;
    var view = root.clientHeight || window.innerHeight || 0;
    var bar = Math.max(0, (window.innerHeight || view) - view);
    var scroll = Math.max(root.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
    if (scroll > view + 1) return { height: Math.ceil(scroll + bar), overflow: scroll - view };
    var bottom = 0;
    if (body) {
      var rect = body.getBoundingClientRect();
      var style = window.getComputedStyle ? window.getComputedStyle(body) : null;
      bottom = rect.bottom + (window.pageYOffset || 0) + (style ? num(style.marginBottom) : 0);
    }
    return { height: Math.ceil(Math.max(bottom, 1) + bar), overflow: 0 };
  }
  function report() {
    queued = false;
    if (stopped) return;
    var m = measure();
    if (!m) return;
    var height = Math.min(MAX, Math.max(m.height, floor));
    if (Math.abs(height - last) < 2) return;
    var now = new Date().getTime();
    // Our own resize answered within a moment: a reaction to the frame, not to the page.
    var reaction = last && now - lastAt < REACTION_MS;
    if (height > last) {
      if (frozenGrowth) return;
      if (reaction && m.overflow > 0 && Math.abs(m.overflow - lastOverflow) < 2) {
        coupled += 1;
        if (coupled >= 4) { frozenGrowth = true; return; }
      } else coupled = 0;
      lastOverflow = m.overflow;
    }
    if (reaction && previous && now - previousAt < 2 * REACTION_MS && Math.abs(height - previous) < 2) {
      floor = Math.max(height, last);
      height = floor;
      if (Math.abs(height - last) < 2) return;
    }
    burst.push(now);
    while (burst.length && now - burst[0] > 1000) burst.shift();
    if (burst.length > BURST) {
      // A height animation also gets here; it just reports its end state a moment later. Only a
      // page that keeps bursting after several pauses is given up on.
      burst = [];
      pauses += 1;
      if (pauses > MAX_PAUSES) { stopped = true; return; }
      paused = true;
      setTimeout(function () { paused = false; schedule(); }, 1000);
      return;
    }
    previous = last;
    previousAt = lastAt;
    last = height;
    lastAt = now;
    window.parent.postMessage({ protocol: PROTOCOL, type: 'height', height: height }, '*');
  }
  // Animation frames are throttled in a cross-origin frame that is off screen, so a timer runs too;
  // whichever comes first measures, once.
  function schedule() {
    if (queued || stopped || paused) return;
    queued = true;
    var done = false;
    var run = function () { if (done) return; done = true; report(); };
    if (window.requestAnimationFrame) window.requestAnimationFrame(run);
    setTimeout(run, 50);
  }
  try {
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(schedule);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
  } catch (e) {}
  try {
    if (window.MutationObserver) {
      new MutationObserver(schedule).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, characterData: true
      });
    }
  } catch (e) {}
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('load', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('animationend', schedule, true);
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule); } catch (e) {}
  schedule();
})();`

const FRAME_HEIGHT_SCRIPT_TAG = `\n<script data-alldone-frame-height>${FRAME_HEIGHT_SCRIPT}</script>\n`

function readHeader(req, name) {
    if (req && typeof req.get === 'function') return req.get(name)
    const headers = (req && req.headers) || {}
    return headers[name.toLowerCase()]
}

// Only an HTML document loaded into a frame reports its height; everything else is served as stored.
function shouldReportFrameHeight(req, mimeType) {
    if (mimeType !== 'text/html') return false
    const dest = readHeader(req, 'sec-fetch-dest')
    return String(Array.isArray(dest) ? dest[0] : dest || '').toLowerCase() === 'iframe'
}

// Appends the script as bytes, so the document's own bytes (and their encoding) stay untouched.
function appendFrameHeightScript(bytes) {
    return Buffer.concat([Buffer.from(bytes), Buffer.from(FRAME_HEIGHT_SCRIPT_TAG, 'utf8')])
}

// The height a frame reported, made safe to apply, or null if the message is not one.
function readFrameHeightMessage(data) {
    if (!data || typeof data !== 'object') return null
    if (data.protocol !== ARTIFACT_FRAME_PROTOCOL || data.type !== 'height') return null
    const height = Number(data.height)
    if (!Number.isFinite(height) || height <= 0) return null
    return Math.min(MAX_FRAME_CONTENT_HEIGHT, Math.max(MIN_FRAME_CONTENT_HEIGHT, Math.ceil(height)))
}

module.exports = {
    ARTIFACT_FRAME_PROTOCOL,
    FRAME_HEIGHT_SCRIPT,
    FRAME_HEIGHT_SCRIPT_TAG,
    MAX_FRAME_CONTENT_HEIGHT,
    MIN_FRAME_CONTENT_HEIGHT,
    appendFrameHeightScript,
    readFrameHeightMessage,
    shouldReportFrameHeight,
}
