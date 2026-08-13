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
 * A record may carry the keeper's dive as well as the striker's swipe:
 *   dive: {x, y, at}   where he threw himself, and when, relative to the
 *                      strike. Negative `at` means he had already gone.
 * Absent, the server plays its own keeper, which is what every solo kick
 * and every record written before two-sided play looks like.
 *
 * The draw order from the seeded stream is part of the contract:
 *   wind (2) -> keeper reaction (1) -> keeper lean (1) -> contact slip (1)
 *   -> keeper read (2)
 */

export const CFG = {
  PEN_Z: 11, GOAL_W: 6.5, BAR_H: 2.5, POST_R: 0.085,
  BALL_R: 0.28, BALL_PHYS: 0.11, G: 9.81, DRAG: 0.010,
  CURL: 14, WALL_GAP: 13,
};
/* how far off centre a full pre-kick lean puts the keeper, in metres */
const KEEPER_LEAN = 0.75;
export const TWO_PT_R = 40;
const HW = CFG.GOAL_W / 2;

export const DIFF = {
  junior:       {rMin:.25, rMax:.35, dur:.52, reach:.42, range:1.90, err:.95},
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

  const react = gRand(diff.rMin, diff.rMax);
  const lean  = gRand(-1, 1);
  /* A human keeper overrides the lean: he stands where he chose to stand. */
  const dive = (rec.dive && typeof rec.dive === 'object') ? rec.dive : null;
  const keeper = {
    wx: lean * KEEPER_LEAN * 0.56, wy:0, tx:0, ty:1.35, side:1, dive:0, settle:0,
    committed:false,
    lean: lean, wx0: dive ? 0 : lean * KEEPER_LEAN,
    react: react, diveAt: undefined,
    dur: diff.dur, reach: diff.reach, range: diff.range, err: diff.err,
  };
  if(dive) keeper.wx = 0;

  const power = clamp(rec.power, 0, 1);
  const curl  = clamp(rec.curl || 0, -1, 1);
  const elev  = rec.elev === undefined ? power : clamp(rec.elev, 0, 1);
  const slip  = gRand(-0.17, 0.17) * (0.30 + power*0.85);
  const aimM  = (rec.aimM || 0) + slip;
  /* The contact slip was LATERAL ONLY, so height at the line was a pure
     function of elevation, power and wind — perfectly repeatable. That left a
     band of the goal where every shot hit the crossbar, 400 out of 400,
     because a ball whose centre passes within a ball-and-a-bar of 2.5m always
     touches it and nothing ever moved it off that line. A deterministic 0%
     strip through the middle of the elevation control is a cliff with no
     feedback.

     A struck ball misses vertically as well as sideways, so it does here now.
     Derived from the SAME draw rather than a new one: the seeded stream's
     order is a contract — wind, keeper reaction, keeper lean, contact slip,
     keeper read — and inserting a draw would shift everything after it and
     re-score every stored replay. `dsin` of the slip decorrelates it without
     costing a number, and is already on the allowed list for this path. */
  const elevSlip = dsin(slip * 91.7) * 0.012 * (0.30 + power*0.85);

  // launch
  const tR = clamp((shotDist-CFG.PEN_Z)/34, 0, 1);
  const th = lerp(lerp(8,22,tR), lerp(26,44,tR), clamp(elev + elevSlip, 0, 1)) * D_PI/180;
  const S  = lerp(lerp(13,20,tR), lerp(27,28,tR), power) * (1 - weather.wet*0.07);
  const hyp = dhyp2(aimM, shotDist);
  const ch  = S*dcos(th);
  const fwd = ch*(shotDist/hyp), lat = ch*(aimM/hyp);

  const b = {wx:sx, wy:CFG.BALL_R, wz:sz, bounced:false,
             vx: uX*fwd + rX*lat, vz: uZ*fwd + rZ*lat, vy: S*dsin(th)};

  const alongShot  = () => (b.wx-sx)*uX + (b.wz-sz)*uZ;
  const acrossAt   = (x,z) => (x-sx)*rX + (z-sz)*rZ;

/* The wind is a gust, not a fan.
 *
 * It was a constant lateral acceleration for the whole flight, so a ball in
 * the air for a second was pushed by exactly the same hand at the end as at
 * the start. That made wind a fixed offset: you learned it once from the
 * arrow and applied it, and the only thing distance changed was how long the
 * same push had to work.
 *
 * It breathes now — same strength on average, but a long ball rides through
 * more of the cycle than a short one, so hang time is worth thinking about
 * and a 45m free is no longer an 11m penalty with more of the same drift.
 *
 * The phase comes out of the wind draw itself rather than a new number: the
 * stream's order is a contract and inserting a draw re-scores every stored
 * replay. Same reasoning as the vertical contact slip above. */
  const gust = t => 1 + 0.35*dsin(t*4.4 + wind*17.3);

/* How long the dive takes. It used to be a constant, which meant flinging
   himself three metres into the top corner cost exactly what a half-step to
   his right cost — so where he stood was decorative and when he went was
   nearly free. Distance now buys time, which is what makes the set position
   worth anything and gives committing late a real price. */
  function diveDur(k){
    const travel = dhyp2(k.tx - k.wx0, k.ty - 1.15);
    return k.dur * (0.46 + 0.88 * clamp(travel/2.6, 0, 1.35));
  }
/* Where the hand is, INCLUDING after the dive is over.
 *
 * It used to stop at full stretch and stay there, which made going early
 * completely free: from the first frame the UI allows right up to the strike
 * the save rate was identical to nine decimal places, because the keeper
 * simply arrived and held the pose until the ball turned up. There was no
 * decision to make — you went as early as you could, every time.
 *
 * A keeper at the end of a dive is airborne for a moment and then he is on
 * the ground, and the hand that was in the top corner comes down with him.
 * That is the price of committing: you get there, and then you keep going.
 * Nothing is drawn from the stream for it — it is a function of time since
 * the dive completed, which the record already carries. */
  const HANG = 0.17;                 // he stays up this long at full stretch
  const FALL = 0.46;                 // and this long to be down
  function keeperHand(){
    const e = ease(keeper.dive);
    const s = ease(keeper.settle || 0);
    const y = lerp(1.42, keeper.ty, e);
    /* a dive already low stays low — settling never lifts him */
    return {x: lerp(keeper.wx0 + keeper.side*0.42, keeper.tx, e),
            y: lerp(y, y < 0.60 ? y : 0.60, s)};
  }
  function keeperUpdate(t){
    if(!keeper.committed){
      if(dive){
        /* the dive he actually threw. It may have started before the strike,
           in which case it is already part-way through at t = 0. */
        if(t < dive.at) return;
        keeper.tx = clamp(dive.x, -keeper.range, keeper.range);
        keeper.ty = clamp(dive.y, 0.20, 2.25);
        keeper.side = Math.sign(keeper.tx) || 1;
        keeper.committed = true;
        keeper.diveAt = dive.at;
      } else {
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
        keeper.diveAt = keeper.react;
      }
    }
    const dt = Math.max(0, t - keeper.diveAt);
    const dur = diveDur(keeper);
    keeper.dive = clamp(dt / dur, 0, 1);
    // how far past full stretch he is — see the note above keeperHand
    keeper.settle = clamp((dt - dur - HANG) / FALL, 0, 1);
    const e = ease(keeper.dive), s = ease(keeper.settle);
    keeper.wx = lerp(keeper.wx0*0.56, keeper.tx*0.56, e);
    /* Sideways he stays where he went — that is what committed means. It is
       height he loses, because he is coming down. */
    keeper.wy = lerp(lerp(0, Math.max(0, keeper.ty*0.52 - 0.14), e), 0, s);
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
  /* A dive committed before the strike is already under way at t = 0, so the
     keeper is stepped once up front to put him where he had got to. */
  if(dive && dive.at < 0) keeperUpdate(0);
  let t = 0, outcome = 'short';
  for(let i=0;i<900;i++){
    const pz=b.wz, px=b.wx, py=b.wy, pa = wall ? alongShot() : 0;
    // step
    const sp = dhyp3(b.vx,b.vy,b.vz);
    const k  = CFG.DRAG*(1 + weather.wet*0.28)*sp;
    const side = (curl*CFG.CURL*(sp/20) + windAcc*gust(t))*dt;
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
  if(rec.elev !== undefined && (typeof rec.elev !== 'number' || rec.elev < 0 || rec.elev > 1)) return 'elev';
  if(rec.dive !== undefined && rec.dive !== null){
    const d = rec.dive;
    if(typeof d !== 'object') return 'dive';
    if(typeof d.x !== 'number' || Math.abs(d.x) > 5) return 'dive.x';
    if(typeof d.y !== 'number' || d.y < -1 || d.y > 4) return 'dive.y';
    if(typeof d.at !== 'number' || d.at < -8 || d.at > 8) return 'dive.at';
  }
  if(rec.difficulty && !DIFF[rec.difficulty]) return 'difficulty';
  if(rec.wall !== undefined && (!Number.isInteger(rec.wall) || rec.wall < 0 || rec.wall > 5)) return 'wall';
  if(rec.weather !== undefined && (!Number.isInteger(rec.weather) || rec.weather < 0 || rec.weather > 3)) return 'weather';
  return null;
}
