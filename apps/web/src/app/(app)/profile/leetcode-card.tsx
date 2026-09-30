"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LeetcodeAccountDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { translateDifficulty } from "@/lib/i18n";
import { formatRelative } from "@/lib/utils";

type LinkError = keyof ReturnType<typeof useLanguage>["t"]["profile"]["leetcode"]["errors"];

export function LeetcodeCard({
  account,
  stale,
}: {
  account: LeetcodeAccountDto | null;
  /** The cached profile is older than a day, so LeetCode refreshes are failing. */
  stale: boolean;
}) {
  const { language, t } = useLanguage();
  const copy = t.profile.leetcode;
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<LinkError | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/leetcode/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const code = res.status === 429 ? "rate_limited" : body?.error;
        setError(code && code in copy.errors ? (code as LinkError) : "generic");
        return;
      }
      setValue("");
      startRefresh(() => router.refresh());
    } catch {
      setError("generic");
    } finally {
      setPending(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setPending(true);
    try {
      await fetch("/api/leetcode/account", { method: "DELETE" });
      startRefresh(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  if (!account) {
    return (
      <Surface className="p-5">
        <h2 className="text-base font-semibold">{copy.connectTitle}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{copy.connectDescription}</p>
        <form onSubmit={connect} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={copy.inputLabel}
            placeholder={copy.placeholder}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            className="font-mono sm:flex-1"
          />
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {busy && <Spinner />}
            {copy.connect}
          </Button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {copy.errors[error]}
          </p>
        )}
      </Surface>
    );
  }

  const profile = account.profile;

  return (
    <Surface className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{copy.title}</div>
          <a
            href={`https://leetcode.com/u/${encodeURIComponent(account.username)}/`}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate text-base font-semibold hover:text-accent"
          >
            @{account.username}
          </a>
        </div>
        <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>
          {busy && <Spinner />}
          {copy.disconnect}
        </Button>
      </div>

      {profile && (
        <>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <div>
              <span className="text-3xl font-semibold tabular-nums">{profile.solved.all}</span>
              <span className="ml-1.5 text-sm text-muted">{copy.solved}</span>
            </div>
            <div className="flex gap-4 text-sm tabular-nums">
              <span className="text-easy">
                {translateDifficulty(language, "Easy")} {profile.solved.easy}
              </span>
              <span className="text-medium">
                {translateDifficulty(language, "Medium")} {profile.solved.medium}
              </span>
              <span className="text-hard">
                {translateDifficulty(language, "Hard")} {profile.solved.hard}
              </span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {profile.streak > 0 && <span>{copy.streak(profile.streak)}</span>}
            <span>{copy.activeDays(profile.activeDays)}</span>
            <span>{copy.updated(formatRelative(account.fetchedAt))}</span>
          </div>
        </>
      )}
      {stale && <p className="mt-3 text-xs text-warning">{copy.unavailable}</p>}
    </Surface>
  );
}
