/* Pressure states: the ground closing in on the kick that decides it.
 *
 *   node tests/pressure.mjs
 *
 * Two halves, and the second one is the important one.
 *
 *   IT SHOWS UP   the last rounds of a shootout, and sudden death, read
 *                 differently from the first kick of five — camera, crowd,
 *                 music and clock.
 *
 *   IT STOPS      pressure never reaches the ball. It cannot: the same seed
 *                 and the same strike have to produce the same outcome at
 *                 nil-all and at the death, or "pressure" is a difficulty
 *                 setting the player never chose — and online it would be a
 *                 DIFFERENT one at each end, because the two ends are not in
 *                 the same position in the match.
 *
 * The second half is checked twice over: by simulating identical kicks in
 * both states and comparing, and by reading the source, because a future
 * change that wires pressure into the flight would pass the first check on
 * any seed where it happened not to matter.
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
const SRC = new URL('../game.html', import.meta.url).pathname;
const GAME = (process.env.GAME_URL || 'file://' + SRC) + '?debug=1';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 820 } });
await page.route('**fonts.googleapis.com**', r => r.abort());
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(GAME, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('crokerFlicks.v2', JSON.stringify({
  v: 2, seenCoach: true, seenTut: true, xp: 9000, money: 900, unlocked: ['Dublin'],
  kit: 'std', kits: ['std'], awards: [], gk: 'gk-std', gks: ['gk-std'],
  ball: 'ball-std', balls: ['ball-std'],
})));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.click('#bQuick');
await page.waitForTimeout(900);
await page.evaluate(() => { for (let i = 0; i < 7; i++) document.getElementById('bCoach').click(); });
/* A player gets five seconds and then the game takes the kick on for them.
   This suite needs to sit on one kick for longer than that and look at it, so
   the clock is held — without pausing, because pausing stops the frame loop
   and the frame loop is where pressure lives. */
await page.evaluate(() => window.CF.holdClock(true));
await page.waitForTimeout(500);

const P = () => page.evaluate(() => window.CF.pressure);
/* The eased value takes about a second to arrive, which is the point of it —
   a stadium that changes character between two frames reads as a bug. */
const settle = (ms = 2200) => page.waitForTimeout(ms);
async function standing(p, c, opt) {
  return page.evaluate(a => window.CF.setStanding(a[0], a[1], a[2]), [p, c, opt || {}]);
}
const G = 'goal', M = 'miss';

console.log('\nTHE FIRST KICK OF FIVE IS JUST A KICK');
await standing([], []);
await settle();
const calm = await P();
ok('no pressure at nil-all with five to go', calm.want === 0, JSON.stringify(calm));
ok('the camera sits at rest', Math.abs(calm.zoom - 1) < 0.001, String(calm.zoom));
ok('the music is at its own level', calm.music === 1, String(calm.music));
const calmCrowd = calm.crowd;

console.log('\nTHE LAST ROUND, ONE SCORE IN IT');
await standing([G, M, G, M], [G, M, G, G]);
await settle();
const tense = await P();
ok('pressure is on', tense.want > 0.5, JSON.stringify(tense));
ok('the camera has pushed in', tense.zoom > 1.02, String(tense.zoom));
ok('the crowd bed is up', tense.crowd > calmCrowd, calmCrowd + ' -> ' + tense.crowd);
ok('the music has thinned out', tense.music < 0.6, String(tense.music));
ok('but it has not been switched off — that reads as a fault',
   tense.music > 0, String(tense.music));

console.log('\nSUDDEN DEATH IS THE TOP OF IT');
await standing([G, G, G, G, G], [G, G, G, G, G], { sudden: true });
await settle();
const death = await P();
ok('pressure is at full', death.want === 1, JSON.stringify(death));
ok('and the eased value has caught up', death.now > 0.9, String(death.now));
ok('the camera is at its closest', death.zoom > tense.zoom,
   tense.zoom + ' -> ' + death.zoom);

console.log('\nAND IT LETS GO AGAIN');
/* A match reset has to put the ground back. Pressure that latches would sit
   over every kick of the next game. */
await standing([], [], { sudden: false });
await settle(3000);
const after = await P();
ok('back to nothing', after.want === 0 && after.now === 0, JSON.stringify(after));
ok('camera back at rest', Math.abs(after.zoom - 1) < 0.001, String(after.zoom));
ok('music back up', after.music === 1, String(after.music));
ok('crowd back down', Math.abs(after.crowd - calmCrowd) < 1e-6,
   calmCrowd + ' -> ' + after.crowd);

console.log('\nTHE CLOCK GOES HOT EARLIER WHEN IT MATTERS');
/* Same fraction of the window left, two different verdicts on it: the bar is
   allowed to shout sooner under pressure, which is a HUD decision and the
   only one pressure gets to make about the kick. */
const hot = await page.evaluate(async () => {
  const read = () => {
    const b = document.getElementById('shotbar');
    return { tight: b.classList.contains('tight'), press: b.classList.contains('press') };
  };
  const at = async (p, c, sudden) => {
    window.CF.setStanding(p, c, { sudden: !!sudden });
    await new Promise(r => setTimeout(r, 2400));
    return read();
  };
  const calm = await at([], [], false);
  const tense = await at(['goal'], ['goal'], true);
  return { calm, tense };
});
ok('an ordinary kick does not wear the pressure clock',
   hot.calm.press === false, JSON.stringify(hot.calm));
ok('a decisive one does', hot.tense.press === true, JSON.stringify(hot.tense));

console.log('\nIT NEVER REACHES THE BALL');
/* The same kick, twice: once at nil-all with five to go and once in sudden
   death. Same seed, same strike, so anything that differs came from pressure
   — and nothing is allowed to. */
const flights = await page.evaluate(async () => {
  const shot = { power: 0.78, aimM: 1.4, curl: 0.2, elev: 0.42 };
  const take = async (p, c, sudden) => {
    window.CF.setStanding(p, c, { sudden: !!sudden });
    await new Promise(r => setTimeout(r, 2400));   // let the ease arrive
    const out = [];
    for (let i = 0; i < 24; i++) {
      out.push(window.CF.simulate({ ...shot, matchSeed: 4242, kickIndex: i, difficulty: "senior", weather: 0 }));
    }
    return out;
  };
  return { calm: await take([], [], false),
           death: await take(['goal', 'goal'], ['goal', 'goal'], true) };
});
const same = JSON.stringify(flights.calm) === JSON.stringify(flights.death);
ok('24 identical kicks land identically under pressure and without it', same,
   same ? '' : JSON.stringify({ calm: flights.calm[0], death: flights.death[0] }));
ok('and they were real flights, not 24 nulls',
   flights.calm.length === 24 && flights.calm.every(f => f && f.outcome),
   JSON.stringify(flights.calm[0]));

console.log('\nNOTHING ON THE OUTCOME PATH EVEN MENTIONS IT');
/* The check above passes on any seed where pressure happens not to matter.
   This one does not: pressure may be read by the camera, the crowd, the
   music, the clock and the vignette, and by nothing else. If a future change
   wires it into the flight, this is what says so. */
const { readFileSync } = await import('node:fs');
const src = readFileSync(SRC, 'utf8').split('\n');
const ALLOWED = [
  /^\s*(const wantP|pressNow \+=|if\(Math\.abs\(wantP|if\(pressNow|crowdHold\(pressNow|musicPress\(pressNow)/,
  /zoomTarget = 1 \+ pressNow\*0\.055;/,
  /function pressure\(\)/,          // its own definition
  /let pressNow = 0;/,
  /function restCam\(\)/,           // the camera
  /zoomTarget = 1 \+ pressure\(\)/,
  /if\(pressure\(\) > 0\.5\) crowdSwell/,   // the crowd
  /bar\.classList\.toggle\('press'/,        // the clock
  /pressNow\*0\.22\)/,
  /untilStrike < 0\.3 \+ pressNow/,
  /if\(pressNow < 0\.02/,                   // the vignette
  /ctx\.globalAlpha = pressNow/,
  /get pressure\(\)/,                       // the debug surface
  /press: pressure\(\)/,
];
const stray = [];
src.forEach((line, i) => {
  if (!/\bpressNow\b|\bpressure\(\)/.test(line)) return;
  if (/^\s*(\*|\/\*|\/\/)/.test(line)) return;               // prose about it
  if (ALLOWED.some(re => re.test(line))) return;
  stray.push((i + 1) + ': ' + line.trim());
});
ok('pressure is read only by the view, the sound and the clock',
   stray.length === 0, stray.join('\n       '));

ok('no runtime errors through any of it', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'PRESSURE: ' + fail + ' FAILED' : 'PRESSURE: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
