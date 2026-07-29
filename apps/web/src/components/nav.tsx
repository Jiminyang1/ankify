"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import type { AuthUser } from "@/lib/auth";
import {
  REVIEW_QUEUE_UPDATED_EVENT,
  type ReviewQueueUpdatedEvent,
} from "@/lib/review-queue-event";
import { BrandLockup } from "./brand";
import { ThemeToggle } from "./ThemeToggle";
import { useLanguage } from "./LanguageProvider";
import { UserAvatar } from "./user-avatar";
import { getUserDisplayName } from "@/lib/user-identity";

const LINKS = [
  { href: "/today", key: "today" },
  { href: "/review", key: "review" },
  { href: "/problems", key: "problems" },
  { href: "/analysis", key: "analysis" },
  { href: "/settings", key: "settings" },
] as const;

export function Nav({
  user,
  initialDueCount = 0,
}: {
  user: AuthUser | null;
  initialDueCount?: number;
}) {
  const pathname = usePathname();
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/welcome" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    (pathname === "/" && !user);
  const [dueCount, setDueCount] = useState(initialDueCount);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  const displayName = user ? getUserDisplayName(user.name, user.email) : "";

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  // Re-seed when a router.refresh() hands down a newer server count. Adjusting
  // during render (rather than in an effect) avoids painting the stale value.
  const [seededCount, setSeededCount] = useState(initialDueCount);
  if (seededCount !== initialDueCount) {
    setSeededCount(initialDueCount);
    setDueCount(initialDueCount);
  }

  // The badge is seeded by the server layout, so no fetch on mount. Ratings
  // dispatch the count directly; only events without one need a round trip.
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

    window.addEventListener(REVIEW_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(REVIEW_QUEUE_UPDATED_EVENT, handleQueueUpdate);
    };
  }, [isPublicPage]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <nav className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 sm:flex sm:justify-between sm:px-6 sm:py-3">
        <Link href={user ? "/today" : "/"} prefetch={false} className="group min-w-0">
          <BrandLockup size="sm" className="transition-opacity group-hover:opacity-85" />
        </Link>

        {!isPublicPage && (
          <div className="order-3 col-span-2 grid w-full grid-cols-5 items-center gap-0.5 text-xs sm:order-none sm:col-auto sm:flex sm:w-auto sm:gap-1 sm:text-sm">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/");
              const showBadge = l.href === "/review" && dueCount > 0;
              return (
                <Link
                  key={l.href}
                  href={l.href as Route}
                  prefetch={false}
                  className={cn(
                    "relative min-h-9 rounded-md px-1.5 py-2 text-center transition font-ui sm:min-h-0 sm:px-3 sm:py-1.5",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-subtle hover:text-fg",
                  )}
                >
                  {t.nav[l.key]}
                  {showBadge && (
                    <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                      {dueCount > 99 ? "99+" : dueCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        <div
          className={cn(
            "flex items-center justify-self-end gap-2",
            isPublicPage && "col-span-2 w-full justify-end sm:col-auto sm:w-auto",
          )}
        >
          {!isPublicPage && user && (
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((open) => !open)}
                className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2 transition hover:border-accent/35 hover:bg-subtle"
                aria-label={t.nav.accountMenu}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
              >
                <UserAvatar
                  name={user.name}
                  email={user.email}
                  image={user.image}
                  size="sm"
                />
                <span className="hidden max-w-28 truncate text-sm font-medium text-fg lg:block">
                  {displayName}
                </span>
                <span
                  aria-hidden="true"
                  className={cn("text-[10px] text-muted transition", accountOpen && "rotate-180")}
                >
                  ▼
                </span>
              </button>

              {accountOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+0.5rem)] w-64 overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-card-hover"
                >
                  <div className="flex items-center gap-3 border-b border-border px-2 pb-3 pt-1">
                    <UserAvatar
                      name={user.name}
                      email={user.email}
                      image={user.image}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-fg">{displayName}</div>
                      <div className="truncate text-xs text-muted">{user.email}</div>
                    </div>
                  </div>
                  <Link
                    href="/settings"
                    prefetch={false}
                    role="menuitem"
                    onClick={() => setAccountOpen(false)}
                    className="mt-2 block rounded-lg px-3 py-2 text-sm text-fg transition hover:bg-subtle"
                  >
                    {t.nav.accountSettings}
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/login") } })}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-subtle hover:text-fg"
                  >
                    {t.nav.signOut}
                  </button>
                </div>
              )}
            </div>
          )}
          {isPublicPage && (
            <ThemeToggle />
          )}
        </div>
      </nav>
    </header>
  );
}
