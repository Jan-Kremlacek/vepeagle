import json, sys, time
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

STIMS = {
  'flash':    ('flash_vep.html',            'nFlashes=2&flashFreq=4'),
  'reversal': ('pattern_reversal_vep.html', 'nCycles=3&reversalsPerSec=4'),
  'onset':    ('pattern_onset_vep.html',    'nCycles=2&onDuration=100&offDuration=100'),
  'motion':   ('motion_onset_vep.html',     'nCycles=2&moveDuration=100&holdDuration=100'),
}
COMMON = 'startDelay=0&useFullscreen=false&enableLogging=true&dotSize=50&displayRefreshHz=60&hexSync1=%230000ff'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    for key, (file, extra) in STIMS.items():
        print('\n=====', key)
        ctx = b.new_context(accept_downloads=True)
        ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append('parent: ' + str(e)))

        # ── APA with display refresh set and a non-default dot size ──
        page.goto(ROOT + file + '?' + extra + '&' + COMMON)
        page.wait_for_timeout(1500)            # local refresh probe (40 rAF)
        apa = page.evaluate('buildAPADescription()')
        check('50' in apa and ('50 × 50' in apa or '50×50' in apa), key + ': APA dot size 50')
        check('set to 60 Hz' in apa, key + ': APA states declared 60 Hz')
        check('approximately' in apa, key + ': APA says rate is estimated before a session')
        check('blue (#0000ff)' in apa and 'black between' in apa, key + ': APA names dot colour')

        # ── Second window: probe, then exact, then local measuredFPS must not win ──
        with page.expect_popup() as pop:
            page.click('#openWindowBtn')
        child = pop.value
        child.on('pageerror', lambda e: errors.append('child: ' + str(e)))
        child.wait_for_load_state()
        page.wait_for_function("_childFPS.hz > 0", timeout=8000)
        disp = page.text_content('#fpsDisplay')
        check('stimulus display' in disp, key + ': fps box names stimulus display: ' + disp)
        child.evaluate("window.opener.postMessage({type:'vep_fps', fps: 74.9}, '*')")
        page.wait_for_function("_childFPS.hz === 74.9")
        page.evaluate("measuredFPS = 120")     # a stale local run on the operator's screen
        apa = page.evaluate('buildAPADescription()')
        check('74.9 Hz (measured)' in apa, key + ': APA uses stimulus-window rate 74.9')
        check('120' not in apa.split('delivered at')[1][:40] if 'delivered at' in apa else False,
              key + ': APA does not use local 120 Hz')
        check(page.is_visible('#refreshMismatchNote') and 'stimulus window' in page.text_content('#refreshMismatchNote'),
              key + ': mismatch note refers to stimulus window')
        if key == 'reversal':
            check('was 19 frames' in apa, 'reversal: half-period from child rate (round(74.9/4)=19)')
        if key == 'flash':
            check('at 74.9 Hz' in page.text_content('#durationNote'), 'flash: duration note uses child rate')

        # ── Run in the child window; parent saves the log ──
        child.evaluate("window.opener.postMessage({type:'vep_fps', fps: 60, probe: true}, '*')")
        page.wait_for_function("_childReady === true", timeout=8000)
        page.evaluate("_refreshRunControls()")   # undo the simulated 'measuring' state
        with page.expect_download(timeout=30000) as dl:
            page.click('#runStartBtn')
        log = json.load(open(dl.value.path()))
        sync = log.get('sync', {})
        check(sync.get('colour') == '#0000ff', key + ': log sync.colour = #0000ff (' + str(sync.get('colour')) + ')')
        check(log.get('suite_version') == '1.2.0' and log.get('engine_version') == '1.2.0', key + ': version 1.2.0 in log')
        check(sync.get('dot_size') == 50, key + ': log sync.dot_size = 50 (' + str(sync.get('dot_size')) + ')')
        check(isinstance(log.get('masks', {}).get('quadrants'), dict) and 'colour' in log.get('fixation', {}),
              key + ': unified fixation/masks schema')
        check(log['params'].get('display_refresh_hz') == 60, key + ': log display_refresh_hz = 60')
        apa = page.evaluate('buildAPADescription()')
        child_fps = log['params']['measuredFPS']
        check(f'{child_fps:.1f} Hz (measured)' in apa,
              key + f': after child run APA uses child exact rate {child_fps}')
        child.close()
        page.wait_for_timeout(800)
        apa = page.evaluate('buildAPADescription()')
        check('120.0 Hz (measured)' in apa, key + ': after closing child APA describes this window (120)')

        # ── Autostart, natural completion ──
        p2 = ctx.new_page()
        p2.on('pageerror', lambda e: errors.append('autostart: ' + str(e)))
        p2.goto(ROOT + file + '?' + extra + '&' + COMMON + '&autostart=1')
        p2.wait_for_selector('#autostartGo')
        with p2.expect_download(timeout=30000) as dl2:
            p2.click('#autostartGo')
        p2.wait_for_function("document.body.innerText.indexOf('FINISHED') >= 0", timeout=10000)
        txt = p2.inner_text('body')
        check('Log prepared as' in txt, key + ': autostart natural end shows FINISHED + log name')
        check(not errors, key + ': no page errors ' + '; '.join(errors))
        ctx.close()
    b.close()

print('\nFAILURES:', len(fails))
for f in fails: print('  -', f)
sys.exit(1 if fails else 0)
