#!/usr/bin/env node
// Runs the seed's real write path against a throwaway database, so its payloads are proved before a
// project sees them.
//
// Run with:  npm run check:seed
//
// The seed is otherwise only ever run by a person, against staging, with a service key. Until it has
// been, nothing has checked that its columns exist, that every value fits its type, not-null rule and
// check constraint, or that a second run clears its own rows instead of colliding with them. This check
// applies the migrations to an in-memory Postgres (PGlite) and calls the same exported `seed()` the
// command line calls, with a client that turns its Supabase calls into SQL: insert, upsert with a
// conflict target, delete and select with a filter, and the three auth.admin calls. It runs the seed
// twice — the second run is what proves delete-then-insert replaces rather than duplicates — and puts a
// row the seed does not own in the way, to show the deletes stay inside the seed's own marker.
//
// What this does not prove. It is not PostgREST: the translation below is small and written to match
// PostgREST's shape, so something PostgREST rejects for a reason outside the schema (a grant, a policy,
// a column it refuses to write) can still pass here. Policies are never evaluated, and the password is
// discarded because auth.users in this stub has no password column. What it does prove is what would
// fail first: the payloads fit the schema, and a rerun does not trip over a unique index.
//
// PGlite is a dev dependency, so `npm install` has to have run once.

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'supabase', 'migrations');

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.error('This check needs the dev dependencies: run `npm install` first.');
  process.exit(1);
}

const { seed, failureLines } = await import('./seed.mjs');

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

// A value as a SQL literal. Everything here comes from the seed's own constants, not from a request, so
// quoting is all that is needed; objects become jsonb, which is how PostgREST carries them.
const literal = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  return `'${String(value).replaceAll("'", "''")}'`;
};

const where = (filters) =>
  filters.length === 0
    ? ''
    : ` where ${filters
        .map(({ column, values }) => `${column} in (${values.map(literal).join(', ')})`)
        .join(' and ')}`;

const asList = (payload) => (Array.isArray(payload) ? payload : [payload]);

// One row per statement is avoided on purpose: a payload of several rows is one statement here, as it is
// through PostgREST, and a key missing from a row falls back to the column default rather than to null.
const columnsOf = (rows) => [...new Set(rows.flatMap((row) => Object.keys(row)))];
const valuesOf = (rows) => {
  const columns = columnsOf(rows);
  const tuples = rows.map(
    (row) => `(${columns.map((column) => (column in row ? literal(row[column]) : 'default')).join(', ')})`,
  );
  return { columns, tuples };
};

const insertSql = (table, rows, conflict) => {
  const { columns, tuples } = valuesOf(rows);
  const base = `insert into public.${table} (${columns.join(', ')}) values ${tuples.join(', ')}`;
  if (!conflict) return base;
  const updates = columns
    .filter((column) => !conflict.split(',').map((part) => part.trim()).includes(column))
    .map((column) => `${column} = excluded.${column}`);
  return `${base} on conflict (${conflict}) ${updates.length === 0 ? 'do nothing' : `do update set ${updates.join(', ')}`}`;
};

// The shape the seed uses: a builder whose filters accumulate until it is awaited, then one statement.
const client = (db) => {
  const from = (table) => {
    const state = { table, op: null, payload: null, conflict: null, columns: '*', filters: [] };
    const run = async () => {
      try {
        if (state.op === 'delete') {
          if (state.filters.length === 0) throw new Error('refusing a delete without a filter');
          await db.query(`delete from public.${state.table}${where(state.filters)}`);
          return { data: null, error: null };
        }
        if (state.op === 'insert' || state.op === 'upsert') {
          await db.query(insertSql(state.table, asList(state.payload), state.conflict));
          return { data: null, error: null };
        }
        const result = await db.query(
          `select ${state.columns} from public.${state.table}${where(state.filters)}`,
        );
        return { data: result.rows, error: null };
      } catch (error) {
        return { data: null, error: { message: String(error?.message ?? error).split('\n')[0] } };
      }
    };
    const builder = {
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      upsert(payload, options = {}) {
        state.op = 'upsert';
        state.payload = payload;
        state.conflict = options.onConflict ?? null;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      select(columns = '*') {
        state.op = state.op ?? 'select';
        state.columns = columns;
        return builder;
      },
      in(column, values) {
        state.filters.push({ column, values });
        return builder;
      },
      eq(column, value) {
        state.filters.push({ column, values: [value] });
        return builder;
      },
      then(resolve, reject) {
        return run().then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    from,
    auth: {
      admin: {
        // The seed's contract: a duplicate address is an error, and the user is then found and updated.
        async createUser({ email }) {
          const existing = (await db.query('select id from auth.users where email = $1', [email]))
            .rows[0];
          if (existing) {
            return {
              data: { user: null },
              error: { message: 'A user with this email address has already been registered' },
            };
          }
          const id = randomUUID();
          await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
          return { data: { user: { id, email } }, error: null };
        },
        async listUsers() {
          const users = (await db.query('select id, email from auth.users')).rows;
          return { data: { users }, error: null };
        },
        // No password column here, so this only proves the seed handles the reset returning cleanly.
        async updateUserById(id) {
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };
};

const db = new PGlite();
await db.exec(SUPABASE);

const files = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();
for (const file of files) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  } catch (error) {
    console.error(`Could not apply ${file}: ${String(error?.message ?? error).split('\n')[0]}`);
    await db.close();
    process.exit(1);
  }
}

console.log(`\nseed, against a local database (${files.length} migrations applied)\n`);

const supabase = client(db);
const failures = [];
const expect = (label, actual, wanted) => {
  if (String(actual) === String(wanted)) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(`${label}: found ${actual}, expected ${wanted}`);
};
const count = async (sql) => Number((await db.query(sql)).rows[0].n);

const snapshot = async () => ({
  staff: await count(`select count(*) as n from public.crm_staff where role = 'admin'`),
  companies: await count(`select count(*) as n from public.companies where source = 'seed'`),
  buyer: await count(`select count(*) as n from public.buyers where name like 'Seed — %'`),
  introductions: await count(`select count(*) as n from public.introductions`),
  offers: await count(`select count(*) as n from public.offers`),
  agreements: await count(`select count(*) as n from public.agreements`),
  partners: await count(`select count(*) as n from public.partners where name like 'Seed — %'`),
  referrals: await count(`select count(*) as n from public.referrals where company_name like 'Seed — %'`),
  channels: await count(`select count(*) as n from public.social_channels where display_name like 'Seed — %'`),
  contents: await count(`select count(*) as n from public.social_contents where title like 'Seed — %'`),
  posts: await count(`select count(*) as n from public.social_posts`),
  settings: await count(`select count(*) as n from public.app_settings where key = 'marketing_sweep'`),
  contacts: await count(`select count(*) as n from public.outreach_contacts where source = 'seed'`),
  sends: await count(`select count(*) as n from public.outbound_sends where subject = 'Seed: bounce rehearsal'`),
  suppressions: await count(`select count(*) as n from public.suppressions where source = 'seed'`),
});

const expected = {
  staff: 1,
  companies: 2,
  buyer: 1,
  introductions: 2,
  offers: 1,
  agreements: 1,
  partners: 1,
  referrals: 2,
  channels: 2,
  contents: 3,
  posts: 3,
  settings: 1,
  contacts: 2,
  sends: 2,
  suppressions: 1,
};

// The seed reports progress through `log`, which stays quiet here so this prints one line per assertion
// rather than fourteen. A step that fails comes back as a thrown StepFailure: that is printed, and the
// database is closed before the check stops.
const runSeed = async () => {
  const said = [];
  try {
    await seed({
      supabase,
      email: 'walkthrough@dataleasers.test',
      password: 'check-only',
      failureHint: [
        'This database has the migrations applied, so the seed is what to change: a column that no',
        'longer exists, or a value the schema refuses.',
      ],
      log: (line) => said.push(line),
    });
  } catch (error) {
    for (const line of failureLines(error)) console.error(line);
    await db.close();
    process.exit(1);
  }
  return said;
};

const firstSteps = await runSeed();
const wrote = firstSteps.filter((line) => line.startsWith('  ok')).length;

for (const [name, wanted] of Object.entries(expected)) {
  expect(`first run: ${name}`, (await snapshot())[name], wanted);
}

expect(
  'a stopped post is waiting for a person',
  (await db.query(`select status, attempts from public.social_posts where id = 'aa000000-0000-4000-8000-000000000002'`))
    .rows.map((row) => `${row.status}/${row.attempts}`)
    .join(),
  'needs_manual/5',
);
expect(
  'the dead channel needs reconnecting',
  (await db.query(`select status from public.social_channels where id = 'a8000000-0000-4000-8000-000000000002'`))
    .rows[0].status,
  'needs_reauth',
);
expect(
  'the sweep warning is readable as json',
  (await db.query(`select value ->> 'degraded' as degraded from public.app_settings where key = 'marketing_sweep'`))
    .rows[0].degraded,
  'false',
);

// The deletes are meant to stay inside the seed's marker. A company the seed does not own must survive
// both the clear step and the second run, or the script would be deleting a project's real work.
await db.query(
  `insert into public.companies (name, stage, source) values ('Not the seed', 'New lead', 'manual')`,
);

// A step that fails on the second run throws, which prints the reason and closes the database.
await runSeed();

for (const [name, wanted] of Object.entries(expected)) {
  expect(`second run: ${name}`, (await snapshot())[name], wanted);
}
expect(
  'a company the seed does not own survives both runs',
  await count(`select count(*) as n from public.companies where source = 'manual'`),
  1,
);
expect(
  'the seed account was reused, not duplicated',
  await count(`select count(*) as n from auth.users where email = 'walkthrough@dataleasers.test'`),
  1,
);

await db.close();

console.log(
  `\n${wrote} writes, applied twice to an empty database: the payloads fit the schema and a rerun replaces them.`,
);

if (failures.length > 0) {
  console.error('\nThe seed does not match the schema:');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nA column above is missing, or a value does not fit its type, not-null rule or check');
  console.error('constraint. The seed is the thing to change: it must fit the schema the migrations build.');
  process.exit(1);
}
