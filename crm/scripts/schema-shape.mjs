// Reads the tables, columns and functions the migrations create.
//
// Both check:schema and check:writes start from this, so a new way of writing a migration has to be
// understood in one place rather than two that can disagree. It is a line-oriented reader, not a SQL
// parser: it knows the two shapes these migrations use — `create table if not exists public.x (` with
// one column per line, and `add column if not exists y` under an `alter table public.x` — and it will
// not guess at anything else.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NOT_A_COLUMN = new Set([
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
  'exclude',
  'like',
]);

export function readSchema(migrationsDir) {
  const tables = new Map();
  const functions = new Set();

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
    const lines = readFileSync(join(migrationsDir, file), 'utf8').split('\n');
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

  return { tables, functions };
}
