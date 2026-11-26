#!/bin/bash
# Static checks. Exits non-zero on the first failing stage, so CI stops on it.
set -e
cd "$(dirname "$0")/.."
TMPJS="$(mktemp -t vepcheck.XXXXXX).js"
export TMPJS
for js in vep_engine.js $(ls vep_page.js 2>/dev/null); do node --check "$js" && echo "$js syntax OK"; done
python3 - <<'PY'
import re,subprocess,glob,collections,os,sys
problems=0
for f in sorted(glob.glob('*.html')):
    s=open(f,encoding='utf-8').read()
    blocks=re.findall(r'<script>(.*?)</script>',s,re.S)
    bad=0
    for i,b in enumerate(blocks):
        p=os.environ['TMPJS']; open(p,'w').write(b)
        r=subprocess.run(['node','--check',p],capture_output=True,text=True)
        if r.returncode: bad+=1; print(f,i,r.stderr[:400])
    mk=re.sub(r'<script.*?</script>','',s,flags=re.S)
    mk=re.sub(r'<!--.*?-->','',mk,flags=re.S)
    o=len(re.findall(r'<div\b',mk)); c=len(re.findall(r'</div>',mk))
    ids=collections.Counter(re.findall(r'\sid="([^"]+)"',mk))
    d=[k for k,v in ids.items() if v>1]
    print(f'{f:28s} scripts={len(blocks)} syntaxErr={bad} div {o}/{c} dupIds={d}')
    problems+=bad+(o!=c)+len(d)
sys.exit(1 if problems else 0)
PY
python3 check_consts.py *.html vep_engine.js $(ls vep_page.js 2>/dev/null)
node tests/lint.js *.html vep_engine.js $(ls vep_page.js 2>/dev/null)
