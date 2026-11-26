"""Pixel checks for the render paths and the sync dot.

Always: the same frames are drawn through both paths (WebGL 2 and Canvas 2D),
with the dot on and off, and must agree exactly — 0 differing pixels — and a
coloured dot must show its colour when on and black when off, without changing
anything outside the dot.

Optionally, with VEP_BASELINE set to a folder holding an earlier version of the
suite, every frame is also compared with what that version drew.
"""
import base64, sys
from playwright.sync_api import sync_playwright

import os, pathlib
HERE = os.path.dirname(os.path.abspath(__file__))
SUITE = os.path.abspath(os.environ.get('VEP_DIR', os.path.join(HERE, '..')))
ROOT = pathlib.Path(SUITE).as_uri() + '/'
P5 = open(os.environ.get('P5_JS', os.path.join(HERE, 'node_modules', 'p5', 'lib', 'p5.min.js')), encoding='utf-8').read()
FIX = os.path.join(HERE, 'fixtures')
W, H = 360, 240
fails = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)

# How to draw one frame of each stimulus, as JS expressions; `on` is the dot.
FRAMES = {
  'flash_vep.html': {
      'flash_dotOn':  'renderFrame(colFlash, true)',
      'flash_dotOff': 'renderFrame(colFlash, false)',
      'blank_dotOff': 'renderFrame(colBlank, false)'},
  'pattern_onset_vep.html': {
      'on_dotOn':    'dotFlashFrames = 2; renderFrame(true)',
      'on_dotOff':   'dotFlashFrames = 0; renderFrame(true)',
      'blank_dotOff':'dotFlashFrames = 0; renderFrame(false)'},
  'pattern_reversal_vep.html': {
      'dotOn':  'dotFlashFrames = 2; renderFrame()',
      'dotOff': 'dotFlashFrames = 0; renderFrame()'},
  'motion_onset_vep.html': {
      'dotOn':  'dotFlashFrames = 2; renderFrame(0)',
      'dotOff': 'dotFlashFrames = 0; renderFrame(0)'},
}

GRAB = """(path) => {
  const enc = (a) => { let s = ''; for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode.apply(null, Array.from(a.subarray(i, i + 8192))); return btoa(s); };
  if (path === 'cpu') return enc(imgBuf);
  const gl = document.getElementById('glCanvas').getContext('webgl2');
  const w = width, h = height, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out = new Uint8Array(w * h * 4);          // flip to top-down, like imgBuf
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return enc(out);
}"""

def render_all(b, root, file, extra=''):
    ctx = b.new_context(viewport={'width': W, 'height': H})
    ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(root + file + '?useFullscreen=false&enableLogging=false&startDelay=20000'
              '&dot_x=40&dot_y=40&dotSize=16' + extra)
    page.wait_for_timeout(800)
    page.click('#runStartBtn')
    page.wait_for_function("typeof state !== 'undefined' && state !== 'INIT' && state !== 'MEASURE'",
                           timeout=15000)
    page.wait_for_timeout(300)
    page.evaluate('noLoop()')
    page.wait_for_timeout(400)          # let an already-queued draw() run first
    gpu = page.evaluate('useWebGL && glRenderer.active')
    out = {}
    for name, js in FRAMES[file].items():
        for path in (['gpu'] if gpu else []) + ['cpu']:
            page.evaluate('useWebGL = ' + ('true' if path == 'gpu' else 'false'))
            # Render and read in one evaluate, so no draw() can run in between.
            out[name + '/' + path] = base64.b64decode(page.evaluate(
                '(path) => { ' + js + '; return (' + GRAB + ')(path); }', path))
        page.evaluate('useWebGL = ' + ('true' if gpu else 'false'))
    ctx.close()
    return out, gpu, errs

def px(buf, x, y):
    i = (y * W + x) * 4
    return tuple(buf[i:i + 3])

def diff(a, b):
    """Pixels that differ, and whether they all lie inside the dot (x,y 32..47)."""
    n, outside = 0, 0
    for i in range(0, min(len(a), len(b)), 4):
        if a[i:i+3] != b[i:i+3]:
            n += 1
            p = i // 4; x, y = p % W, p // W
            if not (32 <= x < 48 and 32 <= y < 48): outside += 1
    return n, outside

BASE = os.environ.get('VEP_BASELINE')
BASE_URI = pathlib.Path(os.path.abspath(BASE)).as_uri() + '/' if BASE else None
if not BASE:
    print('NOTE: VEP_BASELINE not set; skipping the comparison with an earlier version')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files', '--use-angle=swiftshader',
                                '--enable-unsafe-swiftshader'])
    for file in FRAMES:
        print('\n=====', file)
        new, gnew, e2 = render_all(b, ROOT, file)
        check(not e2, file + ': no page errors ' + str(e2))
        if BASE_URI:
            old, gold, e1 = render_all(b, BASE_URI, file)
            check(not e1, file + ': no page errors in the baseline ' + str(e1))
            check(gold == gnew, file + f': same renderer availability (gpu={gnew})')
            for key in new:
                n, outside = diff(old[key], new[key])
                check(n == 0, f'{key}: identical to the baseline ({n} px differ)')
        # The two render paths agree exactly.
        if gnew:
            for name in FRAMES[file]:
                n, outside = diff(new[name + '/gpu'], new[name + '/cpu'])
                check(n == 0, f'{name}: GPU and Canvas 2D identical ({n} px differ)')
        # A coloured dot: right colour when on, black when off, on both paths
        col, gc, e3 = render_all(b, ROOT, file, '&hexSync1=%2300ff00')
        check(not e3, file + ': no page errors with coloured dot ' + str(e3))
        for key, buf in col.items():
            want = (0, 0, 0) if 'dotOff' in key else (0, 255, 0)
            check(px(buf, 40, 40) == want, f'green dot {key}: {px(buf, 40, 40)} == {want}')
            n, outside = diff(new[key], buf)
            check(outside == 0, f'green dot {key}: nothing outside the dot changed')
    b.close()

print('\nFAILURES:', len(fails))
for f in fails: print('  -', f)
sys.exit(1 if fails else 0)
