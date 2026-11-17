#!/usr/bin/env node
// Applies the whole migration series to a throwaway Postgres twice, and fails if any file errors.
//
// Run with:  npm run check:migrations
//
// The series is applied by hand in the Supabase SQL Editor, so nothing else exercises the order the
// files run in, or whether an early file and a late one still agree with each other. This does: a fresh
// in-memory database (PGlite, Postgres compiled to WASM), the objects Supabase provides that the
// migrations assume, then every numbered file in order — and then all of them again. The second pass is
// the one that proves each file can be re-pasted: policies and the constraints that could collide are
// dropped before they are created, so nothing stops with "already exists". It reads only the files in
// supabase/migrations: no network, no credentials, no project.
//
// After both passes it also refuses a date default that is not on the Phoenix clock, and any function
// body that mentions current_date: the database runs in UTC, so those differ from the console after 5pm.
//
// What this does not prove. Policies are created but never evaluated, auth.uid() is a stub returning
// null, and nothing calls storage. A file that applies here can still be wrong about behaviour; what it
// catches is the series no longer building on an empty database, no longer surviving a second run, or
// drifting off the Phoenix clock.
//
// PGlite is a dev dependency, so `npm install` has to have run once.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'supabase', 'migrations');

// The parts of a Supabase project the migrations lean on. Nothing of the CRM's own schema is created
// here, so everything the series needs it has to build itself.
const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    owner uuid,
    created_at timestamptz not null default now()
  );
`;

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.error('This check needs the dev dependencies: run `npm install` first.');
  process.exit(1);
}

const files = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  console.error(`No numbered migrations found in ${MIGRATIONS}.`);
  process.exit(1);
}

const db = new PGlite();
await db.exec(SUPABASE);

for (const pass of [1, 2]) {
  console.log(`\npass ${pass}`);
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
      console.log(`  ok   ${file}`);
    } catch (error) {
      const reason = String(error?.message ?? error).split('\n')[0];
      console.error(`  FAIL ${file}\n       ${reason}`);
      console.error(`\nThe series stops at the file above, on pass ${pass}.`);
      await db.close();
      process.exit(1);
    }
  }
}

// The one thing the series must never drift from: every date a default fills in, and every comparison
// that turns an instant into a day, is on the console's clock. A table added with `default current_date`
// would date its rows in UTC after 5pm Phoenix, and nothing else here would notice.
const clockOffenders = (await db.query(`
  select c.relname || '.' || a.attname as object, 'default' as kind,
         pg_get_expr(d.adbin, d.adrelid) as expression
    from pg_attrdef d
    join pg_class c on c.oid = d.adrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = d.adnum
   where c.relnamespace = 'public'::regnamespace
     and (
       (a.atttypid = 'date'::regtype
        and pg_get_expr(d.adbin, d.adrelid) not ilike '%America/Phoenix%')
       or pg_get_expr(d.adbin, d.adrelid) ilike '%current_date%'
     )
  union all
  select p.proname, 'function', 'body mentions current_date'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%current_date%'
   order by 1
`)).rows;

await db.close();
console.log(`\n${files.length} files applied twice, in order, to an empty database.`);

if (clockOffenders.length > 0) {
  console.error('\nA date is still on the database\'s clock rather than Phoenix:');
  for (const row of clockOffenders) {
    console.error(`  ${row.object} (${row.kind}): ${row.expression}`);
  }
  console.error('\nDate defaults belong on America/Phoenix (see 0022) and day comparisons in a function');
  console.error('belong on it too (see 0021). The database runs in UTC, so after 5pm Phoenix these differ.');
  process.exit(1);
}
