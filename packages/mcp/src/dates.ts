// Calendar dates in the business's time zone (batch 052, FR-MCP-14): "today" and "is this overdue" are decided in that
// zone, and every date we hand back carries its weekday and zone, so "next Friday" is shown as the date it became.
// Same arithmetic as apps/web lib/server/reports.ts (Intl only; no date library).

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 92; // GET /api/v1/reports' limit

export class DateError extends Error {}

export function validZone(zone: string): boolean {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, n: number) => new Date(utcMidnight(date) + n * DAY_MS).toISOString().slice(0, 10);

/** "2026-11-13" → itself, or a DateError for a malformed or impossible date (2026-02-30). */
export function calendarDate(text: string, name: string): string {
  const ok = typeof text === "string" && DATE.test(text) && Number.isFinite(utcMidnight(text)) && addDays(text, 0) === text;
  if (!ok) throw new DateError(`${name} must be a calendar date like 2026-11-13.`);
  return text;
}

/** `zone`'s offset from UTC at `ms` (local wall clock − UTC), in ms. */
function offsetAt(ms: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - (ms - (ms % 1000));
}

/** The instant `date` begins in `zone` (two passes, so a DST change between guess and answer still lands right). */
export function startOfDay(date: string, zone: string): number {
  const wall = utcMidnight(date);
  return wall - offsetAt(wall - offsetAt(wall, zone), zone);
}

/** The instant `date` ends in `zone`: the next day's start. */
export const endOfDay = (date: string, zone: string) => startOfDay(addDays(date, 1), zone);

/** The calendar date of instant `ms` in `zone`. */
export const dateIn = (ms: number, zone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekday = (date: string) => WEEKDAYS[new Date(utcMidnight(date)).getUTCDay()];

/** "Friday 2026-11-13 (Asia/Kolkata)". */
export const labelled = (date: string, zone: string) => `${weekday(date)} ${date} (${zone})`;

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);

export type Period = "today" | "yesterday" | "this_week" | "last_week" | "last_7_days" | "this_month" | "last_month" | "last_30_days";
export const PERIODS: readonly Period[] = ["today", "yesterday", "this_week", "last_week", "last_7_days", "this_month", "last_month", "last_30_days"];

/** A named period → inclusive [from, to] in the zone; weeks start on Monday (ISO 8601). */
export function resolvePeriod(period: Period, today: string): { from: string; to: string } {
  const dow = (new Date(utcMidnight(today)).getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = `${today.slice(0, 8)}01`;
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "this_week":
      return { from: addDays(today, -dow), to: today };
    case "last_week":
      return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "this_month":
      return { from: monthStart, to: today };
    case "last_month": {
      const end = addDays(monthStart, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
  }
}

/** Explicit from/to, or a period; checks order and the 92-day limit. */
export function resolveRange(input: { period?: Period; from?: string; to?: string }, today: string): { from: string; to: string } {
  if (input.period && (input.from || input.to)) throw new DateError("Give either period, or from and to, not both.");
  const range = input.period
    ? resolvePeriod(input.period, today)
    : { from: calendarDate(input.from ?? "", "from"), to: calendarDate(input.to ?? "", "to") };
  if (range.from > range.to) throw new DateError("from must be on or before to.");
  if (daysBetween(range.from, range.to) + 1 > MAX_RANGE_DAYS) throw new DateError(`A summary covers at most ${MAX_RANGE_DAYS} days.`);
  return range;
}
