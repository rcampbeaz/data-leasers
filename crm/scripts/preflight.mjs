#!/usr/bin/env node
// Preflight for the CRM. Answers three questions without anyone clicking through pages:
//
//   1. Which environment names are set here? Names only - a value is never printed, compared or
//      logged, so this is safe to run in front of a screen share.
//   2. Are the tables and columns from migrations 0009-0015 actually present?
//   3. Do the self-authenticating routes answer for themselves, or are they being redirected?
//
// Run it where the environment lives (on the server, `cd crm && node scripts/preflight.mjs`).
// Exit 1 means something below would fail for a signed-in user or a cron job.

import { existsSync, readFileSync } from 'node:fs';

// Plain node does not read .env, and saying "17 names missing" on a server that has them all would
// make this script worse than useless. Values are loaded but never printed or logged. Names already
// in the real environment win, matching how the app resolves them under pm2.
function loadEnvFile(path) {
  if (!existsSync(path)) return false;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length > 1) value = value.slice(1, -1);
    if (process.env[name] === undefined) process.env[name] = value;
  }
  return true;
}

// .env.local first so a local override is not overwritten by .env, as Next.js does it.
loadEnvFile('.env.local');
const hadEnvFile = loadEnvFile('.env');

const ORIGIN = process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';

const GROUPS = [
  ['Supabase', ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']],
  ['Access', ['CRON_SECRET', 'INBOUND_EMAIL_SECRET', 'CRM_ORIGIN', 'PUBLIC_SITE_ORIGIN']],
  ['Email', ['RESEND_API_KEY', 'REMINDER_FROM_EMAIL', 'RESEND_WEBHOOK_SECRET', 'OUTBOUND_FROM_EMAIL', 'POSTAL_ADDRESS']],
  ['Sourcing', ['COMPANIES_HOUSE_API_KEY']],
  ['Social', ['SOCIAL_API_URL', 'SOCIAL_API_KEY']],
  ['Agents', ['OPENAI_API_KEY', 'OPENAI_MODEL']],
];

// One entry per migration that a page or route depends on.
const TABLES = [
  ['social_channels', '0009_social.sql'],
  ['social_contents', '0009_social.sql'],
  ['social_posts', '0009_social.sql'],
  ['outreach_contacts', '0011_outbound.sql'],
  ['sequence_enrolments', '0011_outbound.sql'],
  ['suppressions', '0011_outbound.sql'],
  ['import_candidates', '0012_prospect_import.sql'],
  ['domain_holds', '0013_domain_holds.sql'],
];

const COLUMNS = [
  ['companies', 'legal_name', '0010_company_profile.sql'],
  ['companies', 'staff_countries', '0010_company_profile.sql'],
  ['referrals', 'chase_task_id', '0014_referral_chase.sql'],
  ['referrals', 'escalation_task_id', '0015_referral_escalation.sql'],
];

// Each of these authenticates itself, so a redirect means the middleware ate the request.
const ROUTES = [
  ['/api/reminders', 'POST', 'CRON_SECRET'],
  ['/api/social/publish', 'POST', 'CRON_SECRET'],
  ['/api/outbound/send', 'POST', 'CRON_SECRET'],
  ['/api/outbound/guard', 'POST', 'CRON_SECRET'],
  ['/api/partners/report', 'POST', 'CRON_SECRET'],
  ['/api/partners/chase', 'POST', 'CRON_SECRET'],
  ['/api/inbound/email', 'POST', 'INBOUND_EMAIL_SECRET'],
  ['/api/webhooks/resend', 'POST', 'RESEND_WEBHOOK_SECRET'],
  ['/api/export/leads', 'GET', 'staff session'],
];

const missingEnv = [];

console.log('Environment (names only; values are never read out)');
for (const [group, names] of GROUPS) {
  const states = names.map((name) => {
    const set = Boolean(process.env[name]);
    if (!set) missingEnv.push(name);
    return `${name}${set ? '' : ' MISSING'}`;
  });
  console.log(`  ${group.padEnd(10)} ${states.join('  ')}`);
}
if (!hadEnvFile && !existsSync('.env.local')) {
  console.log('  note       no .env in this directory; run this where the app reads its environment');
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function probeRest(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await response.text();
  return { status: response.status, body };
}

function missingSchema(result) {
  if (result.status === 404) return true;
  if (result.status !== 400) return false;
  return /PGRST20[45]|does not exist/i.test(result.body);
}

let schemaProblems = 0;
console.log('\nSchema (migrations 0009-0015)');
if (!url || !key) {
  console.log('  skipped    needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
} else {
  // A bad URL or key must report as unverified rather than throwing: the answer to "is the schema
  // there" is then "cannot tell", which is a problem, not a pass.
  const rows = [
    ...TABLES.map(([table, migration]) => [`${table}?select=*&limit=1`, `table ${table}`, migration]),
    ...COLUMNS.map(([table, column, migration]) => [
      `${table}?select=${column}&limit=1`,
      `${table}.${column}`,
      migration,
    ]),
  ];
  for (const [select, label, migration] of rows) {
    const result = await probeRest(select).catch(() => null);
    if (!result) {
      schemaProblems++;
      console.log(`  UNKNOWN    ${label.padEnd(34)} could not reach Supabase`);
      continue;
    }
    const bad = missingSchema(result);
    if (bad) schemaProblems++;
    console.log(`  ${bad ? 'MISSING  ' : 'present  '} ${label.padEnd(34)} ${bad ? migration : ''}`);
  }
}

let redirects = 0;
const unconfigured = [];
console.log('\nRoutes');
for (const [path, method, auth] of ROUTES) {
  let status = 0;
  try {
    const response = await fetch(`${ORIGIN}${path}`, { method, redirect: 'manual' });
    status = response.status;
  } catch {
    console.log(`  ${path.padEnd(24)} unreachable`);
    continue;
  }
  const gated = status === 307 || status === 302 || status === 303;
  let verdict = 'answered';
  if (auth === 'staff session') {
    // The one route that must sit behind the session: a redirect is the gate working, and an
    // answer without one is the exposure.
    if (gated) {
      verdict = 'gate working (expected)';
    } else {
      verdict = 'EXPOSED without a session';
      redirects++;
    }
  } else if (gated) {
    verdict = 'REDIRECTED before its own check';
    redirects++;
  } else if (status === 401) {
    verdict = 'reachable, secret enforced';
  } else if (status === 503 || status === 500) {
    verdict = `reachable, ${auth} missing on the server`;
    unconfigured.push(auth);
  } else if (status === 403 || status === 400 || status === 200) {
    verdict = 'reachable, answered';
  }
  console.log(`  ${path.padEnd(24)} ${method.padEnd(5)} ${String(status).padEnd(4)} ${verdict}`);
}

// Missing names only fail the run where an env file is actually present: off the server this is a
// report about the wrong machine, on it it is a broken deploy.
const envGaps = missingEnv.length > 0 && (existsSync('.env') || existsSync('.env.local'));
const problems = redirects + schemaProblems + (envGaps ? 1 : 0);
console.log('\nSummary');
console.log(
  `  env names missing here: ${missingEnv.length}${envGaps ? ' (a failure: .env is present)' : ''}`,
);
if (missingEnv.length) console.log(`    ${missingEnv.join(', ')}`);
console.log(`  schema gaps: ${schemaProblems}`);
console.log(`  routes redirected: ${redirects}`);
if (unconfigured.length) {
  console.log(`  unconfigured on the server: ${[...new Set(unconfigured)].join(', ')}`);
}
process.exit(problems > 0 ? 1 : 0);
