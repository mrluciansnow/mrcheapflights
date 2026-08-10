/* Turns game.html into a page the Artifact host can serve.
 *
 *   node tools/build-artifact.mjs
 *   -> croker-flicks.artifact.html
 *
 * Two things have to change:
 *
 *   1. The host wraps whatever it is given in its own <!doctype><head><body>,
 *      so a complete document nests one inside another and renders nothing.
 *      Everything from <head> that still matters is hoisted, and the document
 *      furniture is dropped.
 *
 *   2. A strict CSP blocks every external host, which includes the Google
 *      Fonts stylesheet the real page links. Rather than let the typography
 *      fall back to system sans — the whole thing is set in Bebas Neue — the
 *      two latin woff2 subsets are inlined as data URIs. Both faces are SIL
 *      Open Font License, which permits embedding.
 *
 * The fonts are cached in tools/fonts/ so a rebuild works offline. Delete
 * that directory to re-fetch.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const CACHE = here + 'fonts/';
const GOOGLE = 'https://fonts.googleapis.com/css2?family=Bebas+Neue' +
               '&family=Nunito:wght@400;700;800;900&display=swap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120 Safari/537.36';

/* the latin subset of each face, as an @font-face with the binary inlined */
async function fontFaces(){
  if(!existsSync(CACHE)) mkdirSync(CACHE, {recursive:true});
  const cssPath = CACHE + 'fonts.css';
  let css;
  if(existsSync(cssPath)) css = readFileSync(cssPath, 'utf8');
  else {
    css = await (await fetch(GOOGLE, {headers:{'User-Agent':UA}})).text();
    writeFileSync(cssPath, css);
  }
  const blocks = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(m => m[0])
    .filter(b => /unicode-range:[^;]*U\+0000-00FF/.test(b));
  if(!blocks.length) throw new Error('no latin subsets found in the font CSS');

  const out = [];
  for(const b of blocks){
    const url = (b.match(/url\((https:[^)]+)\)/) || [])[1];
    if(!url) continue;
    const name = url.split('/').pop();
    const file = CACHE + name;
    let buf;
    if(existsSync(file)) buf = readFileSync(file);
    else {
      buf = Buffer.from(await (await fetch(url, {headers:{'User-Agent':UA}})).arrayBuffer());
      writeFileSync(file, buf);
    }
    out.push(b.replace(/src:\s*url\([^)]+\)\s*format\('woff2'\)/,
      "src: url(data:font/woff2;base64," + buf.toString('base64') + ") format('woff2')"));
  }
  return out.join('\n');
}

const src = readFileSync(here + '../game.html', 'utf8');

const grab = (re, what) => {
  const m = src.match(re);
  if(!m) throw new Error('could not find ' + what + ' in game.html');
  return m[1];
};

const title  = grab(/<title>([\s\S]*?)<\/title>/, 'the title');
const style  = grab(/<style>([\s\S]*?)<\/style>/, 'the stylesheet');
// everything the document actually renders, and both script blocks with it
const body   = grab(/<body>([\s\S]*?)<\/body>/, 'the body');

const page =
`<title>${title}</title>
<style>
/* fonts inlined: the Artifact host blocks every external request, and this
   page is set in Bebas Neue from the scoreboard down */
${await fontFaces()}
${style}
</style>
${body.trim()}
`;

const outPath = here + '../croker-flicks.artifact.html';
writeFileSync(outPath, page);

const kb = n => (n/1024).toFixed(0) + 'KB';
console.log('wrote croker-flicks.artifact.html  ' + kb(page.length) +
            '  (from ' + kb(src.length) + ' of game.html)');
if(/<!DOCTYPE|<html|<head|<body/i.test(page))
  throw new Error('document furniture survived into the artifact build');
console.log('no doctype/html/head/body in the output — safe for the host');
