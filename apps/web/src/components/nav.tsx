"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { BrandLockup } from "./brand";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/review", label: "Review" },
  { href: "/problems", label: "Problems" },
  { href: "/analysis", label: "Analysis" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  const [dueCount, setDueCount] = useState(0);

  useEffect(() => {
    if (isLogin) return;
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

    void loadDueCount();
    return () => {
      cancelled = true;
    };
  }, [isLogin, pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="group">
          <BrandLockup size="sm" className="transition-opacity group-hover:opacity-85" />
        </Link>

        {!isLogin && (
          <div className="flex items-center gap-1 text-sm">
            {LINKS.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname === l.href || pathname.startsWith(l.href + "/");
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
                  {l.label}
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
          {!isLogin && (
            <button
              type="button"
              onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/login") } })}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-subtle hover:text-fg"
            >
              Sign out
            </button>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
