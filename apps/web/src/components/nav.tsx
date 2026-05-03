"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/review", label: "Review" },
  { href: "/problems", label: "Problems" },
  { href: "/analysis", label: "Analysis" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav({ dueCount }: { dueCount: number }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="group flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent ring-1 ring-accent/20"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
              <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h7A2.5 2.5 0 0 1 14 4.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7Zm3 .5v6h2V8h2v3h2V5H9v2H7V5H5Z" />
            </svg>
          </span>
          <span className="font-ui text-base font-semibold tracking-tight">ankify</span>
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

        <ThemeToggle />
      </nav>
    </header>
  );
}
