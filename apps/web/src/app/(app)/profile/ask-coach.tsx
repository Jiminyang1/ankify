"use client";

import { Sparkles } from "lucide-react";
import { useAgentShellControls } from "@/components/agent/agent-shell";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";

/** Asks the Study Coach to pick what to work on next from this plan. */
export function AskCoachNext() {
  const { t } = useLanguage();
  const { ask } = useAgentShellControls();
  return (
    <Button variant="ghost" size="sm" className="self-start" onClick={() => ask(t.profile.askCoach.prompt)}>
      <Sparkles aria-hidden="true" className="size-4 text-accent" />
      {t.profile.askCoach.label}
    </Button>
  );
}
