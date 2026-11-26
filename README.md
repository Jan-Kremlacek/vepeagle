# VEPeagle

Visual evoked potential stimuli that run in a browser, from a folder on disk.
Flash, pattern reversal, pattern onset, radial motion onset and an oddball
paradigm, with the calibration, launcher and log tools they need around them.

No installation, no build step, no server and no network connection.

The name runs VEP and *eagle* together. The eagle is the Orlice — Czech for a
female eagle, and the river that joins the Elbe at Hradec Králové, where the
suite was written.

## Quick start

1. Download the repository (green **Code** button → *Download ZIP*) and unpack
   it. Keep every file in one folder.
2. Open `vep_gate.html` in a current browser. Chrome and Firefox are tested.
3. Measure your display once with `display_calibration.html` and save the
   calibration JSON. Every stimulus can load it, and every log names it.
4. Set the screen geometry and viewing distance in the gate, pick a stimulus,
   press **Run**.

`manual.html` is the reference documentation and answers most questions before
they arise.

## What makes it different

**Timing is measured, not assumed.** A synchronization patch changes color at
each stimulus transition and is read by a photocell on the display, so the EEG
is triggered by the light itself rather than by the computer's intention to
show it. The oddball page gives each stimulus its own trigger color, so an RGB
photodiode can tell standard from deviant without a separate channel.

**The display is characterized in physical units.** Gamma and luminance come
from a measured calibration file, contrasts are solved in candelas per square
meter, and the calibration travels in the stimulus link and is recorded in the
log.

**Both render paths are verified against each other.** Each page can draw
through WebGL2 or Canvas 2D. Before a session the two are compared pixel by
pixel, and WebGL is used only if it matches; otherwise the page falls back and
says so in the log. They currently agree exactly — `maxDiff 0`, no differing
pixel, on every page and at any canvas size.

**A condition is a link.** Every parameter lives in the URL, so a condition can
be copied, mailed, bookmarked or put in a protocol, and it reopens identically
on another machine. Oddball sequences are generated from a seed, so the trial
order can be reconstructed from the log alone.

## Files

| File | What it is for |
|---|---|
| `vep_gate.html` | Launcher: environment, protocol, calibration |
| `flash_vep.html` | Flash VEP |
| `pattern_reversal_vep.html` | Pattern-reversal VEP |
| `pattern_onset_vep.html` | Pattern-onset VEP |
| `motion_onset_vep.html` | Radial motion-onset VEP |
| `oddball_vep.html` | Oddball VEP (standard, deviant, optional third stimulus) |
| `display_calibration.html` | Measure a display, write the calibration file |
| `vep_log_analyzer.html` | Read logs, summarize, draft an APA paragraph |
| `webgl_parity_test.html` | Compare the WebGL2 and Canvas 2D paths |
| `manual.html` | Reference documentation |
| `vep_engine.js` | Shared code: rendering, luminance model, run control |
| `vep_page.js` | Page machinery the five stimulus pages share verbatim |
| `vep.css` | Every style in the suite: the color palette for both themes, the shared rules, then one section per page |
| `p5.min.js` | p5.js 1.9.3, bundled (LGPL-2.1, see `THIRD_PARTY.md`) |

`examples/shapes/` holds three ready-made oddball stimuli — a checkerboard
standard and a mirror-image pair of eagles, matched in drawn area and extent.
See the README there before choosing a shape size.

`check_consts.py` and `tests/` are development tools and are not needed to run
a session.

## Requirements

A current desktop browser with WebGL2. The suite runs from `file://`; no server
is required and nothing is fetched over the network.

## Development checks

```bash
cd tests && npm install          # eslint, globals, p5 (local copy)
pip install playwright && python3 -m playwright install chromium

bash tests/check.sh              # static checks over every page and the engine
node tests/test_engine.js
python3 tests/test_gate.py
python3 tests/test_stim.py
python3 tests/test_oddball.py
python3 tests/test_oddball2.py
python3 tests/test_misc.py
python3 tests/test_pixels.py
```

Each prints `PASS`/`FAIL` lines, ends with `FAILURES: n` and exits non-zero on
failure. See `tests/README.md`. Headless tests do not replace a run on real
hardware, in fullscreen, or with a photodiode attached.

## Citation

```
Kremlacek, J. (2026). VEPeagle: a browser-based visual evoked potential
stimulus suite (Version 1.2.0) [Computer software]. MIT License.
https://github.com/Jan-Kremlacek/vepeagle
```

<!-- TODO before release: add the Zenodo concept DOI here and in CITATION.cff
     once the first release is archived. -->

See `CITATION.cff` for machine-readable metadata.

Write the name as **VEPeagle** in prose, and `vepeagle` wherever it becomes a
repository name, a file name or part of a URL.

## License

MIT, see `LICENSE`. The bundled `p5.min.js` is LGPL-2.1; see `THIRD_PARTY.md`
and `p5.js-LICENSE.txt`. That license applies to that file only.
