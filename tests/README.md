# Development checks for the VEP suite

Not part of what users receive. Static checks and headless-browser tests used
while developing version 1.1.0. Paths are relative: the suite is expected one
level up (`..`), or wherever `VEP_DIR` points.

## Setup

```bash
cd tests
npm install                         # eslint 9.39.5, globals 15.15.0, p5 1.9.3 (local copy)
pip install playwright && python -m playwright install chromium   # if not already present
```

The browser tests serve p5.js from `tests/node_modules/p5` instead of the CDN,
so they run offline. Override with `P5_JS=/path/to/p5.min.js`.

## Static checks (run after every change)

```bash
bash tests/check.sh
```

`node --check` of every inline script, `vep_engine.js` and `vep_page.js`,
`<div>` balance and duplicate ids per page, `check_consts.py` (undeclared
SCREAMING_CASE names, block-scoped declarations used outside their block), and
ESLint 9 over the inline scripts (`tests/lint.js`: `no-undef`, `no-redeclare`,
`no-unused-vars`) — the check that caught the undefined `fps` in three APA
builders. A stimulus page is linted together with `vep_page.js`, which it
loads, so its calls into that file resolve. The script stops with a non-zero
exit status at the first stage that finds a problem, which is what makes it
usable in CI (`.github/workflows/checks.yml`).

## Tests

| File | What it checks | Time |
|---|---|---|
| `test_engine.js` (node) | Sequence generator (3000 seeds: counts, opening standards, spacing, longest run, reproducibility, uniformity), SHA-256 vs Node's, URL text round trip, built-in shapes, one-sided contrast solver. With `VEP_BASELINE_ENGINE=<old vep_engine.js>` also that the pair solver is unchanged. | seconds |
| `test_gate.py` | Gate: summaries, persistence, Add/↻ dialogs, stripping of shared/launch keys, back-link notice and Undo, protocol export, sync colors (per-file substitution, validation, duplicate warning). | ~30 s |
| `test_stim.py` | The four single-stimulus pages: APA (dot size, color, declared Hz), rate of the stimulus window on a second monitor (simulated), run in a child window with the log saved by the parent, log fields, autostart natural end. | ~4 min |
| `test_oddball.py` | Oddball page on WebGL and Canvas 2D: every frame's sync-dot color vs the stimulus shown, log order = planned order = order rebuilt from the seed alone, jitter range, SVG refusal/cleaning/size/aspect, SVG carried in the link, parity with an SVG. | ~1 min |
| `test_oddball2.py` | Oddball in a child window, analyzer on its log, autostart (natural end, refusal of an impossible sequence / sync clash / unknown key), gate tile and conditions with an SVG, parity page. | ~1 min |
| `test_misc.py` | Analyzer sync-dot row, and the parity page for the four single-stimulus pages: every row PASS with `maxDiff 0`. | ~30 s |
| `test_pixels.py` | The WebGL 2 and Canvas 2D paths draw identical frames (0 differing pixels) on flash, onset, reversal and motion, and a colored sync dot changes nothing outside the dot. With `VEP_BASELINE=<folder with an earlier version>` also compares every frame with that version. | ~1 min, ~2 with a baseline |

Each prints `PASS`/`FAIL` lines and ends with `FAILURES: n`; the exit code is
non-zero on failure.

Notes:
- The tests simulate some conditions (a second monitor's rate via `vep_fps`
  messages); they do not replace a run on real hardware, in fullscreen, or in
  Firefox and Safari.
- The WebGL and Canvas 2D paths now agree **exactly**: `maxDiff 0`, no
  differing pixel, on all four pages and at any canvas size. The earlier
  difference had two independent causes, both since fixed — `PATTERN_FRAG`
  built the fixation cross from an unrounded arm and a symmetric half-thickness
  where the Canvas 2D path rounds and uses an asymmetric band, and the radial
  pages indexed the annulus with `Math.hypot`, which V8 does not round
  correctly (`Math.hypot(360, 319)` returns `480.999999999999943` where
  `360² + 319² = 481²`). Any non-zero `maxDiff` is now a regression, not a
  tolerance.
- A parity pixel count means nothing without the canvas size: the same
  difference measured 9 and 39 px at the 360×240 of `test_pixels.py` and 13 and
  205 px at 900×650, because it scales with pixels per degree. Quote the canvas
  size and the cross thickness alongside any such figure.
- `test_pixels.py` treats *any* render change as a failure, so after an
  intended change it reports the intended pixels as `FAIL`. Read the counts
  rather than the verdict: they should account for exactly what was changed.
  Its `n == n0` check ("GPU and Canvas 2D differ as much as they did before")
  is now obsolete and should become `n == 0`.
