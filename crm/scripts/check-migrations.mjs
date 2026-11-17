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
// After both passes it refuses a date default that is not on the Phoenix clock, and any function body
// that mentions current_date: the database runs in UTC, so those differ from the console after 5pm. It
// then exercises the one function the app depends on for scheduling, with the session moved to a zone
// that is always ahead of Phoenix — the state a UTC database is in after 5pm — and requires that a step
// the console calls tomorrow stays queued while today's is claimed. That is 0021's bug, asserted rather
// than described.
//
// What this does not prove. Policies are created but never evaluated, auth.uid() is a stub returning
// null, nothing calls storage, and claim_outbound_sends is the only function whose behaviour is tested. A file that applies here can still be wrong about behaviour; what it
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

// Behaviour, not just shape. The claim compares next_due_on with the console's day, so a step the
// console calls tomorrow must stay queued even when the session's own day has already rolled over.
// "Today" is written with the same expression the app uses, so a comparator on the session day would
// claim tomorrow's step early — the bug 0021 fixed, in either its current_date or its UTC form. The
// console's day is read again afterwards, so a run that happens to cross Phoenix midnight reports that
// rather than accusing the function of a bug.
let claimProblem = null;
let claimDays = '';
try {
  await db.exec(`set time zone 'Etc/GMT-14'`);
  await db.exec(`
    insert into public.sequences (name) values ('clock check');
    insert into public.outreach_contacts (email, basis) values
      ('clock-check-today@example.test', 'opt_out_only'),
      ('clock-check-tomorrow@example.test', 'opt_out_only');
    insert into public.sequence_enrolments (sequence_id, contact_id, status, next_due_on, approved_at)
    select s.id, c.id, 'active', (now() at time zone 'America/Phoenix')::date, now()
      from public.sequences s, public.outreach_contacts c
     where s.name = 'clock check' and c.email = 'clock-check-today@example.test';
    insert into public.sequence_enrolments (sequence_id, contact_id, status, next_due_on, approved_at)
    select s.id, c.id, 'active', (now() at time zone 'America/Phoenix')::date + 1, now()
      from public.sequences s, public.outreach_contacts c
     where s.name = 'clock check' and c.email = 'clock-check-tomorrow@example.test';
  `);

  const claimed = (
    await db.query(`
      select c.email, e.next_due_on::text as due
        from public.claim_outbound_sends(10) e
        join public.outreach_contacts c on c.id = e.contact_id
       order by c.email
    `)
  ).rows;
  const queued = (
    await db.query(`
      select c.email
        from public.sequence_enrolments e
        join public.outreach_contacts c on c.id = e.contact_id
       where e.status = 'active'
       order by c.email
    `)
  ).rows.map((row) => row.email);
  const session = (await db.query(`select current_date::text as day`)).rows[0].day;
  const consoleDay = (
    await db.query(`select (now() at time zone 'America/Phoenix')::date::text as day`)
  ).rows[0].day;
  const afterClaim = (
    await db.query(`select (now() at time zone 'America/Phoenix')::date::text as day`)
  ).rows[0].day;
  claimDays = `session day ${session}, console day ${consoleDay}`;

  const today = 'clock-check-today@example.test';
  const later = 'clock-check-tomorrow@example.test';
  const problems = [];
  if (afterClaim !== consoleDay) {
    problems.push('the console crossed midnight while this ran, so the step due tomorrow is now due today');
  }
  if (claimed.length !== 1 || claimed[0].email !== today) {
    problems.push(
      `steps claimed: ${claimed.map((row) => row.email).join(', ') || 'none'} — expected only ${today}`,
    );
  }
  if (claimed.length === 1 && claimed[0].due !== consoleDay) {
    problems.push(`the claimed step was due ${claimed[0].due}, the console's day is ${consoleDay}`);
  }
  if (queued.length !== 1 || queued[0] !== later) {
    problems.push(
      `still queued: ${queued.join(', ') || 'none'} — expected only ${later} (due tomorrow)`,
    );
  }
  if (problems.length > 0) claimProblem = { problems, detail: claimDays };
} catch (error) {
  claimProblem = {
    problems: [`the claim could not be exercised: ${String(error?.message ?? error).split('\n')[0]}`],
    detail: 'see 0011 for the tables and 0021 for the function',
  };
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
  union all
  -- A UTC comparison is the same bug wearing another name: it agrees with Phoenix for most of the day,
  -- so only naming the zone catches it at every hour rather than proving it between 5pm and midnight.
  select p.proname, 'function', 'turns now() into a day without naming the zone'
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ilike '%now()%'
     and (
       p.prosrc ilike '%::date%'
       or p.prosrc ilike '%time zone%'
       or p.prosrc ilike '%date_trunc%'
     )
     and p.prosrc not ilike '%America/Phoenix%'
   order by 1
`)).rows;

await db.close();
console.log(`\n${files.length} files applied twice, in order, to an empty database.`);

if (clockOffenders.length > 0) {
  console.error('\nA date is still on the database\'s clock rather than Phoenix:');
  for (const row of clockOffenders) {
    console.error(`  ${row.object} (${row.kind}): ${row.expression}`);
  }
  console.error('\nDate defaults belong on America/Phoenix (see 0022) and so do day comparisons in a');
  console.error('function (see 0021). The database runs in UTC, so after 5pm Phoenix these differ — and a');
  console.error('comparison against UTC or against the session day agrees with Phoenix the rest of the time.');
  process.exit(1);
}

if (claimProblem) {
  console.error('\nThe outbound claim does not agree with the console\'s day:');
  for (const problem of claimProblem.problems) console.error(`  ${problem}`);
  console.error(`  (${claimProblem.detail})`);
  console.error('\nclaim_outbound_sends must compare next_due_on with (now() at time zone');
  console.error("'America/Phoenix')::date, not with the session's current_date: after 5pm Phoenix the");
  console.error('session day is tomorrow, and a step would go out a day early. See 0021.');
  process.exit(1);
}

console.log(
  `The claim took only the step due today and left tomorrow's queued (${claimDays}).`,
);
