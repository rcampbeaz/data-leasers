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
// A missing or unreadable value comes back as an empty string instead of throwing. These are printed
// straight into table cells, and a nullable column is a blank cell, not a failed page: the string
// rendering this replaced printed something harmless for null, and so does this.

export const TIME_ZONE = 'America/Phoenix';

type Time = string | number | Date | null | undefined;

function parse(when: Time): Date | null {
  if (when === null || when === undefined || when === '') return null;
  const at = new Date(when);
  return Number.isNaN(at.getTime()) ? null : at;
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

export function phoenixKey(when: Time): { date: string; clock: string } {
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
  return phoenixKey(when).date;
}

// A month key: "2026-11", for bucketing a series or naming an object. A bucket is the console's month,
// not UTC's, or the last seven hours of a month are counted in the next one.
export function phoenixMonth(when: Time): string {
  return phoenixKey(when).date.slice(0, 7);
}

// The last `count` months, oldest first, ending with the console's current month.
export function phoenixMonths(count: number, when: Time = Date.now()): string[] {
  const current = phoenixMonth(when);
  if (!current || count < 1) return [];
  const [year, month] = current.split('-').map(Number);
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(year, month - 1 - back, 1));
    keys.push(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// The year of an instant on the console's clock — for "won this year", which is the buyer's year.
export function phoenixYear(when: Time): string {
  return phoenixKey(when).date.slice(0, 4);
}

// The year a stored calendar date already belongs to. Read off the value rather than through a zone:
// 1 January has to be its own year, which a Phoenix conversion of a UTC midnight would move back.
// A day, not an instant: an instant's year is phoenixYear, and a number is neither, so the type keeps
// `calendarYear(Date.now())` from compiling — it used to reach .getTime() and throw at runtime.
export function calendarYear(day: string | Date | null | undefined): string {
  if (day === null || day === undefined) return '';
  // A Date is read the same way calendarDate reads one: as the UTC day it names, which is the day the
  // database stored, not the day it happens to be on this server.
  const trimmed =
    typeof day === 'string'
      ? day.slice(0, 10)
      : Number.isNaN(day.getTime())
        ? ''
        : day.toISOString().slice(0, 10);
  return /^\d{4}-/.test(trimmed) ? trimmed.slice(0, 4) : '';
}

export function phoenixClock(when: Time): string {
  return phoenixKey(when).clock;
}

export function phoenixStamp(when: Time): string {
  const { date, clock } = phoenixKey(when);
  return date ? `${date} ${clock}` : '';
}

// The value a datetime-local input expects, on the console's clock.
export function phoenixInput(when: Time): string {
  const { date, clock } = phoenixKey(when);
  return date ? `${date}T${clock}` : '';
}

// A day with no time: "2026-11-17" or a full timestamp whose date part is the day meant. Formatted in
// UTC deliberately — not as the console's clock — because the value is already a day, and shifting it by
// a zone is how a deadline ends up on the wrong date.
export function calendarDate(day: string | Date | null | undefined): string {
  if (day === null || day === undefined) return '';
  const trimmed =
    typeof day === 'string'
      ? day.slice(0, 10)
      : Number.isNaN(day.getTime())
        ? ''
        : day.toISOString().slice(0, 10);
  const [year, month, date] = trimmed.split('-').map(Number);
  if (!year || !month || !date) return trimmed;
  return formatter({ dateStyle: 'medium' }, 'UTC').format(new Date(Date.UTC(year, month - 1, date)));
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
