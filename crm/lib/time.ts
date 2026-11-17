// One clock for the whole console.
//
// Every time a page shows is Phoenix time, resolved from the zone rather than by subtracting hours or
// by leaving a Date to the server's own zone. Phoenix is UTC−7 all year — Arizona does not observe
// daylight saving — but nothing here depends on that being true: change the zone and every page changes
// with it.
//
// There are two kinds of value in this system and they are formatted differently on purpose:
//
//   - an instant (created_at, sent_at, scheduled_for) is a moment, and is shown on the console's clock;
//   - a calendar date (due_on, deadline_on, paid_on) is a day, with no time and no zone at all, so it is
//     formatted as the day it already is. Putting one through a zone would move it.
//
// Days, months and years all come from here, so there is one answer to "what day is it" rather than a
// Date expression per page. A missing or unreadable value comes back as an empty string instead of
// throwing: these are printed straight into table cells, and a nullable column is a blank cell.

export const TIME_ZONE = 'America/Phoenix';

type Time = string | number | Date | null | undefined;
type DayValue = string | Date | null | undefined;

function parse(when: Time): Date | null {
  if (when === null || when === undefined || when === '') return null;
  const at = new Date(when);
  return Number.isNaN(at.getTime()) ? null : at;
}

// A stored day as "2026-11-17". A Date is read as the UTC day it names — the day the database stored,
// not the day it happens to be on this server. Anything else is '', including the number an untyped row
// can carry, which is what lets the functions below be written without their own guards or casts.
function dayOf(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return '';
}

// Building an Intl formatter is the expensive half of formatting, so each shape is built once and kept.
// The options are the key because they are what define a shape.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let built = FORMATTERS.get(key);
  if (!built) {
    built = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    FORMATTERS.set(key, built);
  }
  return built;
}

// Anything human-readable: "Nov 17, 2026, 1:04 PM" with dateStyle and timeStyle, "Nov 17, 2026" with
// dateStyle alone, or the field options a chart label needs.
export function phoenix(when: Time, options: Intl.DateTimeFormatOptions): string {
  const at = parse(when);
  return at ? formatter(options, TIME_ZONE).format(at) : '';
}

// The machine-readable shapes — a sortable day, a clock time, a stamp and the value a datetime-local
// input expects — built from parts, so none of them depends on how a formatted string happens to look.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function keyOf(when: Time): { date: string; clock: string } {
  const at = parse(when);
  if (!at) return { date: '', clock: '' };
  const parts = PARTS.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    clock: `${get('hour')}:${get('minute')}`,
  };
}

export function phoenixDay(when: Time): string {
  return keyOf(when).date;
}

// The console's day right now, for the comparisons that ask whether something is due yet.
export function todayIso(): string {
  return phoenixDay(Date.now());
}

export function phoenixClock(when: Time): string {
  return keyOf(when).clock;
}

export function phoenixStamp(when: Time): string {
  const { date, clock } = keyOf(when);
  return date ? `${date} ${clock}` : '';
}

// The value a datetime-local input expects, on the console's clock.
export function phoenixInput(when: Time): string {
  const { date, clock } = keyOf(when);
  return date ? `${date}T${clock}` : '';
}

// The inverse: a datetime-local value on the console's clock as the instant it means. The offset is read
// from the zone rather than written down, so both directions move together; one correction is exact
// because Phoenix's offset never changes. An impossible date — 31 February — rolls over in Date.UTC, so
// the round trip back through the helpers is also the check.
export function phoenixInputToUtc(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const at = new Date(asUtc - (Date.parse(`${phoenixDay(asUtc)}T${phoenixClock(asUtc)}:00Z`) - asUtc));
  const wanted = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  return phoenixStamp(at) === wanted ? at : null;
}

// The month or year an instant falls in on the console's clock, as "2026-11" and "2026": a chart bucket
// or a folder named from UTC would be a month ahead during the last seven hours of a month.
export function phoenixMonth(when: Time): string {
  return keyOf(when).date.slice(0, 7);
}

export function phoenixYear(when: Time): string {
  return keyOf(when).date.slice(0, 4);
}

// The last `count` months, oldest first, ending with the console's current month.
export function phoenixMonths(count: number, when: Time = Date.now()): string[] {
  const current = phoenixMonth(when);
  if (!current || count < 1) return [];
  return Array.from({ length: count }, (_, index) => shiftMonth(current, index + 1 - count));
}

// A day shown as "Nov 17, 2026". Formatted in UTC deliberately — not on the console's clock — because
// the value is already a day, and shifting it by a zone is how a deadline ends up on the wrong date.
export function calendarDate(value: DayValue): string {
  const day = dayOf(value);
  if (!day) return '';
  const [year, month, date] = day.split('-').map(Number);
  return formatter({ dateStyle: 'medium' }, 'UTC').format(new Date(Date.UTC(year, month - 1, date)));
}

// The year a stored day already belongs to: "2026" from "2026-01-01". Read off the value rather than
// converted, because 1 January has to be its own year — a Phoenix conversion of a UTC midnight would
// move it back. A year of an instant is phoenixYear instead.
export function calendarYear(value: DayValue): string {
  return dayOf(value).slice(0, 4);
}

// A calendar month: "2026-11" from a month key, shown as "Nov 2026" — or "Nov 26" where a chart has no
// room for the fourth digit. Same reasoning as the day above.
export function calendarMonth(
  key: string | null | undefined,
  yearStyle: 'numeric' | '2-digit' = 'numeric',
): string {
  const [year, month] = String(key ?? '').slice(0, 7).split('-').map(Number);
  if (!year || !month) return String(key ?? '');
  return formatter({ month: 'short', year: yearStyle }, 'UTC').format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

// Whole days from today to a deadline: negative once it has passed. Both arguments are days, not
// instants — pass '2026-11-17', never a Date — and an unreadable one gives null, so a caller can say
// "no deadline" rather than guess.
export function daysLeft(
  deadline: string | null | undefined,
  today: string = phoenixDay(Date.now()),
): number | null {
  const due = dayOf(deadline);
  const from = dayOf(today);
  if (!due || !from) return null;
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// A month key moved by whole months: "2026-01" minus one is "2025-12". Counted in months rather than
// stepped through a Date, because a key is already a calendar month and a Date would need a zone to say
// which month comes next.
export function shiftMonth(key: string, delta: number): string {
  const [year, month] = String(key ?? '').slice(0, 7).split('-').map(Number);
  if (!year || !month) return String(key ?? '');
  const months = year * 12 + (month - 1) + delta;
  return `${Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, '0')}`;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
