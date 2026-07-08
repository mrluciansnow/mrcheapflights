// /sitemap.xml — the URL robots.txt has always advertised. The generator
// lives in sitemap.js (serving /sitemap); this shim makes the canonical
// .xml path work too, so crawlers following robots.txt stop getting 404s.
export { onRequestGet } from './sitemap.js';
