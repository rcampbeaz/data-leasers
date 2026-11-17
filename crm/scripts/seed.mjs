#!/usr/bin/env node
// Fills a staging project with the states this branch changed, so the console can be walked through
// without touching customer data.
//
// Run with:  npm run seed
//
// Needs three variables and one deliberate confirmation, because this writes rows to a real project:
//
//   NEXT_PUBLIC_SUPABASE_URL     the staging project's URL
//   SUPABASE_SERVICE_ROLE_KEY    its service role key (bypasses RLS, which is why this can seed tables)
//   SEED_STAFF_PASSWORD          the password for the walk-through account, at least 12 characters
//   SEED_CONFIRM=yes             without this the script prints its plan and stops
//   SEED_STAFF_EMAIL             optional, defaults to walkthrough@dataleasers.test
//
// Nothing here is printed back: the password is written to the project, never echoed. The key is read
// from the environment and never shown either.
//
// Everything it creates has a fixed id or a seed marker. A run clears its own rows by that marker and
// then inserts plainly, so the write path never depends on a table's unique index: only the staff row,
// its profile and the sweep record are upserted, because there the key itself is being replaced.
//
// It writes no provider credentials and sends nothing: the social posts are rows in a state, and the
// outbound sends are records of sends that never happened.

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// A day on the console's clock, and whole days added to one. The seed writes calendar dates, so it
// uses the same shape the app stores: YYYY-MM-DD, on America/Phoenix.
const phoenixDay = (when = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(when);
const addDays = (day, days) => {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};
const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

// Fixed ids: a rerun deletes and replaces exactly these, and nothing else.
const BUYER = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_A = 'a2000000-0000-4000-8000-000000000001';
const COMPANY_B = 'a2000000-0000-4000-8000-000000000002';
const INTRODUCTION_A = 'a3000000-0000-4000-8000-000000000001';
const INTRODUCTION_B = 'a3000000-0000-4000-8000-000000000002';
const OFFER = 'a4000000-0000-4000-8000-000000000001';
const AGREEMENT = 'a5000000-0000-4000-8000-000000000001';
const PARTNER = 'a6000000-0000-4000-8000-000000000001';
const REFERRAL_AT_RISK = 'a7000000-0000-4000-8000-000000000001';
const REFERRAL_OVERDUE = 'a7000000-0000-4000-8000-000000000002';
const CHANNEL_LIVE = 'a8000000-0000-4000-8000-000000000001';
const CHANNEL_DEAD = 'a8000000-0000-4000-8000-000000000002';
const CONTENT_QUEUED = 'a9000000-0000-4000-8000-000000000001';
const CONTENT_STOPPED = 'a9000000-0000-4000-8000-000000000002';
const CONTENT_DEAD = 'a9000000-0000-4000-8000-000000000003';
const POST_QUEUED = 'aa000000-0000-4000-8000-000000000001';
const POST_STOPPED = 'aa000000-0000-4000-8000-000000000002';
const POST_DEAD = 'aa000000-0000-4000-8000-000000000003';

const SEND_SUBJECT = 'Seed: bounce rehearsal';
const BOUNCED_EMAIL = 'bounced@seed.bounce.test';
const DELIVERED_EMAIL = 'delivered@seed.bounce.test';
const SWEEP_WARNING =
  'The publisher could not reach the provider (seed fixture). Retrying held posts is safe.';

// A step that fails keeps its label, the database's own message and the hint together. Whoever ran the
// seed decides what to do with that: the command line prints it and exits, the local check prints it and
// closes its database. Neither has to guess from log lines what happened.
export class StepFailure extends Error {
  constructor(label, reason, hint) {
    super(`${label}: ${reason}`);
    this.label = label;
    this.reason = reason;
    this.hint = hint;
  }
}

export const failureLines = (error) =>
  error instanceof StepFailure
    ? [`  FAIL ${error.label}`, `       ${error.reason}`, '', ...error.hint]
    : [`  FAIL ${String(error?.message ?? error).split('\n')[0]}`];

// The write path on its own, so a check can run it against a local database with a stubbed client.
// `supabase` is anything with the same shape as the client this script uses in production.
export async function seed({ supabase, email, password, log = console.log, failureHint }) {
  const today = phoenixDay();
  const delivered = addDays(today, -10);

  // The hint names the usual cause — a staging project that has not had the migrations applied — unless
  // the caller knows better, which the local check does, because it has just applied them itself.
  const hint = failureHint ?? [
    'If this is a missing table or column, apply supabase/migrations in order to this project',
    'first: `npm run check:migrations` proves the series applies to an empty one.',
    'Nothing yet written by this run has been removed.',
  ];
  // Progress only: a failure is thrown, so the caller decides whether that ends the run.
  const step = async (label, run) => {
    try {
      const result = await run();
      log(`  ok   ${label}`);
      return result;
    } catch (error) {
      throw new StepFailure(label, String(error?.message ?? error).split('\n')[0], hint);
    }
  };

  // One way of reporting a failed write: the step around it already says which write this was, so the
  // PostgREST message is all that has to travel.
  const must = async (promise) => {
    const { error } = await promise;
    if (error) throw new Error(error.message);
  };

  // 1. The account. Created if absent; if it exists its password is reset, so the operator always has a
  // working sign-in and the password only ever moves from the environment into the project.
  const userId = await step('walk-through staff account', async () => {
    const created = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!created.error && created.data?.user?.id) return created.data.user.id;

    const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listed.error) throw new Error(listed.error.message);
    const found = (listed.data?.users ?? []).find((user) => user.email?.toLowerCase() === email);
    if (!found) throw new Error(`${email} could not be created (${created.error?.message ?? 'unknown'})`);

    const updated = await supabase.auth.admin.updateUserById(found.id, { password });
    if (updated.error) throw new Error(updated.error.message);
    return found.id;
  });

  await step('staff row, as an admin', () =>
    must(
      supabase.from('crm_staff').upsert(
        { user_id: userId, full_name: 'Walk-through Admin', role: 'admin' },
        { onConflict: 'user_id' },
      ),
    ),
  );

  await step('staff profile row', () =>
    must(
      supabase.from('crm_staff_profiles').upsert({ user_id: userId, email }, { onConflict: 'user_id' }),
    ),
  );

  // 2. Clear what a previous run left, children first, so the seed stays replaceable and never grows.
  // Each table below is cleared by the seed's own marker — a fixed id, or the address or subject it
  // writes — and then filled with a plain insert. Nothing here asks a table what its unique index is.
  await step('clear the previous seed', async () => {
    const removals = [
      supabase.from('social_posts').delete().in('id', [POST_QUEUED, POST_STOPPED, POST_DEAD]),
      supabase.from('social_contents').delete().in('id', [CONTENT_QUEUED, CONTENT_STOPPED, CONTENT_DEAD]),
      supabase.from('social_channels').delete().in('id', [CHANNEL_LIVE, CHANNEL_DEAD]),
      supabase.from('referrals').delete().in('id', [REFERRAL_AT_RISK, REFERRAL_OVERDUE]),
      supabase.from('partners').delete().in('id', [PARTNER]),
      supabase.from('agreements').delete().in('company_id', [COMPANY_A, COMPANY_B]),
      supabase.from('offers').delete().in('company_id', [COMPANY_A, COMPANY_B]),
      supabase.from('introductions').delete().in('company_id', [COMPANY_A, COMPANY_B]),
      supabase.from('companies').delete().in('id', [COMPANY_A, COMPANY_B]),
      supabase.from('buyers').delete().in('id', [BUYER]),
      supabase.from('outbound_sends').delete().eq('subject', SEND_SUBJECT),
      supabase.from('outreach_contacts').delete().in('email', [BOUNCED_EMAIL, DELIVERED_EMAIL]),
      supabase.from('suppressions').delete().in('email', [BOUNCED_EMAIL]),
    ];
    for (const removal of removals) {
      const { error } = await removal;
      if (error) throw new Error(error.message);
    }
  });

  // 3. Companies, a buyer, and the deal trail behind them.
  await step('one buyer', () =>
    must(
      supabase.from('buyers').insert({ id: BUYER, name: 'Seed — Meridian Capital', kind: 'program' }),
    ),
  );

  await step('two companies', () =>
    must(
      supabase.from('companies').insert([
        {
          id: COMPANY_A,
          name: 'Seed — Northwind Analytics',
          stage: 'Introduced to buyer',
          source: 'seed',
          next_action: 'Chase the buyer for a decision',
          next_action_due: addDays(today, 2),
          owner_id: userId,
        },
        {
          id: COMPANY_B,
          name: 'Seed — Halcyon Health Data',
          stage: 'Buyer in discussion',
          source: 'seed',
          next_action: 'Send the sample extract',
          next_action_due: addDays(today, -1),
          owner_id: userId,
        },
      ]),
    ),
  );

  await step('introductions to the buyer', () =>
    must(
      supabase.from('introductions').insert([
        {
          id: INTRODUCTION_A,
          company_id: COMPANY_A,
          buyer_id: BUYER,
          introduced_on: addDays(today, -45),
          introduced_by: userId,
        },
        {
          id: INTRODUCTION_B,
          company_id: COMPANY_B,
          buyer_id: BUYER,
          introduced_on: addDays(today, -30),
          introduced_by: userId,
        },
      ]),
    ),
  );

  await step('an offer and a signed agreement', async () => {
    await must(
      supabase.from('offers').insert({
        id: OFFER,
        company_id: COMPANY_A,
        buyer_id: BUYER,
        introduction_id: INTRODUCTION_A,
        amount: 250000,
        status: 'offered',
        offered_on: addDays(today, -20),
      }),
    );
    await must(
      supabase.from('agreements').insert({
        id: AGREEMENT,
        company_id: COMPANY_A,
        offer_id: OFFER,
        buyer_id: BUYER,
        licence_start: addDays(today, -30),
        licence_end: addDays(today, 335),
        delivered_on: delivered,
        deletion_due: addDays(delivered, 120),
        signed_on: addDays(today, -30),
        status: 'signed',
        audit_right: true,
      }),
    );
  });

  // 4. A partner with two referrals: one inside the chase window, one already past its deadline.
  await step('a partner with two referrals', async () => {
    await must(
      supabase.from('partners').insert({
        id: PARTNER,
        name: 'Seed — Beacon Introductions',
        email: 'beacon@seed.partner.test',
        organisation: 'Beacon Introductions',
        fee_rate: 0.06,
        fee_floor: 50000,
        created_by: userId,
      }),
    );
    await must(
      supabase.from('referrals').insert([
        {
          id: REFERRAL_AT_RISK,
          partner_id: PARTNER,
          company_id: COMPANY_A,
          company_name: 'Seed — Northwind Analytics',
          registered_on: addDays(today, -160),
          deadline_on: addDays(today, 12),
          status: 'registered',
        },
        {
          id: REFERRAL_OVERDUE,
          partner_id: PARTNER,
          company_id: COMPANY_B,
          company_name: 'Seed — Halcyon Health Data',
          registered_on: addDays(today, -190),
          deadline_on: addDays(today, -3),
          status: 'registered',
        },
      ]),
    );
  });

  // 5. Two channels and three posts: one queued, one stopped for a person, one on a dead channel.
  await step('two channels', () =>
    must(
      supabase.from('social_channels').insert([
        {
          id: CHANNEL_LIVE,
          platform: 'linkedin',
          external_id: 'seed-linkedin-page',
          display_name: 'Seed — LinkedIn page',
          provider: 'aggregator',
          status: 'active',
          last_ok_at: hours(-6),
        },
        {
          id: CHANNEL_DEAD,
          platform: 'facebook',
          external_id: 'seed-facebook-page',
          display_name: 'Seed — Facebook page',
          provider: 'direct',
          status: 'needs_reauth',
          last_error: 'The page access token has expired.',
        },
      ]),
    ),
  );

  await step('three pieces of content', () =>
    must(
      supabase.from('social_contents').insert([
        {
          id: CONTENT_QUEUED,
          title: 'Seed — queued',
          body: 'A dataset is only worth what a buyer can legally do with it. Our latest note on rights.',
          status: 'scheduled',
          created_by: userId,
          approved_by: userId,
          approved_at: hours(-26),
        },
        {
          id: CONTENT_STOPPED,
          title: 'Seed — stopped',
          body: 'How a data buyer checks provenance before a diligence call.',
          status: 'scheduled',
          created_by: userId,
          approved_by: userId,
          approved_at: hours(-50),
        },
        {
          id: CONTENT_DEAD,
          title: 'Seed — dead channel',
          body: 'What a licence end date means for the data you have already delivered.',
          status: 'scheduled',
          created_by: userId,
          approved_by: userId,
          approved_at: hours(-70),
        },
      ]),
    ),
  );

  await step('a queued post, a stopped post and a post on a dead channel', () =>
    must(
      supabase.from('social_posts').insert([
        {
          id: POST_QUEUED,
          content_id: CONTENT_QUEUED,
          channel_id: CHANNEL_LIVE,
          body: 'A dataset is only worth what a buyer can legally do with it. Our latest note on rights.',
          scheduled_for: hours(2),
          status: 'scheduled',
          attempts: 0,
        },
        {
          id: POST_STOPPED,
          content_id: CONTENT_STOPPED,
          channel_id: CHANNEL_LIVE,
          body: 'How a data buyer checks provenance before a diligence call.',
          scheduled_for: hours(-2),
          status: 'needs_manual',
          attempts: 5,
          last_error_code: 'http_500',
          last_error: 'The provider returned an error five times. The post was not sent.',
        },
        {
          id: POST_DEAD,
          content_id: CONTENT_DEAD,
          channel_id: CHANNEL_DEAD,
          body: 'What a licence end date means for the data you have already delivered.',
          scheduled_for: hours(-1),
          status: 'failed',
          attempts: 3,
          last_error_code: 'http_401',
          last_error: 'The page access token has expired. Reconnect the channel.',
        },
      ]),
    ),
  );

  // 6. The sweep's own record, which is what the Marketing page and /health read.
  await step('a sweep warning', () =>
    must(
      supabase.from('app_settings').upsert(
        {
          key: 'marketing_sweep',
          value: { error: SWEEP_WARNING, at: new Date().toISOString(), degraded: false },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
    ),
    ),
  );

  // 7. Email health: two recipients, two sends, and a bounce that suppresses one of them.
  await step('contacts, two sends and a suppression', async () => {
    await must(
      supabase.from('outreach_contacts').insert([
        { email: BOUNCED_EMAIL, basis: 'opt_out_only', source: 'seed', status: 'active' },
        { email: DELIVERED_EMAIL, basis: 'opt_out_only', source: 'seed', status: 'active' },
      ]),
    );
    const contacts = await supabase
      .from('outreach_contacts')
      .select('id, email')
      .in('email', [BOUNCED_EMAIL, DELIVERED_EMAIL]);
    if (contacts.error) throw new Error(contacts.error.message);
    const idOf = (address) => contacts.data?.find((row) => row.email === address)?.id;
    if (!idOf(BOUNCED_EMAIL) || !idOf(DELIVERED_EMAIL)) throw new Error('seeded contacts not found');

    await must(
      supabase.from('outbound_sends').insert([
        {
          contact_id: idOf(DELIVERED_EMAIL),
          subject: SEND_SUBJECT,
          body: 'Seed fixture: this send is a record only.',
          status: 'sent',
          sent_at: hours(-48),
        },
        {
          contact_id: idOf(BOUNCED_EMAIL),
          subject: SEND_SUBJECT,
          body: 'Seed fixture: this send is a record only.',
          status: 'failed',
          error: '550 mailbox unavailable',
          sent_at: hours(-47),
        },
      ]),
    );
    await must(
      supabase.from('suppressions').insert({
        email: BOUNCED_EMAIL,
        reason: 'bounced',
        note: 'Seed fixture: the mailbox does not exist.',
        source: 'seed',
      }),
    );
  });


}

async function main() {
  // The variables can come from a file as well as the shell, because `next dev` reads .env.local and a
  // plain node run does not: without this, the message below would send you to a file it never opened.
  // Only the variable names are ever printed, never a value.
  const envFile = process.env.SEED_ENV_FILE ?? '.env.local';
  try {
    process.loadEnvFile?.(envFile);
  } catch {
    // No file is fine; the check below says what is still missing.
  }

  const REQUIRED = [
    ['NEXT_PUBLIC_SUPABASE_URL', 'the staging project URL, e.g. https://abcdefgh.supabase.co'],
    ['SUPABASE_SERVICE_ROLE_KEY', "the project's service role key (Settings > API)"],
    ['SEED_STAFF_PASSWORD', 'a password for the walk-through account, at least 12 characters'],
  ];

  const missing = REQUIRED.filter(([name]) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error('seed: nothing can be written, because the project is not configured.\n');
    for (const [name, what] of missing) console.error(`  ${name} is not set — ${what}`);
    console.error(`\nPut them in the shell that runs this script, or in ${envFile} next to this file:`);
    console.error('the file is gitignored, and this script never prints the values. Set SEED_ENV_FILE to');
    console.error('read a different file.');
    console.error('\nNothing was attempted: no request left this machine.');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const password = process.env.SEED_STAFF_PASSWORD;
  const email = (process.env.SEED_STAFF_EMAIL ?? 'walkthrough@dataleasers.test').trim().toLowerCase();

  let host;
  try {
    host = new URL(url).host;
  } catch {
    console.error(`seed: NEXT_PUBLIC_SUPABASE_URL is not a URL. Expected https://<project>.supabase.co.`);
    process.exit(1);
  }

  if (password.length < 12) {
    console.error('seed: SEED_STAFF_PASSWORD is shorter than 12 characters. Nothing was attempted.');
    process.exit(1);
  }

  if (process.env.SEED_CONFIRM !== 'yes') {
    console.error(`seed: this would write to the Supabase project at ${host}, as ${email}.`);
    console.error('\nIt creates the walk-through account, two companies with a buyer, an introduction,');
    console.error('an offer and an agreement, a partner with two referrals, two channels, three');
    console.error('scheduled posts, a sweep warning, and one send with a suppression.');
    console.error('\nIt deletes and replaces only the rows it created before, and sends nothing to a');
    console.error('provider. Re-run with SEED_CONFIRM=yes to go ahead.');
    process.exit(1);
  }

  console.log(`seed: writing to ${host} as ${email}\n`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    await seed({ supabase, email, password });
  } catch (error) {
    for (const line of failureLines(error)) console.error(line);
    process.exit(1);
  }

  console.log(`\nSeeded. Sign in at /login as ${email} with the password from SEED_STAFF_PASSWORD.`);
  console.log('Nothing was sent to a provider or an inbox; every post and send here is a row.\n');

  const checklist = [
    ['/login', 'Sign in as the seeded admin. No customer data is involved.'],
    ['/marketing', 'Two posts on the Live channel: one scheduled (queued), one in needs_manual with Retry and Cancel. Retry should succeed; Cancel should return its content to the schedule list.'],
    ['/marketing', 'The sweep warning banner is showing, because app_settings.marketing_sweep is set. A real sweep that succeeds clears it; until then it stays.'],
    ['/marketing', 'The post on the Facebook channel is failed with the channel needs_reauth, so Retry is disabled and the row says why. Marking the channel active (admin) should enable it.'],
    ['/health', 'The same sweep warning, the stopped post counted, the dead-channel post counted, and the outbound sends seen as "last send". Nothing should look stuck in publishing.'],
    ['/partners', 'Beacon Introductions with two referrals: one inside the 30-day window (at risk) and one past its deadline. The countdown reads in days, from the Phoenix day.'],
    ['/deliverability', 'This month shows two sends and one bounce from seed.bounce.test, with the suppression listed. Month labels must be Phoenix months: check the month at the top matches the console day, not UTC.'],
    ['/outbound', 'The claims are on the Phoenix day: nothing seeded is due, so no step should be claimable before its date.'],
    ['/audit', 'After using Retry or Cancel, a social_post row appears with your name — that is new on this branch.'],
    ['/dashboard', 'Months and years on the charts follow the Phoenix clock, including "won this year" and the month labels.'],
  ];

  console.log('Walk-through, in order:\n');
  for (const [screen, what] of checklist) console.log(`  ${screen}\n      ${what}\n`);
  console.log('Both of these are worth repeating at 5pm Phoenix, when the console day and UTC part company.');
  console.log('Remove the account and its rows before the project is used for anything real.');
}

// Only the command line runs this: the check imports `seed` and supplies its own client.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
