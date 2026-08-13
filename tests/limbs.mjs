/* An arm is a fixed length.
 *
 *   node tests/limbs.mjs
 *
 * keeperHand() belongs to the simulation: it is where a save is judged from,
 * and at full stretch it sits further from the shoulder than any arm reaches.
 * Both renderers used to close that gap the cheap way — by drawing a longer
 * arm — which is a keeper made of elastic. Swept over every pose a dive can
 * produce, the classic arm reached 1.87x its own length and the ink one
 * 2.07x, and a quarter of all poses needed some stretch.
 *
 * Two mechanisms fix it, and this test holds both:
 *
 *   THE PELVIS      The ink keeper's upper body used to be ROLLED by the lean
 *                   without being MOVED by it, so a man at full stretch stood
 *                   upright with his hand at ankle height. He now turns about
 *                   the pelvis, which is where a dive actually pivots.
 *
 *   THE SHOULDER    Whatever gap survives that, he leads with the shoulder —
 *                   capped, so he cannot dislocate himself either.
 *
 * The constants are read out of game.html rather than restated here, so
 * retuning them re-measures rather than lies.
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('../game.html', import.meta.url).pathname;
const src = readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};
const num = (re, what) => {
  const m = re.exec(src);
  if (!m) { fail++; console.log('  FAIL could not find ' + what); return null; }
  return parseFloat(m[1]);
};

console.log('\nTHE MECHANISMS ARE THERE');
const ARM_C = num(/const ARM = ([\d.]+);\s*\/\/ shoulder to fingertip/, 'the classic arm length');
const LEAD_C = num(/Math\.min\(over, ([\d.]+)\*s\) \/ reach/, 'the classic shoulder lead cap');
const ARM_I = num(/const ARM = ([\d.]+), PELVIS = ([\d.]+)/, 'the ink arm length');
const PELVIS = num(/const ARM = [\d.]+, PELVIS = ([\d.]+)/, 'the ink pelvis height');
const LEAD_I = num(/Math\.min\(over, ([\d.]+)\) \/ reach/, 'the ink shoulder lead cap');
ok('the ink keeper turns about the pelvis, not the feet',
   /const pose = \(lat, hgt\) => \{\s*\/\/ about the pelvis/.test(src));
ok('the ink arm is clamped to its own length',
   /clamp\(Math\.hypot\(dx, dy\), 0\.42, ARM\)/.test(src));
ok('and neither mechanism moved anything the simulation reads',
   !/keeperHand\s*=\s*/.test(src.slice(src.indexOf('function inkKeeper'))) &&
   /k\.wx, k\.wy and keeperHand are untouched|wx, wy and keeperHand never move/.test(src));
console.log('  ARM ' + ARM_C + '/' + ARM_I + 'm   lead cap ' + LEAD_C + '/' + LEAD_I +
            'm   pelvis ' + PELVIS + 'm');

/* ---- the sweep: every pose a dive can put a hand in ---- */
const lerp = (a,b,t)=>a+(b-a)*t, clamp=(v,a,b)=>v<a?a:v>b?b:v;
const ease = t=>t<.5?2*t*t:1-((-2*t+2)*(-2*t+2))/2;

/* the shared part: where the body and the judged hand end up */
function bodyAndHand(tx, ty, dive, wx0){
  const side = Math.sign(tx) || 1, e = ease(dive);
  return {
    side, e,
    wx: lerp(wx0*0.56, tx*0.56, e),
    wy: lerp(0, Math.max(0, ty*0.52 - 0.14), e),
    hand: { x: lerp(wx0 + side*0.42, tx, e), y: lerp(1.42, ty, e) },
  };
}
/* how long the drawn arm has to be, as a multiple of a real one */
function inkArm(tx, ty, dive, wx0){
  const { side, e, wx, wy, hand } = bodyAndHand(tx, ty, dive, wx0);
  const lean = side*e*1.15, crouch = (1-e)*0.14;
  const cL = Math.cos(lean), sL = Math.sin(lean);
  const dh = (1.30 - crouch) - PELVIS;
  const sh = [ side*0.25*cL + dh*sL, PELVIS + dh*cL - side*0.25*sL ];
  let dx = (hand.x - wx) - sh[0], dy = (hand.y - wy) - sh[1];
  const reach = Math.hypot(dx, dy), over = reach - ARM_I;
  if(over > 0 && reach > 0.001){
    const f = Math.min(over, LEAD_I)/reach; dx -= dx*f; dy -= dy*f;
  }
  return Math.hypot(dx, dy)/ARM_I;
}
function classicArm(tx, ty, dive, wx0, sharp){
  const { side, e, wx, wy, hand } = bodyAndHand(tx, ty, dive, wx0);
  const ang = side*e*(1.05 + clamp(Math.abs(tx)/2.4,0,1)*0.42);
  const ux=Math.sin(ang), uy=Math.cos(ang), rx=Math.cos(ang), ry=-Math.sin(ang);
  const h = 1.28 - (1-e)*(0.05 + sharp*0.13), lat = 0.21;
  const shx = wx + lat*rx + h*ux, shy = wy + h*uy - lat*ry;
  let dx = hand.x - shx, dy = hand.y - shy;
  const reach = Math.hypot(dx, dy), over = reach - ARM_C;
  if(over > 0 && reach > 0.001){
    const f = Math.min(over, LEAD_C)/reach; dx -= dx*f; dy -= dy*f;
  }
  return Math.hypot(dx, dy)/ARM_C;
}
function sweep(f, sharps){
  let worst = 0, at = null, n = 0, over = 0;
  for(let tx=-3.0; tx<=3.0001; tx+=0.1)
  for(let ty=0.20; ty<=2.40001; ty+=0.05)
  for(let d=0; d<=1.0001; d+=0.05)
  for(const wx0 of [-0.75, 0, 0.75])
  for(const sharp of sharps){
    const r = f(tx, ty, d, wx0, sharp);
    n++; if(r > 1.001) over++;
    if(r > worst){ worst = r;
      at = {tx:+tx.toFixed(1), ty:+ty.toFixed(2), dive:+d.toFixed(2), wx0, sharp}; }
  }
  return { worst, at, pct: 100*over/n, n };
}

console.log('\nAND NO POSE ASKS FOR MORE ARM THAN HE HAS');
for(const [name, f, sharps] of [['ink', inkArm, [0]],
                                ['classic', classicArm, [0, 0.5, 1]]]){
  const r = sweep(f, sharps);
  console.log('  ' + name + ': worst ' + r.worst.toFixed(2) + ' x ARM over ' +
              r.n.toLocaleString() + ' poses, ' + r.pct.toFixed(1) + '% stretched');
  ok(name + ' never draws an arm longer than an arm',
     r.worst <= 1.001, 'worst ' + r.worst.toFixed(3) + ' at ' + JSON.stringify(r.at));
  ok(name + ' needs no stretch anywhere in the space',
     r.pct === 0, r.pct.toFixed(2) + '%');
}

console.log('\n' + (fail ? 'LIMBS: ' + fail + ' FAILED' : 'LIMBS: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
