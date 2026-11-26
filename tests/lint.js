// Lint the inline scripts of every page, and the shared script files, with
// ESLint 9 (flat configuration, passed inline). A page is linted together with
// the shared files it loads by <script src>, so a function it calls from one
// of them is not reported as undefined, and a shared function that no page
// uses is reported as unused.
// Exit status: 1 when any rule at "error" level fires, so CI fails on it.
const {Linter} = require('eslint');
const globals = require('globals');
const fs = require('fs');
const path = require('path');

const p5 = ['width', 'height', 'windowWidth', 'windowHeight', 'frameCount', 'deltaTime',
  'millis', 'loop', 'noLoop', 'cursor', 'noCursor', 'frameRate', 'resizeCanvas',
  'createCanvas', 'pixelDensity', 'drawingContext', 'random', 'TWO_PI', 'PI'];
const g = {...globals.browser, ...globals.es2021, VEP: 'readonly'};
p5.forEach(k => { g[k] = 'writable'; });
// globals 15 lists `model` as a browser global (a non-standard Chrome property);
// the calibration page declares its own, which is not a redeclaration.
delete g.model;

const config = {
  languageOptions: {ecmaVersion: 2022, sourceType: 'script', globals: g},
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none',
      varsIgnorePattern: '^(setup|draw|preload|windowResized|mousePressed|keyPressed)$'}],
    'no-redeclare': 'error',
  },
};

// Shared script files other than the engine (which is linted on its own).
const SHARED = new Set(['vep_page.js']);

const linter = new Linter();
let errors = 0;
for (const f of process.argv.slice(2)) {
  if (SHARED.has(path.basename(f))) continue;     // linted with the pages that load it
  const s = fs.readFileSync(f, 'utf8');
  let parts;
  if (f.endsWith('.js')) {
    parts = [{name: f, code: s}];
  } else {
    parts = [];
    for (const m of s.matchAll(/<script src="([^"]+)"><\/script>/g)) {
      if (SHARED.has(m[1])) {
        parts.push({name: m[1], code: fs.readFileSync(path.join(path.dirname(f), m[1]), 'utf8')});
      }
    }
    parts.push({name: f, code: [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n')});
  }
  // Join the parts and remember where each begins, to report its own line numbers.
  let code = '', starts = [];
  for (const p of parts) { starts.push({name: p.name, line: code.split('\n').length}); code += p.code + '\n;\n'; }
  const where = line => {
    let cur = starts[0];
    for (const st of starts) if (st.line <= line) cur = st;
    return (cur.name === f ? '' : cur.name + ':') + (line - cur.line + 1);
  };
  const msgs = linter.verify(code, config);
  errors += msgs.filter(m => m.severity === 2).length;
  const out = msgs.map(m => `  ${where(m.line)}: ${m.message}`);
  console.log(f.padEnd(28), out.length ? '\n' + out.join('\n') : 'OK');
}
if (errors) { console.log(`\n${errors} lint error(s)`); process.exitCode = 1; }
