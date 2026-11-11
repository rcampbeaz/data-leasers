// Verifying a Resend webhook. Resend signs with Svix, so the signature is an HMAC-SHA256 over
// `id.timestamp.payload`, keyed with the base64-decoded signing secret, and sent as
// `v1,<base64 signature>`. Pure functions, so the door can be tested without the provider.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type SvixInput = {
  id: string;
  timestamp: string;
  signature: string;
  payload: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
};

// The secret is issued as `whsec_<base64>`. The prefix is not part of the key.
export function signingKey(secret: string): Buffer {
  const raw = (secret ?? '').trim();
  const base64 = raw.startsWith('whsec_') ? raw.slice('whsec_'.length) : raw;
  return Buffer.from(base64, 'base64');
}

export function expectedSignature(
  id: string,
  timestamp: string,
  payload: string,
  secret: string,
): string {
  return createHmac('sha256', signingKey(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

// Fails closed on anything missing. A replay window is enforced because a captured request is
// otherwise valid forever, and a webhook that suppresses addresses is worth replaying.
export function verifySvixSignature(input: SvixInput): VerifyResult {
  const { id, timestamp, signature, payload, secret } = input;
  if (!secret) return { ok: false, reason: 'no signing secret configured' };
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing signature headers' };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'unreadable timestamp' };
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(nowSeconds - seconds) > tolerance) return { ok: false, reason: 'timestamp outside tolerance' };

  const expected = Buffer.from(expectedSignature(id, timestamp, payload, secret));
  // Svix sends every active signature, space separated, while a secret is being rotated.
  const candidates = signature.split(/\s+/).filter(Boolean);
  for (const candidate of candidates) {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no matching signature' };
}

export type ResendEvent =
  | { kind: 'bounce'; emails: string[]; permanent: boolean; detail: string }
  | { kind: 'complaint'; emails: string[]; detail: string }
  | { kind: 'ignore'; reason: string };

function recipients(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return list
    .map((item) => String(item ?? '').trim().toLowerCase())
    .filter((email) => email.includes('@') && email.length <= 320);
}

// Only a permanent bounce means the address is dead. A transient bounce is a delay at the far
// end, and suppressing on it would remove good addresses from the list.
export function classifyResendEvent(body: unknown): ResendEvent {
  const root = body as { type?: unknown; data?: Record<string, unknown> } | null;
  const type = typeof root?.type === 'string' ? root.type : '';
  const data = root?.data ?? {};
  const emails = recipients(data.to);

  if (type === 'email.bounced') {
    if (emails.length === 0) return { kind: 'ignore', reason: 'bounce with no recipients' };
    const bounce = (data.bounce ?? {}) as { type?: unknown; subType?: unknown; message?: unknown };
    const bounceType = String(bounce.type ?? '');
    const detail = [bounce.subType, bounce.message]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join(': ')
      .slice(0, 1000);
    return {
      kind: 'bounce',
      emails,
      permanent: /permanent/i.test(bounceType),
      detail: detail || bounceType || 'bounce',
    };
  }

  if (type === 'email.complained') {
    if (emails.length === 0) return { kind: 'ignore', reason: 'complaint with no recipients' };
    return { kind: 'complaint', emails, detail: 'Marked as spam by the recipient' };
  }

  return { kind: 'ignore', reason: type ? `event ${type} is not handled` : 'no event type' };
}
