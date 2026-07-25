"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Persist the browser's IANA timezone once for accounts created before the
 * timezone setting existed. Explicit user choices are never overwritten.
 * Once the account has a configured timezone, a per-user localStorage flag
 * skips the settings roundtrip on later page loads. */
export function TimeZoneSync({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;

    const syncedKey = `ankify:tz-synced:${userId}`;
    const markSynced = () => {
      try {
        localStorage.setItem(syncedKey, "1");
      } catch {
        // storage unavailable; fall back to checking the API next load
      }
    };
    try {
      if (localStorage.getItem(syncedKey)) return;
    } catch {
      // storage unavailable; continue with the API check
    }

    void (async () => {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { review?: { timeZoneConfigured?: boolean } };
      if (payload.review?.timeZoneConfigured) {
        markSynced();
        return;
      }
      const saved = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone }),
      });
      if (!saved.ok) return;
      markSynced();
      router.refresh();
    })().catch(() => undefined);
  }, [router, userId]);

  return null;
}
