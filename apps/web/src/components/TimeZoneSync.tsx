"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keeps the account's time zone (which decides when "today" starts) equal to
 * this device's IANA zone, read from the browser without any permission. A
 * per-user localStorage entry remembers the zone last saved, so the settings
 * roundtrip happens only when the zone changes. */
export function TimeZoneSync({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;

    const syncedKey = `ankify:tz-synced:${userId}`;
    const remember = () => {
      try {
        localStorage.setItem(syncedKey, timeZone);
      } catch {
        // storage unavailable; fall back to checking the API next load
      }
    };
    try {
      if (localStorage.getItem(syncedKey) === timeZone) return;
    } catch {
      // storage unavailable; continue with the API check
    }

    void (async () => {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { review?: { timeZone?: string } };
      if (payload.review?.timeZone === timeZone) {
        remember();
        return;
      }
      const saved = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone }),
      });
      if (!saved.ok) return;
      remember();
      router.refresh();
    })().catch(() => undefined);
  }, [router, userId]);

  return null;
}
