/* Generates the determinism self-test in two forms:
 *   selftest.html          — a complete standalone page (served from the site)
 *   selftest.artifact.html — content only, for the Artifact host, which wraps
 *                            uploads in its own <!doctype><head><body>
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
  var out = [];
  var spots = [[0,11],[12,45],[-24,38],[33,34],[-6,32],[30,20],[-36,26],[2,16]];
  var tiers = ['junior','intermediate','senior','allireland'];
  for(var i=0;i<200;i++){
    var s = spots[i % spots.length];
    out.push({
      matchSeed: (1013904223 + i*2654435761) >>> 0,
      kickIndex: i % 9,
      power: 0.18 + ((i*17) % 78) / 100,
      aimM:  -3.2 + ((i*23) % 65) / 10,
      curl:  -0.9 + ((i*13) % 19) / 10,
      x: s[0], z: s[1],
      wall: [0,0,3,4,2][i % 5],
      weather: i % 4,
      difficulty: tiers[i % 4]
    });
  }
  return out;
}

/* FNV-1a over every flight: a single-bit difference anywhere changes it. */
function fingerprint(results){
  var s = results.map(function(r){
    return r.outcome+'|'+r.x+'|'+r.y+'|'+r.z+'|'+r.wind;
  }).join(';');
  var h = 0x811c9dc5;
  for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

const RECS = records();
const results = RECS.map(simulate);
const baseline = fingerprint(results);
const spread = {};
results.forEach(r => spread[r.outcome] = (spread[r.outcome]||0)+1);

/* Everything is scoped to .cfst rather than <body>, and there is no 100vh, so
   it renders correctly whether it owns the document or is embedded in one. */
const CSS = `
.cfst{--ink:#fff;--dim:rgba(255,255,255,.58);--ok:#37d67a;--bad:#ff2d6b;--gold:#FFD200;
  background:#0a1628;color:var(--ink);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  line-height:1.55;padding:1.4rem 1.1rem 2.2rem;min-height:100%;box-sizing:border-box}
.cfst *{box-sizing:border-box}
.cfst .in{max-width:520px;margin:0 auto}
.cfst h1{font-size:1.12rem;margin:0 0 .3rem;font-weight:800}
.cfst p{margin:0}
.cfst .sub{color:var(--dim);font-size:.82rem}
.cfst .verdict{margin:1.3rem 0;padding:1.3rem 1rem;border-radius:16px;text-align:center;
  border:2px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05)}
.cfst .verdict.pass{border-color:var(--ok);background:rgba(55,214,122,.12)}
.cfst .verdict.fail{border-color:var(--bad);background:rgba(255,45,107,.12)}
.cfst .big{font-size:2rem;font-weight:800}
.cfst .pass .big{color:var(--ok)}
.cfst .fail .big{color:var(--bad)}
.cfst .note{font-size:.85rem;color:var(--dim);margin-top:.4rem}
.cfst table{width:100%;border-collapse:collapse;margin-top:.8rem;font-size:.83rem}
.cfst td{padding:.5rem .2rem;border-bottom:1px solid rgba(255,255,255,.09);vertical-align:top;text-align:left}
.cfst td:first-child{color:var(--dim);width:42%}
.cfst code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;
  color:var(--gold);word-break:break-all}
.cfst button{margin-top:1.1rem;width:100%;padding:.8rem;border-radius:12px;
  border:1.5px solid rgba(255,255,255,.22);background:transparent;color:var(--ink);
  font:inherit;font-weight:700}
.cfst pre{margin-top:1rem;padding:.7rem;border-radius:10px;background:rgba(0,0,0,.35);
  color:var(--gold);font-size:.72rem;white-space:pre-wrap;word-break:break-all}
.cfst .foot{margin-top:1.4rem;font-size:.75rem;color:var(--dim)}
`;

const BODY = `<div class="cfst"><div class="in">
<h1>Croker Flicks — determinism self-test</h1>
<p class="sub">Runs 200 recorded kicks through the game's physics on this device and
compares every flight with the reference build. A match means this phone's
JavaScript engine agrees to the last decimal place, which is what online
multiplayer needs.</p>
<div id="cfout"><p class="note" style="margin-top:1rem">Running…</p></div>
<button id="cfcopy" type="button">Copy result</button>
<pre id="cfplain"></pre>
<p class="foot">Baseline <code>${baseline}</code> · 200 flights · four keeper tiers ·
11m–47m · all weather states.</p>
</div></div>`;

/* Installed BEFORE the simulation script, so even a parse error in it is
   reported on screen instead of silently leaving "Running…". */
const GUARD = `
window.addEventListener('error', function(e){
  var el = document.getElementById('cfout');
  if(el) el.innerHTML = '<div class="verdict fail"><div class="big">SCRIPT ERROR</div>' +
    '<div class="note">' + ((e && e.message) || 'unknown') + '</div></div>';
});`;

const RUN = `
${simSrc}
var BASELINE = ${JSON.stringify(baseline)};
${records.toString()}
${fingerprint.toString()}
(function(){
  var report = '';
  try{
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var res = records().map(simulate);
    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
    var fp = fingerprint(res);
    var ok = (fp === BASELINE);
    var spread = {};
    for(var i=0;i<res.length;i++) spread[res[i].outcome] = (spread[res[i].outcome]||0)+1;
    var parts = [];
    for(var kk in spread) parts.push(kk + ' ' + spread[kk]);
    report = (ok ? 'PASS' : 'FAIL') + '\\ndevice: ' + fp + '\\nbaseline: ' + BASELINE +
             '\\nua: ' + navigator.userAgent;
    document.getElementById('cfout').innerHTML =
      '<div class="verdict ' + (ok?'pass':'fail') + '">' +
        '<div class="big">' + (ok ? 'MATCH' : 'MISMATCH') + '</div>' +
        '<div class="note">' + (ok
          ? 'This device agrees with the reference build exactly.'
          : 'This device computes different numbers, so online play would need the server to be authoritative.') +
        '</div></div>' +
      '<table>' +
        '<tr><td>This device</td><td><code>' + fp + '</code></td></tr>' +
        '<tr><td>Reference</td><td><code>' + BASELINE + '</code></td></tr>' +
        '<tr><td>Flights</td><td>200 in ' + Math.round(t1-t0) + ' ms</td></tr>' +
        '<tr><td>Outcomes</td><td>' + parts.join(', ') + '</td></tr>' +
        '<tr><td>Browser</td><td style="font-size:.72rem">' + navigator.userAgent + '</td></tr>' +
      '</table>';
    document.getElementById('cfplain').textContent = report;
  }catch(err){
    report = 'ERROR: ' + (err && err.message ? err.message : err);
    document.getElementById('cfout').innerHTML =
      '<div class="verdict fail"><div class="big">ERROR</div><div class="note">' +
      report + '</div></div>';
    document.getElementById('cfplain').textContent = report;
  }
  var btn = document.getElementById('cfcopy');
  if(btn) btn.onclick = function(){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(report);
        btn.textContent = 'Copied';
        return;
      }
    }catch(e2){}
    btn.textContent = 'Select the text below to copy';
  };
})();`;

const artifact = `<title>Croker Flicks — Determinism Self-Test</title>
<style>${CSS}</style>
${BODY}
<script>${GUARD}<\/script>
<script>${RUN}<\/script>`;

const standalone = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Croker Flicks — Determinism Self-Test</title>
<style>html,body{margin:0;padding:0;background:#0a1628;min-height:100%}${CSS}</style>
</head><body>
${BODY}
<script>${GUARD}<\/script>
<script>${RUN}<\/script>
</body></html>`;

writeFileSync(here + '../selftest.html', standalone);
writeFileSync(here + '../selftest.artifact.html', artifact);
console.log('baseline       : ' + baseline);
console.log('outcome spread : ' + JSON.stringify(spread));
console.log('wrote selftest.html and selftest.artifact.html');
