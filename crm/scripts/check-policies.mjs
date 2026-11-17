#!/usr/bin/env node
// Evaluates the row-level security policies the way a request from the browser meets them.
//
// Run with:  npm run check:policies
//
// The migrations create policies but nothing has ever run a query against them: auth.uid() is a stub in
// check:migrations, so a policy edited to `using (true)` would pass every check in the repo and still
// hand the database to anyone holding the anonymous key. This applies the series to PGlite, gives the
// three roles the table grants Supabase gives them by default — RLS, not GRANT, is the perimeter — and
// then reads and writes as anon, as a signed-in stranger, and as each staff role.
//
// auth.uid() here is driven by `request.jwt.claim.sub`, the setting Supabase fills from the JWT. It is a
// simplification of Supabase's own definition (which also reads `request.jwt.claims` as JSON): what it
// reproduces is the only part the policies use, the current user's id, and null for anyone anonymous.
//
// What this does not prove: storage policies, the REST layer's handling of the key itself, or anything
// about a table added without enabling RLS. The last of those is asserted below, so a new table that
// forgets `enable row level security` fails here rather than being unguarded in production.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'supabase', 'migrations');

const SUPABASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    owner uuid,
    created_at timestamptz not null default now()
  );
`;

const ADMIN = '00000000-0000-4000-8000-000000000001';
const INTRODUCER = '00000000-0000-4000-8000-000000000002';
const VIEWER = '00000000-0000-4000-8000-000000000003';
const STRANGER = '00000000-0000-4000-8000-000000000004';
const STAFF = [
  [ADMIN, 'Ada Admin', 'admin'],
  [INTRODUCER, 'Ida Introducer', 'introducer'],
  [VIEWER, 'Vic Viewer', 'viewer'],
];

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.error('This check needs the dev dependencies: run `npm install` first.');
  process.exit(1);
}

const db = new PGlite();
await db.exec(SUPABASE);
for (const file of readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort()) {
  await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
}

// Supabase grants these roles their table privileges by default, so RLS is the only thing standing
// between the browser's key and the data. Without the grants this check would prove nothing.
await db.exec(`
  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  grant usage, select on all sequences in schema public to anon, authenticated;
  grant usage on schema public to service_role;
  grant all on all tables in schema public to service_role;
  grant usage, select on all sequences in schema public to service_role;
`);

await db.exec(`
  insert into auth.users (id, email) values
    ('${ADMIN}', 'admin@example.test'),
    ('${INTRODUCER}', 'introducer@example.test'),
    ('${VIEWER}', 'viewer@example.test'),
    ('${STRANGER}', 'stranger@example.test');
  ${STAFF.map(([id, name, role]) => `insert into public.crm_staff (user_id, full_name, role) values ('${id}', '${name}', '${role}');`).join('\n  ')}
  insert into public.companies (name) values ('Fixture Co');
  insert into public.audit_log (actor_id, entity, entity_id, action, detail)
    values ('${ADMIN}', 'company', (select id from public.companies limit 1), 'created', '{}'::jsonb);
`);

const failures = [];
let checked = 0;

const ok = (label, condition, detail = '') => {
  checked += 1;
  if (!condition) failures.push(detail ? `${label}\n      ${detail}` : label);
};

const as = async (role, uid = null) => {
  await db.exec('reset role');
  await db.exec(`set request.jwt.claim.sub = '${uid ?? ''}'`);
  await db.exec(`set role ${role}`);
};
const back = async () => {
  await db.exec('reset role');
  await db.exec('reset request.jwt.claim.sub');
};
const visible = async (table) => Number((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n);

// A write the policies should refuse: row-level security raises 42501, and nothing else counts.
const refused = async (sql) => {
  try {
    await db.query(sql);
    return false;
  } catch (error) {
    return String(error?.code ?? '') === '42501' || /row-level security/i.test(String(error?.message ?? ''));
  }
};

const tables = (
  await db.query(`
    select c.relname as name, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by 1
  `)
).rows;

ok(
  'every table has row-level security enabled',
  tables.every((row) => row.rls),
  tables.filter((row) => !row.rls).map((row) => `  ${row.name} has RLS off`).join('\n'),
);

// Nothing anonymous, and nothing for a signed-in user who is not staff. Every table, not a sample: a
// policy copied onto a new table with the wrong condition should fail here without being listed.
const unreadable = async (role, uid) => {
  await as(role, uid);
  const leaked = [];
  for (const { name } of tables) {
    try {
      if ((await visible(name)) > 0) leaked.push(name);
    } catch (error) {
      // A table the role cannot even address is not a leak.
      if (String(error?.code ?? '') !== '42501') leaked.push(`${name} (${error?.message ?? error})`);
    }
  }
  await back();
  return leaked;
};

const anonymousLeaks = await unreadable('anon');
ok('anonymous reads nothing', anonymousLeaks.length === 0, anonymousLeaks.join(', '));

const strangerLeaks = await unreadable('authenticated', STRANGER);
ok('a signed-in stranger reads nothing', strangerLeaks.length === 0, strangerLeaks.join(', '));

// Staff read, and the roles are what decide who writes.
await as('authenticated', VIEWER);
ok('a viewer reads the company list', (await visible('companies')) === 1);
ok('a viewer cannot read the activity log', (await visible('audit_log')) === 0);
ok(
  'a viewer cannot create a company',
  await refused(`insert into public.companies (name) values ('Viewer Co')`),
  'the insert succeeded, so a read-only role can write',
);
await back();

await as('authenticated', INTRODUCER);
ok('an introducer reads the company list', (await visible('companies')) === 1);
ok(
  'an introducer can create a company',
  !(await refused(`insert into public.companies (name) values ('Introducer Co')`)),
  'the insert was refused',
);
ok(
  'staff may write their own audit entries',
  !(await refused(
    `insert into public.audit_log (actor_id, entity, entity_id, action) values ('${INTRODUCER}', 'company', (select id from public.companies limit 1), 'touched')`,
  )),
  'the insert was refused, so actions taken in the console cannot be recorded',
);
await back();

await as('authenticated', STRANGER);
ok(
  'a stranger cannot write audit entries',
  await refused(
    `insert into public.audit_log (actor_id, entity, entity_id, action) values ('${STRANGER}', 'company', (select id from public.companies limit 1), 'sneaked')`,
  ),
);
ok(
  'a stranger cannot create a company',
  await refused(`insert into public.companies (name) values ('Stranger Co')`),
);
await back();

await as('authenticated', ADMIN);
ok('an admin reads the activity log', (await visible('audit_log')) >= 1);
ok('an admin reads the company list', (await visible('companies')) >= 2);
await back();

// The server-only client is the one that must bypass RLS, or the intake form and the publisher would
// be subject to a policy written for a signed-in person.
await as('service_role');
ok('the service role is not stopped by RLS', (await visible('companies')) >= 2);
ok('the service role reads the activity log', (await visible('audit_log')) >= 1);
await back();

await db.close();

if (failures.length === 0) {
  console.log(
    `Anonymous and non-staff readers see nothing, and the staff roles are held to their own policies (${checked} checks over ${tables.length} tables).`,
  );
  process.exit(0);
}

console.error(`Row-level security is wrong in ${failures.length} place${failures.length === 1 ? '' : 's'}:\n`);
for (const failure of failures) console.error(`  ${failure}`);
console.error('\nA policy that lets an anonymous key read a table hands the database to anyone holding it.');
console.error('Policies live in supabase/migrations; if a table is meant to be public, that has to be a');
console.error('decision here, not a side effect of a condition that is always true.');
process.exit(1);
