/* Generates selftest.html — a standalone page that re-runs the deterministic
 * simulation on whatever device opens it and compares the result against the
 * baseline computed here.
 *
 * The simulation is inlined from functions/_lib/sim.js at build time rather
 * than copy-pasted, so the page can never drift from the real thing.
 *
 *   node tools/build-selftest.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { simulate } from '../functions/_lib/sim.js';

const here = new URL('.', import.meta.url).pathname;
const simSrc = readFileSync(here + '../functions/_lib/sim.js', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');

/* A fixed battery: every tier, both wall states, spots from 11m to 47m,
   all four weather states, curl both ways, powers from a dink to a rocket. */
function records(){
  const out = [];
  const spots = [[0,11],[12,45],[-24,38],[33,34],[-6,32],[30,20],[-36,26],[2,16]];
  const tiers = ['junior','intermediate','senior','allireland'];
  for(let i=0;i<200;i++){
    const s = spots[i % spots.length];
    out.push({
      matchSeed: (1013904223 + i*2654435761) >>> 0,
      kickIndex: i % 9,
      power: 0.18 + ((i*17) % 78) / 100,
      aimM:  -3.2 + ((i*23) % 65) / 10,
      curl:  -0.9 + ((i*13) % 19) / 10,
      x: s[0], z: s[1],
      wall: [0,0,3,4,2][i % 5],
      weather: i % 4,
      difficulty: tiers[i % 4],
    });
  }
  return out;
}

/* FNV-1a over the full result string: any single-bit difference anywhere in
   200 flights changes the fingerprint. */
function fingerprint(results){
  const s = results.map(r => r.outcome+'|'+r.x+'|'+r.y+'|'+r.z+'|'+r.wind).join(';');
  let h = 0x811c9dc5;
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8,'0');
}

const RECS = records();
const baseline = fingerprint(RECS.map(simulate));
const spread = {};
RECS.map(simulate).forEach(r => spread[r.outcome] = (spread[r.outcome]||0)+1);

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Croker Flicks — Determinism Self-Test</title>
<style>
:root{--bg:#0a1628;--ink:#fff;--dim:rgba(255,255,255,.55);--ok:#37d67a;--bad:#ff2d6b;--gold:#FFD200}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink);
  min-height:100vh;padding:max(1.4rem,env(safe-area-inset-top)) 1.2rem 2.5rem;line-height:1.55}
.wrap{max-width:520px;margin:0 auto}
h1{font-size:1.15rem;letter-spacing:.01em}
.sub{color:var(--dim);font-size:.82rem;margin-top:.25rem}
.verdict{margin:1.4rem 0;padding:1.3rem 1rem;border-radius:16px;text-align:center;
  border:2px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04)}
.verdict.pass{border-color:var(--ok);background:rgba(55,214,122,.1)}
.verdict.fail{border-color:var(--bad);background:rgba(255,45,107,.1)}
.big{font-size:2.1rem;font-weight:800;letter-spacing:-.01em}
.pass .big{color:var(--ok)} .fail .big{color:var(--bad)}
.note{font-size:.85rem;color:var(--dim);margin-top:.4rem}
table{width:100%;border-collapse:collapse;margin-top:1rem;font-size:.83rem}
td{padding:.5rem .2rem;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}
td:first-child{color:var(--dim);width:42%}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;color:var(--gold);word-break:break-all}
.copy{margin-top:1.2rem;width:100%;padding:.8rem;border-radius:12px;border:1.5px solid rgba(255,255,255,.2);
  background:transparent;color:var(--ink);font:inherit;font-weight:700}
.copy:active{background:rgba(255,255,255,.08)}
.foot{margin-top:1.6rem;font-size:.76rem;color:var(--dim)}
</style></head>
<body><div class="wrap">
<h1>Croker Flicks — determinism self-test</h1>
<p class="sub">Re-runs 200 recorded kicks through the game's physics on this device and
compares the result with the reference build. If they match, this phone's
JavaScript engine agrees to the last decimal place — which is what online
multiplayer needs.</p>
<div id="out">Running…</div>
<button class="copy" id="copy">Copy result</button>
<p class="foot">Baseline fingerprint <code>${baseline}</code> · 200 flights across
four keeper tiers, both wall states, 11m–47m, all four weather states.</p>
</div>
<script>
${simSrc}
const BASELINE = ${JSON.stringify(baseline)};
${records.toString()}
${fingerprint.toString()}
let report = '';
try{
  const t0 = performance.now();
  const recs = records();
  const res  = recs.map(simulate);
  const ms   = (performance.now()-t0).toFixed(0);
  const fp   = fingerprint(res);
  const ok   = fp === BASELINE;
  const spread = {};
  res.forEach(r => spread[r.outcome] = (spread[r.outcome]||0)+1);
  const sample = res[0];
  report = [
    (ok ? 'PASS' : 'FAIL'),
    'device fingerprint: ' + fp,
    'baseline:           ' + BASELINE,
    'ua: ' + navigator.userAgent,
    'sample: ' + JSON.stringify(sample)
  ].join('\\n');
  document.getElementById('out').innerHTML =
    '<div class="verdict ' + (ok?'pass':'fail') + '">' +
      '<div class="big">' + (ok ? 'MATCH' : 'MISMATCH') + '</div>' +
      '<div class="note">' + (ok
        ? 'This device agrees with the reference build exactly.'
        : 'This device computes different results — online play would need the server to be authoritative.') +
      '</div></div>' +
    '<table>' +
      '<tr><td>Device fingerprint</td><td><code>' + fp + '</code></td></tr>' +
      '<tr><td>Baseline</td><td><code>' + BASELINE + '</code></td></tr>' +
      '<tr><td>Flights simulated</td><td>200 in ' + ms + ' ms</td></tr>' +
      '<tr><td>Outcome spread</td><td>' + Object.entries(spread).map(e=>e[0]+' '+e[1]).join(', ') + '</td></tr>' +
      '<tr><td>Browser</td><td style="font-size:.72rem">' + navigator.userAgent + '</td></tr>' +
    '</table>';
}catch(err){
  report = 'ERROR: ' + err.message;
  document.getElementById('out').innerHTML =
    '<div class="verdict fail"><div class="big">ERROR</div><div class="note">' + err.message + '</div></div>';
}
document.getElementById('copy').onclick = async () => {
  try{ await navigator.clipboard.writeText(report); document.getElementById('copy').textContent = 'Copied'; }
  catch{ document.getElementById('copy').textContent = report.split('\\n')[1] || 'Copy failed'; }
};
</script></body></html>`;

writeFileSync(here + '../selftest.html', html);
console.log('baseline fingerprint : ' + baseline);
console.log('outcome spread       : ' + JSON.stringify(spread));
console.log('wrote selftest.html');
