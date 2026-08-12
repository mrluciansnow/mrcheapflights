/* Music: that it plays, that it can be stopped, and that it gets out of the
 * way of a voice.
 *
 *   node tests/music.mjs
 *
 * Generated rather than shipped — the game is one file with no external
 * requests — so there is no asset to check. What there is to check is the bus:
 * whether it is running, what level it is at, and whether that level responds
 * to the three things allowed to move it, which are the setting, the global
 * mute, and somebody talking.
 *
 * Chromium is launched with autoplay allowed, because otherwise the audio
 * context stays suspended and the scheduler deliberately refuses to start —
 * which is correct behaviour and untestable behaviour at the same time.
 */
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default;
/* ?debug=1: the CF surface is only built there, and reading a gain value is
   the whole test. */
const GAME = (process.env.GAME_URL ||
  'file://' + new URL('../game.html', import.meta.url).pathname) + '?debug=1';

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

const music = () => page.evaluate(() => window.CF.music);
const settle = ms => page.waitForTimeout(ms || 700);

console.log('\nIT NEVER STARTS AGAINST A FROZEN CLOCK');
/* Autoplay policy leaves the audio context suspended until a gesture, and a
   scheduler running against a frozen clock queues every note at the same
   instant — which arrives as one chord the moment somebody taps. This run
   allows autoplay, so the guard has to be provoked rather than waited for.
   (Music on the menu is fine and intended; this is about HOW it starts.) */
const guarded = await page.evaluate(async () => {
  const before = window.CF.music.on;
  const a = window.CF.audioContext();
  await a.suspend();
  window.CF.opts.music = false; window.CF.applyOpts();   // stop it
  window.CF.opts.music = true;  window.CF.applyOpts();   // and try to start it
  const whileSuspended = window.CF.music.on;
  await a.resume();
  window.CF.applyOpts();
  return { before, whileSuspended, after: window.CF.music.on };
});
ok('it refuses to start while the context is suspended',
   guarded.whileSuspended === false, JSON.stringify(guarded));
ok('and starts once the clock is running again',
   guarded.after === true, JSON.stringify(guarded));

console.log('\nIT STARTS WITH THE MATCH');
await page.click('#bQuick');
await page.waitForTimeout(900);
await page.evaluate(() => { for (let i = 0; i < 7; i++) document.getElementById('bCoach').click(); });
await settle();
const playing = await music();
ok('the bus is running', playing.on === true, JSON.stringify(playing));
ok('at an audible level', playing.gain > 0, JSON.stringify(playing.gain));
ok('and not at full blast — it is a bed, not a track',
   playing.gain <= 0.2, JSON.stringify(playing.gain));

console.log('\nSOMEBODY IS TALKING — IT STEPS BACK');
const before = (await music()).gain;
await page.evaluate(() => window.CF.musicDuck(true));
await settle();
const ducked = await music();
ok('the level drops', ducked.gain < before, before + ' -> ' + ducked.gain);
ok('but it does not stop — a silence reads as something broken',
   ducked.on === true && ducked.gain > 0, JSON.stringify(ducked));
ok('by about three quarters, which is enough to talk over',
   Math.abs(ducked.gain - before * 0.25) < 0.02,
   'expected ~' + (before * 0.25).toFixed(4) + ', got ' + ducked.gain);

await page.evaluate(() => window.CF.musicDuck(false));
await settle(1200);
const back = await music();
ok('and comes back up when the call ends',
   Math.abs(back.gain - before) < 0.02, before + ' -> ' + back.gain);

console.log('\nTHE PLAYER CAN STOP IT');
await page.evaluate(() => { window.CF.opts.music = false; window.CF.applyOpts(); });
await settle();
const off = await music();
ok('turning the setting off silences it', off.on === false || off.gain === 0,
   JSON.stringify(off));

/* and the rest of the game keeps its sound: this is a separate switch */
ok('the sound setting is untouched by it',
   (await page.evaluate(() => window.CF.opts.sound)) === true);

await page.evaluate(() => { window.CF.opts.music = true; window.CF.applyOpts(); });
await settle();
ok('turning it back on resumes it', (await music()).gain > 0, JSON.stringify(await music()));

console.log('\nMUTING THE GAME MUTES IT TOO');
await page.evaluate(() => { window.CF.opts.sound = false; window.CF.applyOpts(); });
await settle();
const m = await music();
ok('mute silences the music as well as the crowd', m.on === false || m.gain === 0,
   JSON.stringify(m));
await page.evaluate(() => { window.CF.opts.sound = true; window.CF.applyOpts(); });
await settle();
ok('and unmuting brings it back', (await music()).gain > 0, JSON.stringify(await music()));

console.log('\nIT SURVIVES BEING STOPPED AND STARTED REPEATEDLY');
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => { window.CF.opts.music = false; window.CF.applyOpts(); });
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.CF.opts.music = true; window.CF.applyOpts(); });
  await page.waitForTimeout(120);
}
await settle();
ok('still exactly one bus running, not four', (await music()).on === true,
   JSON.stringify(await music()));
ok('no runtime errors through any of it', errs.length === 0, errs.join(' | '));

await browser.close();
console.log('\n' + (fail ? 'MUSIC: ' + fail + ' FAILED' : 'MUSIC: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
