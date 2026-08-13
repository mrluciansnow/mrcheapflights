/* Can anything in the working tree reach the build?
 *
 *   node tests/deploy-root.mjs
 *
 * It could, three times, and the third time through a script that printed a
 * warning saying it had left the offending file behind.
 *
 * The reason is worth stating plainly, because it is not obvious and it cost
 * three failed deploys: **wrangler does not compile the functions/ directory
 * beside the assets you point it at.** It compiles the one beside its config,
 * which is the directory you run it from. `wrangler pages deploy .dist` reads
 * the assets out of .dist and the Functions out of ./functions, and says so
 * in its own error — "Failed to build Functions at ./functions". So a deploy
 * script that carefully stages functions/ into .dist/ is staging them into a
 * directory the Functions build never opens, and a half-finished file sitting
 * untracked in the repo takes the whole site down anyway.
 *
 * The fix is to assemble a complete little project — config, functions,
 * assets — and run wrangler from inside it. This test plants exactly the file
 * that broke production three times and proves it cannot get in.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, '.deploy');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/* the real thing, verbatim: an unfinished website endpoint importing two
   modules from a depth that does not exist */
const JUNK = join(root, 'functions/api/scanner/signal/[id]/[action].js');
const JUNK_DIR = join(root, 'functions/api/scanner');
let planted = false;
try {
  if (!existsSync(JUNK_DIR)) {
    mkdirSync(dirname(JUNK), { recursive: true });
    writeFileSync(JUNK,
      "import { requireAdmin } from '../../../_lib/auth.js';\n" +
      "import { promoteSignal } from '../../../_lib/scanner.js';\n" +
      "export const onRequest = () => new Response('x');\n");
    planted = true;
  }

  console.log('\nA HALF-FINISHED FILE IN THE WORKING TREE');
  ok('the fixture is there and git can see it is untracked', existsSync(JUNK) &&
     execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'functions'],
                  { cwd: root, encoding: 'utf8' }).includes('scanner'));

  /* spawnSync, not execFileSync: the warning about what was left behind is a
     console.warn, and execFileSync hands back stdout only */
  const run = spawnSync(process.execPath, ['scripts/deploy.mjs', '--stage-only'],
                        { cwd: root, encoding: 'utf8' });
  const out = (run.stdout || '') + (run.stderr || '');
  ok('the deploy stages without touching it', /Staged only/.test(out), out.slice(-200));
  ok('and says out loud that it left it behind', /left behind/.test(out));

  console.log('\nAND IT IS NOT IN THE BUILD');
  ok('no scanner file anywhere in the deploy root',
     !existsSync(join(build, 'functions/api/scanner')));
  /* the whole point: this is the directory wrangler will compile */
  const staged = execFileSync('find', [join(build, 'functions'), '-name', '*.js'],
                              { encoding: 'utf8' }).trim().split('\n');
  ok('the staged functions are all tracked files', staged.every(f => {
    const rel = f.slice(build.length + 1);
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel],
                   { cwd: root, stdio: 'ignore' });
      return true;
    } catch { return false; }
  }), staged.length + ' files');

  console.log('\nTHE BUILD ROOT IS A COMPLETE PROJECT');
  ok('functions sit BESIDE the assets, not inside them',
     existsSync(join(build, 'functions')) && !existsSync(join(build, 'public/functions')));
  ok('there is a config for wrangler to read',
     existsSync(join(build, 'wrangler.toml')));
  const cfg = readFileSync(join(build, 'wrangler.toml'), 'utf8');
  ok('pointed at the assets directory',
     /pages_build_output_dir\s*=\s*"public"/.test(cfg), cfg.split('\n')[3]);
  ok('and it still carries the bindings the site needs',
     /d1_databases/.test(cfg) && /nodejs_compat/.test(cfg));

  console.log('\nNOTHING PRIVATE IS SERVED');
  for (const f of ['.dev.vars', 'wrangler.toml', 'package.json', 'functions', 'node_modules'])
    ok('public/ has no ' + f, !existsSync(join(build, 'public', f)));
  ok('but it does have the game', existsSync(join(build, 'public/game.html')));
} finally {
  if (planted) rmSync(JUNK_DIR, { recursive: true, force: true });
}

console.log('\n' + (fail ? 'DEPLOY ROOT: ' + fail + ' FAILED'
                         : 'DEPLOY ROOT: ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
