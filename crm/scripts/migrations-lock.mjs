#!/usr/bin/env node
// Records a fingerprint of every migration file, so a file that has already been applied cannot be
// edited afterwards without the check saying so.
//
// Run with:  npm run check:migrations      (verifies; part of npm run check)
//            npm run migrations:record    (records newly added files)
//
// The series is applied by hand in the Supabase SQL Editor, once each, in order. That makes the files
// effectively immutable: production has already run them, so editing one changes the schema a fresh
// database would get while changing nothing on the live one — the app and the database drift apart
// silently. supabase/migrations.lock.json holds the sha256 of each file as it was when it went in; this
// check fails if a recorded file's contents move, and tells you to add a new numbered file instead.
//
// --record only ever *adds* files. It refuses to update a fingerprint that is already there, so
// recording cannot be used to bless an edit made after the fact.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'supabase', 'migrations');
const LOCK = resolve(HERE, '..', 'supabase', 'migrations.lock.json');
const LOCK_NOTE =
  'sha256 of each migration as it was recorded, so an applied file cannot be edited afterwards. Record new files with `npm run migrations:record`; see scripts/migrations-lock.mjs.';

const files = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
const fingerprint = (name) =>
  createHash('sha256').update(readFileSync(join(MIGRATIONS, name))).digest('hex');

if (files.length === 0) {
  console.error(`No numbered migrations found in ${MIGRATIONS}.`);
  process.exit(1);
}

const recorded = existsSync(LOCK)
  ? JSON.parse(readFileSync(LOCK, 'utf8')).files ?? {}
  : {};
const present = new Set(files);

if (process.argv.includes('--record')) {
  const changed = files.filter((name) => name in recorded && recorded[name] !== fingerprint(name));
  if (changed.length > 0) {
    console.error('These files are already recorded and have since changed:\n');
    for (const name of changed) console.error(`  ${name}`);
    console.error('\nA recorded migration has been applied by hand on the real project, so editing it');
    console.error('changes what a fresh database gets without changing the live one. Put the change in a');
    console.error('new numbered file; if this one was never applied anywhere, delete its entry from');
    console.error('supabase/migrations.lock.json by hand and record it again.');
    process.exit(1);
  }

  const added = files.filter((name) => !(name in recorded));
  if (added.length === 0) {
    console.log(`Nothing new to record; ${files.length} migrations are already in the lock file.`);
    process.exit(0);
  }
  const next = { ...recorded };
  for (const name of added) next[name] = fingerprint(name);
  const entries = Object.fromEntries(Object.keys(next).sort().map((key) => [key, next[key]]));
  writeFileSync(LOCK, `${JSON.stringify({ note: LOCK_NOTE, files: entries }, null, 2)}\n`);
  for (const name of added) console.log(`  recorded ${name}`);
  console.log(`\nRecorded ${added.length} new file${added.length === 1 ? '' : 's'}. Commit supabase/migrations.lock.json.`);
  process.exit(0);
}

const changed = files.filter((name) => name in recorded && recorded[name] !== fingerprint(name));
const missing = files.filter((name) => !(name in recorded));
const gone = Object.keys(recorded).filter((name) => !present.has(name));

if (changed.length === 0 && missing.length === 0 && gone.length === 0) {
  console.log(`All ${files.length} recorded migrations are unchanged.`);
  process.exit(0);
}

console.error('The migration series and its record disagree:\n');
for (const name of changed) {
  console.error(`  ${name}: recorded, but the file has changed since`);
}
for (const name of missing) {
  console.error(`  ${name}: not recorded yet`);
}
for (const name of gone) {
  console.error(`  ${name}: recorded, but the file is gone`);
}
console.error('\nA migration that has been applied by hand is finished: further changes go in a new numbered');
console.error('file. Add files with `npm run migrations:record`, which only records ones that are new.');
process.exit(1);
