"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import type { AuthUser } from "@/lib/auth";
import {
  REVIEW_QUEUE_UPDATED_EVENT,
  type ReviewQueueUpdatedEvent,
} from "@/lib/review-queue-event";
import { BrandLockup } from "./brand";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";

const LINKS = [
  { href: "/today", key: "today" },
  { href: "/review", key: "review" },
  { href: "/problems", key: "problems" },
  { href: "/analysis", key: "analysis" },
  { href: "/settings", key: "settings" },
] as const;

export function Nav({ user }: { user: AuthUser | null }) {
  const pathname = usePathname();
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    (pathname === "/" && !user);
  const [dueCount, setDueCount] = useState(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (isPublicPage) return;
    let cancelled = false;

    async function loadDueCount() {
      try {
        const res = await fetch("/api/review/queue?limit=0", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { queue?: { dueCount?: number } };
        if (!cancelled) setDueCount(json.queue?.dueCount ?? 0);
      } catch {
        if (!cancelled) setDueCount(0);
      }
    }

    const handleQueueUpdate = (event: Event) => {
      const detail = (event as ReviewQueueUpdatedEvent).detail;
      if (typeof detail?.dueCount === "number") {
        setDueCount(detail.dueCount);
      } else {
        void loadDueCount();
      }
    };

    void loadDueCount();
    window.addEventListener(REVIEW_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(REVIEW_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    };
  }, [isPublicPage]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href={user ? "/today" : "/"} className="group">
          <BrandLockup size="sm" className="transition-opacity group-hover:opacity-85" />
        </Link>

        {!isPublicPage && (
          <div className="flex items-center gap-1 text-sm">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              const showBadge = l.href === "/review" && dueCount > 0;
              return (
                <Link
                  key={l.href}
                  href={l.href as Route}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 transition font-ui",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-subtle hover:text-fg",
                  )}
                >
                  {t.nav[l.key]}
                  {showBadge && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                      {dueCount > 99 ? "99+" : dueCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          {!isPublicPage && user && (
            <button
              type="button"
              onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/login") } })}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-subtle hover:text-fg"
            >
              {t.nav.signOut}
            </button>
          )}
          {isPublicPage && (
            <>
              <LanguageToggle />
              <ThemeToggle />
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
