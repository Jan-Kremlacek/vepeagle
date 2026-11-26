import json, sys
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

with sync_playwright() as p:
    b = p.chromium.launch(args=['--allow-file-access-from-files'])
    ctx = b.new_context()
    ctx.route('**/p5.min.js', lambda r: r.fulfill(body=P5, content_type='application/javascript'))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    dialogs = []
    def on_dialog(d):
        dialogs.append(d.message)
        d.accept(page_prompt_answer[0]) if d.type == 'prompt' else (d.accept() if dialog_answer[0] else d.dismiss())
    page_prompt_answer = ['']
    dialog_answer = [True]
    page.on('dialog', on_dialog)

    # 1. Fresh gate: summary reflects actual values (not empty px)
    page.goto(ROOT + 'vep_gate.html')
    page.evaluate("localStorage.clear()")
    page.reload()
    summ = page.text_content('#screenSummary')
    check(summ.split(' px')[0].strip().isdigit(), 'screen summary shows detected px: ' + summ)
    check(page.is_checked('#useFullscreen'), 'Fullscreen default on')

    # 2. Change dot size -> persisted, summary updated, Run link carries it
    page.evaluate("""() => { const e=document.getElementById('dotSize'); e.value='50';
                     e.dispatchEvent(new Event('input',{bubbles:true})); }""")
    check('50 px' in page.text_content('#syncSummary'), 'sync summary updates to 50')
    page.reload()
    check(page.input_value('#dotSize') == '50', 'dotSize persisted across reload')
    check('50 px' in page.text_content('#syncSummary'), 'sync summary after reload shows 50')

    # 3. Add condition whose link carries dotSize=70 -> asked; accept -> gate 70, stored link clean
    page.evaluate("document.querySelector('#condList').closest('.section').querySelector('details').open=true")
    page.fill('#newCondName', 'Rev A')
    page.fill('#newCondUrl', 'pattern_reversal_vep.html?patternType=checker&checkSize=0.5&dotSize=70&view_distance_cm=57&autostart=1&parity=1')
    dialog_answer[0] = True; dialogs.clear()
    page.click('#condAddBtn')
    check(any('Dot size' in d for d in dialogs), 'add: dialog lists dot size difference')
    check(page.input_value('#dotSize') == '70', 'add+OK: gate dot size now 70')
    stored = page.evaluate("JSON.parse(localStorage.getItem('vep_protocol'))")
    check(stored and 'dotSize' not in stored[0]['url'] and 'autostart' not in stored[0]['url']
          and 'parity' not in stored[0]['url'] and 'checkSize=0.5' in stored[0]['url'],
          'stored condition stripped of shared/launch keys: ' + stored[0]['url'])

    # 4. Run link carries the gate's 70 and autostart
    href = page.evaluate("""() => { const a=document.querySelector('.cond-run');
                            a.dispatchEvent(new MouseEvent('click',{cancelable:true}));
                            return a.href; }""")
    check('dotSize=70' in href and 'autostart=true' in href and 'useFullscreen=true' in href,
          'Run href has dotSize=70, autostart, fullscreen')

    # 5. ↻ with link dotSize=40, answer Cancel -> keep 70
    dialog_answer[0] = False
    page_prompt_answer[0] = 'pattern_reversal_vep.html?patternType=checker&checkSize=1&dotSize=40'
    dialogs.clear()
    page.click('.cond-acts button:has-text("↻")')
    check(page.input_value('#dotSize') == '70', '↻+Cancel keeps gate dot size 70')
    stored = page.evaluate("JSON.parse(localStorage.getItem('vep_protocol'))")
    check('checkSize=1' in stored[0]['url'] and 'dotSize' not in stored[0]['url'], '↻ updated condition, stripped')

    # 6. Launch tile carries current note even though note is outside the form
    page.fill('#noteField', 'subj-07')
    tile = page.get_attribute('#btnReversal', 'href')
    check('note=subj-07' in tile and 'dotSize=70' in tile, 'launch tile updated with note and dot size')

    # 7. Back-link from a stimulus page -> notice + undo; URL cleaned
    page.goto(ROOT + 'vep_gate.html?dotSize=55&screen_width_cm=40&note=x')
    check(page.is_visible('#envNotice'), 'notice shown for settings from link')
    check(page.input_value('#dotSize') == '55', 'link value applied (55)')
    check('dotSize' not in page.url and 'note=x' in page.url, 'env keys removed from address: ' + page.url)
    page.click('#envNotice button:has-text("Undo")')
    check(page.input_value('#dotSize') == '70' and page.input_value('#screen_width_cm') == '53',
          'undo restores 70 / 53')
    page.reload()
    check(page.input_value('#dotSize') == '70', 'undo persisted across reload')

    # 8. Protocol export contains environment
    with page.expect_download() as dl:
        page.evaluate("document.querySelector('#protoExportBtn').closest('details').open=true")
        page.click('#protoExportBtn')
    data = json.load(open(dl.value.path()))
    check(data.get('environment', {}).get('dotSize') == '70' and len(data['conditions']) == 1,
          'export has environment and conditions')

    # 10. Sync colours: per-file substitution, validation, persistence, warning
    page.evaluate("document.getElementById('syncSummary').closest('details').open=true")
    href = page.evaluate("""() => { const a=document.querySelector('.cond-run');
                            a.dispatchEvent(new MouseEvent('click',{cancelable:true})); return a.href; }""")
    check('hexSync1=%23ffffff' in href and 'hexSync2' not in href and 'hexSync3' not in href,
          'single-stimulus Run gets hexSync1 only')
    multi = page.evaluate("makeURL('oddball_vep.html', {})")
    check('hexSync1=%23ffffff' in multi and 'hexSync2=%23ff0000' in multi and 'hexSync3=%2300ff00' in multi,
          'multi-stimulus page gets all three colours')
    page.fill('#hexSync1', '#F00'); page.press('#hexSync1', 'Tab')
    check(page.input_value('#hexSync1') == '#ff0000', 'short upper-case code normalised to #ff0000')
    check(page.is_visible('#syncWarn'), 'duplicate colour warning shown (1 and 2 both red)')
    page.fill('#hexSync1', 'zzz'); page.press('#hexSync1', 'Tab')
    check(page.input_value('#hexSync1') == '#ff0000', 'invalid code reverted to last valid')
    page.fill('#hexSync1', '#0000ff'); page.press('#hexSync1', 'Tab')
    check(not page.is_visible('#syncWarn'), 'warning gone once colours differ')
    page.reload()
    check(page.input_value('#hexSync1') == '#0000ff', 'sync colour persisted across reload')
    check('#0000ff' in page.text_content('#syncSummary'), 'sync summary lists colours')
    href = page.evaluate("""() => { const a=document.querySelector('.cond-run');
                            a.dispatchEvent(new MouseEvent('click',{cancelable:true})); return a.href; }""")
    check('hexSync1=%230000ff' in href, 'Run link carries the chosen colour')
    page.goto(ROOT + 'vep_gate.html?hexSync1=%2300ff00')
    check(page.input_value('#hexSync1') == '#00ff00' and page.is_visible('#envNotice'),
          'colour from a stimulus back-link applied with notice')
    # a condition link carrying hexSync2 is stripped of it
    page.evaluate("document.querySelector('#condList').closest('.section').querySelector('details').open=true")
    page.fill('#newCondName', 'X'); page.fill('#newCondUrl', 'flash_vep.html?flashFreq=2&hexSync1=%2300ff00&hexSync2=%23123456')
    dialog_answer[0] = False
    page.click('#condAddBtn')
    stored = page.evaluate("JSON.parse(localStorage.getItem('vep_protocol'))")
    check('hexSync' not in stored[-1]['url'], 'stored condition stripped of sync colours')

    # 9. Theme toggle recolours calibration status without error
    page.click('#themeToggleBtn')
    check(not errors, 'no page errors: ' + '; '.join(errors))
    b.close()

print('\nFAILURES:', len(fails))
sys.exit(1 if fails else 0)
