const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
function load(path) {
  const win = {};
  const ctx = { window: win, btoa: s => Buffer.from(s, 'binary').toString('base64'),
                atob: s => Buffer.from(s, 'base64').toString('binary'), Uint32Array, Uint8Array,
                Set, Array, Math, Number, String, Object, escape, unescape, encodeURIComponent,
                decodeURIComponent, isFinite, JSON, Promise, Error };
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), ctx);
  return win.VEP;
}
const path = require('path');
const SUITE = process.env.VEP_DIR || path.join(__dirname, '..');
/* The solver regression compares with an earlier engine (1.1.0 before the
   oddball additions, or any version with the same pair solver). Optional. */
const BASE = process.env.VEP_BASELINE_ENGINE;
const NEW = load(path.join(SUITE, 'vep_engine.js')), OLD = BASE ? load(BASE) : null;
let fails = 0;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

/* 1. Pair solver unchanged by the refactor (only with a baseline engine) */
const cals = [null,
  { model: 'power', gamma: 2.2, L_max_cdm2: 120, L_min_cdm2: 0.4 },
  { model: 'measured', L_max_cdm2: 150, L_min_cdm2: 0.3,
    measured_grey: [0,64,128,192,255].map((V,i)=>({V, L: 0.3 + 149.7*Math.pow(V/255,2.3)})),
    measured_R: [0,128,255].map(V=>({V, L: 0.1+ 31*Math.pow(V/255,2.2)})),
    measured_G: [0,128,255].map(V=>({V, L: 0.15+107*Math.pow(V/255,2.2)})),
    measured_B: [0,128,255].map(V=>({V, L: 0.05+ 11*Math.pow(V/255,2.2)})) } ];
if (OLD) {
let same = 0, total = 0;
const rnd = NEW.makeRng(42);
const rc = () => ({ r: Math.floor(rnd()*256), g: Math.floor(rnd()*256), b: Math.floor(rnd()*256) });
for (const cal of cals) {
  const fN = NEW.buildGammaFns(cal), fO = OLD.buildGammaFns(cal);
  for (let i = 0; i < 300; i++) {
    const o = { colourA: rc(), colourB: rc(), contrast: rnd(), meanLuminance: (fN.L_max) * (0.05 + 0.6*rnd()) };
    const a = JSON.stringify(NEW.solveContrastPairOnRays(fN, o));
    const b = JSON.stringify(OLD.solveContrastPairOnRays(fO, o));
    total++; if (a === b) same++;
  }
}
check(same === total, `pair solver identical before/after refactor (${same}/${total})`);
} else console.log('SKIP pair-solver regression: set VEP_BASELINE_ENGINE');

/* 2. SHA-256 against Node's implementation, incl. multi-block and UTF-8 */
for (const t of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'ž'.repeat(300) + '<svg/>']) {
  const ref = crypto.createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
  check(NEW.sha256Hex(t) === ref, `sha256 length ${Buffer.byteLength(t)}`);
}

/* 3. Text round trip */
const txt = '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg> ž+/=';
check(NEW.decodeTextFromURL(NEW.encodeTextForURL(txt)) === txt, 'text URL round trip');
check(!/[+/=]/.test(NEW.encodeTextForURL(txt)), 'URL-safe alphabet');

/* 4. Sequence: reproducible, exact counts, constraints, over many seeds */
const opt = { total: 200, n2: 30, n3: 10, firstStandards: 5, minStandards: 2, maxStandardRun: 12 };
let okAll = true, repro = true, uniq = new Set();
for (let seed = 1; seed <= 3000; seed++) {
  const r = NEW.oddballSequence(Object.assign({ seed }, opt));
  if (!r.ok) { okAll = false; console.log('  seed', seed, r.reason); break; }
  const o = r.order;
  const c = { 1: 0, 2: 0, 3: 0 }; o.forEach(x => c[x]++);
  let run = 0, maxRun = 0, sinceNon = 0, firstNon = o.findIndex(x => x !== 1), bad = false;
  for (let i = 0; i < o.length; i++) {
    if (o[i] === 1) { run++; sinceNon++; maxRun = Math.max(maxRun, run); }
    else { if (sinceNon < 2) bad = true; run = 0; sinceNon = 0; }
  }
  if (o.length !== 200 || c[1] !== 160 || c[2] !== 30 || c[3] !== 10 || firstNon < 5 || bad || maxRun > 12) {
    okAll = false; console.log('  violated at seed', seed, c, firstNon, maxRun); break;
  }
  if (seed <= 50) {
    const r2 = NEW.oddballSequence(Object.assign({ seed }, opt));
    if (r2.order.join('') !== o.join('')) repro = false;
  }
  uniq.add(o.join(''));
}
check(okAll, 'counts, first standards, spacing before every non-standard, max run: 3000 seeds');
check(repro, 'same seed, same sequence');
check(uniq.size === 3000, `different seeds give different sequences (${uniq.size}/3000)`);

/* Uniformity sanity: position of the first non-standard should not pile up */
const firstPos = {};
for (let seed = 1; seed <= 4000; seed++) {
  const o = NEW.oddballSequence({ total: 20, n2: 2, n3: 0, firstStandards: 0, minStandards: 0, seed }).order;
  const p = o.indexOf(2); firstPos[p] = (firstPos[p] || 0) + 1;
}
/* With 2 deviants in 20 slots, P(first at position p) = (19-p)/190. */
let maxDev = 0;
for (let p = 0; p < 19; p++) maxDev = Math.max(maxDev, Math.abs((firstPos[p] || 0) / 4000 - (19 - p) / 190));
check(maxDev < 0.02, `first-deviant position matches uniform arrangement (max dev ${maxDev.toFixed(3)})`);

/* Infeasible requests are refused with a reason */
const inf = [
  { total: 10, n2: 11 },
  { total: 50, n2: 20, n3: 0, firstStandards: 5, minStandards: 2 },
  { total: 100, n2: 5, n3: 0, minStandards: 2, maxStandardRun: 10 },
  { total: 100, n2: 5, n3: 0, minStandards: 20, maxStandardRun: 10 },
];
inf.forEach(o => { const r = NEW.oddballSequence(Object.assign({ seed: 1 }, o));
  check(!r.ok && r.reason.length > 10, 'refused: ' + r.reason); });
const tight = NEW.oddballSequence({ seed: 7, total: 30, n2: 10, minStandards: 2, firstStandards: 2 });
check(tight.ok && tight.order.join('') === '112112112112112112112112112112', 'exactly-tight spacing yields the only arrangement');

/* 5. Built-in shapes */
for (const k of ['X', 'O', '+']) {
  for (const h of [7, 8, 40, 81]) {
    const m = NEW.builtinShapeMask(k, h, h / 8);
    let top = false, bot = false, left = false, right = false;
    for (let i = 0; i < m.w; i++) { if (m.data[i]) top = true; if (m.data[(m.h - 1) * m.w + i]) bot = true; }
    for (let j = 0; j < m.h; j++) { if (m.data[j * m.w]) left = true; if (m.data[j * m.w + m.w - 1]) right = true; }
    check(m.ok && m.h === h && top && bot && left && right, `${k} at ${h}px: ink fills its box edge to edge`);
  }
}
/* symmetry of X and + and O under 90° rotation */
for (const k of ['X', 'O', '+']) {
  const m = NEW.builtinShapeMask(k, 41, 5); let sym = true;
  for (let y = 0; y < 41; y++) for (let x = 0; x < 41; x++)
    if (m.data[y * 41 + x] !== m.data[x * 41 + (40 - y)]) sym = false;
  check(sym, `${k} is symmetric under 90° rotation`);
}

/* 6. One-sided solver */
const fns = NEW.buildGammaFns(cals[2]);
const bg = { r: 128, g: 128, b: 128 };
for (const C of [0.1, 0.3, 0.5, 0.8]) {
  const r = NEW.solveColourForContrast(fns, { colour: { r: 255, g: 255, b: 255 }, background: bg, contrast: C });
  const reachable = NEW.luminanceOfRGB(fns, { r: 255, g: 255, b: 255 }) >= r.target;
  check(reachable ? (r.ok && Math.abs(r.contrast - C) < 0.02) : (!r.ok && /range/.test(r.reason)),
        `brighter white at C=${C}: ${reachable ? 'achieved ' + (r.contrast && r.contrast.toFixed(3)) : 'refused as out of range'}`);
  const d = NEW.solveColourForContrast(fns, { colour: { r: 10, g: 10, b: 10 }, background: bg, contrast: C });
  check(d.ok && Math.abs(d.contrast - C) < 0.02 && NEW.luminanceOfRGB(fns, d.rgb) < NEW.luminanceOfRGB(fns, bg),
        `darker shape at C=${C}: stays darker, achieved ${d.contrast && d.contrast.toFixed(3)}`);
}
const red = NEW.solveColourForContrast(fns, { colour: { r: 255, g: 0, b: 0 }, background: { r: 40, g: 40, b: 40 }, contrast: 0.4 });
check(red.ok && red.rgb.g === 0 && red.rgb.b === 0, 'a pure primary stays pure');
const again = NEW.solveColourForContrast(fns, { colour: red.rgb, background: { r: 40, g: 40, b: 40 }, contrast: 0.4 });
check(JSON.stringify(again.rgb) === JSON.stringify(red.rgb), 'second Apply is a no-op');
check(!NEW.solveColourForContrast(fns, { colour: { r: 255, g: 255, b: 255 }, background: { r: 0, g: 0, b: 0 }, contrast: 0.5 }).ok,
      'refuses contrast above a black background');
check(!NEW.solveColourForContrast(fns, { colour: { r: 255, g: 255, b: 255 }, background: { r: 250, g: 250, b: 250 }, contrast: 0.9 }).ok,
      'refuses an unreachable contrast');

console.log('\nFAILURES:', fails);
process.exit(fails ? 1 : 0);
