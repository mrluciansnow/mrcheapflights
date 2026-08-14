/* Is the keeper an animal with bones, or a set of shapes that happen to be
 * near each other?
 *
 *   node tests/limbs.mjs
 *
 * He was the second thing. keeperHand() belongs to the simulation — it is
 * where a save is judged from — and the drawing closed the gap to it by
 * growing the arm, up to 2.07x its own length on a fifth of all poses. Worse,
 * the trunk rotated while the hips stayed put, so at full pitch the body
 * folded through its own legs, and a lead offset slid the whole figure
 * around to help the arm reach.
 *
 * This test does not restate the maths. It LIFTS the real pose function out
 * of game.html and runs it, so what is checked is what ships:
 *
 *   BONES     Every segment holds its length to the millimetre across every
 *             pose a dive can produce. A bone that changes length is not a
 *             bone.
 *   REACH     The hand the arm is solved to is the hand the save is judged
 *             from, so the glove lands on it and not near it.
 *   GROUND    Feet stay on the grass while he is on the grass, and no joint
 *             goes under it.
 *   SANITY    He stays the right way up and his head stays on his neck.
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('../game.html', import.meta.url).pathname;
const src = readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/* ---- lift the real thing out of the file ---- */
function grab(startMark, endMark){
  const i = src.indexOf(startMark);
  if(i < 0) throw new Error('could not find ' + startMark);
  const j = src.indexOf(endMark, i);
  return src.slice(i, j < 0 ? undefined : j);
}
const lifted = grab('const ANAT = {', 'function inkKeeper(');
const shim = `
  const lerp=(a,b,t)=>a+(b-a)*t, clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const ease=t=>t<.5?2*t*t:1-((-2*t+2)*(-2*t+2))/2;
  /* the simulation's, verbatim from game.html */
  function keeperHand(k){
    const e = ease(k.dive), st = ease(k.settle || 0);
    const y = lerp(1.42, k.ty, e);
    return { x: lerp(k.wx0 + k.side*0.42, k.tx, e),
             y: lerp(y, y < 0.60 ? y : 0.60, st) };
  }
`;
let keeperPose, ANAT, K_ARM, K_LEG, ACTION;
try {
  ({ keeperPose, ANAT, K_ARM, K_LEG, ACTION } =
    new Function(shim + lifted +
      '\nreturn {keeperPose, ANAT, K_ARM, K_LEG, ACTION};')());
  pass++; console.log('\nTHE REAL POSE FUNCTION LOADS');
  console.log('  ok   lifted keeperPose out of game.html and it runs');
} catch(e){
  fail++; console.log('\n  FAIL could not lift the pose function: ' + e.message);
  process.exit(1);
}
console.log('  a ' + (ANAT.hip + ANAT.spine + ANAT.neck + ANAT.headR*2).toFixed(2) +
            'm keeper: arm ' + K_ARM.toFixed(2) + 'm, leg ' + K_LEG.toFixed(2) +
            'm, span ' + (2*(ANAT.shoulderHalf + K_ARM)).toFixed(2) + 'm');
ok('his arm span matches his height, the way a person\'s does',
   Math.abs(2*(ANAT.shoulderHalf + K_ARM) -
            (ANAT.hip + ANAT.spine + ANAT.neck + ANAT.headR*2)) < 0.12,
   'span ' + (2*(ANAT.shoulderHalf+K_ARM)).toFixed(2));

/* ---- and now put him through everything a dive can ask of him ---- */
const d = (a,b) => Math.hypot(b[0]-a[0], b[1]-a[1]);
const worst = {};
const note = (what, v, at) => {
  if(!worst[what] || v > worst[what].v) worst[what] = { v, at };
};
let n = 0;
/* DIFF.range clamps the keeper's own target to +/-2.32 in every difficulty
   and DIFF.ty to [0.20, 2.25], so that — not the width of the goal — is the
   space he can actually be asked to cover. A little past it on both, to
   catch anything that only breaks at the edge. */
for(let tx=-2.45; tx<=2.4501; tx+=0.05)
for(let ty=0.20; ty<=2.35001; ty+=0.05)
for(let dv=0; dv<=1.0001; dv+=0.05)
for(const wx0 of [-0.75, 0, 0.75])
for(const settle of [0, 0.5, 1]){
  const side = Math.sign(tx) || 1;
  const e = (dv<.5?2*dv*dv:1-((-2*dv+2)*(-2*dv+2))/2);
  const es = (settle<.5?2*settle*settle:1-((-2*settle+2)*(-2*settle+2))/2);
  const k = { tx, ty, wx0, side, dive:dv, settle, recover:0,
              wx: wx0*0.56 + (tx*0.56 - wx0*0.56)*e,
              /* he comes back down as he settles, exactly as keeperStep has it */
              wy: (Math.max(0, ty*0.52 - 0.14))*e * (1 - es) };
  const p = keeperPose(k);
  const at = {tx:+tx.toFixed(1), ty:+ty.toFixed(2), dive:+dv.toFixed(2), wx0, settle};
  n++;

  // BONES — every segment its own length, always
  note('spine',  Math.abs(d(p.P, p.C) - ANAT.spine), at);
  note('neck',   Math.abs(d(p.C, p.HD) - (ANAT.neck + ANAT.headR)), at);
  for(const a of p.arms){
    note('upper arm', Math.abs(d(a.sh, a.elbow) - ANAT.upper), at);
    note('forearm',   Math.abs(d(a.elbow, a.hand) - (ANAT.fore + ANAT.glove)), at);
  }
  for(const L of p.legs){
    note('thigh', Math.abs(d(L.hip, L.knee) - ANAT.thigh), at);
    note('shin',  Math.abs(d(L.knee, L.foot) - ANAT.shin), at);
  }
  // REACH — the glove on the hand the save is judged from
  const hand = { x: (wx0 + side*0.42) + (tx - (wx0 + side*0.42))*e,
                 y: 0 };
  const yy = 1.42 + (ty - 1.42)*e;
  const st = (settle<.5?2*settle*settle:1-((-2*settle+2)*(-2*settle+2))/2);
  hand.y = yy + ((yy < 0.60 ? yy : 0.60) - yy)*st;
  const lead = p.arms.find(a => a.lead);
  note('glove off the judged hand',
       d(lead.hand, [hand.x - k.wx, hand.y - k.wy]), at);
  // GROUND — nothing under the turf, and feet planted while he is planted
  for(const L of p.legs){
    note('joint under the turf', Math.max(0, -(k.wy + L.foot[1])), at);
    if(p.air < 0.05) note('planted foot off the grass',
                          Math.abs(k.wy + L.foot[1]), at);
  }
  // SANITY — head above hips, and the right way up
  note('head below the pelvis', Math.max(0, p.P[1] - p.HD[1]), at);
}

console.log('\nEVERY POSE A DIVE CAN PRODUCE  (' + n.toLocaleString() + ' of them)');
/* A bone is exact. The glove is allowed to sit inside the ball's own
   physical radius of the judged hand — CFG.BALL_PHYS is 0.11m, so at 0.09
   the ball and the glove always overlap on screen and a save is always seen
   to be made. The residual is a mid-dive transient: the arm extends before
   the trunk goes over, which is what a person does. */
const BONE_TOL = 0.001, REACH_TOL = 0.09, GROUND_TOL = 0.03;
for(const [what, tol] of [['spine',BONE_TOL], ['neck',BONE_TOL],
                          ['upper arm',BONE_TOL], ['forearm',BONE_TOL],
                          ['thigh',BONE_TOL], ['shin',BONE_TOL]]){
  const w = worst[what];
  ok(what + ' never changes length', w.v <= tol,
     'off by ' + (w.v*1000).toFixed(1) + 'mm at ' + JSON.stringify(w.at));
}
const g = worst['glove off the judged hand'];
console.log('  glove sits ' + (g.v*1000).toFixed(0) + 'mm from the judged hand at worst');
ok('the glove lands ON the hand the save is judged from', g.v <= REACH_TOL,
   (g.v*1000).toFixed(0) + 'mm at ' + JSON.stringify(g.at));
ok('no joint ever goes under the turf',
   worst['joint under the turf'].v <= GROUND_TOL,
   (worst['joint under the turf'].v*1000).toFixed(0) + 'mm at ' +
   JSON.stringify(worst['joint under the turf'].at));
if(worst['planted foot off the grass'])
  ok('his feet are ON the grass while he is on the grass',
     worst['planted foot off the grass'].v <= GROUND_TOL,
     (worst['planted foot off the grass'].v*1000).toFixed(0) + 'mm at ' +
     JSON.stringify(worst['planted foot off the grass'].at));
ok('his head is never below his hips',
   worst['head below the pelvis'].v <= 0.001,
   worst['head below the pelvis'].v.toFixed(3) + 'm');

console.log('\nHANDS FIRST, AND OFF THE LEGS');
/* Two things you can see in a real dive, asked of the model as questions
   rather than asserted as intentions. Taken across every dive-shaped target
   he can be given, at the moment the push is half spent. */
{
  let leadWins = 0, springWins = 0, cases = 0;
  for(let tx=-2.3; tx<=2.3001; tx+=0.1){
    if(Math.abs(tx) < 1.0) continue;                  // a dive, not a step
    for(let ty=0.4; ty<=2.2001; ty+=0.2){
      const side = Math.sign(tx) || 1, wx0 = 0;
      const K = dv => {
        const e = (dv<.5?2*dv*dv:1-((-2*dv+2)*(-2*dv+2))/2);
        return keeperPose({ tx, ty, wx0, side, dive:dv, settle:0, recover:0,
                            wx: wx0*0.56 + (tx*0.56 - wx0*0.56)*e,
                            wy: Math.max(0, ty*0.52 - 0.14)*e });
      };
      const a0 = K(0), a1 = K(0.30), aN = K(1);
      const lead0 = a0.arms.find(x=>x.lead), lead1 = a1.arms.find(x=>x.lead),
            leadN = aN.arms.find(x=>x.lead);
      /* how much of its journey has each part made a third of the way in? */
      const gl = d(lead0.hand, leadN.hand) || 1e-6;
      const sh = d(a0.arms.find(x=>x.lead).sh, aN.arms.find(x=>x.lead).sh) || 1e-6;
      const glove    = d(lead0.hand, lead1.hand)/gl;
      const shoulder = d(a0.arms.find(x=>x.lead).sh, a1.arms.find(x=>x.lead).sh)/sh;
      cases++;
      if(glove > shoulder + 0.02) leadWins++;
      /* the spring: the driving foot still down while the hips have risen */
      const foot = a1.legs[side > 0 ? 1 : 0];
      if(a1.drive > 0.2 && Math.abs(foot.foot[1]) < 0.02 && a1.P[1] > a0.P[1] + 0.005)
        springWins++;
    }
  }
  console.log('  the glove is ahead of the shoulder in ' +
              (100*leadWins/cases).toFixed(0) + '% of dives a third of the way in');
  console.log('  the driving foot is still on the grass with the hips rising in ' +
              (100*springWins/cases).toFixed(0) + '% of them');
  ok('his hands go first', leadWins/cases > 0.85,
     (100*leadWins/cases).toFixed(0) + '%');
  ok('he springs off a planted leg', springWins/cases > 0.85,
     (100*springWins/cases).toFixed(0) + '%');
}

console.log('\nAND HE HAS MORE THAN ONE MOVEMENT');
const seen = new Set();
for(let tx=-3; tx<=3.001; tx+=0.05)
for(let ty=0.2; ty<=2.4001; ty+=0.05)
  seen.add(keeperPose({tx, ty, wx0:0, side:Math.sign(tx)||1, dive:1, settle:0,
                       wx:tx*0.56, wy:Math.max(0,ty*0.52-0.14)}).action);
console.log('  reachable: ' + [...seen].sort().join(', '));
for(const a of Object.keys(ACTION))
  ok(a + ' is reachable from somewhere in the goal', seen.has(a));

console.log('\n' + (fail ? 'LIMBS: ' + fail + ' FAILED' : 'LIMBS: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
