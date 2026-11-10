#!/usr/bin/env node
// Sets a usable password on a staff account.
//
// Why this exists: accounts created through an invite, or through the dashboard
// without a password, exist and are confirmed but have no password credential,
// so sign-in fails with "Invalid login credentials" for every password typed.
// Supabase Studio cannot set a password on an existing user, so this does it
// through the admin API using the keys already in crm/.env.
//
// Usage, from the crm directory on the server (or locally):
//   node scripts/set-password.mjs you@dataleasers.com 'a-long-new-password'
//
// It never prints the password or any key value.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(paths = ['.env.local', '.env']) {
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      const value = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}

loadEnv();

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/set-password.mjs <email> '<new password>'");
  process.exit(2);
}
if (password.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const target = email.trim().toLowerCase();
const { data: listed, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 200,
});

if (listError) {
  console.error('Could not list users:', listError.message);
  process.exit(1);
}

const user = listed.users.find((u) => (u.email ?? '').toLowerCase() === target);

if (!user) {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: target,
    password,
    email_confirm: true,
  });
  if (createError) {
    console.error('Could not create the user:', createError.message);
    process.exit(1);
  }
  console.log(`Created ${target} (id ${created.user.id}) with a confirmed email and a password.`);
  console.log('Next: add a row to crm_staff for this user, or they will land on /no-access.');
  process.exit(0);
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
  password,
  email_confirm: true,
});

if (updateError) {
  console.error('Could not set the password:', updateError.message);
  process.exit(1);
}

console.log(`Password set for ${target} (id ${user.id}). Email is confirmed.`);
console.log('Sign in at https://app.dataleasers.com/login, then change the password in Supabase.');
