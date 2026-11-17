#!/usr/bin/env node
// Checks that the columns the console asks the database for are columns the migrations create.
//
// Run with:  npm run check:schema
//
// The console runs against a schema that is pasted into the SQL Editor by hand, so the code and the
// database can disagree: a page selecting a column that is not there fails at runtime with a PostgREST
// error, and — after this branch's fallback — can look like a degraded banner rather than a bug. This
// compares the two offline: tables and their columns are read from supabase/migrations, and every
// `.from('table').select('a, b')` in lib/ and app/ is checked against them. `.rpc('name')` is checked
// against the functions the migrations define.
//
// What it does not check: writes. An `insert({...})` or `update({...})` object is not judged here, nor
// are select strings that are built at runtime, embed another table (`buyers(name)`), rename a column
// (`alias:column`) or read a JSON path. Those are skipped rather than guessed at, so this is a check
// against the commonest drift, not a schema type system.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const NOT_A_COLUMN = new Set([
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
  'exclude',
  'like',
]);

const tables = new Map();
const functions = new Set();

for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
  const lines = readFileSync(join(MIGRATIONS, file), 'utf8').split('\n');
  let current = null;
  let altering = null;
  for (const line of lines) {
    const table = line.match(/^create table if not exists public\.([a-z_][a-z0-9_]*)\s*\(/i);
    if (table) {
      current = table[1];
      tables.set(current, new Set());
      continue;
    }
    if (current) {
      if (/^\s*\)\s*;/.test(line)) {
        current = null;
        continue;
      }
      const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (column && !NOT_A_COLUMN.has(column[1].toLowerCase())) tables.get(current).add(column[1]);
      continue;
    }
    // A column added later is usually one statement spread over several lines, with one clause each.
    const alter = line.match(/^alter table public\.([a-z_][a-z0-9_]*)/i);
    if (alter) {
      altering = alter[1];
      if (!tables.has(altering)) tables.set(altering, new Set());
    }
    if (altering) {
      const add = line.match(/add column if not exists\s+([a-z_][a-z0-9_]*)/i);
      if (add) tables.get(altering).add(add[1]);
      if (/;\s*$/.test(line)) altering = null;
      continue;
    }
    const fn = line.match(/^create or replace function public\.([a-z_][a-z0-9_]*)\s*\(/i);
    if (fn) functions.add(fn[1]);
  }
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(?:ts|tsx)$/.test(name) ? [full] : [];
  });

const FROM_SELECT = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)\s*\.select\(\s*['"]([^'"]*)['"]/g;
const RPC = /\.rpc\(\s*['"]([a-z_][a-z0-9_]*)['"]/g;

const findings = [];
const unknownTables = new Set();
let selects = 0;

const lineAt = (source, index) => source.slice(0, index).split('\n').length;

for (const dir of ['lib', 'app']) {
  for (const full of walk(join(ROOT, dir))) {
    const file = relative(ROOT, full).split('\\').join('/');
    const source = readFileSync(full, 'utf8');

    for (const match of source.matchAll(FROM_SELECT)) {
      const [whole, table, columns] = match;
      const line = lineAt(source, match.index);
      const known = tables.get(table);
      if (!known) {
        unknownTables.add(table);
        continue;
      }
      selects += 1;
      // A nested relation — buyers(name) — names another table's columns, so it is taken out whole
      // before the list is split; aliases, wildcards and JSON paths simply fail the plain-name test.
      const plain = columns.replace(/[a-z_][a-z0-9_]*\s*\([^()]*\)/gi, ' ');
      for (const entry of plain.split(',')) {
        const column = entry.trim();
        if (!/^[a-z_][a-z0-9_]*$/i.test(column)) continue;
        if (!known.has(column)) {
          findings.push({
            file,
            line,
            what: `${table}.${column} is selected but not created by the migrations`,
            source: whole.replace(/\s+/g, ' ').slice(0, 120),
          });
        }
      }
    }

    for (const match of source.matchAll(RPC)) {
      const name = match[1];
      if (!functions.has(name)) {
        findings.push({
          file,
          line: lineAt(source, match.index),
          what: `rpc('${name}') is called but no migration creates that function`,
          source: match[0],
        });
      }
    }
  }
}

if (findings.length === 0) {
  const skipped = unknownTables.size
    ? ` (${unknownTables.size} other table${unknownTables.size === 1 ? '' : 's'} not in the migrations, skipped)`
    : '';
  console.log(
    `Every selected column exists in the migrations (${selects} selects over ${tables.size} tables${skipped}).`,
  );
  process.exit(0);
}

console.error(`The code asks for ${findings.length} column${findings.length === 1 ? '' : 's'} the migrations do not create:\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.what}`);
  console.error(`      ${finding.source}`);
}
console.error('\nA column added to a page but not to a migration fails at runtime, and after the schema');
console.error('fallback it can look like a degraded database rather than a missing column. Add the');
console.error('migration (and record it with npm run migrations:record), or fix the select.');
process.exit(1);
