#!/usr/bin/env node
// Gives a staff account a working password.
//
// Why this exists: an account created through an invite, or created without a
// password, exists and is confirmed but has no password credential. Sign-in
// then fails with "Invalid login credentials" for every password typed, and
// Supabase Studio cannot set a password on an existing user.
//
// Usage:
//   node scripts/set-password.mjs <email> '<new password>'
//   node scripts/set-password.mjs <email> '<new password>' --recreate
//
// Run it from the crm directory (the one holding .env), or export
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY yourself. It uses plain fetch, so
// it needs no installed packages. It never prints the password or any key.

import { readFileSync } from 'node:fs';

// Top-level await failures land here, so the message stays readable.
const fail = (e) => {
  console.error(e?.message ?? e);
  process.exit(1);
};
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

const USAGE = `Usage:
  node scripts/set-password.mjs <email> '<new password>' [--recreate]

  --recreate  delete and recreate the account if its password cannot be set

Environment (read from .env, .env.local or ../.env if not already set):
  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Run this from the crm directory, which is where .env lives.`;

// Only fills in what the shell did not already provide.
function loadEnvFile(paths) {
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const args = process.argv.slice(2);
const recreate = args.includes('--recreate');
const [emailArg, password] = args.filter((a) => a !== '--recreate');
const email = (emailArg ?? '').trim().toLowerCase();

if (!email || !password) {
  console.error(USAGE);
  process.exit(2);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`"${email}" does not look like an email address.`);
  process.exit(2);
}
if (password.length < 12) {
  console.error('Pick a password of at least 12 characters.');
  process.exit(2);
}

loadEnvFile(['.env.local', '.env', '../.env']);

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!url || !serviceKey) {
  console.error('Missing Supabase configuration.');
  console.error(url ? '  SUPABASE_SERVICE_ROLE_KEY is not set.' : '  SUPABASE_URL is not set.');
  console.error('');
  console.error('If you are not in the crm directory, cd into it first:');
  console.error('  cd crm && node scripts/set-password.mjs ...');
  process.exit(1);
}

const host = url.replace(/^https?:\/\//, '');

async function api(path, { method = 'GET', body, key = serviceKey } = {}) {
  let res;
  try {
    res = await fetch(`${url}/auth/v1${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`Could not reach ${host}: ${e.message}`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    const detail = json?.msg ?? json?.message ?? json?.error_description ?? text.slice(0, 200);
    const err = new Error(`${method} ${path} failed (${res.status}): ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

console.log(`Project: ${host}`);

const listed = await api('/admin/users?page=1&per_page=200');
const user = (listed?.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);

let userId;

if (user) {
  userId = user.id;
  console.log(`Found ${email}. Setting a password…`);
  try {
    await api(`/admin/users/${userId}`, {
      method: 'PUT',
      body: { password, email_confirm: true },
    });
  } catch (e) {
    if (!recreate) {
      console.error(e.message);
      console.error('Re-run with --recreate to delete and recreate this account.');
      process.exit(1);
    }
    console.log('Could not update it; recreating the account…');
    await api(`/admin/users/${userId}`, { method: 'DELETE' });
    const made = await api('/admin/users', {
      method: 'POST',
      body: { email, password, email_confirm: true },
    });
    userId = made.id;
  }
} else {
  console.log(`${email} does not exist here; creating it…`);
  const made = await api('/admin/users', {
    method: 'POST',
    body: { email, password, email_confirm: true },
  });
  userId = made.id;
}

// Prove it works by making the same call the sign-in form makes.
if (anonKey) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body?.access_token) {
    console.log(`Verified: ${email} can now sign in.`);
  } else {
    console.error(`Password was set, but sign-in still fails (${res.status}): ${body?.error_description ?? body?.msg ?? body?.message ?? ''}`);
    process.exit(1);
  }
} else {
  console.log('Set, but not verified (NEXT_PUBLIC_SUPABASE_ANON_KEY is absent).');
}

console.log(`Account id: ${userId}`);
console.log('Next: sign in at https://app.dataleasers.com/login, then change the password.');
