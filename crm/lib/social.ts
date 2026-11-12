// Marketing console rules and the publishing adapter. No database access lives here,
// so the limits, the brand rules and the provider call can be reasoned about on their own.

export type Channel = 'linkedin' | 'facebook' | 'instagram' | 'tiktok' | 'bluesky' | 'x';

export type ChannelSpec = {
  key: Channel;
  label: string;
  limit: number;
  needsMedia: boolean;
  note?: string;
};

// The six channels the console can address. Order is the order they appear in the
// composer: the one with the right audience first.
export const CHANNELS: ChannelSpec[] = [
  {
    key: 'linkedin',
    label: 'LinkedIn (company page)',
    limit: 3000,
    needsMedia: false,
  },
  {
    key: 'facebook',
    label: 'Facebook page',
    limit: 63206,
    needsMedia: false,
  },
  {
    key: 'instagram',
    label: 'Instagram',
    limit: 2200,
    needsMedia: true,
    note: 'Links are not clickable in a caption, so the link belongs in the first comment.',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    limit: 2200,
    needsMedia: true,
    note: 'Video required. Public posting needs the TikTok API audit; before that a post can only go out as a private draft.',
  },
  {
    key: 'bluesky',
    label: 'Bluesky',
    limit: 300,
    needsMedia: false,
  },
  {
    key: 'x',
    label: 'X',
    limit: 280,
    needsMedia: false,
  },
];

export function channelSpec(key: string): ChannelSpec | undefined {
  return CHANNELS.find((c) => c.key === key);
}

export type Lint = { level: 'block' | 'warn'; message: string };

// The claims the site deliberately does not make. These are warnings, not blocks:
// blocking everything gets the rule switched off, and then nothing is checked.
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bfree money\b/i, why: 'the site does not promise free money' },
  { pattern: /\bpassive income\b/i, why: 'the site does not promise passive income' },
  { pattern: /\bguarantee[ds]?\b/i, why: 'the site does not guarantee an outcome' },
  { pattern: /\bget rich\b/i, why: 'the site does not promise wealth' },
];

// A currency figure, a percentage or an "Nx" claim needs its source in the same post.
// This is the machine version of the rule the website already follows, and it is the
// one rule worth blocking on.
const NUMERIC_CLAIM = /(?:\$|£|€)\s?\d[\d,.]*(?:\s?[kKmMbB])?|\b\d+(?:\.\d+)?\s?(?:%|percent\b|x\b)/gi;

export function lintPost(
  body: string,
  opts: { channel: Channel; hasMedia: boolean },
): Lint[] {
  const out: Lint[] = [];
  const spec = channelSpec(opts.channel);
  const text = body.trim();

  if (!text) out.push({ level: 'block', message: 'The post is empty.' });

  if (spec && body.length > spec.limit) {
    out.push({
      level: 'block',
      message: `${spec.label} allows ${spec.limit} characters and this is ${body.length}.`,
    });
  }

  if (spec?.needsMedia && !opts.hasMedia) {
    out.push({ level: 'block', message: `${spec.label} needs an image or a video.` });
  }

  const claims = text.match(NUMERIC_CLAIM) ?? [];
  if (claims.length > 0 && !/https?:\/\//i.test(text)) {
    out.push({
      level: 'block',
      message: `This makes a numeric claim (${claims.slice(0, 3).join(', ')}) with no source link. Add the source URL or remove the figure.`,
    });
  }

  if (/\bmode\b/i.test(text)) {
    out.push({
      level: 'warn',
      message:
        'The buyer’s name was retired from the site. Say "the data buyer" unless written permission exists.',
    });
  }

  for (const banned of BANNED) {
    if (banned.pattern.test(text)) {
      out.push({ level: 'warn', message: `Avoid this phrasing: ${banned.why}.` });
    }
  }

  return out;
}

export function blockingProblems(lints: Lint[]): string[] {
  return lints.filter((l) => l.level === 'block').map((l) => l.message);
}

// Display time is America/Phoenix, which does not observe daylight saving, so the
// offset never moves. Storage is UTC.
export const PHOENIX_OFFSET = '-07:00';

export function phoenixInputToUtc(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}:00${PHOENIX_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type PublishInput = {
  channel: Channel;
  body: string;
  firstComment?: string;
  mediaUrls: string[];
  scheduledFor: string;
  idempotencyKey: string;
};

export type PublishResult =
  | { ok: true; providerPostId: string; permalink?: string }
  | { ok: false; code: string; message: string; retryable: boolean };

// One provider behind one interface. Facebook posts go straight to Meta, because a page we own needs
// no aggregator and no app review: Standard Access covers an app whose own admin posts to a page they
// manage, a long-lived Page token never expires, and there is no per-post cap. Other networks use the
// aggregator, which holds the LinkedIn and TikTok approvals.
export function facebookConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_TOKEN);
}

export function providerConfigured(): boolean {
  return Boolean(process.env.SOCIAL_API_URL && process.env.SOCIAL_API_KEY) || facebookConfigured();
}

// Graph API errors worth distinguishing: 190/102/463/467 are a dead or malformed token and will never
// fix themselves, while 4/17/32/613 are rate limits that will.
function facebookFailure(status: number, json: Record<string, unknown> | null): PublishResult {
  const error = (json?.error ?? null) as Record<string, unknown> | null;
  const code = Number(error?.code ?? 0);
  const message =
    typeof error?.message === 'string'
      ? error.message
      : `Facebook returned ${status} with no explanation`;
  const kind = [190, 102, 463, 467].includes(code)
    ? 'auth'
    : [4, 17, 32, 613].includes(code)
      ? 'rate_limit'
      : code
        ? `graph_${code}`
        : `http_${status}`;
  return {
    ok: false,
    code: kind,
    message: message.slice(0, 300),
    retryable: [4, 17, 32, 613, 2].includes(code) || (!code && status >= 500),
  };
}

// Posts as the Page. A public image URL goes to /photos with the text as its caption; text alone goes
// to /feed, where Meta attaches a link preview for any URL in the message.
async function publishToFacebook(input: PublishInput): Promise<PublishResult> {
  const pageId = process.env.FACEBOOK_PAGE_ID!;
  const token = process.env.FACEBOOK_PAGE_TOKEN!;
  const version = process.env.FACEBOOK_API_VERSION ?? 'v26.0';
  const root = `https://graph.facebook.com/${version}/${pageId}`;
  const media = input.mediaUrls[0];

  const form = new URLSearchParams({ access_token: token });
  if (media) {
    form.set('url', media);
    form.set('caption', input.body);
  } else {
    form.set('message', input.body);
  }

  try {
    const response = await fetch(media ? `${root}/photos` : `${root}/feed`, {
      method: 'POST',
      body: form,
    });
    const raw = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }

    if (!response.ok) return facebookFailure(response.status, json);

    const id = typeof json?.id === 'string' ? json.id : '';
    if (!id) {
      return {
        ok: false,
        code: 'no_id',
        message: 'Facebook accepted the post but returned no id, so it cannot be confirmed.',
        retryable: false,
      };
    }

    // A first comment is posted separately; failing to attach it must not fail the post itself.
    if (input.firstComment && !media) {
      try {
        await fetch(`https://graph.facebook.com/${version}/${id}/comments`, {
          method: 'POST',
          body: new URLSearchParams({ access_token: token, message: input.firstComment }),
        });
      } catch {
        // Left as a note for a person to add by hand.
      }
    }

    return { ok: true, providerPostId: id, permalink: `https://www.facebook.com/${id}` };
  } catch (error) {
    return {
      ok: false,
      code: 'network',
      message: error instanceof Error ? error.message.slice(0, 300) : 'Network error',
      retryable: true,
    };
  }
}

export async function publishPost(input: PublishInput): Promise<PublishResult> {
  if (input.channel === 'facebook' && facebookConfigured()) {
    return publishToFacebook(input);
  }

  const url = process.env.SOCIAL_API_URL;
  const key = process.env.SOCIAL_API_KEY;
  if (!url || !key) {
    return {
      ok: false,
      code: 'not_configured',
      message: 'No publishing provider is configured on the server yet.',
      retryable: false,
    };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        platform: input.channel,
        text: input.body,
        first_comment: input.firstComment ?? null,
        media: input.mediaUrls,
        scheduled_at: input.scheduledFor,
      }),
    });

    const raw = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429
            ? 'rate_limit'
            : `http_${response.status}`;
      const message =
        (typeof json?.message === 'string' && json.message) || raw || `Provider returned ${response.status}`;
      return {
        ok: false,
        code,
        message: message.slice(0, 300),
        retryable: response.status === 429 || response.status >= 500,
      };
    }

    const nested = (json?.data ?? null) as Record<string, unknown> | null;
    const id = json?.id ?? json?.post_id ?? nested?.id ?? '';
    const permalink = json?.url ?? json?.permalink ?? nested?.url;
    return {
      ok: true,
      providerPostId: String(id ?? ''),
      permalink: typeof permalink === 'string' ? permalink : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'network',
      message: error instanceof Error ? error.message.slice(0, 300) : 'Network error',
      retryable: true,
    };
  }
}

// Backoff ladder for a failed post. null means stop retrying and leave it for a person.
export function retryDelayMinutes(attempts: number): number | null {
  const ladder = [1, 5, 30, 60, 180, 360];
  return ladder[attempts - 1] ?? null;
}
