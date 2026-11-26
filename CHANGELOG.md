# Changelog

Notable changes to VEPeagle. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the suite carries
one version number across all of its files.

## [Unreleased]

## [1.2.0] — 2026-11-24

First public release, as VEPeagle. Version 1.1.0 was never published; this
version collects everything since then.

Findings from a parity and robustness audit, and the fixes for them. The render
paths changed, so a session run with this code is not pixel-identical to one run
with 1.1.0 as originally built — see *Fixed*, first two entries.

### Added
- `p5.min.js` is bundled (p5.js 1.9.3, LGPL-2.1) instead of being fetched from
  a CDN, so the suite has no external dependency and runs without a network.
  `THIRD_PARTY.md` and `p5.js-LICENSE.txt` carry the attribution and checksums.
- Every stimulus page refuses to start, with an explanation, when p5.js is not
  available. Previously the page looked ready and Start hung at `Starting…`
  with an uncaught `ReferenceError`.
- `VEP.prepareSVG` refuses animated shapes — `animate`, `animateTransform`,
  `animateMotion`, `set`, `discard` and CSS `@keyframes`. An animated SVG was
  rasterized at whichever frame happened to be current, so the shape was not
  reproducible.
- All 112 URL-reachable numeric inputs now carry both `min` and `max`. Autostart
  validates through `form.checkValidity()`, so a field without bounds accepted
  anything a link put in it: `nCycles=1000000000` and `screen_width_px=0` both
  started a session.
- `README.md`, `LICENSE`, `CITATION.cff`, `CHANGELOG.md`, `.gitignore`.
- `examples/shapes/` — three ready-made oddball stimuli (a checkerboard standard
  and a mirror-image pair of eagles) matched in drawn area and extent, with a
  README giving the measurements and the two size limits that follow from them.
- `vep_page.js`, the page machinery the five stimulus pages shared verbatim:
  32 functions (run controls, full-screen handling, refresh-rate probing,
  color pairs, the copyable link and report, calibration status lines) that
  were byte-identical on all five pages, each page carrying its own copy. They
  are ordinary global functions, loaded right after `vep_engine.js`, so no call
  site changed; each page is about 485 lines shorter. Only whole functions that
  were identical everywhere moved — code that differs even slightly between
  pages stays in the page.
- One stylesheet for the whole suite. The rules each page kept in its own
  `<style>` block (about 410 across the ten pages) moved to the end of
  `vep.css`, one section per page, scoped by a class on the page's `<html>`
  element (`page-flash`, `page-gate`, …). The scope is written with `:where()`,
  which adds no specificity, and the page sections follow every shared rule as
  the inline blocks followed the `<link>`, so the cascade is unchanged: every
  element on every page computes the same style as before, in both themes. No
  page carries a `<style>` block any more.
- `.github/workflows/checks.yml` runs `tests/check.sh`, the engine tests and the
  browser battery (Chromium with SwiftShader) on every push and pull request.

### Changed
- The settings column is wider on large screens: every page except the manual
  uses `max-width: min(92vw, 800px)` instead of fixed 560 px (stimulus pages,
  gate), 640 px (calibration) and 720 px (analyzer). Below about 870 px the
  column takes 92 % of the window.
- The APA paragraph has one structure and one wording on all five stimulus
  pages: stimulus with its colors, timing, the intervals before and after,
  geometry and frame rate, sync patch, fixation and masks, calibration and
  contrast, renderer, pauses. It no longer cites literature — a reference holds
  only when the parameters follow the cited recommendation, which the page
  cannot know; the manual lists the references. Contrast is given in percent
  everywhere (also in the log analyzer), totals in whole seconds; the interval
  after the last stimulus, the half-field in degrees (oddball) and the
  motion-onset colors are now stated. Removed: the "nominal colors" note, which
  contradicted the calibration sentence; "high-contrast" for any contrast; an
  instruction to "run a session first". Pattern onset says the blank is matched
  to the pattern's mean luminance when it is, and justifies the alternation by
  local, not mean, light adaptation. A calibration without a valid date reads
  "calibration date: not recorded" instead of "Invalid Date".
- Pattern reversal defaults to the checkerboard. The manual already documented
  `patternType` as defaulting to checker; the page had the radial pattern
  selected, so code and documentation disagreed.
- Pattern onset defaults to 200 ms on and 400 ms off, the ISCEV durations. The
  off phase was 800 ms.
- Collapsible section headings on the gate follow `.section-title` in light mode.
  They repeated its appearance with a hard-coded dark-theme color and had no
  light-mode rule, so they stayed pale blue while the ordinary section titles
  turned dark teal.
- Secondary and disabled controls have light-theme colors. White text at low
  opacity on a near-white fill left Pause, Stop and New window unreadable;
  they now read at 8.5:1 against the page.
- `oddball_vep.html` has its own favicon. It shipped the pattern-onset icon.
- The manual's theme toggle is round again. Its size is set inline but its
  padding was not, so the shared `button` rule added 2 em on each side and
  stretched the circle into an ellipse.
- Light-theme colors added wherever a rule only had a dark one: the parity
  page's result words and footnote, the analyzer's report (metric titles, target
  values, APA block, warnings), the calibration page's verification readouts,
  the gate's danger pill and the oddball stimulus table header.
- Colors that sat in `style=""` attributes, where no theme rule can reach them,
  moved into six classes carrying both themes (`.t-amber`, `.t-dim`, `.t-dim-2`,
  `.t-mute`, `.t-grey`, `.t-slate`). Their dark values are the literals they
  replace, so dark mode is unchanged; verified element by element.
- `webgl_parity_test.html` participates in the theme at all. It had no theme
  bootstrap, no toggle and no page background of its own, so switching the suite
  to light left it on browser defaults; it now carries the same bootstrap,
  toggle and background rules as the other pages.
- The log analyzer's summary pairs have light-theme colors. The key was a
  pale blue and the value plain white, 2.7:1 and 1.1:1 against a light page;
  the rendered report now has no text below 4.5:1 in either theme.
- Every text in the suite now meets WCAG AA (4.5:1) in both themes. The button
  fill moved from `#29b` to `#17799a` so that white labels read at 5.0:1 instead
  of 3.3:1, and five muted tones were lightened for the dark theme or darkened
  for the light one: the page footers (2.1:1 in dark), the field notes and
  collapsed-section summaries (3.8:1 in dark, 4.1:1 in light), the gate's launch
  abbreviations (4.0:1 in dark) and the analyzer's section captions (3.1:1 in
  light). Two further classes (`.t-faint`, `.t-steel`) carry the tones that sat
  in `style=""` attributes. A rule that existed only for the dark theme also
  paints the light one, so each recolored rule got a light counterpart where
  the page did not already have one.
- `Tip:`, `Note:` and `Warning:` labels in the manual are readable in light
  mode. The rule set them white for both themes, which put them at 1.1:1 on the
  pale callout background.
- The gamma curve's sRGB reference is black in the light theme. The plot
  interior is painted dark in both themes, so a gray dashed line at 40 % alpha
  was invisible once the page around it turned light. `drawPlot()` reads the
  theme and the toggle redraws the plot.
- The gamma legend shows the curves instead of describing them: a 1.5 px dashed
  sample for the reference, a 2 px solid `#7bc8e8` sample for the fitted model
  and a 3 px dot for the measured points, each on a patch of the plot's own
  background, with the widths, dash pattern and colors `drawPlot()` uses.
- One palette for the whole suite. Colors used to be written twice — a rule for
  the dark theme and an `html[data-theme="light"]` counterpart restating it — and
  the suite had grown 102 distinct dark and 106 distinct light values. 22 named
  roles now live in `vep.css`, in a `:root` block and a light block that re-binds
  the same names; 130 declarations name a role, 44 light counterparts and the 27
  rules that held nothing else are gone. A color is changed in one place.
  Deliberately theme-independent surfaces keep their literals: the full-screen
  stimulus overlay, the color picker, the WebGL canvas and the gamma plot.
- Rules whose light color carries meaning of its own keep it; 26 such
  exceptions were detected by comparing each light value with its role (kept
  when they differ by more than ΔE 8 on the light page) rather than by eye.
- The light theme reaches the parts that had no rule for it: the root element
  background (it stayed dark gray behind the page on nine pages), the gate's
  session-note field and the manual's keyboard chips.
- The manual's own twelve-token palette was folded into the shared one. Its
  muted body text goes from `#b8c5d0` to `#dde` and its light-theme accent from
  `#0d5472` to `#126478`, so the manual and the stimulus pages now draw from the
  same set.
- `.run-status` had a color rule that never applied: it named a variable that
  no page outside the manual defined, so the declaration was dropped and the
  status line inherited body text. It now names `--text-soft`, which is what it
  rendered as. The renderer note had the same dead reference inline, and now
  resolves to `--text-mute` as its author intended.
- The log analyzer's drop zone is the size it was. The shared `label` rule
  reached it once the rules moved to `vep.css` — the analyzer is the only page
  that never had a `label` rule of its own — and shrank its text to .86 em.
- Flash's four-column field rows work. The page used `class="field-grid cols-4"`
  in two places but was the only one of six pages that never defined `.cols-4`,
  so those rows silently fell back to two columns.
- The reproducible link and the APA-style report look the same on every page.
  The log analyzer presented its report as a section with a heading and a
  "Click to copy" note; the five stimulus pages presented both as bare `<code>`
  elements carrying eight inline style declarations each, with no heading and
  the only label in a `title` attribute. `.apa-block` and the new `.url-block`
  now live in `vep.css` and the stimulus pages use the section markup. A click
  still copies and nothing opens — the behavior is unchanged.
- Callouts in the manual come in two kinds instead of three. Green appeared
  nowhere else in the suite, so the eight tips became notes; a note is in the
  accent color, a warning in amber, and both tints are palette roles
  (`--tint-note`, `--tint-warn`).
- One table style for the suite. There were four bases — the manual's, the
  analyzer's right-aligned one, the parity page's wide one and the calibration
  page's measurement table — and the same `html[data-theme="light"] table th`
  rule repeated on nine pages. `vep.css` carries the base with two modifiers:
  `.num` right-aligns columns of numbers and keeps the first column left,
  `.kv` is for the six key-and-value tables that have no header row.
- Collapsible asides share the gate's marker (▸ / ▾ rather than a rotating ▸)
  and its frame, on the gate and in the manual alike. The gate's collapsible
  section headings keep their own look, because they are headings.
- Sections have a top margin. They had only a bottom one, so a section that
  follows something else — the reproducible link under the parameter form —
  sat straight against it. Between two sections the margins collapse, so the
  spacing there is unchanged. `.section`, `.section-head` and `.section-meta`
  were written out on eight pages and now live in `vep.css`; `.section-meta`
  existed only in the analyzer, so the "Click to copy" note the stimulus pages
  had just gained was unstyled.
- The session note field is readable in the light theme. `#noteField` set its
  color in an id rule, which outranks the light-theme rule for text inputs, so
  the text stayed white on the white field — on the gate and on all five
  stimulus pages. Field text is now the role `--text-strong`, and the light
  rule that merely restated the same three properties is gone.
- Condition names in the protocol are readable in the light theme. The name
  was set to `#fff` with no light-theme counterpart, so it was white on the
  pale row; it now takes `--text-strong`, the role the fields already use.
- The autostart card — what Run in the protocol opens — is part of the
  presentation, not of the page. It paints its own dark surface, but the value
  cells of its parameter table carried no color, so in the light theme the
  shared rule for table cells printed them dark on that dark card. The cells
  now carry the card's own color and the table is marked `.autostart-table`,
  which also keeps the light theme's cell borders and row tint out of it.
- `theme` is a parameter the stimulus pages recognize. The gate appends it to
  every link it opens, and autostart greeted it with "Unrecognized parameter:
  theme" above the Start button.
- Run and Page in the protocol pass the theme on. Both rebuild their href
  inside their own click handler, after the generic link rewriter has run, so
  the theme is set in `condURL()` where the two share one code path. A stored
  condition does not keep it: `theme` joined the keys this page owns.
- A page opened from another page of the suite keeps the theme. Each page read
  `localStorage` alone, and over `file://` every page is its own origin —
  Firefox separates them, Chrome refuses the store — so a stimulus page opened
  from a light gate fell back to dark. The theme now resolves from, in order, a
  `?theme=` parameter, the stored choice and `prefers-color-scheme`, and is
  passed on: the gate puts it in the launch URL it builds, and every page
  rewrites links to other suite pages on the way out. The reproducible link the
  stimulus pages display is built from the form and stays free of it.
- `tests/lint.js` enables `no-unused-vars`. It was off, which is why the
  declarations above survived; the p5.js lifecycle callbacks are exempt.
- The suite is named VEPeagle. Page titles, the manual and the suggested
  citation carry the name; file names, `localStorage` keys, window names and the
  `suite_version` / `engine_version` log fields are deliberately unchanged, so
  stored settings, protocols and older logs keep working.
- `test_misc.py` prints `PASS`/`FAIL` lines, ends with `FAILURES: n` and exits
  non-zero like the rest of the battery; it previously always exited 0. It also
  asserts `maxDiff 0` on every row of the parity page.
- `test_oddball.py` waits for the SVG readout to change instead of sleeping for
  a fixed 200 ms after `set_input_files`. The sleep was a race that failed six
  checks at once on a loaded machine.
- `check_consts.py` reports in English.
- The development checks use ESLint 9 (9.39.5, with `globals` 15.15.0); 8.57
  is no longer supported. `tests/lint.js` passes the configuration in the flat
  format and lints each stimulus page together with `vep_page.js`, so the
  page's calls into it resolve and a shared function no page uses is reported.
- `tests/check.sh` exits non-zero at the first stage that finds a problem — a
  syntax error, unbalanced markup, a duplicate id, an undeclared constant or a
  lint error. It used to print the findings and exit 0, so CI could not fail on
  them.
- `tests/test_pixels.py` asserts that the two render paths draw identical frames
  (0 differing pixels). It asserted that they differed by as many pixels as an
  earlier version did, which made exact parity untestable and needed a baseline
  folder to run at all; the comparison with an earlier version is now optional.
- `flash_vep.html` names its parameter map `GET_TO_FIELD_ID`, like the other
  four stimulus pages (it was `GET_MAP`).
- The manual documents the `theme` and `autostart` parameters among those not on
  any form, and lists `theme` with the launch keys a condition never stores.
- The file tables in `README.md` and the manual list `vep.css` and
  `vep_page.js`, and say which pages load what; the manual said the pages other
  than the stimuli and the gate were independent, which `vep.css` made untrue.
- `CITATION.cff` carries the author's ORCID.
- All text a user reads is in American spelling — the pages, their messages,
  the APA paragraph, the manual and the documentation (*color*, *gray*,
  *center*, *synchronization*, *linearized* and 35 other forms, in 322
  lines). Identifiers, CSS classes, URL parameters, log keys such as
  `sync.colour`, and calibration-file keys and values such as `measured_grey`
  are unchanged, so older logs, calibrations and links still read.
- Every note and warning in the manual opens with a bold sentence that states
  its point; a warning says what can go wrong and what it costs, a note
  explains. Labels such as "Tip:" are gone, one warning labeled "Note" was
  reworded, the flash page's description became a note, and three points made
  twice (the link is the condition; luminances are estimates; browser storage
  is not an archive) are now made once and referred to.

### Removed
- 44 declarations that no caller reads: the unused `VEP.*` aliases
  (`gSrgbToLinear`, `gLinearToSRGB8`, `gBuildMonoSpline`, `gMakeChannelFns`),
  `_helloUntilReady`, `_childDpr`, `firstTrialStart`, `syncColourUI` (superseded
  by `VEP.syncColourText`), two captured-but-unused calibration values in
  `oddball_vep.html`, and two locals in the engine's contrast solver.
- 37 kB of CSS rules whose selectors cannot match, across all ten pages. Both
  themes render identically before and after: the only pixels that differ
  between two renders are the measured 60-frame time, which also differs between
  two runs of the same code.

### Fixed
- The session note next to *Save log* on the stimulus pages was white on white
  in the light theme; it now takes the theme's text color.
- Pattern onset starts with the blank at the pattern's mean luminance. The page
  opened with the blank at #808080 and *Blank at pattern mean* ticked, but the box
  acted only when *Apply to colors* was pressed; under the sRGB assumption
  #808080 is a relative luminance of about 0.22 against the default pattern's
  mean of 0.5, so the default onset carried a luminance step. With the box
  ticked, the page now matches the blank as it opens (#bcbcbc for the default
  pattern without a calibration), keeping the blank's chromaticity. A link that
  sets `hexBlank` is reproduced as written, so saved protocols present exactly
  what they presented before.
- A stimulus page without `vep_page.js` refuses to start and names the file.
  It showed "Ready." and did nothing — three `ReferenceError`s at load and, in
  autostart, no ready card. The check that already covered `p5.min.js` now
  covers both files and names whichever is missing.
- Manual corrections against the code: the sync dot is drawn over the fixation
  cross, not under it; the reversal and motion-onset tables listed a `contrast`
  parameter that does not exist; the flash and onset tables named internal
  variables (`colFlash`, `colBlank`) instead of the parameters `hexFlash` and
  `hexBlank`; the flash page was called the only stimulus without a pattern,
  which the oddball page made untrue; `performance.now()` timestamps were called
  sub-millisecond accurate, although browsers coarsen them to 0.1 ms or as much
  as 1 ms; the gate's keys listed `hexSync1` only; the installation section
  named `vep_engine.js` alone; the motion-onset table gave typical values where
  the others give defaults; and the workflow still sent readers to "the link
  below the form" for the APA paragraph, which has its own section.
- The manual gave the reversal half-period as `1000/(2·rate)`, a formula left
  from when the rate was in hertz. With the rate in reversals per second, the
  time between reversals is `1000/reversalsPerSec` — 500 ms at the default — as
  the log's `half_period_ms` records it.
- **Fixation cross on the GPU path.** `PATTERN_FRAG` built the cross from the
  unrounded arm `radius_deg*ppd` and the symmetric half-thickness `T/2`, while
  the Canvas 2D `prepareCrossMask()` uses `round(radius_deg*ppd)` and the
  asymmetric band `[-floor(T/2), T-floor(T/2)-1]`. The GPU cross was one pixel
  wider for even thickness — the default is 2 px — and one pixel shorter
  whenever `frac(radius_deg*ppd) >= 0.5`. It now receives the same integer
  geometry `SHAPE_FRAG` already used, including an explicit integer center,
  which also fixes a half-pixel offset on a canvas of odd width or height.
- **Radial annulus index on the Canvas 2D path.** The radial pages indexed the
  annulus with `Math.hypot`, which V8 does not round correctly: for a
  Pythagorean offset such as (360, 319), where 360² + 319² = 481²,
  `Math.hypot` returns `480.999999999999943` and `Math.floor` dropped the pixel
  into the neighboring annulus. They now use `Math.sqrt` of the exact squared
  offsets. `PATTERN_FRAG` additionally corrects its integer radius against the
  squared radius, which makes the GPU path exact whatever the driver's `sqrt`
  does.
- The two render paths now agree **exactly** — `maxDiff 0`, no differing pixel,
  on all four single-stimulus pages and at any canvas size. Previously they
  differed by 9 and 39 pixels at 360×240, or 13 and 205 at 900×650.
- `buildSessionSummary` in the log analyzer no longer throws when `trials` is
  not a list, as in a hand-edited or truncated log.
- Every stimulus page reported `Ready — stimulus will run in the this window.`

## [1.1.0]

### Added
- Oddball VEP (`oddball_vep.html`): standard, deviant and an optional third
  stimulus; built-in shapes computed geometrically so they are identical on
  every system, or a user SVG; exact trial counts with opening standards,
  minimum spacing and a longest-run limit; sequences reproducible from a seed;
  jitter on the OFF phase drawn from a second stream of the same seed.
- Engine: sequence generator, mulberry32 PRNG, SHA-256, shape rasterization,
  SVG cleaning, shape shader, one-sided contrast solver.
- The synchronization patch has a configurable trigger color, and the oddball
  page gives each stimulus its own, so an RGB photodiode can distinguish them.
- `tests/`: static checks and headless browser tests.

### Changed
- Outside a trigger the synchronization patch is black on every stimulus. Flash
  previously left it transparent, so the flash field showed through.
- The gate remembers the recording environment and asks before discarding
  values that differ from a condition's own.
- Stimulus and child window rates are tracked separately, and the APA text,
  rate warnings and flash duration use the rate of the window that presents.
- The log schema is the same across all stimuli.

## [1.0.0]

First complete suite: flash, pattern reversal, pattern onset and radial motion
onset, with the gate, display calibration, log analyzer, parity test page and
manual.
