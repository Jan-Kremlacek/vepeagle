/* =============================================================================
   vep_engine.js — shared core for the VEP stimulation set
   -----------------------------------------------------------------------------
   Loaded by each stimulus via a classic <script src="vep_engine.js"></script>
   (no ES module, so it works from file:// too). Exposes a single global `VEP`.

   This is v1.2.0. Modules are extracted one at a time, each verified before the
   next is moved, so the working reference is never broken blind.
   Roadmap: [x] watchdog, [x] calibration decode, [x] gamma LUT helpers,
   [x] child-window link (messaging + handshake + standalone window),
   [x] WebGL renderer + shader: ONE shared renderer (VEP.createPatternRenderer)
       and ONE shared shader (VEP.PATTERN_VERT / VEP.PATTERN_FRAG) used by all
       four stimuli — pattern_onset, pattern_reversal, motion_onset, and flash
       (uniform-field mode: setFieldColor + render with patternOn=false).
   [x] parity/debug helpers (per-stimulus; ?parity=1 + webgl_parity_test.html).
   ========================================================================== */
(function (root) {
  'use strict';
  const VEP = root.VEP = root.VEP || {};
  /* ── Pause note ────────────────────────────────────────────────────────
     Shows / hides the "▮▮ PAUSED — press Space to resume" note in the
     stimulus window. Kept in the engine so all four stimuli behave the same.

     Robustness: the note is position:fixed, so entering fullscreen changes its
     containing block, and a stacking context created by an ancestor can hide it
     behind the canvas. We therefore re-parent it to <body> and force a top
     z-index on every show, rather than trusting the markup's inline style. */
  VEP.showPauseNote = function (show) {
    const pn = document.getElementById('pauseNote');
    if (!pn) return;
    if (show) {
      if (pn.parentElement !== document.body) document.body.appendChild(pn);
      pn.style.zIndex = '2147483600';
      pn.style.position = 'fixed';
      pn.style.display = 'block';
    } else {
      pn.style.display = 'none';
    }
  };

  /* ── Child-window waiting note ─────────────────────────────────────────
     The "Awaiting start signal from parent window…" note shown in a child
     stimulus window between sessions. Same robustness rationale as the pause
     note above: the markup carries no z-index, so without forcing one it can
     end up painted behind the stimulus canvas. */
  VEP.showChildWaiting = function (show) {
    const cw = document.getElementById('childWaiting');
    if (!cw) return;
    if (show) {
      if (cw.parentElement !== document.body) document.body.appendChild(cw);
      cw.style.zIndex = '2147483500';
      cw.style.position = 'fixed';
      cw.style.display = 'block';
    } else {
      cw.style.display = 'none';
    }
  };

  /* ── Stimulus field geometry (for the APA methods text) ────────────────
     Resolves WHICH surface the stimulus is actually presented on.

     This matters because the settings window and the stimulus window can be
     different windows: when a separate ("child") stimulus window is open, the
     stimulation runs there, so the methods paragraph must describe the child's
     canvas — not the settings window the operator happens to be reading.

     Preference order:
       1. the child stimulus window's reported canvas, if one is open;
       2. this window's own last session canvas;
       3. this window's current inner size (estimate, no session run yet).   */
  VEP.stimulusField = function (o) {
    o = o || {};
    if (o.childOpen && o.childW > 0) {
      return { w: o.childW, h: o.childH,
               fullscreen: !!o.childFullscreen, source: 'child' };
    }
    if (o.sessionW > 0) {
      return { w: o.sessionW, h: o.sessionH,
               fullscreen: !!o.sessionFullscreen, source: 'session' };
    }
    return { w: window.innerWidth, h: window.innerHeight,
             fullscreen: !!o.formFullscreen, source: 'estimate' };
  };

  /* ── Clipboard ─────────────────────────────────────────────────────────
     Copies text and briefly flashes the source element green as feedback.

     Kept separate from the preview builders on purpose: building/refreshing a
     preview must never touch the clipboard, or a background refresh (e.g. the
     child window reporting its geometry) would silently overwrite whatever the
     operator had just copied. Only an explicit click copies.                */
  VEP.copyToClipboard = function (text, el) {
    return navigator.clipboard.writeText(text)
      .then(function () {
        if (!el) return;
        const orig = el.style.color;
        el.style.color = '#8f8';
        setTimeout(function () { el.style.color = orig; }, 800);
      })
      .catch(function () {
        /* Clipboard blocked (permissions / insecure origin). The text is
           displayed on screen, so it can still be selected manually. */
      });
  };

  /* ── Fullscreen ────────────────────────────────────────────────────────
     Requests fullscreen for THIS window. Resolves true if we ended up
     fullscreen, false otherwise — it never rejects, so callers can proceed
     either way.

     Note on Safari: webkitRequestFullscreen returns undefined rather than a
     promise, so the result is checked against document state instead.        */
  VEP.enterFullscreen = function () {
    const doc = document;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) return Promise.resolve(true);
    const el  = doc.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen
              || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!req) return Promise.resolve(false);
    let r;
    try { r = req.call(el); } catch (e) { return Promise.resolve(false); }
    if (r && typeof r.then === 'function') return r.then(function () { return true; },
                                                         function () { return false; });
    return new Promise(function (res) {
      setTimeout(function () {
        res(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
      }, 120);
    });
  };

  /* Fullscreen can only be entered from a user gesture IN THE WINDOW that is
     going fullscreen. A stimulus window driven by postMessage therefore cannot
     put itself into fullscreen on the parent's command — the message carries no
     user activation. This arms the stimulus window so any click on it, or the
     F key, enters fullscreen; the operator does that once when placing the
     window on the stimulus monitor, and it is then already fullscreen when the
     start command arrives.                                                    */
  VEP.armFullscreenGesture = function (opts) {
    opts = opts || {};
    const canEnter = opts.canEnter || function () { return true; };
    const enter = function () {
      if (document.fullscreenElement || !canEnter()) return;
      VEP.enterFullscreen();
    };
    /* Only between sessions: entering fullscreen mid-run would resize the
       canvas and disturb the stimulus. */
    window.addEventListener('click', enter);
    window.addEventListener('keydown', function (e) {
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); enter(); }
    });
    const note = (typeof opts.note === 'string') ? document.getElementById(opts.note) : opts.note;
    if (note) {
      /* Only make it clickable — the note's own markup carries the wording and
         the styling, so overwriting textContent here would flatten it. */
      note.style.pointerEvents = 'auto';
      note.style.cursor = 'pointer';
    }
  };

  /* ── Run controls ──────────────────────────────────────────────────────
     One model driving the Start / Pause / Stop buttons and the status line in
     the settings window, for BOTH a local run (stimulus in this window) and a
     remote run (stimulus in a child window). The host supplies callbacks; this
     module owns only the button-enabled state and the status text, derived from
     a single run-state string so all four stimuli behave identically.

     Run states:
       'idle'      no session; Start offered (subject to the fullscreen gate)
       'measuring' warming up (frame-rate measurement) — only Stop
       'running'   stimulating — Pause and Stop
       'paused'    Resume (via the Start button) and Stop
       'blocked'   fullscreen required but the target isn't fullscreen — no Start

     The fullscreen gate: when the Fullscreen checkbox is on, a run may start
     only once the presenting surface is actually fullscreen. For a local run
     that is handled at launch; for a child run the child must report it. Until
     then the state is 'blocked' and Start is disabled. */
  VEP.createRunControls = function (opts) {
    const $ = function (id) { return document.getElementById(id); };
    const startBtn = $(opts.startBtn || 'runStartBtn');
    const pauseBtn = $(opts.pauseBtn || 'runPauseBtn');
    const stopBtn  = $(opts.stopBtn  || 'runStopBtn');
    const statusEl = $(opts.status   || 'runStatus');

    let runState = 'idle';
    let statusText = '';

    function apply() {
      const s = runState;
      if (startBtn) {
        startBtn.disabled = !(s === 'idle' || s === 'paused');
        startBtn.textContent = (s === 'paused') ? 'Resume' : 'Start';
      }
      if (pauseBtn) pauseBtn.disabled = (s !== 'running');
      if (stopBtn)  stopBtn.disabled  = !(s === 'running' || s === 'paused' || s === 'measuring');
      if (statusEl) statusEl.textContent = statusText;
    }

    const api = {
      set: function (state, text) {
        runState = state;
        if (typeof text === 'string') statusText = text;
        apply();
      },
      status: function (text) { statusText = text; if (statusEl) statusEl.textContent = text; },
      state: function () { return runState; },
      refresh: apply,
    };

    if (startBtn) startBtn.addEventListener('click', function () {
      if (startBtn.disabled) return;
      if (runState === 'paused') { if (opts.onResume) opts.onResume(); }
      else                       { if (opts.onStart)  opts.onStart();  }
    });
    if (pauseBtn) pauseBtn.addEventListener('click', function () {
      if (!pauseBtn.disabled && opts.onPause) opts.onPause();
    });
    if (stopBtn) stopBtn.addEventListener('click', function () {
      if (!stopBtn.disabled && opts.onStop) opts.onStop();
    });

    apply();
    return api;
  };

  /* Show a terminal "FINISHED" note in the child window (session ended). Reuses
     the same centred element as the waiting note, so the styling is uniform. */
  VEP.showChildFinished = function (text) {
    const cw   = document.getElementById('childWaiting');
    const msg  = document.getElementById('childWaitingMsg');
    const hint = document.getElementById('childWaitingHint');
    if (msg)  msg.textContent  = text || 'FINISHED';
    if (hint) hint.textContent = '';
    if (cw) {
      if (cw.parentElement !== document.body) document.body.appendChild(cw);
      cw.style.zIndex = '2147483500';
      cw.style.position = 'fixed';
      cw.style.cursor = 'default';
      cw.style.display = 'block';
    }
  };

  /* Is this window effectively filling the display? True for the Fullscreen API,
     but ALSO for an OS-maximized window or a window promoted to its own virtual
     desktop / Space — cases where document.fullscreenElement is null yet the
     canvas still covers the whole screen. The stimulus is valid in all of these,
     so the run gate should accept them, not just the Fullscreen API. */
  VEP.isEffectivelyFullscreen = function () {
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    // Compare the viewport to the screen. availWidth/Height excludes OS chrome
    // (taskbar/dock), so a maximized window matches even when not API-fullscreen.
    const scr = window.screen || {};
    const sw = scr.availWidth  || scr.width  || 0;
    const sh = scr.availHeight || scr.height || 0;
    if (!sw || !sh) return false;
    const w = window.innerWidth, h = window.innerHeight;
    // Allow a small tolerance for scrollbars / rounding.
    return (w >= sw - 4) && (h >= sh - 4);
  };

  VEP.version = '1.2.0';

  /* ── Sync-dot colour in words, for the methods text and the summaries ──
     A trigger patch is usually one primary (for an RGB photodiode) or white
     (for a luminance photodiode); those get their name, anything else its
     8-bit triple. The hex code is always given as well, since that is what
     reproduces it. */
  VEP.syncColourText = function (rgb) {
    if (!rgb) return 'white';
    const r = rgb.r | 0, g = rgb.g | 0, b = rgb.b | 0;
    const hex = '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    const full = function (v) { return v === 255; }, off = function (v) { return v === 0; };
    const names = { '111': 'white', '100': 'red', '010': 'green', '001': 'blue',
                    '110': 'yellow', '011': 'cyan', '101': 'magenta' };
    const pure = [r, g, b].every(function (v) { return full(v) || off(v); });
    const key = [r, g, b].map(function (v) { return full(v) ? '1' : '0'; }).join('');
    if (pure && names[key]) return names[key] + ' (' + hex + ')';
    return 'RGB ' + r + ', ' + g + ', ' + b + ' (' + hex + ')';
  };

  /* ---------------------------------------------------------------------------
     Calibration: decode the base64-JSON gamma calibration passed in the URL
     (?cal=...). Pure function — safe to share verbatim.
     ------------------------------------------------------------------------ */
  VEP.decodeCalFromURL = function (s) {
    if (!s) return null;
    try {
      let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const json = decodeURIComponent(escape(atob(b64)));
      return JSON.parse(json);
    } catch (e) { return null; }
  };

  /* ---------------------------------------------------------------------------
     Calibration: encode a calibration object into the URL-safe base64-JSON form
     read back by decodeCalFromURL. Exact inverse of the decoder above; the
     alphabet substitution and padding removal must stay in sync with it.
     Returns '' on failure so callers can simply omit the parameter.
     Pure function — safe to share verbatim.
     ------------------------------------------------------------------------ */
  VEP.encodeCalForURL = function (cal) {
    if (!cal) return '';
    try {
      const json = JSON.stringify(cal);
      // URL-safe base64 (no +, /, =)
      return btoa(unescape(encodeURIComponent(json)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  };

  /* ---------------------------------------------------------------------------
     Gamma / luminance transfer functions
     Build per-channel forward (8-bit code -> cd/m^2) and inverse (cd/m^2 ->
     8-bit code) functions from a calibration object. Supports sRGB, power-law
     and measured (monotone-cubic-spline) models. Pure — extracted verbatim and
     shared by every stimulus so the gamma pipeline is defined in one place.
     ------------------------------------------------------------------------ */
  function srgbToLinear(v8) {
    const c = v8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSRGB8(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  function buildMonoSpline(xs, ys) {
    const n = xs.length;
    if (n < 2) return () => (ys[0] || 0);
    const h = [], s = [];
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i+1]-xs[i]; s[i] = (ys[i+1]-ys[i])/h[i]; }
    const d = new Array(n);
    d[0] = s[0]; d[n-1] = s[n-2];
    for (let i = 1; i < n-1; i++) {
      if (s[i-1]*s[i] <= 0) { d[i] = 0; continue; }
      const w1 = 2*h[i]+h[i-1], w2 = h[i]+2*h[i-1];
      d[i] = (w1+w2)/(w1/s[i-1]+w2/s[i]);
    }
    for (let i = 0; i < n-1; i++) {
      if (Math.abs(s[i]) < 1e-10) { d[i] = d[i+1] = 0; continue; }
      const a = d[i]/s[i], b = d[i+1]/s[i], r = Math.sqrt(a*a+b*b);
      if (r > 3) { d[i] = 3*s[i]*a/r; d[i+1] = 3*s[i]*b/r; }
    }
    return function(x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n-1]) return ys[n-1];
      let i = 0; while (i < n-2 && xs[i+1] < x) i++;
      const t = (x-xs[i])/h[i], t2=t*t, t3=t2*t;
      return (2*t3-3*t2+1)*ys[i] + (t3-2*t2+t)*h[i]*d[i]
           + (-2*t3+3*t2)*ys[i+1] + (t3-t2)*h[i]*d[i+1];
    };
  }
  function makeChannelFns(pts, Lmax, Lmin) {
    if (!pts || pts.length < 2) {
      return { fwd: v => srgbToLinear(v)*(Lmax-Lmin)+Lmin,
               inv: L => linearToSRGB8((Math.max(Lmin,Math.min(Lmax,L))-Lmin)/(Lmax-Lmin)) };
    }
    const xs = pts.map(p => p.V), ys = pts.map(p => p.L);
    const spline = buildMonoSpline(xs, ys);
    const lo = ys[0], hi = ys[ys.length-1];
    return {
      fwd: v => spline(v),
      inv: L => {
        L = Math.max(lo, Math.min(hi, L));
        let a = 0, b = 255;
        for (let k = 0; k < 22; k++) { const m=(a+b)/2; if (spline(m)<L) a=m; else b=m; }
        return Math.max(0, Math.min(255, Math.round((a+b)/2)));
      }
    };
  }
  /* Relative luminance of the primaries, from the BT.709 / sRGB colour space
     (Rec. ITU-R BT.709-6, Table 3; sRGB adopts the same primaries, IEC
     61966-2-1). Applied here to linear light, which is what they describe --
     the older 0.299/0.587/0.114 luma weights belong to gamma-encoded NTSC
     signals and would be wrong in this position. They sum to 1, so an
     achromatic colour still reproduces the measured grey curve exactly. */
  const SRGB_PRIMARY_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 };
  VEP.SRGB_PRIMARY_WEIGHTS = SRGB_PRIMARY_WEIGHTS;

  /* How much each channel's contribution above black counts towards the field
     luminance.

     With all three primaries measured, their own curves already carry the
     ratios between them, so one common scale suffices: choose it so the three
     contributions sum to the directly measured white. Panels are never
     perfectly additive and the residual away from white is real non-additivity.

     Without them, the three channels share the grey curve, and weighting them
     equally would claim every primary emits the same light -- which no display
     does, and which makes an isoluminant red/green pair a no-op. Fall back to
     the BT.709 weights instead: still an assumption, but one that lands within
     about a percent of a typical measured panel rather than a factor of three
     out. Mixed cases (say R measured, G and B not) have no principled common
     scale, so any missing channel sends the whole set to the assumed weights. */
  function channelWeights(R, G, B, grey, Lmin, allMeasured) {
    const target = grey.fwd(255) - Lmin;
    if (allMeasured) {
      const cw = (R.fwd(255) - R.fwd(0)) + (G.fwd(255) - G.fwd(0)) + (B.fwd(255) - B.fwd(0));
      const k = (cw > 1e-9 && target > 0) ? target / cw : 1;
      return { r: k, g: k, b: k, basis: 'measured_channels' };
    }
    return { r: SRGB_PRIMARY_WEIGHTS.r, g: SRGB_PRIMARY_WEIGHTS.g,
             b: SRGB_PRIMARY_WEIGHTS.b, basis: 'srgb_primaries' };
  }

  function buildGammaFns(cal) {
    const Lmax = (cal && cal.L_max_cdm2) || 1;
    const Lmin = (cal && cal.L_min_cdm2) || 0;
    if (!cal || cal.model === 'srgb') {
      const ch = { fwd: v => srgbToLinear(v)*(Lmax-Lmin)+Lmin,
                   inv: L => linearToSRGB8((Math.max(Lmin,Math.min(Lmax,L))-Lmin)/(Lmax-Lmin)) };
      return { R:ch, G:ch, B:ch, grey:ch, L_max:Lmax, L_min:Lmin, model:'srgb',
               weights: channelWeights(ch, ch, ch, ch, Lmin, false) };
    }
    if (cal.model === 'power') {
      const g = cal.gamma || 2.2;
      const ch = { fwd: v => Math.pow(v/255,g)*(Lmax-Lmin)+Lmin,
                   inv: L => Math.max(0,Math.min(255,Math.round(Math.pow(Math.max(0,(L-Lmin)/(Lmax-Lmin)),1/g)*255))) };
      return { R:ch, G:ch, B:ch, grey:ch, L_max:Lmax, L_min:Lmin, model:'power', gamma:g,
               weights: channelWeights(ch, ch, ch, ch, Lmin, false) };
    }
    const grey = makeChannelFns(cal.measured_grey, Lmax, Lmin);
    const allMeasured = !!(cal.measured_R && cal.measured_G && cal.measured_B);
    const R    = cal.measured_R ? makeChannelFns(cal.measured_R, Lmax, Lmin) : grey;
    const G    = cal.measured_G ? makeChannelFns(cal.measured_G, Lmax, Lmin) : grey;
    const B    = cal.measured_B ? makeChannelFns(cal.measured_B, Lmax, Lmin) : grey;
    return { R, G, B, grey, L_max:Lmax, L_min:Lmin, model:'measured',
             weights: channelWeights(R, G, B, grey, Lmin, allMeasured) };
  }

  VEP.srgbToLinear   = srgbToLinear;
  VEP.linearToSRGB8  = linearToSRGB8;
  VEP.buildMonoSpline= buildMonoSpline;
  VEP.makeChannelFns = makeChannelFns;
  VEP.buildGammaFns  = buildGammaFns;

  /* ---------------------------------------------------------------------------
     Contrast tools
     Luminance of a colour, Michelson contrast, and the inverse problem: given a
     target contrast and mean luminance, find the pair of 8-bit colours that
     produces them. Shared by every stimulus so flash (flash vs blank) and the
     pattern stimuli (light vs dark check/ring) use one definition.

     One luminance model throughout: the black floor plus the channel
     contributions above it, scaled so their sum agrees with the directly
     measured white (see channelWeights). Adding the raw channel curves would
     count the black floor three times, which is negligible for bright colours
     but badly wrong for the dark saturated ones used in isoluminant work.

     Without a calibration buildGammaFns yields L_max = 1, L_min = 0, so these
     values are relative, not photometric. Contrast is a ratio and stays valid.
     Pure functions - no DOM, no state.
     ------------------------------------------------------------------------ */
  VEP.luminanceOfRGB = function (fns, rgb) {
    if (!fns || !rgb) return null;
    const Lmin = fns.L_min || 0;
    const w    = fns.weights || { r: 1/3, g: 1/3, b: 1/3 };
    /* Each channel is measured from its own dark point, not from the grey black
       level. Mixing the two makes a channel driven to 0 look as though it still
       emits, which turns a pure primary into a desaturated one. */
    return Lmin + w.r * Math.max(0, fns.R.fwd(rgb.r | 0) - fns.R.fwd(0))
                + w.g * Math.max(0, fns.G.fwd(rgb.g | 0) - fns.G.fwd(0))
                + w.b * Math.max(0, fns.B.fwd(rgb.b | 0) - fns.B.fwd(0));
  };

  VEP.michelson = function (L1, L2) {
    if (L1 == null || L2 == null) return null;
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    if (hi + lo < 1e-9) return null;
    return (hi - lo) / (hi + lo);
  };

  /** 8-bit grey whose luminance is closest to L, under the model above. */
  function achromaticCodeFor(fns, L) {
    let a = 0, b = 255;
    for (let k = 0; k < 12; k++) {
      const m = (a + b) >> 1;
      if (VEP.luminanceOfRGB(fns, { r: m, g: m, b: m }) < L) a = m + 1; else b = m;
    }
    const lo = Math.max(0, a - 1);
    let best = lo, bestErr = Infinity;
    for (let v = lo; v <= Math.min(255, a + 1); v++) {
      const e = Math.abs(VEP.luminanceOfRGB(fns, { r: v, g: v, b: v }) - L);
      if (e < bestErr) { bestErr = e; best = v; }
    }
    return best;
  }

  /* Move one colour along its own ray towards black until it has luminance
     Ltarget, keeping its chromaticity. Shared by the pair solver below and the
     one-sided solver used against a fixed background. */
  function slideOnRay(fns, col, Ltarget) {
    const Lmin = fns.L_min || 0;
    const w    = fns.weights || { r: 1/3, g: 1/3, b: 1/3 };
    const r0 = fns.R.fwd(0), g0 = fns.G.fwd(0), b0 = fns.B.fwd(0);
    const cr = Math.max(0, fns.R.fwd(col.r | 0) - r0);
    const cg = Math.max(0, fns.G.fwd(col.g | 0) - g0);
    const cb = Math.max(0, fns.B.fwd(col.b | 0) - b0);
    const above = w.r * cr + w.g * cg + w.b * cb;
    if (!(above > 1e-9)) {           // sitting on the black floor: no hue to keep
      const v = achromaticCodeFor(fns, Ltarget);
      return { rgb: { r: v, g: v, b: v }, scale: null };
    }
    const s0 = (Ltarget - Lmin) / above;

    /* Every candidate comes from one common scale, so the channel ratios --
       and with them the hue -- are preserved by construction; a channel with
       no contribution stays at 0 and a primary stays pure. Rounding the three
       inverses independently would not have that property.
       The three channels quantise at different scales, so the triple nearest
       the target is not always the one at s0. Sweep a narrow bracket around it
       and keep the best, including the incoming colour as a candidate: when it
       ties, it wins, which makes a second press of Apply a genuine no-op. */
    const tripleAt = (s) => ({ r: fns.R.inv(r0 + s * cr),
                               g: fns.G.inv(g0 + s * cg),
                               b: fns.B.inv(b0 + s * cb) });
    const errOf = (c) => Math.abs(VEP.luminanceOfRGB(fns, c) - Ltarget);
    const eps = Math.max(1e-12, fns.L_max * 1e-9);

    let best = null, bestErr = Infinity;
    for (let i = -60; i <= 60; i++) {
      const s = s0 * (1 + i * 0.0015);
      if (s < 0) continue;
      const cand = tripleAt(s);
      const e = errOf(cand);
      if (e < bestErr - eps) { bestErr = e; best = cand; }
    }
    if (!best) { best = tripleAt(s0); bestErr = errOf(best); }
    const incumbent = { r: col.r | 0, g: col.g | 0, b: col.b | 0 };
    if (errOf(incumbent) <= bestErr + eps) best = incumbent;
    return { rgb: best, scale: s0 };
  }

  /**
   * Solve for the colour pair realising a requested Michelson contrast about a
   * requested mean luminance, moving each colour along its own ray towards
   * black so that both keep their chromaticity:
   *     L_high = L_mean(1+C),  L_low = L_mean(1-C)
   *
   * At C = 0 this yields the isoluminant version of the two colours rather than
   * collapsing them together, which is the point: an isoluminant pair is a
   * stimulus in its own right. Scaling happens in linear light, since scaling
   * 8-bit codes would not preserve chromaticity through the transfer curve.
   *
   * opts.colourA / opts.colourB   the two colours, in the caller's own order
   * opts.contrast                 target Michelson contrast, 0..1
   * opts.meanLuminance            target mean luminance (cd/m^2, or relative)
   *
   * Whichever colour is currently the brighter one stays the brighter one. A
   * colour sitting at the black floor has no direction of its own and falls
   * back to achromatic. The colours come back quantised to 8 bits, so the
   * achieved contrast is reported separately and is what callers should show
   * and log. `ok` is false when the display cannot reach the request, with the
   * clamped attempt still returned for inspection.
   */
  VEP.solveContrastPairOnRays = function (fns, opts) {
    const out = { ok: false, reason: '', a: null, b: null, L_a: null, L_b: null,
                  L_mean: null, contrast: null, alpha: null, beta: null, clipped: [] };
    if (!fns || !opts || !opts.colourA || !opts.colourB) { out.reason = 'missing arguments'; return out; }
    const C  = Number(opts.contrast);
    const Lm = Number(opts.meanLuminance);
    if (!isFinite(C) || C < 0 || C > 1) { out.reason = 'contrast must be between 0 and 1'; return out; }
    if (!isFinite(Lm) || Lm <= 0)       { out.reason = 'mean luminance must be above 0'; return out; }

    const A = opts.colourA, B = opts.colourB;
    const LA0 = VEP.luminanceOfRGB(fns, A), LB0 = VEP.luminanceOfRGB(fns, B);
    /* No pre-flight range test: asking for L_low = 0 at full contrast is a
       legitimate "as dark as the panel goes", not an error. Whether the request
       was really met is decided after the conversion, below. */
    // Keep the caller's brighter colour bright; equal luminance keeps the order.
    const aWantsHigh = LA0 >= LB0;
    const targetA = Lm * (1 + (aWantsHigh ?  C : -C));
    const targetB = Lm * (1 + (aWantsHigh ? -C :  C));

    const ra = slideOnRay(fns, A, targetA), rb = slideOnRay(fns, B, targetB);
    out.a = ra.rgb; out.b = rb.rgb;
    out.alpha = ra.scale; out.beta = rb.scale;
    out.L_a = VEP.luminanceOfRGB(fns, out.a);
    out.L_b = VEP.luminanceOfRGB(fns, out.b);
    out.L_mean = (out.L_a + out.L_b) / 2;
    out.contrast = VEP.michelson(out.L_a, out.L_b);

    /* The inverse functions clamp to what each channel can emit, so a request
       that leaves the RGB cube comes back silently satisfied. Verify the
       luminances actually landed, then name the channels that ran out of room
       so the message can say which primary was the limit. */
    const tol = Math.max(1e-9, fns.L_max * 0.02);
    const missA = Math.abs(out.L_a - targetA) > tol;
    const missB = Math.abs(out.L_b - targetB) > tol;
    if (missA || missB) {
      ['r', 'g', 'b'].forEach(function (chn) {
        const hitA = missA && (out.a[chn] >= 255 || out.a[chn] <= 0);
        const hitB = missB && (out.b[chn] >= 255 || out.b[chn] <= 0);
        if (hitA || hitB) out.clipped.push(chn.toUpperCase());
      });
      out.reason = out.clipped.length
        ? 'outside the display range: ' + out.clipped.join(', ') + ' ran out of headroom'
        : 'outside the display range for this color pair';
      return out;
    }
    out.ok = true;
    return out;
  };

  /* ---------------------------------------------------------------------------
     Child-window link
     Parent<->child messaging, the parent->child handshake, and opening/reusing
     the standalone presentation window ('vep_present_<stimulus>'). Byte-identical
     across every stimulus, so it lives here. The per-protocol state (_childWin,
     _childReady, _activeParent, _isChild) and the protocol-specific child-panel
     UI updater stay in the stimulus and are reached through `ctx` accessors, so
     all existing call sites are unchanged.

     ctx = {
       isChild,                         // bool: is this page the child popup?
       getChildWin(), setChildWin(w),   // parent's reference to the child window
       getChildReady(), setChildReady(b),
       getActiveParent(),               // most-recent parent that addressed us
       buildURL(),                      // -> current-settings stimulus URL
       updateChildUI(msg, startOk, pauseOk, stopOk)   // protocol's child panel
     }
     ------------------------------------------------------------------------ */
  VEP.childLink = function (ctx) {
    const isChild = !!ctx.isChild;

    function toChild(msg) {
      const w = ctx.getChildWin();
      if (w && !w.closed) w.postMessage(msg, '*');
    }
    function toParent(msg) {
      if (!isChild) return;
      const ap = ctx.getActiveParent && ctx.getActiveParent();
      const tgt = (ap && !ap.closed) ? ap
                : (window.opener && !window.opener.closed) ? window.opener : null;
      if (tgt) tgt.postMessage(msg, '*');
    }
    function helloUntilReady(win) {
      if (!win) return;
      let tries = 0;
      const iv = setInterval(function () {
        if (!win || win.closed || ctx.getChildReady() || tries++ > 20) { clearInterval(iv); return; }
        try { win.postMessage({ type: 'vep_hello' }, '*'); } catch (e) {}
      }, 250);
    }
    function openStandaloneWindow() {
      const url = ctx.buildURL();
      let cw = ctx.getChildWin();
      // Reuse an already-open stimulus window (shared target name).
      if (cw && !cw.closed) {
        try { cw.location.href = url; } catch (e) { ctx.setChildWin(null); cw = null; }
        if (cw) {
          ctx.setChildReady(false);
          ctx.updateChildUI('Child: loading new stimulus\u2026', false, false, false);
          helloUntilReady(cw);
          return;
        }
      }
      /* Open a fresh popup. The browser reuses a window with the same name, so
         the name has to be per stimulus: the parent/child pairing is one-to-one,
         and a shared name would let one stimulus take over another's window,
         leaving the first parent holding a reference to something else. */
      const pw = window.screen.availWidth, ph = window.screen.availHeight;
      let popup = null;
      try {
        /* The name must stay inside the vep_present_ family: the stimulus page
           recognises itself as the presentation window from that prefix. */
        popup = window.open(url, ctx.windowName || 'vep_present_stimulus',
          'popup=1,width=' + pw + ',height=' + ph + ',left=' + window.screen.width + ',top=0');
      } catch (e) {}
      if (!popup || popup.closed) {
        const pn = document.getElementById('popupNote');
        if (pn) {
          pn.textContent = '\u26a0\ufe0f Popup blocked \u2014 click the address bar icon to ' +
            'allow popups for this page, then try again.';
          pn.style.display = 'inline'; pn.style.color = '#e8855a';
        }
        return;
      }
      ctx.setChildWin(popup);
      ctx.setChildReady(false);
      const cp = document.getElementById('childPanel');
      const owb = document.getElementById('openWindowBtn');
      if (cp)  cp.style.display  = 'block';
      if (owb) owb.style.display = 'none';
      ctx.updateChildUI('Child window: loading\u2026', false, false, false);
      helloUntilReady(popup);
      const poll = setInterval(function () {
        const w = ctx.getChildWin();
        if (!w || w.closed) {
          clearInterval(poll);
          ctx.setChildWin(null); ctx.setChildReady(false);
          if (cp)  cp.style.display  = 'none';
          if (owb) owb.style.display = '';
          ctx.updateChildUI('', false, false, false);
          /* Let the host forget anything it cached about the child (e.g. the
             canvas geometry used for the APA methods text). */
          if (typeof ctx.onChildClosed === 'function') ctx.onChildClosed();
        }
      }, 500);
    }

    return { toChild, toParent, helloUntilReady, openStandaloneWindow };
  };

  /* ---------------------------------------------------------------------------
     Shared pattern WebGL renderer (checker / radial + LUT + phi + masks +
     fixation + sync dot). Byte-identical between pattern_onset and
     pattern_reversal, so it lives here. flash (solid) and motion (moving
     grating) keep their own renderers for now.

     opts = {
       vertSrc, fragSrc,            // GLSL sources
       getUniforms(),              // -> { pixelsPerDegree, dotSize, dotPos,
                                   //      dotColour,                  // {r,g,b} 0..255 when triggered; white if absent
                                   //      maskCentral, maskCentralRad_deg, ...,
                                   //      colMask, showFixation, fixationRadiusDeg,
                                   //      fixationThicknessPx, colFixation,
                                   //      patternType, checkSize_deg,
                                   //      colLight, colDark, colBlank }
       onContextLost(),            // protocol teardown on webglcontextlost
       updateBadge(state, msg)     // optional status badge
     }
     ------------------------------------------------------------------------ */
  /* Shared pattern shader (checker / radial + LUT + phi + masks + fixation +
     sync dot). Parity-validated against the Canvas2D reference. Used by
     pattern_onset, pattern_reversal, motion_onset, and flash (which drives it
     in uniform-field mode: patternOn=false paints uColBlank as the field). */
  VEP.PATTERN_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  VEP.PATTERN_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform bool      uCheckerMode;
uniform float     uCheckSizePx;
uniform float     uCheckerPhase;
uniform vec3      uColLight;
uniform vec3      uColDark;
uniform bool      uPatternOn;
uniform vec3      uColBlank;
uniform sampler2D uLUT;
uniform sampler2D uPhiTex;
uniform float     uOffsetFrac;
uniform float     uPhiN;
uniform vec2  uCentre;
uniform vec4  uDotBounds;
uniform float uDotBright;
uniform vec3  uDotCol;
uniform bool  uMaskC;  uniform float uMaskCR;
uniform bool  uMaskP;  uniform float uMaskPR;
uniform bool  uMQ1;    uniform float uR1;
uniform bool  uMQ2;    uniform float uR2;
uniform bool  uMQ3;    uniform float uR3;
uniform bool  uMQ4;    uniform float uR4;
uniform vec3  uColMask;
uniform bool  uShowFix;
uniform ivec2 uFixC;
uniform int   uFixArm;
uniform int   uFixT0;
uniform int   uFixT1;
uniform vec3  uColFix;
out vec4 outColor;
void main() {
  vec2 fcRaw=gl_FragCoord.xy;
  float Hh=2.0*uCentre.y;
  vec2 fc=vec2(fcRaw.x-0.5, Hh-0.5-fcRaw.y);   // top-down integer pixel coords (match Canvas2D)
  vec2 d=fc-uCentre; float r=length(d);
  vec3 col;
  if(!uPatternOn){
    col=uColBlank;
  } else {
    float phase;                                // wrapped LUT phase in [0,1)
    if(uCheckerMode){
      float ix=floor(d.x/uCheckSizePx);
      float iy=floor(d.y/uCheckSizePx);
      phase=0.5*mod(ix+iy,2.0);                 // 0.0 dark / 0.5 light (LUT index 0 / 512)
    } else {
      /* length() is allowed a few ULP of error, so a pixel whose radius is an
         exact integer can land just below it and take the neighbouring
         annulus — isolated wrong pixels on circles of integer radius. The
         squared radius is exact here, so correct the integer part with it
         rather than with a tolerance. */
      float rf=floor(r);
      float r2=d.x*d.x+d.y*d.y;
      if((rf+1.0)*(rf+1.0)<=r2) rf+=1.0; else if(rf*rf>r2) rf-=1.0;
      float ri=min(rf,uPhiN-1.0);               // integer radius, matches Canvas2D
      float up=(ri+0.5)/uPhiN;
      phase=texture(uPhiTex,vec2(up,0.5)).r;     // = phiIdxByR[ri]/1024
    }
    float ul=fract(phase+uOffsetFrac);           // (baseIdx+offset) mod 1024, /1024
    ul=(floor(ul*1024.0+0.5)+0.5)/1024.0;        // snap to LUT texel centre → gamma via LUT
    col=texture(uLUT,vec2(ul,0.5)).rgb;
  }
  if(uMaskC&&r<uMaskCR) col=uColMask;
  if(uMaskP&&r>uMaskPR) col=uColMask;
  /* Quadrant masks — Q1 top-right, Q2 top-left, Q3 bottom-left, Q4 bottom-right,
     in top-down screen coords, matching the Canvas2D references (dy<=0 upper). */
  if(uMQ1&&d.x>=0.&&d.y<=0.&&r<uR1) col=uColMask;
  if(uMQ2&&d.x< 0.&&d.y<=0.&&r<uR2) col=uColMask;
  if(uMQ3&&d.x< 0.&&d.y> 0.&&r<uR3) col=uColMask;
  if(uMQ4&&d.x>=0.&&d.y> 0.&&r<uR4) col=uColMask;
  /* Integer geometry, identical to prepareCrossMask() on the Canvas 2D side:
     centre round(W/2),round(H/2); arm round(radius_deg*ppd); bar rows
     -floor(T/2) .. T-floor(T/2)-1. Comparing an integer coordinate against an
     unrounded arm and a symmetric T/2 is what used to make the GPU cross a
     pixel wider for even T. */
  if(uShowFix){
    int fdx=int(fc.x)-uFixC.x, fdy=int(fc.y)-uFixC.y;
    if((abs(fdx)<=uFixArm&&fdy>=uFixT0&&fdy<=uFixT1)||
       (abs(fdy)<=uFixArm&&fdx>=uFixT0&&fdx<=uFixT1)) col=uColFix;}
  /* Sync dot: its trigger colour when triggered, black otherwise — on every
     stimulus, so the photodiode reads zero between triggers whatever the field
     behind the patch is doing. */
  if(fcRaw.x>=uDotBounds.x&&fcRaw.x<uDotBounds.z&&fcRaw.y>=uDotBounds.y&&fcRaw.y<uDotBounds.w){
    col=(uDotBright>0.5)?uDotCol:vec3(0.0);
  }
  outColor=vec4(col,1.0);
}`;

  VEP.createPatternRenderer = function (opts) {
    'use strict';
    let _gl=null,_canvas=null,_prog=null,_vbuf=null,_locs={},_lost=false,_texLUT=null,_texPhi=null;
    const getU         = opts.getUniforms || (() => ({}));
    const updateBadge  = opts.updateBadge  || (() => {});
    const onContextLost= opts.onContextLost|| (() => {});

    function _sh(gl,src,type){
      const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function _link(gl,vs,fs){
      const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs);
      gl.linkProgram(p);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    function _tex1D(gl,ifmt,fmt,type,data,w){
      const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,ifmt,w,1,0,fmt,type,data); return t;
    }
    function _dotBounds(gl,loc,W,H,u){
      const half=(u.dotSize/2)|0;
      const sx0=Math.max(0,u.dotPos.x-half), sy0=Math.max(0,u.dotPos.y-half);
      const sx1=Math.min(W-1,u.dotPos.x+half-1), sy1=Math.min(H-1,u.dotPos.y+half-1);
      gl.uniform4f(loc, sx0, H-sy1-1, sx1+1, H-sy0);
    }
    function _masks(gl,L,ppd,u){
      gl.uniform1i(L.uMaskC, u.maskCentral?1:0); gl.uniform1f(L.uMaskCR, u.maskCentralRad_deg*ppd);
      gl.uniform1i(L.uMaskP, u.maskPeripheral?1:0); gl.uniform1f(L.uMaskPR, u.maskPeripheralRad_deg*ppd);
      gl.uniform1i(L.uMQ1, u.maskQ1?1:0); gl.uniform1f(L.uR1, u.maskQ1Rad_deg*ppd);
      gl.uniform1i(L.uMQ2, u.maskQ2?1:0); gl.uniform1f(L.uR2, u.maskQ2Rad_deg*ppd);
      gl.uniform1i(L.uMQ3, u.maskQ3?1:0); gl.uniform1f(L.uR3, u.maskQ3Rad_deg*ppd);
      gl.uniform1i(L.uMQ4, u.maskQ4?1:0); gl.uniform1f(L.uR4, u.maskQ4Rad_deg*ppd);
      gl.uniform3f(L.uColMask, u.colMask.r/255, u.colMask.g/255, u.colMask.b/255);
    }
    function _fix(gl,L,ppd,u,W,H){
      gl.uniform1i(L.uShowFix, u.showFixation?1:0);
      /* The same integers prepareCrossMask() computes, so the two paths paint
         the same pixels; see the comment in PATTERN_FRAG. */
      const halfT=Math.floor(u.fixationThicknessPx/2);
      gl.uniform2i(L.uFixC, Math.round(W*0.5), Math.round(H*0.5));
      gl.uniform1i(L.uFixArm, Math.round(u.fixationRadiusDeg*ppd));
      gl.uniform1i(L.uFixT0, -halfT);
      gl.uniform1i(L.uFixT1, u.fixationThicknessPx-halfT-1);
      gl.uniform3f(L.uColFix, u.colFixation.r/255, u.colFixation.g/255, u.colFixation.b/255);
    }
    const _api = {
      init(canvas) {
        _canvas=canvas; _gl=canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
        if(!_gl) throw new Error('WebGL 2 not available');
        _lost=false;
        canvas.addEventListener('webglcontextlost',     _api._onContextLost.bind(_api));
        canvas.addEventListener('webglcontextrestored', _api._onContextRestored.bind(_api));
        const gl=_gl;
        const vs=_sh(gl,opts.vertSrc,gl.VERTEX_SHADER);
        const fs=_sh(gl,opts.fragSrc,gl.FRAGMENT_SHADER);
        _prog=_link(gl,vs,fs); gl.deleteShader(vs); gl.deleteShader(fs);
        gl.useProgram(_prog);
        _vbuf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,_vbuf);
        gl.bufferData(gl.ARRAY_BUFFER,
          new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
        const aPos=gl.getAttribLocation(_prog,'aPos');
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
        const names=['uCheckerMode','uCheckSizePx','uCheckerPhase','uColLight','uColDark','uPatternOn','uColBlank','uLUT','uPhiTex','uOffsetFrac','uPhiN','uCentre','uDotBounds','uDotBright','uDotCol','uMaskC','uMaskCR','uMaskP','uMaskPR','uMQ1','uR1','uMQ2','uR2','uMQ3','uR3','uMQ4','uR4','uColMask','uShowFix','uFixC','uFixArm','uFixT0','uFixT1','uColFix'];
        names.forEach(n=>{_locs[n]=gl.getUniformLocation(_prog,n);}); gl.uniform1i(_locs.uLUT,0); gl.uniform1i(_locs.uPhiTex,1);
      },
      resize(w,h){ if(!_gl||_lost)return; _canvas.width=w;_canvas.height=h;_gl.viewport(0,0,w,h); },
      get active(){ return _gl!==null&&!_lost; },

      uploadLUT(lR,lG,lB){
        const gl=_gl; if(!gl||_lost)return;
        const n=lR.length, rgba=new Uint8Array(n*4);
        for(let i=0;i<n;i++){rgba[i*4]=lR[i];rgba[i*4+1]=lG[i];rgba[i*4+2]=lB[i];rgba[i*4+3]=255;}
        if(_texLUT) gl.deleteTexture(_texLUT);
        gl.activeTexture(gl.TEXTURE0);
        _texLUT=_tex1D(gl,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,rgba,n);
      },
      uploadPhi(phiArr,n){
        const gl=_gl; if(!gl||_lost)return;
        const frac=new Float32Array(n);
        for(let r=0;r<n;r++) frac[r]=phiArr[r]/1024;
        if(_texPhi) gl.deleteTexture(_texPhi);
        gl.activeTexture(gl.TEXTURE1);
        _texPhi=_tex1D(gl,gl.R32F,gl.RED,gl.FLOAT,frac,n);
        gl.uniform1f(_locs.uPhiN,n);
      },

      updateSessionUniforms(W,H){
        const gl=_gl; if(!gl||_lost)return;
        const u=getU(); const ppd=u.pixelsPerDegree;
        gl.uniform2f(_locs.uCentre,W*0.5,H*0.5);
        _dotBounds(gl,_locs.uDotBounds,W,H,u);
        const dc=u.dotColour||{r:255,g:255,b:255};
        gl.uniform3f(_locs.uDotCol, dc.r/255, dc.g/255, dc.b/255);
        _masks(gl,_locs,ppd,u); _fix(gl,_locs,ppd,u,W,H);
        gl.uniform1i(_locs.uCheckerMode, (u.patternType==='checker')?1:0);
        const csz=Math.max(1e-3,(u.checkSize_deg||1)*ppd);
        gl.uniform1f(_locs.uCheckSizePx,csz);
        if(u.colLight) gl.uniform3f(_locs.uColLight,u.colLight.r/255,u.colLight.g/255,u.colLight.b/255);
        if(u.colDark)  gl.uniform3f(_locs.uColDark, u.colDark.r/255, u.colDark.g/255, u.colDark.b/255);
        if(u.colBlank) gl.uniform3f(_locs.uColBlank,u.colBlank.r/255,u.colBlank.g/255,u.colBlank.b/255);
        else           gl.uniform3f(_locs.uColBlank,0.5,0.5,0.5);
      },
      /* Uniform-field support (flash): set the blank/field colour per frame
         without resending the whole session-uniform block. Together with
         render(0, dotOn, false) this paints a solid field + masks + fixation
         + sync dot — the 'uniform' shader mode from the roadmap. */
      setFieldColor(col){
        const gl=_gl; if(!gl||_lost)return;
        gl.uniform3f(_locs.uColBlank,col.r/255,col.g/255,col.b/255);
      },
      render(offsetIdx, dotOn, patternOn){
        const gl=_gl; if(!gl||_lost)return;
        const oFrac=(offsetIdx&(1024-1))/1024;
        const cPhase=(offsetIdx&(1024>>1))?1.0:0.0;
        gl.uniform1f(_locs.uOffsetFrac,oFrac);
        gl.uniform1f(_locs.uCheckerPhase,cPhase);
        gl.uniform1i(_locs.uPatternOn,patternOn?1:0);
        gl.uniform1f(_locs.uDotBright,dotOn?1.0:0.0);
        gl.drawArrays(gl.TRIANGLES,0,6);
      },
      _onContextLost(e){
        e.preventDefault(); _lost=true;
        onContextLost();
        updateBadge('fail','context lost');
      },
      _onContextRestored(){
        _lost=false;
        try{ _api.init(_canvas); updateBadge('idle','context restored'); }
        catch(e){ updateBadge('fail','restore failed: '+e.message); }
        const btn=document.getElementById('startBtn');
        if(btn) btn.disabled=false;
      },
    };
    return _api;
  };

  /* ---------------------------------------------------------------------------
     Background safety watchdog
     Aborts a running session if frame delivery stalls (window throttled) or the
     tab/window becomes hidden — both of which corrupt VEP timing. A silent,
     zero-gain oscillator is started to discourage background throttling.

     The protocol supplies:
       getState() -> current state string ('INIT' / 'PAUSED' / running states)
       onAbort(reason) -> protocol-specific teardown (noLoop, state reset,
                          show overlay, warning, save partial log)
       onClear() -> optional; called by stop() to clear any warning UI
     ------------------------------------------------------------------------ */
  VEP.createWatchdog = function (opts) {
    opts = opts || {};
    const getState = opts.getState || function () { return undefined; };
    const onAbort  = opts.onAbort  || function () {};
    const onClear  = opts.onClear  || function () {};
    const POLL_MS  = opts.pollMs  || 200;
    const STALL_MS = opts.stallMs || 500;
    const GRACE_MS = opts.graceMs || 0;   // suppress stall aborts for this long after start()

    let _audioCtx = null, _oscNode = null, _watchId = null, _lastFrame = 0, _startedAt = 0, _hideTimer = null;

    function _running() {
      const s = getState();
      return !(s === undefined || s === 'INIT' || s === 'PAUSED');
    }
    function _startAudio() {
      if (_audioCtx) return;
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        _oscNode  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain(); gain.gain.value = 0;
        _oscNode.connect(gain); gain.connect(_audioCtx.destination); _oscNode.start();
      } catch (_) {}
    }
    function _stopAudio() {
      try { if (_oscNode)  _oscNode.stop();  } catch (_) {}
      try { if (_audioCtx) _audioCtx.close(); } catch (_) {}
      _audioCtx = _oscNode = null;
    }
    function _abort(reason) {
      if (!_running()) return;
      if (_watchId) { clearInterval(_watchId); _watchId = null; }
      _stopAudio();
      onAbort(reason);
    }

    /* Debounced hidden-abort: some browsers (Firefox) fire a transient
       visibilitychange while entering/settling fullscreen. Only abort if the
       document stays hidden past a short delay AND we're past the grace window. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (_hideTimer) clearTimeout(_hideTimer);
        _hideTimer = setTimeout(function () {
          _hideTimer = null;
          if (document.hidden && _running() &&
              (performance.now() - _startedAt) >= GRACE_MS)
            _abort('\u26a0\ufe0f  Stimulus aborted \u2014 window is hidden.\n' +
              'Keep the stimulus window fully visible on its monitor during recording.');
        }, 600);
      } else if (_hideTimer) {
        clearTimeout(_hideTimer); _hideTimer = null;   // visible again -> transient, ignore
      }
    });

    return {
      start() {
        _lastFrame = _startedAt = performance.now();
        _startAudio();
        if (!_watchId) _watchId = setInterval(function () {
          if (!_running()) return;
          // Grace period after start() ignores the frame gap created by the
          // fullscreen transition (rAF is paused during it) and MEASURE warm-up.
          if (performance.now() - _startedAt < GRACE_MS) return;
          if (performance.now() - _lastFrame > STALL_MS)
            _abort('\u26a0\ufe0f  Frame delivery stalled (>' + STALL_MS + '\u202fms).\n' +
              'Browser may be throttling the stimulus window. ' +
              'Keep it visible and unobscured during recording.');
        }, POLL_MS);
      },
      markFrame() { _lastFrame = performance.now(); },
      stop() {
        _stopAudio();
        if (_watchId) { clearInterval(_watchId); _watchId = null; }
        onClear();
      }
    };
  };


  /* ===========================================================================
     Multi-stimulus (oddball) support — added in 1.1.0
     Everything below is new; nothing above depends on it, so the four
     single-stimulus pages are unaffected by it.
     ======================================================================== */

  /* ── Deterministic random numbers ──────────────────────────────────────
     mulberry32: small, fast, and the same sequence in every browser for the
     same seed. That is the whole point — a seed in the link or the log must
     rebuild exactly the sequence that was presented. Not for cryptography. */
  VEP.makeRng = function (seed) {
    let a = (Number(seed) >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** A fresh seed, 1 .. 2^31-1, short enough to read off a log. */
  VEP.randomSeed = function () {
    try {
      const u = new Uint32Array(1);
      root.crypto.getRandomValues(u);
      return (u[0] % 2147483646) + 1;
    } catch (e) {
      return Math.floor(Math.random() * 2147483646) + 1;
    }
  };

  /** K distinct integers from 0..n-1, ascending (Floyd's algorithm). */
  function sampleDistinct(n, K, rng) {
    const set = new Set();
    for (let j = n - K; j < n; j++) {
      const t = Math.floor(rng() * (j + 1));
      set.add(set.has(t) ? j : t);
    }
    return Array.from(set).sort(function (a, b) { return a - b; });
  }

  /**
   * Oddball sequence with exact counts and spacing constraints.
   *
   *   total            number of trials
   *   n2, n3           number of stimulus-2 and stimulus-3 trials; the rest
   *                    are standards (stimulus 1)
   *   firstStandards   standards that open the sequence
   *   minStandards     standards required before every non-standard trial,
   *                    whichever non-standard stimulus it is
   *   maxStandardRun   longest allowed run of standards (0 = no limit)
   *   seed             integer; the same seed gives the same sequence
   *
   * The standards are spread as gaps around the non-standard trials. Every
   * arrangement satisfying the constraints is equally likely: the free
   * standards are distributed as a uniformly random composition, and the order
   * of the non-standard stimuli as a uniformly random permutation.
   * Returns { ok, reason, order: [1|2|3, ...], counts: {1,2,3} }.
   */
  VEP.oddballSequence = function (o) {
    o = o || {};
    const total = Math.floor(Number(o.total));
    const n2 = Math.floor(Number(o.n2) || 0), n3 = Math.floor(Number(o.n3) || 0);
    const first = Math.max(0, Math.floor(Number(o.firstStandards) || 0));
    const k = Math.max(0, Math.floor(Number(o.minStandards) || 0));
    const maxRun = Math.max(0, Math.floor(Number(o.maxStandardRun) || 0));
    const out = { ok: false, reason: '', order: null, counts: { 1: 0, 2: n2, 3: n3 } };
    if (!(total >= 1)) { out.reason = 'the number of trials must be at least 1'; return out; }
    if (n2 < 0 || n3 < 0) { out.reason = 'stimulus counts cannot be negative'; return out; }
    const K = n2 + n3, nStd = total - K;
    if (nStd < 0) {
      out.reason = K + ' non-standard trials do not fit into ' + total + ' trials';
      return out;
    }
    out.counts[1] = nStd;
    const rng = VEP.makeRng(o.seed);

    if (K === 0) {
      if (maxRun && nStd > maxRun) {
        out.reason = 'with no non-standard trials, ' + nStd
                   + ' standards exceed the longest allowed run of ' + maxRun;
        return out;
      }
      out.order = new Array(total).fill(1); out.ok = true; return out;
    }
    const g0min = Math.max(first, k);
    const need = g0min + (K - 1) * k;
    if (need > nStd) {
      out.reason = 'the spacing needs at least ' + need + ' standards ('
        + g0min + ' before the first non-standard trial and ' + k + ' before each of the other '
        + (K - 1) + '), but only ' + nStd + ' trials are standards';
      return out;
    }
    if (maxRun) {
      if (g0min > maxRun || k > maxRun) {
        out.reason = 'the longest allowed run of standards (' + maxRun
          + ') is shorter than the required spacing (' + Math.max(g0min, k) + ')';
        return out;
      }
      if ((K + 1) * maxRun < nStd) {
        out.reason = 'with at most ' + maxRun + ' standards in a row, ' + K
          + ' non-standard trials can separate at most ' + ((K + 1) * maxRun)
          + ' standards, but there are ' + nStd;
        return out;
      }
    }
    const F = nStd - need, n = F + K;
    let gaps = null;
    for (let attempt = 0; attempt < 20000 && !gaps; attempt++) {
      const bars = sampleDistinct(n, K, rng);
      const g = []; let prev = -1;
      bars.forEach(function (b) { g.push(b - prev - 1); prev = b; });
      g.push(n - prev - 1);
      g[0] += g0min;
      for (let i = 1; i < K; i++) g[i] += k;
      if (!maxRun || g.every(function (x) { return x <= maxRun; })) gaps = g;
    }
    if (!gaps) {
      out.reason = 'no arrangement satisfying the longest-run limit was found; loosen the limit';
      return out;
    }
    const labels = [];
    for (let i = 0; i < n2; i++) labels.push(2);
    for (let i = 0; i < n3; i++) labels.push(3);
    for (let i = labels.length - 1; i > 0; i--) {           // Fisher-Yates
      const j = Math.floor(rng() * (i + 1));
      const t = labels[i]; labels[i] = labels[j]; labels[j] = t;
    }
    const order = [];
    for (let i = 0; i <= K; i++) {
      for (let s = 0; s < gaps[i]; s++) order.push(1);
      if (i < K) order.push(labels[i]);
    }
    out.order = order; out.ok = true;
    return out;
  };

  /* ── SHA-256 of a text (UTF-8), as hex ─────────────────────────────────
     Synchronous and self-contained: crypto.subtle is asynchronous and is not
     offered to every page opened from file://. Identifies an SVG in the log. */
  VEP.sha256Hex = function (text) {
    const bytes = unescape(encodeURIComponent(String(text)));
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const l = bytes.length;
    const nBlocks = ((l + 9 + 63) >> 6);
    const W = new Uint32Array(nBlocks * 16);
    for (let i = 0; i < l; i++) W[i >> 2] |= bytes.charCodeAt(i) << (24 - (i & 3) * 8);
    W[l >> 2] |= 0x80 << (24 - (l & 3) * 8);
    W[nBlocks * 16 - 1] = (l * 8) >>> 0;
    W[nBlocks * 16 - 2] = Math.floor(l / 0x20000000);
    const w = new Uint32Array(64);
    const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (let b = 0; b < nBlocks; b++) {
      for (let t = 0; t < 16; t++) w[t] = W[b * 16 + t];
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t-15], 7) ^ rotr(w[t-15], 18) ^ (w[t-15] >>> 3);
        const s1 = rotr(w[t-2], 17) ^ rotr(w[t-2], 19) ^ (w[t-2] >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & bb) ^ (a & c) ^ (bb & c);
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return Array.from(H).map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  };

  /* ── Text in a URL parameter (URL-safe base64 of UTF-8) ───────────────── */
  VEP.encodeTextForURL = function (text) {
    if (!text) return '';
    try {
      return btoa(unescape(encodeURIComponent(String(text))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return ''; }
  };
  VEP.decodeTextFromURL = function (s) {
    if (!s) return '';
    try {
      let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return decodeURIComponent(escape(atob(b64)));
    } catch (e) { return null; }
  };

  /* ── One colour against a fixed background ───────────────────────────────
     Michelson contrast between a stimulus colour and the background, with the
     background held where it is — it is shared by every stimulus of the page,
     so it cannot move with any one of them. The stimulus colour slides along
     its own ray towards black and keeps its chromaticity; it stays on its side
     of the background (brighter stays brighter). */
  VEP.solveColourForContrast = function (fns, o) {
    const out = { ok: false, reason: '', rgb: null, L: null, contrast: null, target: null };
    if (!fns || !o || !o.colour || !o.background) { out.reason = 'missing arguments'; return out; }
    const C = Number(o.contrast);
    if (!isFinite(C) || C < 0 || C > 1) { out.reason = 'contrast must be between 0 and 100%'; return out; }
    const Lb = VEP.luminanceOfRGB(fns, o.background);
    const L0 = VEP.luminanceOfRGB(fns, o.colour);
    const Lmin = fns.L_min || 0;
    const brighter = L0 >= Lb;
    if (brighter && C >= 1) {
      out.reason = '100% contrast above the background would need infinite luminance'; return out;
    }
    if (Lb - Lmin < fns.L_max * 1e-6 && brighter) {
      out.reason = 'the background is at the display’s black level, so any brighter color '
                 + 'has 100% contrast against it';
      return out;
    }
    const target = brighter ? Lb * (1 + C) / (1 - C) : Lb * (1 - C) / (1 + C);
    out.target = target;
    const r = slideOnRay(fns, o.colour, target);
    out.rgb = r.rgb;
    out.L = VEP.luminanceOfRGB(fns, out.rgb);
    out.contrast = VEP.michelson(out.L, Lb);
    const tol = Math.max(1e-9, fns.L_max * 0.02);
    if (Math.abs(out.L - target) > tol) {
      out.reason = 'outside the display range for this color';
      return out;
    }
    out.ok = true;
    return out;
  };

  /* ── Stimulus shapes as binary masks ─────────────────────────────────────
     A shape is a w × h array of 0/1, one byte per pixel, with its ink filling
     the box edge to edge: the height asked for is the height of what is drawn,
     not of an invisible frame around it. Binary on purpose — an anti-aliased
     edge would carry intermediate codes whose luminance the calibration does
     not describe, so the stimulus would have more than two luminances. */

  /**
   * The built-in shapes, computed from geometry rather than drawn by the
   * browser, so they are identical on every system: X (two diagonal strokes),
   * O (a ring) and + (two bars). Pixel centres are tested against the shape.
   * heightPx and strokePx in screen pixels; the box is square.
   */
  VEP.builtinShapeMask = function (kind, heightPx, strokePx) {
    const h = Math.max(1, Math.round(heightPx));
    const s = Math.max(1, Number(strokePx) || 1);
    const w = h, c = h / 2, data = new Uint8Array(w * h);
    const half = s / 2, diag = s / Math.SQRT2;
    let area = 0;
    for (let y = 0; y < h; y++) {
      const py = y + 0.5;
      for (let x = 0; x < w; x++) {
        const px = x + 0.5;
        let on = false;
        if (kind === 'X') {
          on = Math.abs(px - py) <= diag || Math.abs(px + py - h) <= diag;
        } else if (kind === 'O') {
          const r = Math.hypot(px - c, py - c);
          on = r <= c && r >= c - s;
        } else if (kind === '+') {
          on = Math.abs(px - c) <= half || Math.abs(py - c) <= half;
        }
        if (on) { data[y * w + x] = 1; area++; }
      }
    }
    if (!area) return { ok: false, reason: 'the shape is too small to draw' };
    return { ok: true, w: w, h: h, data: data, area: area };
  };

  /** Largest SVG accepted after cleaning, in bytes of UTF-8. It travels in
      every link and log, so it has to stay small. */
  VEP.SVG_MAX_BYTES = 16384;

  /**
   * Check and clean an SVG before it is used as a stimulus shape.
   *
   * Refused: anything that would make the shape depend on the machine it is
   * shown on or reach outside the file — text (it is drawn with whatever fonts
   * happen to be installed), embedded or linked images, HTML content, external
   * references, scripts and event handlers. Removed: editor metadata, comments,
   * titles. The root gets explicit width and height from its viewBox, so every
   * browser draws it at a defined size.
   * Returns { ok, reason, svg, width, height } with width/height in viewBox units.
   */
  /** Does a value contain url(...) pointing anywhere but inside the file? */
  function externalUrl(val) {
    const re = /url\(\s*['"]?\s*([^)'"\s]*)/gi;
    let m;
    while ((m = re.exec(String(val))) !== null) if (m[1].charAt(0) !== '#') return true;
    return false;
  }

  VEP.prepareSVG = function (text) {
    const out = { ok: false, reason: '', svg: '', width: 0, height: 0 };
    let doc = null;
    try { doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml'); }
    catch (e) { doc = null; }
    if (!doc || doc.getElementsByTagName('parsererror').length) {
      out.reason = 'the file is not valid SVG (it does not parse as XML)'; return out;
    }
    const svg = doc.documentElement;
    if (!svg || svg.localName !== 'svg') { out.reason = 'the file has no <svg> root element'; return out; }

    const FORBID = {
      text: 'text', tspan: 'text', textPath: 'text',
      image: 'an embedded or linked image', foreignObject: 'HTML content (foreignObject)',
      script: 'a script', iframe: 'an embedded page', video: 'video', audio: 'audio',
      canvas: 'a canvas', feImage: 'an image filter source',
      /* Declarative animation is not script, so an <img> renders it: the mask
         would be whichever frame happened to be up when it was rasterised. */
      animate: 'an animation', animateTransform: 'an animation',
      animateMotion: 'an animation', set: 'an animation', discard: 'an animation',
    };
    const DROP = { metadata: 1, title: 1, desc: 1, namedview: 1 };
    const EDITOR_NS = /inkscape|sodipodi|adobe|sketch|figma|serif\.com/i;
    const drop = [];
    const els = [svg].concat(Array.from(svg.getElementsByTagNameNS('*', '*')));
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (FORBID[el.localName]) {
        const kind = FORBID[el.localName];
        const hint = (kind === 'text')
          ? ' — convert text to paths (outlines) in the editor and save again'
          : (kind === 'an animation')
            ? ' — the shape has to look the same every time it is drawn'
            : ' — only self-contained vector shapes can be used';
        out.reason = 'the SVG contains ' + kind + hint;
        return out;
      }
      if (DROP[el.localName] || (el.namespaceURI && EDITOR_NS.test(el.namespaceURI))) {
        drop.push(el); continue;
      }
      const attrs = Array.from(el.attributes);
      for (let j = 0; j < attrs.length; j++) {
        const at = attrs[j], name = at.name, val = at.value;
        if (/^on/i.test(at.localName)) { out.reason = 'the SVG contains an event handler (' + name + ')'; return out; }
        if (at.localName === 'href' && !/^\s*#/.test(val)) {
          out.reason = 'the SVG refers to an external resource (' + val.slice(0, 60) + ')'; return out;
        }
        if (externalUrl(val)) {
          out.reason = 'the SVG refers to an external resource in ' + name; return out;
        }
        if ((at.namespaceURI && EDITOR_NS.test(at.namespaceURI))
            || /^xmlns:/.test(name) && EDITOR_NS.test(val)) el.removeAttribute(name);
      }
      if (el.localName === 'style') {
        const css = el.textContent || '';
        if (/@import/i.test(css) || externalUrl(css)) {
          out.reason = 'the SVG style sheet refers to an external resource'; return out;
        }
        if (/@keyframes|animation\s*:|animation-name\s*:/i.test(css)) {
          out.reason = 'the SVG style sheet animates the shape'
            + ' — the shape has to look the same every time it is drawn';
          return out;
        }
      }
    }
    drop.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    // comments
    const walker = doc.createTreeWalker(svg, 128 /* NodeFilter.SHOW_COMMENT */);
    const comments = []; while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(function (c) { c.parentNode.removeChild(c); });

    let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(function (v) { return !isFinite(v); })) {
      const pw = parseFloat(svg.getAttribute('width')), ph = parseFloat(svg.getAttribute('height'));
      const unitOK = function (a) { return /^\s*[\d.]+\s*(px)?\s*$/.test(a || ''); };
      if (isFinite(pw) && isFinite(ph) && unitOK(svg.getAttribute('width')) && unitOK(svg.getAttribute('height'))) {
        vb = [0, 0, pw, ph];
      } else {
        out.reason = 'the SVG needs a viewBox (or a width and height in pixels)'; return out;
      }
    }
    if (!(vb[2] > 0 && vb[3] > 0)) { out.reason = 'the SVG viewBox has no area'; return out; }
    svg.setAttribute('viewBox', vb.join(' '));
    svg.setAttribute('width', String(vb[2]));
    svg.setAttribute('height', String(vb[3]));

    let txt = new XMLSerializer().serializeToString(svg)
      .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
    const bytes = unescape(encodeURIComponent(txt)).length;
    if (bytes > VEP.SVG_MAX_BYTES) {
      out.reason = 'the SVG is ' + (bytes / 1024).toFixed(1) + ' kB after cleaning; the limit is '
        + (VEP.SVG_MAX_BYTES / 1024) + ' kB — simplify the paths or save as plain SVG';
      return out;
    }
    out.ok = true; out.svg = txt; out.width = vb[2]; out.height = vb[3];
    return out;
  };

  /** Load a cleaned SVG as an image. Resolves to the HTMLImageElement. */
  VEP.loadSVGImage = function (svgText) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('the browser could not draw this SVG')); };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    });
  };

  function rasterAlpha(img, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, w, h);
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  }
  function inkBox(a, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /**
   * Binary mask of a loaded SVG whose drawn part is heightPx tall, keeping the
   * aspect ratio. The shape is whatever the SVG paints opaquely (alpha of at
   * least one half); its own colours are ignored — the stimulus colour is set on
   * the page, where the calibration applies to it.
   * Measured in two passes: once at a reference size to find where the ink sits
   * within the viewBox, then at the scale that gives the ink the requested
   * height. The result can differ from heightPx by a pixel; the actual size is
   * returned and logged.
   */
  VEP.svgShapeMask = function (img, vbW, vbH, heightPx) {
    const out = { ok: false, reason: '' };
    const target = Math.max(1, Math.round(heightPx));
    try {
      const ref = 1024 / Math.max(vbW, vbH);
      const rw = Math.max(1, Math.round(vbW * ref)), rh = Math.max(1, Math.round(vbH * ref));
      const b = inkBox(rasterAlpha(img, rw, rh), rw, rh);
      if (!b) { out.reason = 'the SVG draws nothing opaque'; return out; }
      const scale = ref * target / (b.y1 - b.y0 + 1);
      const fw = Math.max(1, Math.round(vbW * scale)), fh = Math.max(1, Math.round(vbH * scale));
      if (fw > 16384 || fh > 16384 || fw * fh > 64e6) {
        out.reason = 'the shape fills too little of its viewBox to be drawn at this size — '
                   + 'crop the viewBox to the shape';
        return out;
      }
      const a = rasterAlpha(img, fw, fh);
      const b2 = inkBox(a, fw, fh);
      if (!b2) { out.reason = 'the SVG draws nothing opaque at this size'; return out; }
      const w = b2.x1 - b2.x0 + 1, h = b2.y1 - b2.y0 + 1;
      const data = new Uint8Array(w * h);
      let area = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (a[((y + b2.y0) * fw + x + b2.x0) * 4 + 3] >= 128) { data[y * w + x] = 1; area++; }
      }
      out.ok = true; out.w = w; out.h = h; out.data = data; out.area = area;
      return out;
    } catch (e) {
      out.reason = 'the browser would not let this page read the drawn SVG (' + e.message + ')';
      return out;
    }
  };

  /* ── Shape renderer (WebGL 2) ─────────────────────────────────────────────
     Background, one shape from a mask atlas, fixation cross and sync dot. The
     shapes are uploaded once as a single R8 texture with the masks stacked
     vertically, and read with texelFetch, so the GPU sees exactly the pixels
     the Canvas 2D reference writes. The fixation cross takes the integer
     geometry the CPU path uses (centre, arm, bar rows) for the same reason. */
  VEP.SHAPE_FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform vec2  uCentre;
uniform vec3  uColBg;
uniform bool  uShapeOn;
uniform vec3  uColShape;
uniform sampler2D uAtlas;
uniform ivec2 uOrigin;
uniform ivec2 uSize;
uniform int   uAtlasY;
uniform bool  uShowFix;
uniform ivec2 uFixC;
uniform int   uFixArm;
uniform int   uFixT0;
uniform int   uFixT1;
uniform vec3  uColFix;
uniform vec4  uDotBounds;
uniform float uDotBright;
uniform vec3  uDotCol;
out vec4 outColor;
void main() {
  vec2 fcRaw = gl_FragCoord.xy;
  float Hh = 2.0 * uCentre.y;
  ivec2 p = ivec2(int(fcRaw.x - 0.5), int(Hh - 0.5 - fcRaw.y));   // top-down pixel
  vec3 col = uColBg;
  if (uShapeOn) {
    ivec2 q = p - uOrigin;
    if (q.x >= 0 && q.y >= 0 && q.x < uSize.x && q.y < uSize.y) {
      if (texelFetch(uAtlas, ivec2(q.x, q.y + uAtlasY), 0).r > 0.5) col = uColShape;
    }
  }
  if (uShowFix) {
    int dx = p.x - uFixC.x, dy = p.y - uFixC.y;
    if ((abs(dx) <= uFixArm && dy >= uFixT0 && dy <= uFixT1) ||
        (abs(dy) <= uFixArm && dx >= uFixT0 && dx <= uFixT1)) col = uColFix;
  }
  if (fcRaw.x >= uDotBounds.x && fcRaw.x < uDotBounds.z &&
      fcRaw.y >= uDotBounds.y && fcRaw.y < uDotBounds.w) {
    col = (uDotBright > 0.5) ? uDotCol : vec3(0.0);
  }
  outColor = vec4(col, 1.0);
}`;

  VEP.createShapeRenderer = function (opts) {
    opts = opts || {};
    const onContextLost = opts.onContextLost || function () {};
    const updateBadge   = opts.updateBadge   || function () {};
    let gl = null, canvas = null, prog = null, tex = null, lost = false, listening = false;
    let shapes = [];
    const L = {};
    const NAMES = ['uCentre', 'uColBg', 'uShapeOn', 'uColShape', 'uAtlas', 'uOrigin', 'uSize',
      'uAtlasY', 'uShowFix', 'uFixC', 'uFixArm', 'uFixT0', 'uFixT1', 'uColFix',
      'uDotBounds', 'uDotBright', 'uDotCol'];
    function compile(src, type) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    const c3 = function (loc, c) { gl.uniform3f(loc, c.r / 255, c.g / 255, c.b / 255); };
    const api = {
      init: function (cv) {
        canvas = cv;
        gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
        if (!gl) throw new Error('WebGL 2 not available');
        lost = false;
        if (!listening) {
          listening = true;
          cv.addEventListener('webglcontextlost', function (e) {
            e.preventDefault(); lost = true; onContextLost(); updateBadge('fail', 'context lost');
          });
        }
        const vs = compile(VEP.PATTERN_VERT, gl.VERTEX_SHADER);
        const fs = compile(VEP.SHAPE_FRAG, gl.FRAGMENT_SHADER);
        prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        gl.deleteShader(vs); gl.deleteShader(fs);
        gl.useProgram(prog);
        const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        NAMES.forEach(function (n) { L[n] = gl.getUniformLocation(prog, n); });
        gl.uniform1i(L.uAtlas, 0);
      },
      get active() { return gl !== null && !lost; },
      resize: function (w, h) {
        if (!gl || lost) return;
        canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
      },
      /** data: Uint8Array of 0/1 (or 0/255), w × h, rows top-down. */
      uploadAtlas: function (data, w, h) {
        if (!gl || lost) return;
        const bytes = new Uint8Array(w * h);
        for (let i = 0; i < bytes.length; i++) bytes[i] = data[i] ? 255 : 0;
        gl.activeTexture(gl.TEXTURE0);
        if (tex) gl.deleteTexture(tex);
        tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      },
      /**
       * s = { W, H, background:{r,g,b},
       *       fixation:{ show, cx, cy, arm, t0, t1, colour },
       *       dot:{ x, y, size },
       *       shapes:[ { x0, y0, w, h, atlasY, colour } ] }   (index 0 = stimulus 1)
       */
      setSession: function (s) {
        if (!gl || lost) return;
        gl.useProgram(prog);
        gl.uniform2f(L.uCentre, s.W * 0.5, s.H * 0.5);
        c3(L.uColBg, s.background);
        const f = s.fixation;
        gl.uniform1i(L.uShowFix, f.show ? 1 : 0);
        gl.uniform2i(L.uFixC, f.cx, f.cy);
        gl.uniform1i(L.uFixArm, f.arm); gl.uniform1i(L.uFixT0, f.t0); gl.uniform1i(L.uFixT1, f.t1);
        c3(L.uColFix, f.colour);
        const d = s.dot, half = (d.size / 2) | 0, W = s.W, H = s.H;
        const sx0 = Math.max(0, d.x - half), sy0 = Math.max(0, d.y - half);
        const sx1 = Math.min(W - 1, d.x + half - 1), sy1 = Math.min(H - 1, d.y + half - 1);
        gl.uniform4f(L.uDotBounds, sx0, H - sy1 - 1, sx1 + 1, H - sy0);
        shapes = s.shapes || [];
      },
      /** which: 0 = no shape (background only), 1..n = that stimulus. */
      render: function (which, dotOn, dotColour) {
        if (!gl || lost) return;
        const sh = which > 0 ? shapes[which - 1] : null;
        gl.uniform1i(L.uShapeOn, sh ? 1 : 0);
        if (sh) {
          gl.uniform2i(L.uOrigin, sh.x0, sh.y0);
          gl.uniform2i(L.uSize, sh.w, sh.h);
          gl.uniform1i(L.uAtlasY, sh.atlasY);
          c3(L.uColShape, sh.colour);
        }
        gl.uniform1f(L.uDotBright, dotOn ? 1 : 0);
        c3(L.uDotCol, dotColour || { r: 255, g: 255, b: 255 });
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
    };
    return api;
  };

})(typeof window !== 'undefined' ? window : this);
