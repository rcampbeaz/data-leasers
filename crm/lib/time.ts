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

export const TIME_ZONE = 'America/Phoenix';

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
export function phoenix(when: string | number | Date, options: Intl.DateTimeFormatOptions): string {
  return formatter(options, TIME_ZONE).format(new Date(when));
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

export function phoenixKey(when: string | number | Date): { date: string; clock: string } {
  const parts = PARTS.formatToParts(new Date(when));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    clock: `${get('hour')}:${get('minute')}`,
  };
}

export function phoenixDay(when: string | number | Date): string {
  return phoenixKey(when).date;
}

export function phoenixClock(when: string | number | Date): string {
  return phoenixKey(when).clock;
}

export function phoenixStamp(when: string | number | Date): string {
  const { date, clock } = phoenixKey(when);
  return `${date} ${clock}`;
}

// The value a datetime-local input expects, on the console's clock.
export function phoenixInput(when: string | number | Date): string {
  const { date, clock } = phoenixKey(when);
  return `${date}T${clock}`;
}

// A day with no time: "2026-11-17" or a full timestamp whose date part is the day meant. Formatted in
// UTC deliberately — not as the console's clock — because the value is already a day, and shifting it by
// a zone is how a deadline ends up on the wrong date.
export function calendarDate(day: string | Date): string {
  const trimmed = typeof day === 'string' ? day.slice(0, 10) : day.toISOString().slice(0, 10);
  const [year, month, date] = trimmed.split('-').map(Number);
  if (!year || !month || !date) return trimmed;
  return formatter({ dateStyle: 'medium' }, 'UTC').format(new Date(Date.UTC(year, month - 1, date)));
}

// A calendar month: "2026-11" from a month key, shown as "Nov 2026" — or "Nov 26" where a chart has no
// room for the fourth digit. Same reasoning as the day above.
export function calendarMonth(key: string, yearStyle: 'numeric' | '2-digit' = 'numeric'): string {
  const [year, month] = String(key ?? '').slice(0, 7).split('-').map(Number);
  if (!year || !month) return String(key ?? '');
  return formatter({ month: 'short', year: yearStyle }, 'UTC').format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}
