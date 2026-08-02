/* Croker Flicks — deterministic simulation core.
 *
 * This is the server's copy of the physics. It exists so the API can
 * re-simulate a submitted input record and decide the outcome itself, rather
 * than trusting whatever the client claims happened.
 *
 * It MUST stay byte-for-byte equivalent in behaviour to the copy inside
 * game.html. Two things keep it honest:
 *   1. Only + - * / and sqrt are used on the outcome path. Math.sin/cos/atan2/
 *      pow/hypot are implementation-defined across JS engines; dsin/dcos below
 *      are polynomial so every runtime agrees.
 *   2. tests/sim-parity.mjs runs the same records through this module and
 *      through the browser build and fails on any divergence.
 *
 * The draw order from the seeded stream is part of the contract:
 *   wind (2) -> keeper reaction (1) -> contact slip (1) -> keeper read (2)
 */

export const CFG = {
  PEN_Z: 11, GOAL_W: 6.5, BAR_H: 2.5, POST_R: 0.085,
  BALL_R: 0.28, BALL_PHYS: 0.11, G: 9.81, DRAG: 0.010,
  CURL: 14, WALL_GAP: 13,
};
export const TWO_PT_R = 40;
const HW = CFG.GOAL_W / 2;

export const DIFF = {
  junior:       {rMin:.25, rMax:.35, dur:.52, reach:.42, range:1.70, err:.95},
  intermediate: {rMin:.22, rMax:.31, dur:.47, reach:.45, range:2.05, err:.68},
  senior:       {rMin:.19, rMax:.27, dur:.43, reach:.48, range:2.32, err:.46},
  allireland:   {rMin:.15, rMax:.22, dur:.38, reach:.52, range:2.28, err:.30},
};
export const WEATHERS = [
  {name:'Clear',        rain:0,   wet:0},
  {name:'Overcast',     rain:0,   wet:.25},
  {name:'Drizzle',      rain:.45, wet:.6},
  {name:'Driving rain', rain:1,   wet:1},
];

/* ---------- deterministic maths ---------- */
const D_PI = 3.141592653589793, D_2PI = 6.283185307179586, D_HPI = 1.5707963267948966;
export function dsin(x){
  x -= D_2PI * Math.floor((x + D_PI) / D_2PI);
  const t = x*x;
  return x*(1 + t*(-1/6 + t*(1/120 + t*(-1/5040 + t*(1/362880 - t/39916800)))));
}
export const dcos  = x => dsin(x + D_HPI);
const dhyp2 = (a,b)   => Math.sqrt(a*a + b*b);
const dhyp3 = (a,b,c) => Math.sqrt(a*a + b*b + c*c);
const lerp  = (a,b,t) => a + (b-a)*t;
const clamp = (v,a,b) => v<a ? a : v>b ? b : v;
const ease  = t => t<.5 ? 2*t*t : 1-((-2*t+2)*(-2*t+2))/2;

/* ---------- seeded stream ---------- */
export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a>>>15, 1 | a);
    t = t + Math.imul(t ^ t>>>7, 61 | t) ^ t;
    return ((t ^ t>>>14) >>> 0) / 4294967296;
  };
}
export function hash2(a,b){
  let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b+0x165667B1, 0xC2B2AE35);
  h ^= h>>>15; return h>>>0;
}

/* ---------- the simulation ---------- */
export function simulate(rec){
  const diff = DIFF[rec.difficulty] || DIFF.senior;
  const rng  = mulberry32(hash2((rec.matchSeed>>>0), (rec.kickIndex|0)));
  const gRand = (a,b) => a + rng()*(b-a);

  const sx = rec.x || 0, sz = (rec.z === undefined ? CFG.PEN_Z : rec.z);
  const shotDist = Math.max(4, dhyp2(sx, sz));
  const uX = -sx/shotDist, uZ = -sz/shotDist;   // toward the goal
  const rX = -uZ,          rZ =  uX;            // right of the shot line

  const wall = rec.wall ? {
    men: Array.from({length:rec.wall}, (_,i)=>({off:(i-(rec.wall-1)/2)*0.60})),
    at: Math.min(CFG.WALL_GAP, shotDist - 1.4), jump:0, h:1.92, jumpH:0.60,
  } : null;

  const weather = WEATHERS[rec.weather || 0];

  // --- draw order matters: wind, then keeper reaction, then contact slip ---
  const wind = gRand(-1,1);
  const windKmh = Math.abs(wind) * gRand(3,24);
  const windAcc = wind * (windKmh/24) * 5.2;

  const keeper = {
    wx:0, wy:0, tx:0, ty:1.35, side:1, dive:0, committed:false,
    react: gRand(diff.rMin, diff.rMax),
    dur: diff.dur, reach: diff.reach, range: diff.range, err: diff.err,
  };

  const power = clamp(rec.power, 0, 1);
  const curl  = clamp(rec.curl || 0, -1, 1);
  const slip  = gRand(-0.17, 0.17) * (0.55 + power);
  const aimM  = (rec.aimM || 0) + slip;

  // launch
  const tR = clamp((shotDist-CFG.PEN_Z)/34, 0, 1);
  const th = lerp(lerp(9,24,tR), lerp(20,40,tR), power) * D_PI/180;
  const S  = lerp(lerp(13,20,tR), lerp(27,28,tR), power) * (1 - weather.wet*0.07);
  const hyp = dhyp2(aimM, shotDist);
  const ch  = S*dcos(th);
  const fwd = ch*(shotDist/hyp), lat = ch*(aimM/hyp);

  const b = {wx:sx, wy:CFG.BALL_R, wz:sz, bounced:false,
             vx: uX*fwd + rX*lat, vz: uZ*fwd + rZ*lat, vy: S*dsin(th)};

  const alongShot  = () => (b.wx-sx)*uX + (b.wz-sz)*uZ;
  const acrossAt   = (x,z) => (x-sx)*rX + (z-sz)*rZ;

  function keeperHand(){
    const e = ease(keeper.dive);
    return {x: lerp(keeper.side*0.42, keeper.tx, e), y: lerp(1.42, keeper.ty, e)};
  }
  function keeperUpdate(t){
    if(!keeper.committed){
      if(t < keeper.react) return;
      const tt = b.wz / Math.max(0.6, -b.vz);
      let px = b.wx + b.vx*tt;
      let py = b.wy + b.vy*tt - 0.5*CFG.G*tt*tt;
      px += gRand(-keeper.err, keeper.err);
      py += gRand(-keeper.err, keeper.err)*0.55;
      keeper.tx = clamp(px, -keeper.range, keeper.range);
      keeper.ty = clamp(py, 0.20, 2.25);
      keeper.side = Math.sign(keeper.tx) || 1;
      keeper.committed = true;
    }
    const dt = Math.max(0, t - keeper.react);
    keeper.dive = clamp(dt / keeper.dur, 0, 1);
    const e = ease(keeper.dive);
    keeper.wx = lerp(0, keeper.tx*0.56, e);
    keeper.wy = lerp(0, Math.max(0, keeper.ty*0.52 - 0.14), e);
  }
  function evaluateAtPlane(bx, by){
    const R = CFG.BALL_PHYS, edge = CFG.POST_R + R;
    if(Math.abs(by - CFG.BAR_H) <= edge && Math.abs(bx) <= HW + edge) return 'bar';
    if(Math.abs(Math.abs(bx) - HW) <= edge && by <= CFG.BAR_H + edge) return 'post';
    if(Math.abs(bx) > HW) return 'wide';
    if(by > CFG.BAR_H) return shotDist > TWO_PT_R ? 'twopoint' : 'point';
    const hand = keeperHand();
    const smother = b.bounced ? 0.55 : 0;
    const dHand = dhyp2(bx-hand.x, by-hand.y);
    const dBody = dhyp2(bx-keeper.wx, by-(keeper.wy+1.0));
    if(dHand < keeper.reach+smother || dBody < 0.55+smother) return 'save';
    if(dHand < keeper.reach + smother + 0.16) return 'tip';
    return 'goal';
  }

  const dt = 1/60;
  let t = 0, outcome = 'short';
  for(let i=0;i<900;i++){
    const pz=b.wz, px=b.wx, py=b.wy, pa = wall ? alongShot() : 0;
    // step
    const sp = dhyp3(b.vx,b.vy,b.vz);
    const k  = CFG.DRAG*(1 + weather.wet*0.28)*sp;
    const side = (curl*CFG.CURL*(sp/20) + windAcc)*dt;
    b.vx += (-k*b.vx)*dt + rX*side;
    b.vz += (-k*b.vz)*dt + rZ*side;
    b.vy += (-CFG.G - k*b.vy)*dt;
    b.wx += b.vx*dt; b.wy += b.vy*dt; b.wz += b.vz*dt;
    if(b.wy < CFG.BALL_R){
      b.bounced = true;
      b.wy = CFG.BALL_R; b.vy = -b.vy*(0.48 - weather.wet*0.16);
      b.vx*=0.78; b.vz*=0.82;
      if(Math.abs(b.vy)<0.7) b.vy=0;
    }
    t += dt;
    keeperUpdate(t);
    if(wall){ wall.jump = t < 0.62 ? dsin(clamp(t/0.62,0,1)*D_PI) : 0; }

    if(wall && pa < wall.at && alongShot() >= wall.at){
      const f2 = (wall.at-pa)/(alongShot()-pa);
      const latAt = acrossAt(lerp(px,b.wx,f2), lerp(pz,b.wz,f2));
      const hgt   = lerp(py, b.wy, f2);
      const top   = wall.h + wall.jump*wall.jumpH;
      if(hgt <= top && hgt >= 0 &&
         wall.men.some(m => Math.abs(latAt - m.off) < 0.34 + CFG.BALL_PHYS)){
        outcome = 'blocked'; break;
      }
    }
    if(pz > 0 && b.wz <= 0){
      const f = pz/(pz-b.wz);
      outcome = evaluateAtPlane(lerp(px,b.wx,f), lerp(py,b.wy,f));
      break;
    }
    if(t > 6) break;
  }
  return {
    outcome,
    x:+b.wx.toFixed(9), y:+b.wy.toFixed(9), z:+b.wz.toFixed(9),
    wind:+wind.toFixed(9),
  };
}

/* points, mirroring the client's XP table */
const XP = {point:10, twopoint:25, goal:40,
            tierMul:{junior:1.0, intermediate:1.2, senior:1.4, allireland:1.6}};
export function scoreValue(outcome){
  return outcome==='goal' ? 3 : outcome==='twopoint' ? 2 : outcome==='point' ? 1 : 0;
}
export function xpValue(outcome, rec, streak){
  if(!XP[outcome]) return 0;
  let n = XP[outcome] * (XP.tierMul[rec.difficulty] || 1);
  const dist = Math.max(4, dhyp2(rec.x||0, rec.z===undefined?CFG.PEN_Z:rec.z));
  if(outcome==='twopoint') n += Math.max(0, dist-TWO_PT_R) * 1.5;
  if(Math.abs(rec.curl||0) >= 0.35) n *= 1.5;
  n += Math.min(50, (streak||0)*5);
  return Math.round(n);
}

/* reject anything outside the ranges the UI can physically produce */
export function validateRecord(rec){
  if(!rec || typeof rec !== 'object') return 'malformed';
  if(!Number.isInteger(rec.kickIndex) || rec.kickIndex < 0 || rec.kickIndex > 999) return 'kickIndex';
  if(typeof rec.power !== 'number' || rec.power < 0 || rec.power > 1) return 'power';
  if(typeof rec.aimM !== 'number' || Math.abs(rec.aimM) > 6) return 'aimM';
  if(rec.curl !== undefined && (typeof rec.curl !== 'number' || Math.abs(rec.curl) > 1)) return 'curl';
  if(rec.difficulty && !DIFF[rec.difficulty]) return 'difficulty';
  if(rec.wall !== undefined && (!Number.isInteger(rec.wall) || rec.wall < 0 || rec.wall > 5)) return 'wall';
  if(rec.weather !== undefined && (!Number.isInteger(rec.weather) || rec.weather < 0 || rec.weather > 3)) return 'weather';
  return null;
}
