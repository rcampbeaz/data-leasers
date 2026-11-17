#!/usr/bin/env node
// Guards the console's clock in lib/ and app/, the way check:migrations guards it in the SQL.
//
// Run with:  npm run check:dates
//
// Two things are refused, because both were real bugs here:
//
//   1. A day built from UTC — `new Date().toISOString().slice(0, 10)`, a `split('T')[0]`, or
//      `getUTCDate()`. That gives yesterday's or tomorrow's day depending on the hour, and after 5pm
//      Phoenix it is tomorrow. lib/time.ts is where an instant may become a day, and lib/deals.ts does
//      deliberate UTC arithmetic on ISO day strings (adding months, adding days); every other day comes
//      from phoenixDay.
//   2. A month or a year taken from UTC — getUTCFullYear, getUTCMonth. A month key built that way names
//      next month during the last seven hours of a month, and a year is off on 1 January.
//   3. A date-only column rendered raw. A stored day is a calendar date with no zone, so it is shown
//      with calendarDate and never as an ISO string. The column names are read from the migrations, so
//      a date column added there is covered without touching this file. An <input type="date"> is
//      exempt, because that control's value is YYYY-MM-DD by definition.
//
// A month or a year taken from UTC is refused for the same reason one level up: a month key built from
// UTC names the next month during the last seven hours of a month, which is enough to put a row in the
// wrong bucket on a chart or to age a company by a year. phoenixMonth and phoenixYear answer those, and
// a stored calendar date's year comes from calendarYear, which reads the value rather than converting it.
//
// This is a scan, not an analysis: it matches the shapes the code actually uses, so a day assembled
// across several statements can slip past it. A timestamptz is an instant and belongs in UTC; this
// says nothing about those.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// Where an instant may become a day, with the reason. Everything else goes through lib/time.ts.
const UTC_DAY_ALLOWED = {
  'lib/time.ts': 'phoenixDay is the one place an instant becomes a day',
  'lib/deals.ts': 'addMonths and addDays do calendar arithmetic on ISO day strings',
};

const HELPERS = /calendarDate|calendarMonth|phoenix|daysUntil|daysLeft/;

const findings = [];
const report = (file, line, rule, source) =>
  findings.push({ file, line, rule, source: source.trim().slice(0, 120) });

// Every `name date` column in the schema, so a new one is guarded without editing this script.
const dateColumns = new Set();
for (const file of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
  for (const line of readFileSync(join(MIGRATIONS, file), 'utf8').split('\n')) {
    // `due_on date` in a create table, and `add column if not exists next_action_due date`.
    const match = line.trim().match(/^(?:add column if not exists\s+)?([a-z_]+)\s+date\b/);
    if (match) dateColumns.add(match[1]);
  }
}
const columns = [...dateColumns].join('|');

const GMEMBER = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;
const UTC_DAY = /\.toISOString\(\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|\.toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]/;
const UTC_DAY_FIELD = /\bgetUTC(?:Date|Day)\s*\(/;
const UTC_CALENDAR = /\bgetUTC(?:FullYear|Month)\s*\(/;
const LOCALE = /\.toLocale(?:Date|Time)?String\s*\(/;
const RENDER_MEMBER = new RegExp(String.raw`^(${GMEMBER})\.(${columns})$`);
const RENDER_NULLISH = new RegExp(String.raw`(${GMEMBER})\.(${columns})\s*\?\?`);

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(?:ts|tsx)$/.test(name) ? [full] : [];
  });

// One-line JSX interpolations and template placeholders are enough to see a raw value; anything longer
// is an expression this scan does not try to judge.
const INTERPOLATION = /\{([^{}\n]*)\}|\$\{([^{}\n]*)\}/g;

for (const dir of ['lib', 'app']) {
  for (const full of walk(join(ROOT, dir))) {
    const file = relative(ROOT, full).split('\\').join('/');
    const source = readFileSync(full, 'utf8');

    source.split('\n').forEach((line, index) => {
      const at = index + 1;
      const allowed = file in UTC_DAY_ALLOWED;

      if (UTC_DAY.test(line) && !allowed) {
        report(file, at, 'a day built from UTC', line);
      }
      if (UTC_DAY_FIELD.test(line) && !allowed) {
        report(file, at, 'a day field read from UTC', line);
      }
      if (UTC_CALENDAR.test(line) && !allowed) {
        report(file, at, 'a month or year taken from UTC', line);
      }
      if (LOCALE.test(line) && file !== 'lib/time.ts') {
        report(file, at, 'locale formatting outside the helper', line);
      }

      // An <input type="date"> takes and returns YYYY-MM-DD by definition, so its value is the one
      // place a stored day belongs as an ISO string.
      if (!columns || /type=["']date["']/.test(line)) return;
      for (const match of line.matchAll(INTERPOLATION)) {
        const inner = (match[1] ?? match[2] ?? '').trim();
        if (!inner || HELPERS.test(inner)) continue;
        if (RENDER_MEMBER.test(inner)) {
          report(file, at, 'a stored date rendered raw', line);
        } else if (RENDER_NULLISH.test(inner)) {
          report(file, at, 'a stored date rendered raw behind ??', line);
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log(
    `No UTC day, no UTC month or year, and no raw date render in lib/ or app/ (${dateColumns.size} date columns checked).`,
  );
  process.exit(0);
}

console.error(`A date leaves the Phoenix clock in ${findings.length} place${findings.length === 1 ? '' : 's'}:\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.rule}`);
  console.error(`      ${finding.source}`);
}
console.error('\nA day comes from phoenixDay, a month from phoenixMonth, a year of an instant from');
console.error('phoenixYear, and a stored date is shown with calendarDate: all in lib/time.ts. The database');
console.error('stores instants in UTC, so every day, month and year the console shows comes from there.');
process.exit(1);
