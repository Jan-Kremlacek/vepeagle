/* vep_page.js — code shared verbatim by the five stimulus pages.

   Loaded by flash_vep.html, pattern_reversal_vep.html, pattern_onset_vep.html,
   motion_onset_vep.html and oddball_vep.html, right after vep_engine.js. These
   are ordinary global functions, exactly as they were when each page carried
   its own copy: they read the page's own state (its form, its run controls,
   its calibration) at the moment they are called, so a page must have
   declared that state before calling them — which every page does, since
   they are only called from its own scripts.

   vep_engine.js holds what does not depend on a page (colour science, the
   WebGL renderer, SVG handling); this file holds the page machinery that
   happens to be the same on all five. A function that differs on even one
   page stays in that page. */

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max > 0 ? d / max : 0, v: max };
}

/* Once a session's renderer is actually chosen (after the parity gate), reflect
   the real result in the on-screen note and the APA methods text, so note, APA,
   and log agree — the parity gate can fall back to Canvas 2D even when the light
   detection test passed. */
function _syncRendererReadout() {
  _rendererDecided = true;
  /* Snapshot the actual renderer NOW, while useWebGL is authoritative.
     endSession()/abortStimulation() reset useWebGL to false before the
     log is written, so the log must read this snapshot, not the live flag. */
  _sessionRenderer = useWebGL ? 'webgl2' : 'canvas2d';
  const note = document.getElementById('rendererNote');
  if (note) {
    if (useWebGL) {
      const t = (webglTestResult && webglTestResult.timing_60f_ms != null)
        ? '  (60 draw calls: ' + webglTestResult.timing_60f_ms + '\u202fms, GPU throughput)' : '';
      note.textContent = 'Renderer: WebGL\u00a02 \u2713' + t;
    } else {
      const disabled = (urlParams.get('webgl') === '0');
      note.textContent = 'Renderer: Canvas 2D'
        + (disabled ? ' (WebGL\u00a02 available but disabled)'
                    : ' (WebGL\u00a02 parity fallback)');
    }
  }
  try { buildAPADescription(); } catch (e) {}
}

/* Explicit copy actions. The builders above only render the preview; only a
   click puts anything on the clipboard, so a background refresh can never
   overwrite what the operator just copied. */
function copyURLPreview() {
  VEP.copyToClipboard(updateURLPreview(), document.getElementById('urlPreview'));
}

function copyAPADescription() {
  VEP.copyToClipboard(buildAPADescription(), document.getElementById('apaPreview'));
}

/** True when the calibration was actually measured, so luminances may be
    reported in cd/m^2 rather than as relative or modelled values. */
function luminanceIsMeasured() {
  return !!(gammaCalibration && gammaCalibration.model === 'measured');
}

/** True when R, G and B were each measured, rather than their relative
    luminances being assumed from the sRGB primaries. Only a per-channel
    measurement can tell one hue's luminance from another's on this display. */
function channelsWereMeasured() {
  return !!(gammaFns && gammaFns.weights && gammaFns.weights.basis === 'measured_channels');
}

/** What the reported luminances rest on, recorded in the log. */
function luminanceBasis() {
  if (!luminanceIsMeasured()) return 'not_reported';
  return channelsWereMeasured() ? 'measured_channels' : 'measured_grey_srgb_primaries';
}

/** Write an RGB triple into a colour pair, keeping swatch, field and state together. */
function setColourPair(hexId, swatchId, col, rgb) {
  col.r = rgb.r; col.g = rgb.g; col.b = rgb.b;
  const hex   = rgbToHex(rgb);
  const hexEl = document.getElementById(hexId);
  const swEl  = document.getElementById(swatchId);
  if (hexEl) { hexEl.value = hex; hexEl.classList.remove('invalid'); }
  if (swEl)  swEl.style.background = hex;
}

/**
 * Compare the rate at which the browser delivered frames with the refresh rate
 * the operator says the presentation display runs at.
 *
 * These are two different quantities and no browser API reports the second one:
 * screen exposes no refresh rate, and neither does the Window Management API.
 * What can be measured is only how often requestAnimationFrame fired.
 *
 * With displays of different rates connected, that cadence need not match the
 * panel actually presenting — and it is not settled by which monitor the window
 * sits on: a browser moved entirely onto a 60 Hz display has been observed still
 * running at the 120 Hz of another connected panel. The mechanism sits below the
 * browser, so the wording here reports the discrepancy without claiming a cause.
 *
 * When the two disagree, frame-locked durations are computed against a cadence
 * the panel never showed: the effective quantisation is the panel's, and a short
 * sync flash may fall between refreshes. That is worth saying out loud, because
 * nothing else in the record reveals it.
 */
function updateRefreshMismatchNote() {
  const el = document.getElementById('refreshMismatchNote');
  if (!el) return;
  const declared = declaredRefreshHz();
  const f = presentationFPS();
  const fps = f.hz;
  if (!declared || !(fps > 0)) { el.style.display = 'none'; return; }
  const ratio = fps / declared;
  if (Math.abs(ratio - 1) <= 0.05) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  /* The two directions have different consequences and must not be described in
     the same words. Frames arriving faster than the panel refreshes means some
     of them are never shown and the panel sets the limit. Frames arriving slower
     means every one of them is shown, each held over several refreshes, and the
     delivery rate sets the limit. Either way the coarser of the two intervals is
     what the stimulus is actually quantised to. */
  const deliveredMs = 1000 / fps, displayMs = 1000 / declared;
  const fpsTxt = f.exact ? fps.toFixed(1) : 'about ' + Math.round(fps);
  const head = (f.exact ? 'Frames were delivered at ' : 'Frames are arriving at ') + fpsTxt + ' Hz'
    + (f.where === 'child' ? ' in the stimulus window' : '')
    + ', but the presentation display is set to ' + declared + ' Hz. '
    + '<strong>The browser is pacing the stimulus at a different rate than the display '
    + 'presenting it.</strong> ';
  const body = (fps > declared)
    ? 'Only the display\'s own refreshes reach the subject, so durations land on multiples of '
      + displayMs.toFixed(1) + ' ms rather than ' + deliveredMs.toFixed(1) + ' ms, and brief '
      + 'events may fall between two refreshes and never be shown. '
    : 'New content appears only as fast as frames are delivered, so durations land on multiples '
      + 'of ' + deliveredMs.toFixed(1) + ' ms even though the display could resolve '
      + displayMs.toFixed(1) + ' ms; each frame is held over several refreshes. '
      + 'Nothing is dropped, but the timing is coarser than the panel would allow. ';
  el.innerHTML = head + body
    + 'Setting every connected display to the same refresh rate is the dependable remedy.';
}

function presentationFPS() {
  if (_childWin && !_childWin.closed) {
    return { hz: _childFPS.hz, exact: _childFPS.exact, where: 'child' };
  }
  if (measuredFPS > 0) return { hz: measuredFPS, exact: true, where: 'local' };
  return { hz: _localProbeFPS, exact: false, where: 'local' };
}

/** The rate as the methods text states it, including how it was obtained. */
function fpsPhrase(f) {
  if (!(f.hz > 0)) return 'a rate measured when the session starts';
  return f.exact ? f.hz.toFixed(1) + ' Hz (measured)'
                 : 'approximately ' + Math.round(f.hz) + ' Hz (estimated before the session; '
                   + 'the exact rate is measured when the session starts)';
}

/** Refresh rate the operator entered for the presentation display, or 0. */
function declaredRefreshHz() {
  const el = document.getElementById('displayRefreshHz');
  const v = el ? parseFloat(el.value) : NaN;
  return (isFinite(v) && v > 0) ? v : 0;
}

/**
 * Warn when the presentation window is on a different display from this one.
 *
 * Screen width and viewing distance describe the surface the subject looks at.
 * When the stimulus is presented on a second monitor, the value detected here
 * belongs to the wrong screen, and its physical width in centimetres has to be
 * measured on that monitor too -- nothing in the browser can supply it. Getting
 * this wrong scales every angle in the stimulus and leaves no trace in the log
 * beyond the numbers themselves.
 */
function updateScreenScopeNote() {
  const el = document.getElementById('screenScopeNote');
  if (!el) return;
  const here = window.screen.width;
  if (!_childScreenW || _childScreenW === here) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  /* Only the presentation display's width is stated. This window's own width is
     of no use here and would go stale the moment either display changed. */
  el.innerHTML = 'The stimulus window is on a different display, '
    + _childScreenW + ' px wide. '
    + '<strong>Width (px) and Width (cm) must describe the display the subject sees.</strong> '
    + 'Set the width to ' + _childScreenW + ' px, measure that monitor physically, and check '
    + 'the viewing distance applies to it too.';
}

/** Calibration date in one fixed form, so the line reads the same everywhere
    rather than following whatever locale the operator's machine happens to use. */
function formatCalibrationDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return 'not recorded';
  try {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return d.toDateString(); }
}

/**
 * One line answering the three things an operator needs before recording:
 * what kind of calibration is in force, how old it is, and whether it is backed
 * by a named file or only carried by the link that opened this page.
 * "No calibration" and a calibration whose model is sRGB are different states:
 * the first knows nothing about the display's luminance range and works in
 * relative units, the second has a measured range and assumes only the curve.
 */
function updateCalibrationStatusEl(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (!gammaCalibration) {
    el.innerHTML = '<span style="color:#e8a55a">&#9888; No calibration &mdash; sRGB assumed, relative units</span>'
      + ' <a href="display_calibration.html" target="vep_calibration" style="color:#7bc8e8;font-size:.9em">Calibrate &rarr;</a>';
    return;
  }
  const d    = new Date(gammaCalibration.calibration_date);
  const days = Math.floor((Date.now() - d) / 86400000);
  const old  = days >= GAMMA_WARN_DAYS;
  const ms   = { srgb:'sRGB', power:`Power-law (\u03B3=${gammaCalibration.gamma})`,
                 measured:'Measured' }[gammaCalibration.model] || gammaCalibration.model;
  const Ls   = gammaFns ? ` \u00B7 ${gammaFns.L_max.toFixed(0)} cd/m\u00B2` : '';
  /* Source follows gammaCalSource, the same value the log records, so the panel
     and the log can never tell different stories. A calibration is "from file"
     whenever a file name is known for it, whether it was opened here or carried
     in by the link; without a name there is nothing to trace it back to, so it
     counts as temporary. */
  const src  = gammaCalSource === 'file'
             ? ` \u00B7 file: ${gammaCalFileName || 'unnamed'}`
             : ' \u00B7 temporary (from link)';
  el.innerHTML = `<span style="color:${old?'#e8a55a':'#59c08b'}">${old?'\u26A0':'\u2713'} ${ms}${Ls}</span>`
    + ` <span class="t-faint" style="font-size:.88em" >\u00B7 ${formatCalibrationDate(d)}`
    + `${old?' &mdash; <b style=color:#e8a55a>recalibrate</b>':''}${src}</span>`;
}

function _probeChildRefreshRate() {
  if (!_isChild || state !== 'INIT') return;
  /* Debounced, because the events that mean "this window may now be on a
     different display" — resize, fullscreen, regaining visibility — arrive in
     bursts, and a probe costs 60 frames. The delay also lets the window settle:
     measured immediately after opening or after a fullscreen transition, the
     frame intervals describe the transition rather than the display. */
  if (_probeTimer) clearTimeout(_probeTimer);
  _probeTimer = setTimeout(function () {
    _probeTimer = null;
    if (_probeBusy || document.hidden || state !== 'INIT') return;
    _probeBusy = true;
    const dts = []; let last = null, n = 0; const N = 60;
    requestAnimationFrame(function tick(t) {
      if (last !== null) dts.push(t - last);
      last = t;
      if (++n <= N && !document.hidden) { requestAnimationFrame(tick); return; }
      _probeBusy = false;
      /* A hidden or throttled window reports intervals many times too long;
         reporting those would be worse than saying nothing. */
      if (document.hidden || dts.length < 20) return;
      dts.sort(function (a, b) { return a - b; });
      const med = dts[dts.length >> 1] || 0;
      const hz  = med > 0 ? Math.round(1000 / med) : 0;
      if (hz >= 20 && hz <= 480) _toParent({ type: 'vep_fps', fps: hz, probe: true });
    });
  }, 600);
}

function _watchScreenChanges() {
  if (!_isChild) return;
  setInterval(function () {
    const sig = window.screen.width + 'x' + window.screen.height
              + '@' + (window.devicePixelRatio || 1);
    if (sig === _screenSig) return;
    const first = !_screenSig;
    _screenSig = sig;
    _reportGeometryToParent();
    if (!first) _probeChildRefreshRate();
  }, 1000);
}

/* Does the operator want the stimulus fullscreen? (Run-panel checkbox.) */
function _fullscreenWanted() {
  const el = document.getElementById('useFullscreen');
  return !!(el && el.checked);
}

/**
 * Apply the operator's fullscreen intent in the stimulus window, at any time.
 *
 * The switch itself cannot be pushed from the parent: requestFullscreen() is
 * only granted to the document that calls it, and only while that document
 * holds a user activation. A postMessage carries none. What the parent can do
 * is arm this window and put the prompt up, so one click or F here does it —
 * which beats closing and reopening the window just to change the setting.
 */
function _applyFullscreenPref(wanted) {
  const el = document.getElementById('useFullscreen');
  if (el) el.checked = !!wanted;
  if (wanted) {
    if (!_fsGestureArmed) {
      VEP.armFullscreenGesture({ note: 'childWaiting',
                                 canEnter: function () { return state === 'INIT'; } });
      _fsGestureArmed = true;
    }
    /* Already fullscreen (or OS-maximized to the same effect)? Then there is
       nothing to ask for and the prompt would just cover the stimulus. */
    VEP.showChildWaiting(!VEP.isEffectivelyFullscreen());
  } else {
    VEP.showChildWaiting(false);
  }
}

/* Is the presenting surface allowed to start right now? With fullscreen off,
   always. With fullscreen on: a local run can request it at launch, so it is
   allowed; a child run may start only once the child reports it is fullscreen. */
function _fullscreenGateOK() {
  if (!_fullscreenWanted()) return true;
  if (_childWin && !_childWin.closed) return _childFullscreen;   // remote: must already be FS
  return true;                                                   // local: entered at launch
}

/* Recompute the idle/blocked offering of the Start button + its status text. */
function _refreshRunControls() {
  if (!_runControls) return;
  if (state !== 'INIT') return;   // a run is active; state is driven by events
  /* p5.min.js is bundled beside the page. Without it nothing can be drawn, yet
     the page itself still renders, so an unguarded Start hangs at
     'Starting...' with an uncaught ReferenceError and tells the operator
     nothing. Name what is missing and keep Start disabled. */
  if (typeof p5 === 'undefined') {
    _runControls.set('blocked',
      'The p5.js library did not load, so no stimulus can be drawn. This page '
      + 'needs p5.min.js in the same folder; copy it there and reload.');
    return;
  }
  const childOpen = !!(_childWin && !_childWin.closed);
  const where = childOpen ? 'the stimulus window' : 'this window';
  if (childOpen && !_childReady) {
    _runControls.set('blocked', 'Stimulus window: connecting\u2026');
  } else if (!_fullscreenGateOK()) {
    _runControls.set('blocked',
      'Fullscreen is required. Click the stimulus window (or press F) to make it '
      + 'fullscreen, then Start.');
  } else {
    _runControls.set('idle', 'Ready \u2014 stimulus will run in ' + where + '.');
  }
}

function _initRunControls() {
  _runControls = VEP.createRunControls({
    onStart: _runStart, onResume: _runResume,
    onPause: _runPause, onStop: _runStop,
  });
  /* Toggling the Fullscreen checkbox changes the Start gate live, and an
     already-open stimulus window needs to hear about it: otherwise its click/F
     affordance stays as it was when the window opened, and the only way to
     change the setting would be to close and reopen it. */
  const fsEl = document.getElementById('useFullscreen');
  if (fsEl) fsEl.addEventListener('change', function () {
    if (_childWin && !_childWin.closed) {
      _toChild({ type: 'vep_fullscreen_pref', wanted: _fullscreenWanted() });
    }
    _refreshRunControls();
  });
  _refreshRunControls();
}

/**
 * Read a query parameter meant as a yes/no.
 *
 * The pages write true/false, but a link is often typed or edited by hand, and
 * autostart=1, =yes or =on are all obvious intentions. Accepting them costs
 * nothing; rejecting them silently produced a page that simply did not start
 * and gave no reason. What is emitted stays canonical — one form written, many
 * read.
 *
 * Note the trap this also avoids: every query value is a string, and the string
 * "0" is truthy in JavaScript, so a bare `if (params.get(name))` is wrong for
 * every token choice. Parsing in one place is what makes it safe, not which
 * words are used.
 */
function paramBool(name, fallback) {
  if (!urlParams.has(name)) return !!fallback;
  const v = String(urlParams.get(name)).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].indexOf(v) >= 0) return true;
  if (['0', 'false', 'no', 'off', ''].indexOf(v) >= 0) return false;
  return !!fallback;
}

/**
 * Close down after an autostart run: report where the log went, then close the
 * window — but only after a pause long enough to read it.
 *
 * Closing immediately would hide the one case that matters: a download blocked
 * by the browser, which under file:// can need a confirmation. The countdown
 * costs five seconds and keeps the failure visible. A window the script did not
 * open cannot be closed at all, so that is checked rather than assumed.
 */
function _autostartFinish(savedAs) {
  const wrap = document.createElement('div');
  wrap.setAttribute('style',
    'position:fixed; inset:0; z-index:9999; display:flex; flex-direction:column;'
    + 'align-items:center; justify-content:center; gap:1rem; background:#0f141b;'
    + 'color:#e6ecf4; font:16px/1.6 system-ui,-apple-system,sans-serif; text-align:center;');
  wrap.innerHTML = '<div style="font-size:1.6rem; font-weight:600;">FINISHED</div>'
    + '<div>' + (savedAs ? 'Log prepared as <code>' + savedAs + '</code>'
                         : 'No log was written \u2014 logging was off.') + '</div>'
    + '<div id="autostartCountdown" style="color:#8fa6bd; font-size:.9em;"></div>';
  document.body.appendChild(wrap);
  const cd = document.getElementById('autostartCountdown');
  let cancelled = false;
  function stopClosing(msg) {
    cancelled = true;
    if (cd) cd.textContent = msg;
  }
  wrap.addEventListener('click', function () {
    stopClosing('Closing cancelled \u2014 close this window when done.');
  });

  function closeNow() {
    /* Leave full-screen before closing. On macOS a full-screen window occupies
       its own desktop space, and closing it from script while it is still
       full-screen has been seen to leave a window that cannot be reached
       again. Exiting first costs a moment and avoids that state. */
    let done = false;
    function reallyClose() {
      if (done) return;
      done = true;
      window.close();
      /* A window opened by the operator rather than by a script cannot be
         closed from here; say so instead of leaving a blank countdown. */
      setTimeout(function () {
        if (!window.closed) stopClosing('This window cannot be closed automatically \u2014 close it when done.');
      }, 300);
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        document.exitFullscreen().then(function () { setTimeout(reallyClose, 250); })
                                 .catch(function () { reallyClose(); });
      } catch (e) { reallyClose(); }
      setTimeout(reallyClose, 1200);   // safety net if the promise never settles
    } else {
      reallyClose();
    }
  }

  function startCountdown() {
    let left = 5;
    const t = setInterval(function () {
      if (cancelled) { clearInterval(t); return; }
      if (left <= 0) { clearInterval(t); closeNow(); return; }
      if (cd) cd.textContent = 'Closing in ' + left + ' s \u2014 click to stay open.';
      left--;
    }, 1000);
  }

  /* Do not count down while the file is still being saved.
     When the browser is set to ask where to put a download it opens a modal
     dialog, which takes focus away from this page. Counting through it would
     close the window from under the dialog and leave the save in an undefined
     state — with the recording as the thing at stake. There is no API that
     reports the dialog, but losing and regaining focus is a reliable enough
     proxy: wait for the page to be focused again, then start.
     If nothing was saved there is nothing to wait for. */
  if (!savedAs) { startCountdown(); return; }

  function waitForFocus() {
    if (cd) cd.textContent = 'Waiting until the file has been saved\u2026';
    window.addEventListener('focus', function once() {
      window.removeEventListener('focus', once);
      setTimeout(startCountdown, 400);
    });
  }

  if (!document.hasFocus()) { waitForFocus(); return; }
  /* Focused now, but a dialog may be about to appear — give it a moment before
     deciding that the save went through without one. */
  if (cd) cd.textContent = 'Saving\u2026';
  setTimeout(function () {
    if (cancelled) return;
    if (document.hasFocus()) startCountdown();
    else waitForFocus();
  }, 1200);
}

function _runResume() {
  if (_childWin && !_childWin.closed) _toChild({ type: 'vep_pause_toggle' });
  else if (state === 'PAUSED') resumeSession();
}

function _runPause() {
  if (_childWin && !_childWin.closed) _toChild({ type: 'vep_pause_toggle' });
  else if (state !== 'INIT' && state !== 'MEASURE') pauseSession();
}

function _runStop() {
  if (_childWin && !_childWin.closed) _toChild({ type: 'vep_stop' });
  if (state === 'PAUSED') state = pausedState;
  if (state !== 'INIT') abortStimulation(true);
}

function _announceRunning() {
  if (_isChild) { _toParent({ type: 'vep_running', webgl: !!useWebGL }); return; }
  if (_runControls) _runControls.set('running', 'Running in this window.');
}

function _updateChildUI(msg, startOk, pauseOk, stopOk) {
  /* Retained for the engine's childLink callback; forwards to the run status. */
  if (_runControls && typeof msg === 'string' && msg) _runControls.status(msg);
}

/* Quick rAF-based estimate of the display refresh rate, shown on the settings
   panel at load. The exact rate is measured again at session start (MEASURE). */
function _probeDisplayRefreshRate() {
  const fps = document.getElementById('fpsDisplay');
  if (fps) fps.textContent = 'measuring display\u2026';
  const dts = []; let last = null, n = 0; const N = 40;
  function tick(t) {
    if (last !== null) dts.push(t - last);
    last = t;
    if (++n <= N) requestAnimationFrame(tick);
    else {
      dts.sort((a, b) => a - b);
      const med = dts[dts.length >> 1] || 0;
      const hz  = med > 0 ? Math.round(1000 / med) : 0;
      _localProbeFPS = hz;
      refreshFpsDisplay();
      try { updateRefreshMismatchNote(); } catch (e) {}
      try { buildAPADescription(); } catch (e) {}
    }
  }
  requestAnimationFrame(tick);
}

function _updateBadge(cls, msg) {
  const note = document.getElementById('rendererNote');
  if (note && msg) note.textContent = 'Renderer: ' + msg;
}
