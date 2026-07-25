export type CalendarDate = { year: number; month: number; day: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA-u-ca-gregory", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  try {
    formatter(value).format(new Date(0));
    return true;
  } catch {
    formatterCache.delete(value);
    return false;
  }
}

export function normalizeTimeZone(value: unknown, fallback = "UTC") {
  return isValidTimeZone(value) ? value : fallback;
}

function numericParts(at: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function calendarDateInTimeZone(at: Date, timeZone: string): CalendarDate {
  const { year, month, day } = numericParts(at, normalizeTimeZone(timeZone));
  return { year, month, day };
}

/** Convert a local calendar midnight in an IANA zone into its UTC instant. */
function zonedMidnightToUtc(date: CalendarDate, timeZone: string) {
  const targetWallClock = Date.UTC(date.year, date.month - 1, date.day);
  let guess = targetWallClock;

  // Offset can change around a DST boundary. Iterating against the formatted
  // wall clock converges without relying on the server process timezone.
  for (let i = 0; i < 4; i += 1) {
    const local = numericParts(new Date(guess), timeZone);
    const representedWallClock = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const correction = targetWallClock - representedWallClock;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function nextCalendarDate(date: CalendarDate): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function getZonedDayBounds(timeZone: string, now = new Date()) {
  const zone = normalizeTimeZone(timeZone);
  const calendarDate = calendarDateInTimeZone(now, zone);
  return {
    start: zonedMidnightToUtc(calendarDate, zone),
    end: zonedMidnightToUtc(nextCalendarDate(calendarDate), zone),
  };
}

export function formatDateKeyInTimeZone(at: Date, timeZone: string) {
  const date = calendarDateInTimeZone(at, normalizeTimeZone(timeZone));
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
