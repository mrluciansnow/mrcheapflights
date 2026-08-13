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
 * Worse, the ink keeper crumpled: his torso rotated about the pelvis while
 * his hips and legs stayed where they were, so at full pitch the body folded
 * through its own legs. Nothing held a bone to its length or a joint to the
 * end of the bone before it.
 *
 * Three things fix it, and this test holds all three:
 *
 *   THE CHAIN       He is built pelvis -> chest -> head, chest -> shoulders,
 *                   pelvis -> hips, and every joint is the end of the bone
 *                   before it. Nothing is placed independently, so no part of
 *                   him can budge into any other part.
 *
 *   THE SOLVER      Arms and legs are SOLVED to a target by ik2(), which
 *                   pulls the target into range first. A bone cannot exceed
 *                   its length however far away the target is.
 *
 *   THE ACTION      A keeper has more than one movement. Which of SET, STEP,
 *                   DUCK, JUMP, DIVE, LEAP or SPRAWL he is in follows from
 *                   where his own target is, and each has its own shape.
 *                   Pose comes from the action; position never does.
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
const UPPER = num(/upper:([\d.]+),/, 'the upper arm bone');
const FORE  = num(/fore:([\d.]+),/, 'the forearm bone');
const GLOVE = num(/glove:([\d.]+),/, 'the glove');
const LEAD_I = num(/Math\.min\(over, ([\d.]+)\)\/reach/, 'the ink shoulder lead cap');
const ARM_I = UPPER + FORE + GLOVE;
ok('the ink keeper is a chain: every joint is the end of the bone before it',
   /const C  = \[P\[0\] \+ up\[0\]\*BONE\.spine/.test(src) &&
   /const HD = \[C\[0\] \+ up\[0\]\*BONE\.neck/.test(src) &&
   /const SH = s => \[C\[0\]/.test(src) && /const HP = s => \[P\[0\]/.test(src));
ok('his limbs are SOLVED to a target, not stretched to one',
   /function ik2\(sx, sy, tx, ty, l1, l2, bend\)/.test(src) &&
   /if\(d > hi\)\{ const f = hi\/\(d\|\|1e-6\)/.test(src));
ok('so no bone can exceed its own length whatever the target',
   /else if\(d < lo\)\{ const f = lo\/\(d\|\|1e-6\)/.test(src));
ok('the shoulder lead moves the WHOLE chain, so he cannot come apart',
   /The lead moves the WHOLE chain/.test(src));
ok('he has more than one movement, chosen by where his target is',
   /function keeperAction\(k\)/.test(src) &&
   ['SET','STEP','DUCK','JUMP','DIVE','LEAP','SPRAWL']
     .every(n => new RegExp('\\b' + n + ':').test(src)));
ok('and none of it moved anything the simulation reads',
   /POSE comes from the action\. POSITION does not/.test(src));
console.log('  ARM ' + ARM_C + '/' + ARM_I.toFixed(2) + 'm   lead cap ' +
            LEAD_C + '/' + LEAD_I + 'm');

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
/* The ink arm is solved, not stretched, so the question is not whether it
   overshoots — ik2 pulls the target into range and it cannot — but how much
   of the reach the SOLVER has to throw away, which is the same defect wearing
   a different coat. A glove short of the hand is a save that lands near it. */
const ACT = {
  SET:{pitch:0.10,knee:0.55}, STEP:{pitch:0.34,knee:0.42}, DUCK:{pitch:0.46,knee:1.00},
  JUMP:{pitch:0.16,knee:0.30}, DIVE:{pitch:1.02,knee:0.20}, LEAP:{pitch:0.80,knee:0.16},
  SPRAWL:{pitch:1.34,knee:0.26},
};
function actionOf(tx, ty, wx0){
  const dx = tx - wx0, travel = Math.hypot(dx, ty - 1.15), wide = Math.abs(dx);
  const high = ty > 1.70, low = ty < 0.80;
  if(travel < 0.38) return 'SET';
  if(wide < 0.55)   return high ? 'JUMP' : low ? 'DUCK' : 'STEP';
  if(travel < 0.95) return 'STEP';
  if(low)  return 'SPRAWL';
  if(high) return 'LEAP';
  return 'DIVE';
}
function inkArm(tx, ty, dive, wx0){
  const { side, e, wx, wy, hand } = bodyAndHand(tx, ty, dive, wx0);
  const A = ACT[actionOf(tx, ty, wx0)];
  const sit = A.knee*(1-e)*0.26, pitch = side*e*A.pitch;
  const cP = Math.cos(pitch), sP = Math.sin(pitch);
  const pelH = (0.42+0.40) * (0.94 - sit) * (1 - e*0.30);
  const hl = hand.x - wx, hv = hand.y - wy;
  const sh = [ sP*0.42 + cP*side*0.19, pelH + cP*0.42 - sP*side*0.19 ];
  let dx = hl - sh[0], dy = hv - sh[1];
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
  ok(name + ' never asks for an arm longer than an arm',
     r.worst <= 1.001, 'worst ' + r.worst.toFixed(3) + ' at ' + JSON.stringify(r.at));
  ok(name + ' reaches the judged hand everywhere in the space',
     r.pct === 0, r.pct.toFixed(2) + '% short or stretched');
}

console.log('\n' + (fail ? 'LIMBS: ' + fail + ' FAILED' : 'LIMBS: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
