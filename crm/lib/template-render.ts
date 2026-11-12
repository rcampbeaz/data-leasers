// Merge fields for email templates, and the renderer that fills them at send time.
//
// Pure functions: a template is stored with {{placeholders}} intact so that correcting the copy
// fixes every future message, and rendering happens once, at the moment of sending. Keeping this
// out of the database means a preview can show exactly what will be sent.
//
// A missing value never leaves a raw {{placeholder}} in a sent email. First names fall back to
// "there" because a greeting is the one place a placeholder would be read as a bug; everything
// else falls back to empty, which reads as slightly terse rather than broken.

export const MERGE_FIELDS = ['first_name', 'full_name', 'role_title', 'email', 'company'] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeContext = Partial<Record<MergeField, string | null | undefined>>;

const FIELD_LABELS: Record<MergeField, string> = {
  first_name: 'First name, or "there" when unknown',
  full_name: 'Full name as recorded on the contact',
  role_title: 'Role, for example Managing partner',
  email: 'The contact address',
  company: 'Linked company name',
};

export function mergeFieldHelp(): { field: MergeField; label: string; token: string }[] {
  return MERGE_FIELDS.map((field) => ({
    field,
    label: FIELD_LABELS[field],
    token: `{{${field}}}`,
  }));
}

const TOKEN = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

// Every placeholder used in the text, lowercased and de-duplicated, in first-appearance order.
export function fieldsUsed(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1].toLowerCase();
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

// Placeholders the sender does not know how to fill. Surfaced in the UI so a typo such as
// {{firstname}} is caught while writing rather than appearing in somebody's inbox.
export function unknownFields(text: string): string[] {
  return fieldsUsed(text).filter((name) => !(MERGE_FIELDS as readonly string[]).includes(name));
}

// The first word of a full name, which is what a greeting needs. Empty when unusable.
export function firstNameOf(fullName: string | null | undefined): string {
  const cleaned = (fullName ?? '').trim();
  if (!cleaned) return '';
  const first = (cleaned.split(/\s+/)[0] ?? '').replace(/[.,;:]+$/, '');
  // A single initial reads badly as a greeting ("Hi J,"), so it counts as missing and the
  // greeting falls back to "there".
  return first.length > 1 ? first : '';
}

function valueFor(field: MergeField, ctx: MergeContext): string {
  if (field === 'first_name') return (ctx.first_name ?? '').trim() || 'there';
  return (ctx[field] ?? '').toString().trim();
}

// Unknown placeholders are left untouched: silently deleting them would hide a mistake, and this
// text is only ever sent after a person has seen it on the approval screen.
export function renderTemplate(text: string, ctx: MergeContext): string {
  return text.replace(TOKEN, (whole, raw: string) => {
    const name = raw.toLowerCase();
    if (!(MERGE_FIELDS as readonly string[]).includes(name)) return whole;
    return valueFor(name as MergeField, ctx);
  });
}

// Subject and body rendered in one call, so a subject can use the same fields as the body.
export function renderMessage(
  input: { subject: string; body: string },
  ctx: MergeContext,
): { subject: string; body: string } {
  return {
    subject: renderTemplate(input.subject, ctx),
    body: renderTemplate(input.body, ctx),
  };
}
