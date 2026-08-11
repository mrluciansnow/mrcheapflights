/* Where the wrangler CLI actually is — on Windows as well as everywhere else.
 *
 * `execFileSync('npx', …)` fails with ENOENT on Windows. On that platform the
 * thing on PATH is `npx.cmd`, and since Node 20.12 a .cmd file cannot be
 * spawned without a shell (spawning them silently was CVE-2024-27980). Asking
 * for a shell instead would mean every argument — including SQL statements
 * full of quotes and parentheses — surviving cmd.exe's quoting rules, which is
 * a worse problem than the one it solves.
 *
 * wrangler is a devDependency, so `npm ci` has already put the CLI on disk.
 * Run it with the Node that is running this script: no PATH lookup, no shell,
 * no quoting, and the pinned version rather than whatever npx decides to
 * fetch.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

let cached = null;

/** Absolute path to wrangler's CLI entry script. Exits with advice if absent. */
export function wranglerBin() {
  if (cached) return cached;
  /* wrangler's package `exports` does not publish bin/, so resolve the
     manifest — which is always exported — and walk from there. */
  let bin = null;
  try {
    bin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
               'bin', 'wrangler.js');
  } catch { /* not installed under this module's node_modules */ }

  if (!bin || !existsSync(bin)) {
    console.error('wrangler is not installed in this checkout.');
    console.error('Run:  npm ci');
    process.exit(1);
  }
  return (cached = bin);
}

/** argv for execFileSync(process.execPath, …) — `wrangler(['d1','execute',…])`. */
export const wranglerArgv = (args) => [wranglerBin(), ...args];
