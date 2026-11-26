import json, sys, subprocess
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


def svg_ui_ready(page, timeout=15000):
    """Wait until the page can actually receive a file.

    The change listener on the file inputs is bound in initStimulusUI(), near
    the end of a long DOMContentLoaded handler. A fixed sleep before touching
    the input is a race: when it lost, the event went nowhere, the readout
    stayed empty however long the test then waited, and six checks failed for
    no reason at all.
    """
    page.wait_for_function(
        "() => typeof loadSvgFile === 'function'"
        " && !!document.getElementById('svgFile2')"
        " && !!document.getElementById('svgInfo2')", timeout=timeout)


def load_svg(page, file_sel, info_sel, path, prev='', attempts=3, each=4000):
    """Load an SVG into a shape slot and wait until the page has judged it.

    set_input_files only queues the file; reading it, cleaning it and hashing
    it are asynchronous, so the readout has to be waited for rather than slept
    at. Setting the same file again re-fires `change` — the page clears the
    input after each load — so a lost event costs a retry, not the run.
    """
    for _ in range(attempts):
        page.set_input_files(file_sel, path)
        try:
            page.wait_for_function(
                "([s, p]) => { const el = document.querySelector(s);"
                " return el && el.textContent.trim() !== '' && el.textContent !== p; }",
                [info_sel, prev], timeout=each)
            break
        except Exception:
            continue
    return page.text_content(info_sel)

SVG_OK = ('<?xml version="1.0"?><!-- made in an editor --><svg xmlns="http://www.w3.org/2000/svg" '
          'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 60" '
          'inkscape:version="1.2"><metadata>x</metadata><title>tri</title>'
          '<path d="M10 50 L50 10 L90 50 Z" fill="#123456"/></svg>')
SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="8">A</text></svg>'
SVG_EXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="url(http://x/y)"/></svg>'
os.makedirs(FIX, exist_ok=True)
open(os.path.join(FIX, 'tri.svg'), 'w').write(SVG_OK)
open(os.path.join(FIX, 'text.svg'), 'w').write(SVG_TEXT)
open(os.path.join(FIX, 'ext.svg'), 'w').write(SVG_EXT)

RUN = ('nCycles=14&count2=3&useStim3=true&count3=2&firstStandards=2&minStandards=1'
       '&onDuration=50&offDuration=50&offJitter=50&startDelay=0&useFullscreen=false'
       '&enableLogging=true&hexStim1=%23ffffff&hexStim2=%23ffff00&hexStim3=%2300ffff'
       '&hexSync1=%23ff0000&hexSync2=%2300ff00&hexSync3=%230000ff&syncDotFrames=2'
       '&dot_x=20&dot_y=20&dotSize=16')

# Records, every frame, what the dot shows and what is on the shape's pixels.
HOOK = """() => {
  window.__rec = [];
  const orig = window.draw;
  window.draw = function () {
    const pre = { state: state, stim: currentStim, trial: trial };
    orig();
    if (pre.state === 'INIT' || pre.state === 'MEASURE' || pre.state === 'PAUSED') return;
    if (state === 'INIT') return;     // the session ended in this call: nothing left to read
    const read = (x, y) => {
      if (useWebGL && glRenderer.active) {
        const gl = document.getElementById('glCanvas').getContext('webgl2');
        const p = new Uint8Array(4); gl.readPixels(x, height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        return [p[0], p[1], p[2]];
      }
      const j = (y * width + x) * 4; return [imgBuf[j], imgBuf[j+1], imgBuf[j+2]];
    };
    const shown = {};
    [1,2,3].forEach(i => { const m = shapeMasks[i]; if (!m) return;
      let k = 0; while (!m.data[k]) k++;
      shown[i] = read(m.x0 + (k % m.w), m.y0 + Math.floor(k / m.w)); });
    window.__rec.push({ state: pre.state, trial: pre.trial, stim: pre.stim, dot: read(20, 20), shown });
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    for renderer in ['webgl', 'canvas']:
        print('\n=====', renderer)
        ctx = b.new_context(viewport={'width': 640, 'height': 400}, accept_downloads=True)
        ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(ROOT + 'oddball_vep.html?' + RUN + ('&webgl=0' if renderer == 'canvas' else ''))
        page.wait_for_timeout(900)
        check('n = 9' in page.text_content('#syncLabel1') and 'n = 3' in page.text_content('#syncLabel2'),
              'sync labels linked to counts: ' + page.text_content('#syncLabel1'))
        check('drawn' in page.text_content('#shapeInfo'), 'shape info: ' + page.text_content('#shapeInfo')[:90])
        page.evaluate(HOOK)
        with page.expect_download(timeout=30000) as dl:
            page.click('#runStartBtn')
        log = json.load(open(dl.value.path()))
        rec = page.evaluate('window.__rec')
        seed = log['sequence']['seed']
        check(seed >= 1 and str(seed) == page.input_value('#seed'), f'seed drawn, shown and logged ({seed})')
        order = log['sequence']['order']
        trials = [t for t in log['trials'] if 'trial' in t]
        check(''.join(str(t['stimulus']) for t in trials) == order, 'trials follow the planned order')
        check(order.count('1') == 9 and order.count('2') == 3 and order.count('3') == 2 and order[:2] == '11',
              'counts and opening standards: ' + order)
        ok_gap = all(order[i-1] == '1' for i in range(1, len(order)) if order[i] != '1')
        check(ok_gap, 'a standard before every non-standard')
        # Rebuild the order from the seed in Node, from the engine alone
        node = ("const vm=require('vm'),fs=require('fs');const w={};vm.runInNewContext(fs.readFileSync("
                "" + json.dumps(os.path.join(SUITE, 'vep_engine.js')) + ",'utf8'),{window:w,Uint32Array,Set,Array,Math,Number});"
                f"console.log(w.VEP.oddballSequence({{total:14,n2:3,n3:2,firstStandards:2,minStandards:1,"
                f"maxStandardRun:0,seed:{seed}}}).order.join(''))")
        rebuilt = subprocess.run(['node', '-e', node], capture_output=True, text=True).stdout.strip()
        check(rebuilt == order, 'seed alone rebuilds the order')
        cols = {1: [255, 0, 0], 2: [0, 255, 0], 3: [0, 0, 255]}
        stimcol = {1: [255, 255, 255], 2: [255, 255, 0], 3: [0, 255, 255]}
        bad_dot = [r for r in rec if r['dot'] != [0, 0, 0] and r['dot'] != cols.get(r['stim'])]
        lit = [r for r in rec if r['dot'] != [0, 0, 0]]
        check(len(lit) > 0 and not bad_dot, f'dot colour always that of the current stimulus ({len(lit)} lit frames, {len(bad_dot)} wrong)')
        lit_trials = {r['trial'] for r in lit}
        check(lit_trials == set(range(1, 15)), 'every trial fired the dot')
        on_bad = [r for r in rec if r['state'] == 'ON' and r['shown'].get(str(r['stim'])) != stimcol[r['stim']]]
        off_bad = [r for r in rec if r['state'] in ('OFF', 'DELAY') and any(v == stimcol[int(k)] and stimcol[int(k)] != [128,128,128] for k, v in r['shown'].items())]
        check(not on_bad, f'ON frames show the right stimulus in its colour ({len(on_bad)} wrong)')
        check(not off_bad, f'OFF frames show no stimulus ({len(off_bad)} wrong)')
        if off_bad or on_bad:
            i = rec.index((off_bad or on_bad)[0])
            for r in rec[max(0, i-3): i+2]: print('   ', r)
        check(log['params']['renderer'] == ('webgl2' if renderer == 'webgl' else 'canvas2d'),
              'renderer ' + log['params']['renderer'] + (' parity ' + json.dumps(log['params']['webgl_parity']) if renderer == 'webgl' else ''))
        jit = [t['off_jitter_frames'] for t in trials]
        check(max(jit) > 0 and all(0 <= j <= log['params']['jitterFrames'] for j in jit), f'jitter within 0..{log["params"]["jitterFrames"]} frames: {jit}')
        st = {s['stimulus']: s for s in log['stimuli']}
        check(st[1]['shape'] == 'X' and st[2]['shape'] == 'O' and st[3]['shape'] == '+' and st[2]['height_px'] > 0,
              'stimuli block: shapes and sizes')
        apa = page.evaluate('buildAPADescription()')
        check(f'seed {seed}' in apa and 'red (#ff0000) for the standard' in apa, 'APA names seed and sync colours')
        check(not errs, 'no page errors ' + str(errs))
        ctx.close()

    # ── SVG: load, clean, refuse text/external, carry in link, run parity ──
    print('\n===== SVG')
    ctx = b.new_context(viewport={'width': 640, 'height': 400}, accept_downloads=True)
    ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(ROOT + 'oddball_vep.html')
    page.wait_for_timeout(600)
    svg_ui_ready(page)
    info = load_svg(page, '#svgFile2', '#svgInfo2', os.path.join(FIX, 'text.svg'))
    check('convert text to paths' in info, 'SVG with <text> refused: ' + info)
    info = load_svg(page, '#svgFile2', '#svgInfo2', os.path.join(FIX, 'ext.svg'), prev=info)
    check('external' in info, 'SVG with external url() refused: ' + info)
    info = load_svg(page, '#svgFile2', '#svgInfo2', os.path.join(FIX, 'tri.svg'), prev=info)
    check('tri.svg' in info and 'SHA-256' in info and page.input_value('#shape2') == 'svg', 'SVG accepted: ' + info)
    cleaned = page.evaluate("svgTextOf(2)")
    check('inkscape' not in cleaned and 'metadata' not in cleaned and '<title' not in cleaned and 'width="100"' in cleaned,
          'editor metadata removed, size made explicit')
    page.wait_for_timeout(400)
    si = page.text_content('#shapeInfo')
    check('2 tri.svg:' in si, 'shape info for SVG: ' + si[:160])
    pv = page.evaluate("_shapePreview[2]")
    hp = page.evaluate("_shapePreview[1].h")
    check(abs(pv['h'] - hp) <= 1 and abs(pv['w'] / pv['h'] - 2.0) < 0.06, f'SVG ink height = X height ({pv["h"]} vs {hp}), aspect kept ({pv["w"]/pv["h"]:.3f})')
    url = page.evaluate('updateURLPreview()')
    check('svg2=' in url and 'svg2_name=tri.svg' in url and 'shape2=svg' in url, 'link carries the SVG')
    # The link alone restores it, and parity passes with it
    p2 = ctx.new_page(); p2.on('pageerror', lambda e: errs.append('p2 ' + str(e)))
    p2.goto(url + '&parity=1')
    p2.wait_for_selector('#parityReport', timeout=15000)
    rep = p2.text_content('#parityReport')
    check('PASS' in rep, 'parity with SVG + X: ' + rep.split('\n')[0])
    check(p2.input_value('#shape2') == 'svg' and 'tri.svg' in p2.text_content('#svgInfo2'), 'SVG restored from link')
    check(not errs, 'no page errors ' + str(errs))
    b.close()

print('\nFAILURES:', len(fails))
for f in fails: print('  -', f)
sys.exit(1 if fails else 0)
