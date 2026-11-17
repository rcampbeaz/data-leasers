#!/usr/bin/env node
// Pins what lib/time.ts answers at the instants where it is easiest to be wrong.
//
// Run with:  npm run check:clock
//
// check:dates refuses a day, month or year built from UTC, but a scan cannot see what a helper returns.
// The values below were measured by hand when this clock was put in — 5pm Phoenix, the last seven hours
// of a month, New Year's Eve, 31 February typed into the schedule form — and they are written down here
// so that an edit which moves one of them fails a check instead of shipping on memory.
//
// Every instant is fixed except todayIso and phoenixMonths, which need the real clock; those two are
// compared against the day and month read at the same moment, so the check says the same thing at any
// hour on any machine.

import { loadLib } from './load-lib.mjs';

// lib/time.ts has to stand alone for this check to load it; loadLib says so if it ever stops.
const clock = await loadLib('time.ts', 'check:clock');

const {
  TIME_ZONE,
  calendarDate,
  calendarMonth,
  calendarYear,
  daysLeft,
  isMonthKey,
  phoenix,
  phoenixClock,
  phoenixDay,
  phoenixInput,
  phoenixInputToUtc,
  phoenixMonth,
  phoenixMonths,
  phoenixStamp,
  phoenixYear,
  shiftMonth,
  todayIso,
} = clock;

const failures = [];
let checked = 0;

const show = (value) =>
  typeof value === 'string' ? `"${value}"` : value === null ? 'null' : String(value);

const same = (what, actual, expected) => {
  checked += 1;
  if (actual !== expected) failures.push(`${what}: expected ${show(expected)}, got ${show(actual)}`);
};

const at = (instant) => (instant ? instant.toISOString() : String(instant));

// Phoenix is UTC-7 all year, so 5pm there is midnight UTC: that is the hour the UTC day is already
// tomorrow while the console's day is still today, and it was the bug behind every countdown.
const beforeFive = '2026-11-18T23:59:00Z'; // Wed Nov 18, 4:59 PM Phoenix
const fiveOClock = '2026-11-19T00:00:00Z'; // Wed Nov 18, 5:00 PM Phoenix
const elevenFiftyNine = '2026-11-19T06:59:00Z'; // Wed Nov 18, 11:59 PM Phoenix
const midnight = '2026-11-19T07:00:00Z'; // Thu Nov 19, midnight Phoenix

same('phoenixDay just before 5pm', phoenixDay(beforeFive), '2026-11-18');
same('phoenixDay at 5pm, when UTC has rolled over', phoenixDay(fiveOClock), '2026-11-18');
same('phoenixDay a minute before midnight', phoenixDay(elevenFiftyNine), '2026-11-18');
same('phoenixDay at midnight', phoenixDay(midnight), '2026-11-19');

same('phoenixClock at 5pm', phoenixClock(fiveOClock), '17:00');
same('phoenixStamp at 5pm', phoenixStamp(fiveOClock), '2026-11-18 17:00');
same('phoenixInput at 5pm', phoenixInput(fiveOClock), '2026-11-18T17:00');
same('phoenix date only', phoenix(fiveOClock, { dateStyle: 'medium' }), 'Nov 18, 2026');
same(
  'phoenix date and time',
  phoenix(fiveOClock, { dateStyle: 'medium', timeStyle: 'short' }),
  'Nov 18, 2026, 5:00 PM',
);
same('phoenixDay of a missing instant', phoenixDay(null), '');
same('phoenixStamp of an unreadable instant', phoenixStamp('nonsense'), '');

// The last seven hours of a month: UTC is already December while the console is still in November.
const monthEnd = '2026-12-01T00:30:00Z'; // Mon Nov 30, 5:30 PM Phoenix
same('phoenixDay on the last evening of a month', phoenixDay(monthEnd), '2026-11-30');
same('phoenixMonth on the last evening of a month', phoenixMonth(monthEnd), '2026-11');
same('phoenixYear on the last evening of a month', phoenixYear(monthEnd), '2026');
same('phoenixMonth at the first moment of a month', phoenixMonth('2026-12-01T07:00:00Z'), '2026-12');

// The same seven hours on 31 December, where both the month and the year are ahead in UTC.
const yearEnd = '2027-01-01T02:00:00Z'; // Thu Dec 31 2026, 7:00 PM Phoenix
same('phoenixDay on New Year’s Eve', phoenixDay(yearEnd), '2026-12-31');
same('phoenixMonth on New Year’s Eve', phoenixMonth(yearEnd), '2026-12');
same('phoenixYear on New Year’s Eve', phoenixYear(yearEnd), '2026');
same('phoenixYear at the first moment of a year', phoenixYear('2027-01-01T07:00:00Z'), '2027');
same('phoenixYear on the last evening of a year', phoenixYear('2026-01-01T06:59:00Z'), '2025');

// A stored day is a calendar date with no zone, so it is shown as the day it already says — a deadline
// must not move because a server happens to be west of UTC.
same('calendarDate of a stored day', calendarDate('2026-11-17'), 'Nov 17, 2026');
same('calendarDate of a day with a time', calendarDate('2026-11-17T23:30:00+00:00'), 'Nov 17, 2026');
same('calendarDate of an empty day', calendarDate(''), '');
same('calendarDate of an unreadable day', calendarDate('nonsense'), '');
same('calendarDate of a missing day', calendarDate(null), '');
same('calendarYear of a stored day', calendarYear('2026-01-01'), '2026');
same('calendarYear of a Date', calendarYear(new Date('2016-05-04T12:00:00Z')), '2016');
same('calendarYear of a number', calendarYear(1234), '');
same('calendarMonth of a key', calendarMonth('2026-11'), 'Nov 2026');
same('calendarMonth with a short year', calendarMonth('2026-11', '2-digit'), 'Nov 26');
same('calendarMonth of a missing key', calendarMonth(null), '');

// The countdown the partners page and the chase tasks read. A day is a day: both arguments are strings,
// and an unreadable one is null rather than a guess of zero.
same('daysLeft on the day itself', daysLeft('2026-11-17', '2026-11-17'), 0);
same('daysLeft tomorrow', daysLeft('2026-11-18', '2026-11-17'), 1);
same('daysLeft yesterday', daysLeft('2026-11-16', '2026-11-17'), -1);
same('daysLeft a month out', daysLeft('2026-12-17', '2026-11-17'), 30);
same('daysLeft from a day carrying a time', daysLeft('2026-11-17T09:00:00Z', '2026-11-17'), 0);
same('daysLeft from an unreadable deadline', daysLeft('nonsense', '2026-11-17'), null);
same('daysLeft from an unreadable today', daysLeft('2026-11-17', 'nonsense'), null);
same('daysLeft of a missing deadline', daysLeft(null, '2026-11-17'), null);
same('daysLeft of a missing today', daysLeft('2026-11-17', null), null);
same('daysLeft of a missing deadline and today', daysLeft(undefined), null);

// Month keys, moved in months: a key is already a calendar month, so stepping it through a Date would
// need a zone to say which month comes next.
same('shiftMonth back over a year', shiftMonth('2026-01', -1), '2025-12');
same('shiftMonth forward over a year', shiftMonth('2026-12', 1), '2027-01');
same('shiftMonth by nothing', shiftMonth('2026-11', 0), '2026-11');
same('shiftMonth back a year', shiftMonth('2026-11', -12), '2025-11');
same('shiftMonth forward a year', shiftMonth('2026-11', 12), '2027-11');
same('shiftMonth of an unreadable key', shiftMonth('bad', 1), 'bad');
same('isMonthKey of a key', isMonthKey('2026-11'), true);
same('isMonthKey of a thirteenth month', isMonthKey('2026-13'), false);
same('isMonthKey of a one-digit month', isMonthKey('2026-1'), false);
same('isMonthKey of a missing key', isMonthKey(null), false);
same('isMonthKey of a number', isMonthKey(202611), false);

// The schedule form: a datetime-local value is the console's wall clock, and the instant it means is
// seven hours later. July is asserted too, because a zone with daylight saving would answer differently
// there and Phoenix must not.
same(
  'a scheduled 5pm is midnight UTC',
  at(phoenixInputToUtc('2026-11-18T17:00')),
  '2026-11-19T00:00:00.000Z',
);
same(
  'a scheduled midnight is 7am UTC',
  at(phoenixInputToUtc('2026-11-18T00:00')),
  '2026-11-18T07:00:00.000Z',
);
same(
  'a scheduled noon in July is 7pm UTC',
  at(phoenixInputToUtc('2026-07-04T12:00')),
  '2026-07-04T19:00:00.000Z',
);
same(
  'a scheduled half past midnight on New Year’s Day',
  at(phoenixInputToUtc('2027-01-01T00:30')),
  '2027-01-01T07:30:00.000Z',
);
same('a scheduled empty value', phoenixInputToUtc(''), null);
same('a scheduled unreadable value', phoenixInputToUtc('not-a-date'), null);
same('a scheduled 31 February', phoenixInputToUtc('2026-02-31T10:00'), null);
same('a scheduled 25:00', phoenixInputToUtc('2026-11-18T25:00'), null);
same('a scheduled value with seconds', phoenixInputToUtc('2026-11-18T17:00:00'), null);
same('a missing scheduled value', phoenixInputToUtc(null), null);

// What the form shows must be what it reads back, or editing a scheduled post would move it.
for (const instant of [
  '2026-11-19T00:00:00.000Z',
  '2026-12-01T02:00:00.000Z',
  '2027-01-01T07:00:00.000Z',
  '2026-07-04T19:00:00.000Z',
]) {
  same(`the form round trip for ${instant}`, at(phoenixInputToUtc(phoenixInput(instant))), instant);
}
for (const wall of ['2026-11-18T17:00', '2026-02-28T23:59', '2026-06-15T00:00']) {
  same(`the form round trip for ${wall}`, phoenixInput(phoenixInputToUtc(wall)), wall);
}

// The two answers that come from the real clock, compared with the clock read at the same moment: the
// point is that they agree, not that they equal a value written down here.
const before = Date.now();
const today = todayIso();
const months = phoenixMonths(3);
const after = Date.now();
const todays = new Set([phoenixDay(before), phoenixDay(after)]);
same('todayIso is a day', /^\d{4}-\d{2}-\d{2}$/.test(today), true);
same('todayIso is the console’s day', todays.has(today), true);
same('phoenixMonths has three months', months.length, 3);
same(
  'phoenixMonths ends on the console’s month',
  months.length === 3 && new Set([phoenixMonth(before), phoenixMonth(after)]).has(months[2]),
  true,
);
same('phoenixMonths runs oldest first', months[0] < months[1] && months[1] < months[2], true);
same('phoenixMonths steps one month at a time', months[1], shiftMonth(months[0], 1));
same('phoenixMonths does not skip a month', months[2], shiftMonth(months[1], 1));
same('phoenixMonths of nothing', phoenixMonths(0).length, 0);
same('phoenixMonths of a negative count', phoenixMonths(-1).length, 0);
same('TIME_ZONE', TIME_ZONE, 'America/Phoenix');

if (failures.length === 0) {
  console.log(
    `The clock holds at 5pm Phoenix, through the month and year rollovers, and back through the ` +
      `schedule form (${checked} checks).`,
  );
  process.exit(0);
}

console.error(`The console's clock answers wrongly in ${failures.length} place${failures.length === 1 ? '' : 's'}:\n`);
for (const failure of failures) console.error(`  ${failure}`);
console.error('\nEvery day, month and year in lib/ and app/ comes from lib/time.ts. If a value above is');
console.error('wrong, the pages that read it are wrong too — fix the helper, not this check. If the');
console.error('change was deliberate, the expected values here are part of what changed.');
process.exit(1);
