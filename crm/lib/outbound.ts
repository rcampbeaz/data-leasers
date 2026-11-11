// Outbound rules. Pure functions so the guard can be reasoned about without a database,
// and so the same answer is given by the composer, the importer and the cron sender.

export type Basis =
  | 'opt_out_only'
  | 'consent_express'
  | 'consent_implied'
  | 'existing_relationship'
  | 'corporate_subscriber';

export const BASIS_LABELS: Record<Basis, string> = {
  opt_out_only: 'US opt-out regime (CAN-SPAM): no consent needed, unsubscribe honoured',
  consent_express: 'Express consent on record',
  consent_implied: 'Implied consent (conspicuous publication or existing enquiry)',
  existing_relationship: 'Existing business relationship',
  corporate_subscriber: 'UK corporate subscriber (PECR)',
};

// What each market accepts for a *first* commercial email. The US is opt-out; Canada and
// Australia require consent; the UK allows corporate subscribers but treats sole traders
// and ordinary partnerships as individuals.
const ACCEPTED: Record<string, Basis[]> = {
  US: ['opt_out_only', 'consent_express', 'consent_implied', 'existing_relationship', 'corporate_subscriber'],
  CA: ['consent_express', 'consent_implied', 'existing_relationship'],
  GB: ['corporate_subscriber', 'consent_express', 'consent_implied', 'existing_relationship'],
  AU: ['consent_express', 'consent_implied', 'existing_relationship'],
};

export const SUPPORTED_COUNTRIES = Object.keys(ACCEPTED);

export const COUNTRY_NOTES: Record<string, string> = {
  US: 'CAN-SPAM: no prior consent, but accurate headers, a postal address and opt-outs honoured within 10 business days.',
  CA: 'CASL: express or implied consent only. A published address counts only with no "no unsolicited messages" notice and only when the message is relevant to the role.',
  GB: 'PECR: email to corporate subscribers is allowed; sole traders and ordinary partnerships need consent or the soft opt-in.',
  AU: 'Spam Act: consent required, unsubscribe must keep working for 30 days and requests actioned within 5 working days.',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

// A From header arrives as `Name <addr@example.com>`, sometimes with a mailto: prefix and
// often with trailing punctuation from a forwarded body. Bare addresses pass through, so
// this is safe to call on anything a person typed as well.
const ANGLE_ADDRESS = /<([^<>\s]+@[^<>\s]+)>/;
const BARE_ADDRESS = /[^\s<>,;:"]+@[^\s<>,;:"]+/;

export function extractEmail(value: string): string {
  const raw = (value ?? '').trim();
  const angled = ANGLE_ADDRESS.exec(raw);
  if (angled) return normaliseEmail(angled[1].replace(/^mailto:/i, ''));
  const bare = BARE_ADDRESS.exec(raw.replace(/^mailto:/i, ''));
  return normaliseEmail(bare ? bare[0].replace(/[.,;:]+$/, '') : raw);
}

export type GuardInput = {
  email: string;
  country: string | null;
  basis: string;
  suppressed: boolean;
};

export type GuardResult = { ok: true } | { ok: false; reason: string };

// The single door every send goes through.
export function sendGuard(input: GuardInput): GuardResult {
  const email = normaliseEmail(input.email ?? '');
  if (!EMAIL.test(email)) return { ok: false, reason: 'That is not a valid email address.' };
  if (input.suppressed) {
    return { ok: false, reason: 'That address is on the suppression list and must not be contacted.' };
  }

  const country = (input.country ?? '').toUpperCase();
  const accepted = ACCEPTED[country];
  if (!accepted) {
    return {
      ok: false,
      reason: 'Set the country first. Each market has different rules for a first commercial email.',
    };
  }

  if (!accepted.includes(input.basis as Basis)) {
    return {
      ok: false,
      reason: `${BASIS_LABELS[input.basis as Basis] ?? 'That basis'} is not lawful for a first commercial email in ${country}. ${COUNTRY_NOTES[country] ?? ''}`.trim(),
    };
  }

  return { ok: true };
}

// Licensing and sender details have to exist before anything can legally go out.
export function senderConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.OUTBOUND_FROM_EMAIL && process.env.POSTAL_ADDRESS);
}

export function unsubscribeUrl(token: string): string {
  const base = process.env.CRM_ORIGIN ?? 'https://app.dataleasers.com';
  return `${base}/unsubscribe?token=${encodeURIComponent(token)}`;
}

// CAN-SPAM requires the postal address; every market requires an identifiable sender and a
// working opt-out. Generated at send time so the link carries the contact's own token.
export function complianceFooter(opts: { postalAddress: string; unsubscribe: string }): string {
  return [
    '',
    '---',
    'You are receiving this because your firm appeared in our research on company data licensing.',
    `Unsubscribe from all future messages: ${opts.unsubscribe}`,
    opts.postalAddress,
  ].join('\n');
}

// Rendered into the message body. Providers differ on HTML support, so this stays plain.
export function renderEmail(opts: { body: string; footer: string }): string {
  return `${opts.body.trim()}\n${opts.footer}`;
}
