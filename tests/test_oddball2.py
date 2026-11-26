import json, sys
from playwright.sync_api import sync_playwright

import os, pathlib
HERE = os.path.dirname(os.path.abspath(__file__))
SUITE = os.path.abspath(os.environ.get('VEP_DIR', os.path.join(HERE, '..')))
ROOT = pathlib.Path(SUITE).as_uri() + '/'
P5 = open(os.environ.get('P5_JS', os.path.join(HERE, 'node_modules', 'p5', 'lib', 'p5.min.js')), encoding='utf-8').read()
FIX = os.path.join(HERE, 'fixtures')
fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

RUN = ('nCycles=10&count2=2&firstStandards=2&minStandards=1&onDuration=50&offDuration=50'
       '&startDelay=0&useFullscreen=false&enableLogging=true&displayRefreshHz=60')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context(viewport={'width': 800, 'height': 500}, accept_downloads=True)
    ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
    errs = []
    def watch(pg, tag): pg.on('pageerror', lambda e: errs.append(tag + ': ' + str(e)))

    # ── 1. Child window: the parent draws the seed, the child presents, the parent saves ──
    page = ctx.new_page(); watch(page, 'parent')
    page.goto(ROOT + 'oddball_vep.html?' + RUN + '&shape2=svg&svg2_name=tri.svg&svg2='
              + __import__('base64').urlsafe_b64encode(open(os.path.join(FIX, 'tri.svg'),'rb').read()).decode().rstrip('='))
    page.wait_for_timeout(800)
    check('tri.svg' in page.text_content('#svgInfo2'), 'SVG from link (raw file, cleaned on use): ' + page.text_content('#svgInfo2')[:60])
    with page.expect_popup() as pop:
        page.click('#openWindowBtn')
    child = pop.value; watch(child, 'child'); child.wait_for_load_state()
    page.wait_for_function('_childReady === true', timeout=10000)
    page.evaluate('_refreshRunControls()')
    with page.expect_download(timeout=40000) as dl:
        page.click('#runStartBtn')
    log = json.load(open(dl.value.path()))
    seed_parent = page.input_value('#seed')
    check(str(log['sequence']['seed']) == seed_parent, f'child used the seed drawn in the parent ({seed_parent})')
    check(len([t for t in log['trials'] if 'trial' in t]) == 10 and log['sequence']['order'].count('2') == 2,
          'child log complete: ' + log['sequence']['order'])
    st = {s['stimulus']: s for s in log['stimuli']}
    check(st[2]['shape'] == 'svg' and st[2]['svg_name'] == 'tri.svg' and len(st[2]['svg_sha256']) == 64
          and '<svg' in st[2]['svg'], 'log carries the SVG, name and SHA-256')
    check(log['sync']['colours']['2'] == '#ff0000' and log['sync']['colours']['3'] is None, 'log sync colours')
    child.close(); page.wait_for_timeout(600)

    # ── 2. Analyzer on that log ──
    an = ctx.new_page(); watch(an, 'analyzer')
    an.goto(ROOT + 'vep_log_analyzer.html')
    an.set_input_files('#fileInput', dl.value.path())
    an.wait_for_selector('#results', state='visible')
    summ = an.inner_text('#summaryCard'); apa = an.inner_text('#apaBlock'); stats = an.inner_text('#statsBlock')
    check('Oddball VEP' in summ and 'order as planned' in summ and 'tri.svg' in summ, 'analyzer summary')
    check('ON duration, stimulus 2 (deviant)' in stats and 'OFF duration error' in stats, 'analyzer per-stimulus metrics')
    check(f'seed {seed_parent}' in apa and 'standard n = 8' in apa and 'deviant n = 2' in apa, 'analyzer APA sequence paragraph')

    # ── 3. Autostart: natural end, and refusal of an impossible sequence ──
    a1 = ctx.new_page(); watch(a1, 'autostart')
    a1.goto(ROOT + 'oddball_vep.html?' + RUN + '&autostart=1')
    a1.wait_for_selector('#autostartGo')
    txt = a1.inner_text('#autostartScreen')
    check('Oddball' in txt and 'standard 8' in txt and '⚠' not in txt.replace('Logging is off', ''),
          'autostart screen lists the session, no problems')
    with a1.expect_download(timeout=30000):
        a1.click('#autostartGo')
    a1.wait_for_function("document.body.innerText.indexOf('FINISHED') >= 0", timeout=10000)
    check('Log prepared as' in a1.inner_text('body'), 'autostart natural end')
    a2 = ctx.new_page(); watch(a2, 'autostart-bad')
    a2.goto(ROOT + 'oddball_vep.html?nCycles=10&count2=6&minStandards=2&autostart=1&enableLogging=true&hexSync2=%23ffffff')
    a2.wait_for_selector('#autostartGo')
    t2 = a2.inner_text('#autostartScreen')
    check('Sequence not possible' in t2 and 'share a sync color' in t2, 'autostart names an impossible sequence and a sync clash')
    a2.click('#autostartGo'); a2.wait_for_timeout(500)
    check('Cannot start' in a2.inner_text('body'), 'start refused, with the reason shown')
    a3 = ctx.new_page(); watch(a3, 'unknown-key')
    a3.goto(ROOT + 'oddball_vep.html?autostart=1&patternType=checker')
    a3.wait_for_selector('#autostartGo')
    check('Unrecognized parameter: patternType' in a3.inner_text('#autostartScreen'), 'unknown key refused')

    # ── 4. Gate: tile and condition carry all three sync colours; SVG survives in the protocol ──
    g = ctx.new_page(); watch(g, 'gate')
    g.goto(ROOT + 'vep_gate.html'); g.evaluate('localStorage.clear()'); g.reload()
    tile = g.get_attribute('#btnOddball', 'href')
    check('hexSync2=%23ff0000' in tile and 'hexSync3=%2300ff00' in tile, 'gate oddball tile carries all sync colours')
    cond_url = log['replication_url']
    g.on('dialog', lambda d: d.dismiss())
    g.evaluate("document.querySelector('#condList').closest('.section').querySelector('details').open=true")
    g.fill('#newCondName', 'odd'); g.fill('#newCondUrl', cond_url); g.click('#condAddBtn')
    stored = g.evaluate("JSON.parse(localStorage.getItem('vep_protocol'))")[0]['url']
    check('svg2=' in stored and 'hexSync' not in stored and 'seed=' in stored, 'condition keeps SVG and seed, drops sync colours')
    run = g.evaluate("""() => { const a=document.querySelector('.cond-run');
                         a.dispatchEvent(new MouseEvent('click',{cancelable:true})); return a.href; }""")
    check('hexSync2=' in run and 'hexSync3=' in run and 'autostart=true' in run, 'Run link gets all sync colours')
    r = ctx.new_page(); watch(r, 'gate-run')
    r.goto(run); r.wait_for_selector('#autostartGo')
    check('Unrecognized' not in r.inner_text('#autostartScreen') and 'tri.svg' in r.inner_text('#autostartScreen'),
          'condition from the gate starts: no unknown keys, SVG present')
    rev = g.evaluate("makeURL('pattern_reversal_vep.html', {})")
    check('hexSync2' not in rev, 'single-stimulus pages still get only hexSync1')

    # ── 5. Parity page ──
    pp = ctx.new_page(); watch(pp, 'parity-page')
    pp.goto(ROOT + 'webgl_parity_test.html')
    with pp.expect_popup() as pop2: pp.click('button[data-stim="oddball_vep.html"]')
    pop2.value.wait_for_load_state()
    pp.wait_for_function("document.querySelectorAll('#results tbody tr').length >= 1", timeout=20000)
    check('PASS' in pp.inner_text('#results tbody'), 'parity page: ' + pp.inner_text('#results tbody'))
    check(not errs, 'no page errors ' + str(errs))
    b.close()

print('\nFAILURES:', len(fails))
for f in fails: print('  -', f)
sys.exit(1 if fails else 0)
