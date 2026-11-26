import sys
from playwright.sync_api import sync_playwright
import os, pathlib
HERE = os.path.dirname(os.path.abspath(__file__))
SUITE = os.path.abspath(os.environ.get('VEP_DIR', os.path.join(HERE, '..')))
ROOT = pathlib.Path(SUITE).as_uri() + '/'
P5 = open(os.environ.get('P5_JS', os.path.join(HERE, 'node_modules', 'p5', 'lib', 'p5.min.js')), encoding='utf-8').read()
FIX = os.path.join(HERE, 'fixtures')
fails = []
def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

STIMS = ['flash_vep.html', 'pattern_onset_vep.html',
         'pattern_reversal_vep.html', 'motion_onset_vep.html']

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(); ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
    pg = ctx.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(ROOT + 'vep_log_analyzer.html')
    new = pg.evaluate("buildSessionSummary('reversal', {params:{}, sync:{dot_size:50, colour:'#0000ff', syncDotFrames:2}, trials:[]})")
    old = pg.evaluate("buildSessionSummary('reversal', {params:{}, sync:{dot_size:32, syncDotFrames:2}, trials:[]})")
    check('50 px · #0000ff · 2 frames' in new, 'analyzer sync-dot row: size, colour and frames')
    check('white before v1.1.0' in old, 'analyzer names the default colour for a 1.0.0 log')
    # parity page round trip for each stimulus
    pg.goto(ROOT + 'webgl_parity_test.html')
    for stim in STIMS:
        with pg.expect_popup() as pop: pg.click(f'button[data-stim="{stim}"]')
        pop.value.wait_for_load_state()
    pg.wait_for_function("document.querySelectorAll('#results tbody tr').length >= 4", timeout=30000)
    rows = pg.evaluate("""() => Array.from(document.querySelectorAll('#results tbody tr'))
        .map(tr => Array.from(tr.children).map(td => td.textContent.trim()))""")
    check(len(rows) == len(STIMS), f'parity page reported {len(rows)} rows, expected {len(STIMS)}')
    for row in rows:
        # columns: stimulus, pattern, result, maxDiff, pctOver, pixels, note
        name, result, maxdiff = row[0], row[2], row[3]
        check(result == 'PASS', f'{name}: parity {result}')
        # Since the fixation cross and the radial annulus index were made exact,
        # the two paths agree pixel for pixel. Anything else is a regression.
        check(maxdiff == '0', f'{name}: maxDiff {maxdiff}, expected 0')
    check(not errs, 'no page errors: ' + '; '.join(errs))
    b.close()

print('\nFAILURES:', len(fails))
sys.exit(1 if fails else 0)
