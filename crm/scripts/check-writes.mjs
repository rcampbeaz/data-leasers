#!/usr/bin/env node
// Checks that the columns the console writes are columns the migrations create.
//
// Run with:  npm run check:writes
//
// check:schema compares reads (`.select`) with the migrations; writes were left to the database to
// refuse. That is a late place to find out: an `insert({...})` naming a column that a migration has
// not created fails at runtime, on the screen the person was using, and a payload that has quietly
// stopped carrying a field looks like a save that worked. This reads every `.from('table').insert(
// {...})`, `.update({...})` and `.upsert({...})` in lib/, app/ and scripts/ and checks each key in the
// object against the columns the migrations create.
//
// What it can see: object literals written in place, including shorthand (`{ status }`), quoted keys
// and an array of rows (`insert([{...}])`). What it cannot: an object built elsewhere and passed by
// name (`.update(patch)`), a spread inside the object, or a computed key. Those are counted and
// reported as skipped rather than silently passed, so the number that was checked is always visible.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSchema } from './schema-shape.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const { tables } = readSchema(join(ROOT, 'supabase', 'migrations'));

// The check scripts are skipped: they contain these shapes in their own comments and harnesses, and
// describing a payload is not writing one. scripts/seed.mjs is not a check and is scanned.
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next' || name.startsWith('check-')) return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(?:ts|tsx|mjs)$/.test(name) ? [full] : [];
  });

const FROM_WRITE =
  /\.from\(\s*(['"])([a-z_][a-z0-9_]*)\1\s*\)\s*\.\s*(insert|update|upsert)\s*\(/g;

const lineAt = (source, index) => source.slice(0, index).split('\n').length;

// The text between a brace and its match, or null if it never closes. Quotes are followed so a brace
// or a comma inside a string is not counted; within a template literal everything is a string.
// Comments are skipped for the same reason: this codebase explains a field between its neighbours,
// and a comma in that sentence would otherwise end a member.
function balanced(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// The members of an object literal, split on the commas that sit outside any nested value.
function members(objectText) {
  const inner = objectText.slice(1, -1);
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && inner[i + 1] === '/') {
      const eol = inner.indexOf('\n', i);
      i = eol === -1 ? inner.length : eol;
      continue;
    }
    if (ch === '/' && inner[i + 1] === '*') {
      const close = inner.indexOf('*/', i + 2);
      i = close === -1 ? inner.length : close + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

// A leading comment belongs to the member, not to its key: `// why\n created_at: at` is a key.
const stripLeadingComments = (text) =>
  text.replace(/^(?:\s*\/\/[^\n]*(?:\n|$)|\s*\/\*[\s\S]*?\*\/)*/, '').trim();

const findings = [];
const unknownTables = new Set();
let writes = 0;
let skipped = 0;
const skippedSites = [];

for (const dir of ['lib', 'app', 'scripts']) {
  for (const full of walk(join(ROOT, dir))) {
    const file = relative(ROOT, full).split('\\').join('/');
    const source = readFileSync(full, 'utf8');

    for (const match of source.matchAll(FROM_WRITE)) {
      const [whole, , table, method] = match;
      const line = lineAt(source, match.index);
      const after = match.index + whole.length;
      const rest = source.slice(after);
      const lead = rest.match(/^\s*/)[0].length;
      const cursor = after + lead;
      const first = source[cursor];

      // insert([{...}]) writes the first row's shape; an object lifted into a variable is not readable
      // here, and pretending otherwise would report nothing while proving nothing.
      const open = first === '{' ? cursor : first === '[' ? source.indexOf('{', cursor) : -1;
      const objectText = open === -1 ? null : balanced(source, open);
      if (!objectText || (first === '[' && objectText === null)) {
        skipped += 1;
        skippedSites.push(`${file}:${line}  ${table} ${method}: payload built elsewhere`);
        continue;
      }

      const known = tables.get(table);
      if (!known) {
        unknownTables.add(table);
        findings.push({
          file,
          line,
          what: `an ${method} targets ${table}, which no migration creates`,
          source: whole.replace(/\s+/g, ' ').slice(0, 120),
        });
        continue;
      }
      writes += 1;

      for (const raw of members(objectText)) {
        const member = stripLeadingComments(raw);
        if (!member) continue;
        // A spread or a computed key cannot be resolved without running the code.
        if (member.startsWith('...') || member.startsWith('[')) {
          skipped += 1;
          skippedSites.push(`${file}:${line}  ${table}.${member.replace(/\s+/g, ' ').slice(0, 60)}`);
          continue;
        }
        const keyed = member.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:/);
        const shorthand = member.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*$/);
        const key = keyed ? keyed[1] ?? keyed[2] ?? keyed[3] : shorthand ? shorthand[1] : null;
        if (!key || !/^[a-z_][a-z0-9_]*$/.test(key)) {
          skipped += 1;
          skippedSites.push(`${file}:${line}  ${table}: ${member.replace(/\s+/g, ' ').slice(0, 60)}`);
          continue;
        }
        if (!known.has(key)) {
          findings.push({
            file,
            line,
            what: `${table}.${key} is written but not created by the migrations`,
            source: member.replace(/\s+/g, ' ').slice(0, 120),
          });
        }
      }
    }
  }
}

// VERBOSE_WRITES=1 lists what could not be read, so the skipped count can be audited.
if (process.env.VERBOSE_WRITES === '1') {
  for (const site of skippedSites) console.log(`  skipped  ${site}`);
}

if (findings.length === 0) {
  const unknown = unknownTables.size
    ? ` (${unknownTables.size} table${unknownTables.size === 1 ? '' : 's'} not in the migrations)`
    : '';
  const unread = skipped ? `, ${skipped} name${skipped === 1 ? '' : 's'} skipped as unreadable` : '';
  console.log(
    `Every written column exists in the migrations (${writes} inserts, updates and upserts over ${tables.size} tables${unread}${unknown}).`,
  );
  process.exit(0);
}

console.error(
  `check:writes found ${findings.length} name${findings.length === 1 ? '' : 's'} the migrations do not create:\n`,
);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.what}`);
  console.error(`      ${finding.source}`);
}
console.error('\nA write naming a column the migrations do not create fails in the screen the person is');
console.error('using, not at deploy. Add the migration (and record it with npm run migrations:record),');
console.error('or fix the write. check:schema covers the same ground for reads.');
process.exit(1);
