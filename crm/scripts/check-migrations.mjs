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
// What this does not prove. Policies are created but never evaluated, auth.uid() is a stub returning
// null, and nothing calls storage. A file that applies here can still be wrong about behaviour; what it
// catches is the series no longer building on an empty database, or no longer surviving a second run.
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

await db.close();
console.log(`\n${files.length} files applied twice, in order, to an empty database.`);
