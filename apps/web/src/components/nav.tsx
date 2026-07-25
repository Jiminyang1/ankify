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
import { LanguageToggle } from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";
import { getUserDisplayName, UserAvatar } from "./user-avatar";

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
