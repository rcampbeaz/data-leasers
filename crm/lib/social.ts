// Social console rules, shared by the composer in the browser and the server action
// that saves the post. Defining the platform limits once means the preview cannot
// disagree with the server about what will be accepted.

export const PLATFORMS = ['facebook', 'instagram', 'linkedin', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

// An asset already uploaded, as the composer needs it to offer reuse rather than a second
// upload of the same file. One file, one rights note.
export type MediaLibraryItem = {
  id: string;
  url: string;
  kind: 'image' | 'video';
  altText: string;
  rightsNote: string;
  // Shown in the picker: two uploads can share an alt text, and the date is what tells
  // them apart.
  createdAt: string;
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
};

export type MediaKind = 'image' | 'video';

type PlatformRules = {
  // Character ceiling the platform enforces on the text itself.
  maxChars: number;
  // What the platform refuses to publish without.
  needsMedia: MediaKind | 'none';
  // Whether a link in the text is clickable. Instagram and TikTok are not.
  linksClickable: boolean;
  // Shown next to the preview so the reason for a check is visible.
  note: string;
};

// Ceilings are the platforms' published limits for a text post from a business
// account, as of November 2026. They are deliberately the only numbers in here
// that come from somewhere other than this repository.
export const RULES: Record<Platform, PlatformRules> = {
  facebook: {
    maxChars: 63206,
    needsMedia: 'none',
    linksClickable: true,
    note: 'Posts to the DataLeasers Page.',
  },
  instagram: {
    maxChars: 2200,
    needsMedia: 'image',
    linksClickable: false,
    note: 'A caption needs a photo or video, and links in the caption are not clickable.',
  },
  linkedin: {
    maxChars: 3000,
    needsMedia: 'none',
    linksClickable: true,
    note: 'Posts as the company page, not as a person.',
  },
  tiktok: {
    maxChars: 2200,
    needsMedia: 'video',
    linksClickable: false,
    note: 'A video is required. The caption is not a place for links.',
  },
};

export type Issue = { level: 'error' | 'warning'; message: string };

export type PostDraft = {
  body: string;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
  // The uploaded asset, when there is one. The server reads its address from the asset so
  // the post cannot pair one file's URL with another file's rights note.
  mediaId: string | null;
  // Phoenix local time, "YYYY-MM-DDTHH:mm", or null to keep it as a draft.
  scheduledFor: string | null;
  channels: { channelId: string; body: string | null }[];
};

export function charCount(text: string): number {
  return Array.from(text).length;
}

// Counts code points, so an emoji is one character rather than two. The platforms
// are not this generous about emoji, but over-reporting the remaining space is
// worse than under-reporting it.
export function remaining(platform: Platform, text: string): number {
  return RULES[platform].maxChars - charCount(text);
}

export function mediaKindFor(url: string | null): MediaKind | null {
  if (!url) return null;
  const path = url.split('?')[0].toLowerCase();
  return /\.(mp4|mov|m4v|webm)$/.test(path) ? 'video' : 'image';
}

// The house rules, enforced in the same place as the platform ones.
//
// A figure with no source is the mistake that costs the most: this company's whole
// argument is that its numbers are traceable. A post that quotes a statistic with
// nothing to click is the one error worth blocking rather than warning about.
const MONEY = /\$\s?\d|\b\d[\d,.]*\s?(?:k|m|million|billion)\b/i;
const PERCENT = /\b\d+(?:\.\d+)?\s?%/;
const MULTIPLE = /\b\d+(?:\.\d+)?\s?[x×]\b/i;
const HAS_LINK = /https?:\/\//i;
const BUYER_NAME = /\bMode\b/;
const CASING = /Data Leasers|Dataleasers/;

export function brandIssues(text: string): Issue[] {
  const issues: Issue[] = [];
  const citesSomething = HAS_LINK.test(text);

  if (!citesSomething && (MONEY.test(text) || PERCENT.test(text) || MULTIPLE.test(text))) {
    issues.push({
      level: 'error',
      message: 'A figure with nothing to click: add the link you are citing, or take the number out.',
    });
  }
  if (BUYER_NAME.test(text)) {
    issues.push({
      level: 'warning',
      message: 'Name the counterparty "the data buyer" rather than a partner by name.',
    });
  }
  if (CASING.test(text)) {
    issues.push({ level: 'warning', message: 'The brand is written DataLeasers, one word.' });
  }
  return issues;
}

export function issuesForChannel(
  platform: Platform,
  text: string,
  opts: { mediaKind: MediaKind | null; hasLink: boolean },
): Issue[] {
  const rules = RULES[platform];
  const issues: Issue[] = [];
  const count = charCount(text);

  if (!text.trim()) issues.push({ level: 'error', message: 'There is no text for this channel.' });
  if (count > rules.maxChars) {
    issues.push({
      level: 'error',
      message: `${count - rules.maxChars} characters over the ${rules.maxChars.toLocaleString('en-US')} limit.`,
    });
  }
  if (rules.needsMedia === 'image' && !opts.mediaKind) {
    issues.push({ level: 'error', message: 'Needs a photo or video: add a media URL.' });
  }
  if (rules.needsMedia === 'video' && opts.mediaKind !== 'video') {
    issues.push({ level: 'error', message: 'Needs a video: add a video URL.' });
  }
  if (!rules.linksClickable && opts.hasLink) {
    issues.push({
      level: 'warning',
      message: 'A link here is not clickable. Put it in the profile link instead.',
    });
  }
  return [...issues, ...brandIssues(text)];
}

// The checks that decide whether a post can go out at all, as opposed to whether it
// reads well. Every path that can put a post on the calendar runs this: the composer
// when it saves, and the queue when it moves a draft to a time. Two callers of the
// same list is the point — a draft scheduled from the queue must not be able to reach
// a platform that will reject it.
export function postErrors(input: {
  body: string;
  linkUrl: string | null;
  mediaUrl: string | null;
  channels: { platform: Platform; body: string | null }[];
}): string[] {
  const mediaKind = mediaKindFor(input.mediaUrl?.trim() || null);
  const hasLink = Boolean(input.linkUrl?.trim()) || /https?:\/\//i.test(input.body);
  const found: string[] = [];

  for (const channel of input.channels) {
    const text = channel.body?.trim() || input.body;
    for (const issue of issuesForChannel(channel.platform, text, { mediaKind, hasLink })) {
      if (issue.level === 'error') {
        found.push(`${PLATFORM_LABELS[channel.platform]}: ${issue.message}`);
      }
    }
  }

  // The same brand problem on four channels is one problem to fix.
  return [...new Set(found)];
}

// ---------- time ----------
//
// Arizona does not observe daylight saving, so Phoenix is UTC-7 all year. That is
// a fixed offset rather than a zone lookup, and it is the reason every conversion
// here can be done with arithmetic instead of a timezone library.

export const PHOENIX_OFFSET_MINUTES = -420;

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function shifted(iso: string): Date {
  return new Date(Date.parse(iso) + PHOENIX_OFFSET_MINUTES * 60_000);
}

// "YYYY-MM-DDTHH:mm" in Phoenix to an ISO instant.
export function phoenixToUtc(local: string): string | null {
  if (!LOCAL_INPUT.test(local)) return null;
  const ms = Date.parse(`${local}:00-07:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// An instant back to the value a datetime-local input expects, in Phoenix.
export function utcToPhoenixInput(iso: string): string {
  const d = shifted(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// An instant as the calendar day it falls on in Phoenix.
export function phoenixDayKey(iso: string): string {
  return shifted(iso).toISOString().slice(0, 10);
}

export function phoenixLabel(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
): string {
  // shifted() is the Phoenix wall clock expressed as UTC, so formatting it as UTC
  // prints Phoenix time without asking the runtime for a zone database.
  return shifted(iso).toLocaleString('en-US', { timeZone: 'UTC', ...opts });
}

export function phoenixClock(iso: string): string {
  return phoenixLabel(iso, { hour: 'numeric', minute: '2-digit' });
}

export function phoenixMonthKey(now: Date = new Date()): string {
  const d = shifted(now.toISOString());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function parseMonthKey(value: string | undefined): { year: number; month: number } {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split('-').map((part) => Number.parseInt(part, 10));
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = shifted(new Date().toISOString());
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
}

export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

// The grid starts on the Sunday on or before the first of the month, and always
// covers six weeks so the height does not jump between months.
export function monthGrid(year: number, month: number): { key: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const startMs = first.getTime() - first.getUTCDay() * 86_400_000;
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(startMs + i * 86_400_000);
    return {
      key: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
    };
  });
}

export function gridRange(year: number, month: number): { from: string; to: string } {
  const cells = monthGrid(year, month);
  const from = phoenixToUtc(`${cells[0].key}T00:00`)!;
  const to = phoenixToUtc(`${cells[cells.length - 1].key}T00:00`)!;
  return { from, to: new Date(Date.parse(to) + 86_400_000).toISOString() };
}

export function isDay(value: string | null | undefined): value is string {
  return !!value && DAY.test(value);
}
