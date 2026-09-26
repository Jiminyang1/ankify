const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * Coarse, time-zone-free phrase for how far `date` is from `now`
 * ("3 hours ago", "in 2 days", "about 6 weeks ago"). Tool results carry this
 * next to the ISO timestamp so the Coach can talk about dates naturally
 * instead of echoing machine timestamps.
 */
export function relativeTimeLabel(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";

  let phrase: string;
  if (abs < HOUR) phrase = plural(Math.round(abs / MINUTE), "minute");
  else if (abs < DAY) phrase = plural(Math.round(abs / HOUR), "hour");
  else if (abs < 14 * DAY) phrase = plural(Math.round(abs / DAY), "day");
  else if (abs < 60 * DAY) phrase = `about ${plural(Math.round(abs / (7 * DAY)), "week")}`;
  else if (abs < 365 * DAY) phrase = `about ${plural(Math.round(abs / (30 * DAY)), "month")}`;
  else phrase = `about ${plural(Math.round(abs / (365 * DAY)), "year")}`;

  return diff < 0 ? `${phrase} ago` : `in ${phrase}`;
}
