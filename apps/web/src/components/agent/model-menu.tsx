"use client";

import { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import type { AgentModelChoice, CoachModelsDto } from "@ankify/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MODEL_KEY = "ankify.coachModel";

/**
 * The Coach's model and thinking level for the next replies, as in the
 * extension: the Settings model first, then the provider's suggested models.
 * Only with the user's own key (the starter key's model is fixed). The pick is
 * kept in this browser and dropped when Settings move to another provider.
 */
export function useCoachModel() {
  const [models, setModels] = useState<CoachModelsDto | null>(null);
  const [choice, setChoice] = useState<AgentModelChoice | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/agent/models", { cache: "no-store" });
        if (!res.ok) return;
        const dto = (await res.json()) as CoachModelsDto;
        if (cancelled) return;
        setModels(dto);
        const stored = readStored();
        if (stored && stored.provider === dto.provider && dto.models.some((model) => model.id === stored.id)) {
          setChoice({ id: stored.id, ...(stored.reasoningLevel ? { reasoningLevel: stored.reasoningLevel } : {}) });
        }
      } catch {
        /* no picker; turns use the Settings model */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickable = models && models.source === "user" && models.models.length > 0 ? models : null;
  const pick = (next: AgentModelChoice) => {
    setChoice(next);
    if (!models) return;
    try {
      localStorage.setItem(MODEL_KEY, JSON.stringify({ ...next, provider: models.provider }));
    } catch {}
  };
  // A pick only counts on the user's own key (the server checks too).
  return { pickable, choice: pickable ? choice : null, pick };
}

function readStored(): (AgentModelChoice & { provider?: string }) | null {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    return raw ? (JSON.parse(raw) as AgentModelChoice & { provider?: string }) : null;
  } catch {
    return null;
  }
}

export function ModelMenu({
  pickable,
  choice,
  onPick,
  disabled,
}: {
  pickable: CoachModelsDto;
  choice: AgentModelChoice | null;
  onPick: (choice: AgentModelChoice) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase, so Escape closes only the menu and not the Coach panel
    // (AgentShell closes the panel on Escape).
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const currentId = choice?.id ?? pickable.defaultModel;
  const currentLevel =
    choice?.reasoningLevel ?? (currentId === pickable.defaultModel ? pickable.defaultReasoningLevel : "default");
  const levels = pickable.models.find((model) => model.id === currentId)?.reasoningLevels ?? [];

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        aria-label={t.agent.modelMenu}
        title={t.agent.modelMenu}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-10 right-0 z-30 w-64 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-card-hover"
        >
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{t.agent.modelHeading}</p>
          {pickable.models.map((model) => (
            <MenuItem
              key={model.id}
              selected={model.id === currentId}
              onClick={() => onPick({ id: model.id })}
            >
              <span className="truncate font-mono text-xs">{model.id}</span>
              {model.id === pickable.defaultModel && (
                <span className="ml-auto shrink-0 text-[10px] text-muted">{t.agent.fromSettings}</span>
              )}
            </MenuItem>
          ))}
          {levels.length > 0 && (
            <>
              <p className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted">
                {t.agent.thinkingHeading}
              </p>
              {levels.map((level) => (
                <MenuItem
                  key={level}
                  selected={level === currentLevel}
                  onClick={() => onPick({ id: currentId, reasoningLevel: level })}
                >
                  <span className="text-xs">{t.settings.reasoningLevel(level)}</span>
                </MenuItem>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-fg transition hover:bg-subtle",
        selected && "bg-subtle",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0 text-accent", !selected && "invisible")} aria-hidden />
      {children}
    </button>
  );
}
