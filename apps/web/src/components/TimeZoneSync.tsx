"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Persist the browser's IANA timezone once for accounts created before the
 * timezone setting existed. Explicit user choices are never overwritten. */
export function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) return;

    void (async () => {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { review?: { timeZoneConfigured?: boolean } };
      if (!payload.review?.timeZoneConfigured) {
        const saved = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ timeZone }),
        });
        if (!saved.ok) return;
        router.refresh();
      }
    })().catch(() => undefined);
  }, [router]);

  return null;
}
