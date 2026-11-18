#!/usr/bin/env node
// Every form control needs a name a screen reader can read out.
//
// Run with:  npm run check:forms
//
// A field wrapped in <label> is announced with the label's text. One that is not needs its own
// aria-label, and this branch's field passes rewrote most forms, which is exactly when a control
// loses the label it was visually sitting next to. The scan is textual but it reads tags properly:
// a tag ends at the first > outside braces and quotes, so a defaultValue expression containing an
// angle bracket does not end it early.
//
// What it does not check: whether the label's words describe the field, a <label> that wraps the
// wrong control, or the order controls are announced in. A hidden input is exempt, because it has no
// appearance and nothing to announce.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });

const TAG = /<(input|select|textarea)\b/g;

// The whole tag: from `<` to the first `>` that is not inside braces, quotes or a template literal.
const tagAt = (source, start) => {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start, Math.min(source.length, start + 400));
};

const lastIndexOfBefore = (source, needle, end) => source.lastIndexOf(needle, end);

const unlabelled = [];
let controls = 0;

for (const dir of ['app', 'components']) {
  let files;
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue;
  }

  for (const full of files) {
    const file = relative(ROOT, full).split('\\').join('/');
    const source = readFileSync(full, 'utf8');

    for (const match of source.matchAll(TAG)) {
      controls += 1;
      const tag = tagAt(source, match.index);

      if (/aria-label\s*=/.test(tag) || /aria-labelledby\s*=/.test(tag)) continue;
      if (/type\s*=\s*["']hidden["']/.test(tag)) continue;

      // A control inside <label>...</label> takes the label's text. The nearest tag before it decides:
      // an opening label means it is inside one, a closing label means the last one had already ended.
      const openLabel = lastIndexOfBefore(source, '<label', match.index);
      const closeLabel = lastIndexOfBefore(source, '</label', match.index);
      if (openLabel > closeLabel) continue;

      // The other correct shape: a separate label pointing at the control's id.
      const id = tag.match(/\bid\s*=\s*["']([^"']+)["']/);
      if (id && source.includes(`htmlFor="${id[1]}"`)) continue;

      const line = source.slice(0, match.index).split('\n').length;
      unlabelled.push({
        file,
        line,
        snippet: tag.replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  }
}

if (controls === 0) {
  console.error('No form controls were found. this check is scanning', ['app', 'components'].join(' and '));
  console.error('for .tsx files; if the forms moved, it has stopped guarding anything.');
  process.exit(1);
}

if (unlabelled.length === 0) {
  console.log(`Every form control carries a label (${controls} controls).`);
  process.exit(0);
}

console.error(`${unlabelled.length} form control${unlabelled.length === 1 ? ' has' : 's have'} no label:\n`);
for (const item of unlabelled) console.error(`  ${item.file}:${item.line}  ${item.snippet}`);
console.error('\nWrap the control in <label> with its words, or give it an aria-label. A field with a');
console.error('placeholder and nothing else is silent to a screen reader, and the placeholder');
console.error('disappears the moment someone types.');
process.exit(1);
