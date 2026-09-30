"use client";

import { useCallback, useState } from "react";
import type { SuggestionAllocateResponseDto, SuggestionDto, SuggestionListDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DifficultyPill, Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import type { Translation } from "@/lib/i18n";

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  return response.ok && data ? { ok: true, data } : { ok: false, error: data?.error ?? `HTTP ${response.status}` };
}

/** Today's suggestions: the same items the extension popup shows. */
export function SuggestionsClient({ initial, initialExhausted }: { initial: SuggestionListDto; initialExhausted: boolean }) {
  const { t, language } = useLanguage();
  const [list, setList] = useState(initial);
  const [exhausted, setExhausted] = useState(initialExhausted);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/suggestions", { cache: "no-store" });
    if (response.ok) setList((await response.json()) as SuggestionListDto);
  }, []);

  const allocate = useCallback(async (kind: "extra") => {
    setBusy(kind);
    setError(null);
    const result = await post<SuggestionAllocateResponseDto>("/api/suggestions", { requestId: crypto.randomUUID(), kind });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setExhausted(result.data.suggestion === null);
    await refresh();
  }, [refresh]);

  async function act(suggestion: SuggestionDto, action: "skip" | "already_attempted") {
    setBusy(`${action}:${suggestion.id}`);
    setError(null);
    const result = await post(`/api/suggestions/${suggestion.id}/actions`, { action, requestId: crypto.randomUUID() });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    await refresh();
  }

  const visible = list.suggestions.filter((suggestion) => suggestion.status === "pending" || suggestion.status === "started");
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t.suggestions.errors[error] ?? t.suggestions.failed}
        </p>
      )}
      {visible.length === 0 && (
        <Surface>
          <EmptyState title={t.suggestions.noneTitle} description={t.suggestions.none} />
        </Surface>
      )}
      {visible.map((suggestion) => (
        <SuggestionCard key={suggestion.id} t={t} language={language} suggestion={suggestion} busy={busy} onAct={(action) => void act(suggestion, action)} />
      ))}
      {visible.length > 0 && exhausted && <p className="text-sm text-muted">{t.suggestions.none}</p>}
      <div className="flex justify-end">
        <Button variant="secondary" disabled={busy != null} onClick={() => void allocate("extra")}>
          {busy === "extra" && <Spinner />}
          {t.suggestions.another}
        </Button>
      </div>
    </div>
  );
}

function reasonLines(t: Translation, suggestion: SuggestionDto) {
  const category = (id: string) => t.mistakes.categories[id as keyof typeof t.mistakes.categories] ?? id;
  return suggestion.reasons.map((reason) => {
    switch (reason.code) {
      case "category_focus":
        return t.suggestions.focus(category(reason.category), reason.contexts);
      case "general_practice":
        return t.suggestions.general[reason.why] ?? "";
      case "similar_to":
        return reason.category ? t.suggestions.similarToMistake(reason.title, category(reason.category)) : t.suggestions.similarTo(reason.title);
      case "topic_match":
        return t.suggestions.topic(reason.topic);
    }
  });
}

function SuggestionCard({
  t,
  language,
  suggestion,
  busy,
  onAct,
}: {
  t: Translation;
  language: "en" | "zh";
  suggestion: SuggestionDto;
  busy: string | null;
  onAct: (action: "skip" | "already_attempted") => void;
}) {
  const [first, ...rest] = reasonLines(t, suggestion);
  const pending = suggestion.status === "pending";
  return (
    <Surface as="article" aria-label={suggestion.target.title} className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{suggestion.target.title}</h2>
        <div className="flex items-center gap-2">
          {!pending && (
            <Pill tone={suggestion.outcome === "accepted" ? "success" : "warning"}>
              {suggestion.outcome ? t.suggestions.outcome[suggestion.outcome] : t.suggestions.inProgress}
            </Pill>
          )}
          <DifficultyPill difficulty={suggestion.target.difficulty} language={language} />
        </div>
      </div>
      <div className="space-y-1 text-sm">
        {first && <p>{first}</p>}
        {rest.map((line, index) => (
          <p key={index} className="text-muted">
            {line}
          </p>
        ))}
        {pending && <p className="text-muted">{t.suggestions.novelty[suggestion.novelty]}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <a href={suggestion.target.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: pending ? "primary" : "secondary", size: "sm" })}>
          {t.suggestions.openOnLeetcode}
        </a>
        {pending && (
          <>
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => onAct("skip")}>
              {busy === `skip:${suggestion.id}` && <Spinner />}
              {t.suggestions.skip}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => onAct("already_attempted")}>
              {busy === `already_attempted:${suggestion.id}` && <Spinner />}
              {t.suggestions.attempted}
            </Button>
            <span className="text-xs text-muted">{t.suggestions.startHint}</span>
          </>
        )}
      </div>
    </Surface>
  );
}
