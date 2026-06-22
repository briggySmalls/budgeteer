/**
 * Timezone-safe "civil date" helpers.
 *
 * The Python engine uses `datetime.date` (no time, no timezone). JS `Date` is a
 * timezone-sensitive instant, which silently shifts the calendar day depending on
 * the runtime locale. To port the engine faithfully we pin every date to UTC
 * midnight and do all arithmetic in UTC, so day/month boundaries never drift.
 */

const MS_PER_DAY = 86_400_000;

/** Construct a UTC-midnight date. `month` is 1-based (1 = January). */
export function civilDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function year(d: Date): number {
  return d.getUTCFullYear();
}

/** 1-based month (1 = January). */
export function month(d: Date): number {
  return d.getUTCMonth() + 1;
}

export function day(d: Date): number {
  return d.getUTCDate();
}

/** Number of days in the given 1-based month (leap-year aware). */
export function daysInMonth(yr: number, mon: number): number {
  return new Date(Date.UTC(yr, mon, 0)).getUTCDate();
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/** First day of `d`'s month, at UTC midnight. */
export function monthStart(d: Date): Date {
  return civilDate(year(d), month(d), 1);
}

/** Last day of `d`'s month, at UTC midnight. */
export function monthEnd(d: Date): Date {
  return civilDate(year(d), month(d), daysInMonth(year(d), month(d)));
}

/** Add `n` whole months to a month-start date (handles year rollover). */
export function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(year(d), month(d) - 1 + n, 1));
}

/** Whole-day difference `a - b` (a and b are UTC-midnight dates). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/** -1 / 0 / 1 comparator on calendar instants. */
export function compareDates(a: Date, b: Date): number {
  const av = a.getTime();
  const bv = b.getTime();
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** ISO `YYYY-MM-DD` (matches Python `date.isoformat()` / `str(date)`). */
export function formatISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year(d)}-${pad(month(d))}-${pad(day(d))}`;
}

/**
 * Month-start dates spanning [start, end], equivalent to
 * `pandas.date_range(start, end, freq="MS")`: every month-start that falls within
 * the range. If `start` is not itself a month-start, the first emitted date is the
 * next month-start.
 */
export function monthStartsBetween(start: Date, end: Date): Date[] {
  let cur = monthStart(start);
  if (cur.getTime() < start.getTime()) {
    cur = addMonths(cur, 1);
  }
  const out: Date[] = [];
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}
