"use client";

import { useState } from "react";
import type { SkillDimension } from "@ankify/core";
import { Button, type ButtonSize } from "@/components/ui/button";
import { useLanguage } from "@/components/LanguageProvider";
import type { MistakeSourceRef } from "@/lib/mistakes-client";
import { RecordMistakeDialog } from "./record-mistake-dialog";

/** "Log mistake" for one piece of evidence (a quiz answer, a submission).
 *  Turns into a disabled "Mistake recorded" once saved. */
export function LogMistakeButton({
  problemId,
  source,
  initialCategory,
  suggestedFirst,
  size = "sm",
  className,
}: {
  problemId: string;
  source: MistakeSourceRef;
  initialCategory?: SkillDimension | null;
  suggestedFirst?: SkillDimension | null;
  size?: ButtonSize;
  className?: string;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <>
      <Button size={size} className={className} disabled={saved} onClick={() => setOpen(true)}>
        {saved ? t.mistakes.saved : t.mistakes.logMistake}
      </Button>
      <RecordMistakeDialog
        open={open}
        onClose={() => setOpen(false)}
        problemId={problemId}
        mode="create"
        source={source}
        initialCategory={initialCategory}
        suggestedFirst={suggestedFirst}
        onSaved={() => setSaved(true)}
      />
    </>
  );
}
