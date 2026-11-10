import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// TEMPORARY diagnostics for a sign-in outage where every account was rejected
// with `invalid_credentials`. It reports which project the deployment talks to,
// whether the anon and service keys belong to the same project, and whether the
// test account exists there. It never returns a key. Delete once sign-in works.

export const dynamic = 'force-dynamic';

const TEST_EMAIL = 'aicoder@dataleasers.com';

function jwtRef(token: string | undefined): string | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
    return typeof json.ref === 'string' ? json.ref : null;
  } catch {
    return null;
  }
}

function hostRef(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url);
  return m ? m[1] : null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const out: Record<string, unknown> = {
    supabaseHost: url.replace(/^https?:\/\//, '') || '(unset)',
    looksLocal: /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url),
    hostRef: hostRef(url),
    anonKeyRef: jwtRef(anonKey),
    serviceKeyRef: jwtRef(serviceKey),
    anonKeyLooksLikeJwt: Boolean(anonKey && anonKey.split('.').length === 3),
    anonKeyFormat: !anonKey
      ? '(unset)'
      : anonKey.startsWith('sb_publishable_')
        ? 'sb_publishable'
        : anonKey.split('.').length === 3
          ? 'legacy-jwt'
          : 'unknown',
    keysMatchHost: hostRef(url) !== null && jwtRef(anonKey) === hostRef(url),
    serviceKeyMatchesHost: hostRef(url) !== null && jwtRef(serviceKey) === hostRef(url),
    anonKeyTail: anonKey ? anonKey.slice(-6) : null,
  };

  if (!url || !serviceKey) {
    out.note = 'missing url or service key on the server';
    return NextResponse.json(out, { status: 200 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const leads = await admin.from('leads').select('*', { count: 'exact', head: true });
  out.leadsCount = leads.count ?? null;
  out.leadsError = leads.error?.message ?? null;

  const staff = await admin.from('crm_staff').select('*', { count: 'exact', head: true });
  out.staffCount = staff.count ?? null;
  out.staffError = staff.error?.message ?? null;

  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  out.usersError = users.error?.message ?? null;
  const all = users.data?.users ?? [];
  out.totalUsers = all.length;
  out.userEmails = all.map((u) => u.email);
  const match = all.find((u) => (u.email ?? '').toLowerCase() === TEST_EMAIL);
  out.testUser = match
    ? {
        exists: true,
        confirmed: Boolean(match.email_confirmed_at),
        createdAt: match.created_at,
        lastSignInAt: match.last_sign_in_at,
        provider: match.app_metadata?.provider ?? null,
        providers: match.app_metadata?.providers ?? null,
        hasPassword: (match.identities ?? []).some((i) => i.provider === 'email'),
      }
    : { exists: false };

  // Does the anon key work at all? The email-link path depends on it.
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey ?? '', Authorization: `Bearer ${anonKey ?? ''}` },
      cache: 'no-store',
    });
    out.settingsStatus = res.status;
    const settings = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    out.emailProviderEnabled = Boolean((settings?.external as Record<string, unknown>)?.email);
    out.mailerAutoconfirm = settings?.mailer_autoconfirm ?? null;
    out.disableSignup = settings?.disable_signup ?? null;
  } catch (e) {
    out.settingsStatus = `fetch failed: ${(e as Error).message}`;
  }

  // The exact call the sign-in form makes, with a deliberately wrong password,
  // to separate a bad key from a bad password.
  const anon = createClient(url, anonKey ?? '', { auth: { persistSession: false } });
  const probe = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: 'not-the-real-password-probe',
  });
  out.passwordProbe = {
    code: probe.error?.code ?? null,
    status: probe.error?.status ?? null,
    message: probe.error?.message ?? null,
    returnedSession: Boolean(probe.data?.session),
  };

  return NextResponse.json(out, { status: 200 });
}
