#!/usr/bin/env node
// Every internal link and asset in the built site resolves to a file in the build.
//
// Run with:  npm run check:links        (after npm run build; defaults to _site)
//
// deploy-site proves the pages named in sitemap.xml exist, and that they answer once live — but both of
// those run after the upload, so a link to a page that was renamed ships first and 404s in front of a
// reader. This reads the built HTML instead, so a broken link fails in the workflow's first minute
// rather than on dataleasers.com.
//
// The templates link each other relatively (`about.html`, `fonts/inter-latin.woff2`), so a link is
// resolved against the page it appears on, with `/path` treated as the site root. Not checked: off-site
// links (there is no network here), in-page #anchors (a heading id is not a file), and anything a script
// builds at runtime.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, process.argv[2] ?? '_site');

if (!existsSync(SITE)) {
  console.error(`${relative(ROOT, SITE)} does not exist. Build the site first: npm run build.`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const ATTRIBUTE = /(?:href|src)="([^"]*)"/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

// A path resolves to the file the host would serve: the file itself, the .html for an extensionless
// page, or the directory's index.
const candidates = (base, path) => {
  const clean = path.split('#')[0].split('?')[0];
  if (!clean) return [];
  const target = clean.startsWith('/') ? join(SITE, clean) : resolve(base, clean);
  if (!target.startsWith(SITE + sep) && target !== SITE) return [];
  if (clean.endsWith('/') || target === SITE) return [join(target, 'index.html')];
  return [target, `${target}.html`, join(target, 'index.html')];
};

const pages = walk(SITE).filter((file) => file.endsWith('.html'));
const broken = [];
let checked = 0;

for (const page of pages) {
  const base = dirname(page);
  for (const match of readFileSync(page, 'utf8').matchAll(ATTRIBUTE)) {
    const href = match[1].trim();
    if (!href || EXTERNAL.test(href)) continue;
    const options = candidates(base, href);
    if (options.length === 0) continue;
    checked++;
    if (!options.some((option) => existsSync(option))) {
      broken.push({ page: relative(SITE, page), href });
    }
  }
}

if (broken.length === 0) {
  console.log(`Every internal link in the build resolves (${checked} links over ${pages.length} pages).`);
  process.exit(0);
}

console.error(`${broken.length} internal link${broken.length === 1 ? '' : 's'} point at nothing:\n`);
for (const { page, href } of broken) console.error(`  ${page.padEnd(28)} ${href}`);
console.error('\nEither the page or asset was renamed, or the link is new and its target was never built.');
process.exit(1);
