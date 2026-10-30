import { createIntakeClient } from '@/lib/supabase';

// Public intake for the "Book a call" form on the website.
// Accepts form posts only from the public site origin, validates input, and stores a lead.

const ALLOWED_ORIGINS = [
  process.env.PUBLIC_SITE_ORIGIN ?? 'https://dataleasers.com',
  'https://www.dataleasers.com',
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function back(path: string) {
  const site = process.env.PUBLIC_SITE_ORIGIN ?? 'https://dataleasers.com';
  return new Response(null, {
    status: 303,
    headers: { Location: `${site}/${path}` },
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }

  const form = await request.formData();

  // Honeypot: real visitors leave this empty. Pretend success for bots.
  if (String(form.get('website') ?? '') !== '') {
    return back('contact.html?sent=1');
  }

  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const company = String(form.get('company') ?? '').trim();
  const roleTitle = String(form.get('role') ?? '').trim();
  const dataNote = String(form.get('data') ?? '').trim();

  const valid =
    name.length >= 1 && name.length <= 200 &&
    EMAIL.test(email) && email.length <= 320 &&
    company.length >= 1 && company.length <= 200 &&
    roleTitle.length <= 200 && dataNote.length <= 2000;

  if (!valid) {
    return back('contact.html?error=1');
  }

  const supabase = createIntakeClient();
  const { error } = await supabase.from('leads').insert({
    name,
    email,
    company,
    role_title: roleTitle || null,
    data_note: dataNote || null,
    source_page: 'contact',
  });

  if (error) {
    console.error('lead insert failed', error.code);
    return back('contact.html?error=1');
  }

  return back('contact.html?sent=1');
}
