import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "in 2h", "3d ago", or "—" */
export function formatRelative(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = d.getTime() - Date.now();
  const abs = Math.abs(ms);
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  const future = ms >= 0;
  let txt: string;
  if (abs < min) txt = "now";
  else if (abs < hr) txt = `${Math.round(abs / min)}m`;
  else if (abs < day) txt = `${Math.round(abs / hr)}h`;
  else if (abs < 30 * day) txt = `${Math.round(abs / day)}d`;
  else if (abs < 365 * day) txt = `${Math.round(abs / (30 * day))}mo`;
  else txt = `${Math.round(abs / (365 * day))}y`;
  if (txt === "now") return "now";
  return future ? `in ${txt}` : `${txt} ago`;
}

/** Compact interval string for next-review previews: "10m", "1d", "3w", "2mo" */
export function formatInterval(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "now";
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < hr) return `${Math.max(1, Math.round(ms / min))}m`;
  if (ms < day) return `${Math.max(1, Math.round(ms / hr))}h`;
  if (ms < 30 * day) return `${Math.max(1, Math.round(ms / day))}d`;
  if (ms < 365 * day) return `${Math.round(ms / (30 * day))}mo`;
  return `${Math.round(ms / (365 * day))}y`;
}

/** "Apr 27, 2:45 PM" */
export function formatAbsolute(date: Date | string | null | undefined) {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}


