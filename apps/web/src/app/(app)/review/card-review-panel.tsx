"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import type { Card } from "@ankify/db";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/components/ui/markdown";
import { useLanguage } from "@/components/LanguageProvider";

export function CardReviewPanel({
  cards,
  currentCard,
  cardIdx,
  setCardIdx,
  flipped,
  setFlipped,
  problemId,
}: {
  cards: Card[];
  currentCard: Card | null;
  cardIdx: number;
  setCardIdx: Dispatch<SetStateAction<number>>;
  flipped: boolean;
  setFlipped: Dispatch<SetStateAction<boolean>>;
  problemId: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border">
        <button
          type="button"
          disabled={cardIdx === 0}
          onClick={() => { setCardIdx((i) => i - 1); setFlipped(false); }}
          className="text-xs text-muted hover:text-fg disabled:opacity-30 transition-colors"
        >
          {t.common.previous}
        </button>
        <span className="text-[11px] text-muted tabular-nums">
          {cards.length > 0 ? `${cardIdx + 1} / ${cards.length}` : "0 / 0"}
        </span>
        <button
          type="button"
          disabled={cardIdx >= cards.length - 1}
          onClick={() => { setCardIdx((i) => i + 1); setFlipped(false); }}
          className="text-xs text-muted hover:text-fg disabled:opacity-30 transition-colors"
        >
          {t.common.next}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" style={{ perspective: "800px" }}>
        {currentCard ? (
          <div
            className="h-full cursor-pointer overflow-hidden"
            onClick={() => setFlipped((f) => !f)}
          >
            <div
              className="h-full transition-transform duration-500 ease-in-out"
              style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
            >
              {!flipped ? (
                <div className="h-full flex flex-col">
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <div className="flex min-h-full flex-col rounded-lg bg-subtle/40 px-5 py-6 sm:px-7">
                      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">{t.review.question}</div>
                      <div className="flex flex-1 items-center justify-center py-8">
                        <Markdown className="max-w-[34rem] text-center break-words [&_code]:break-words [&_li]:text-base [&_li]:leading-relaxed [&_p]:text-base [&_p]:leading-relaxed">
                          {currentCard.question}
                        </Markdown>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                    <span className="text-[10px] text-muted">{t.review.tapReveal}</span>
                  </div>
                </div>
              ) : (
                <div
                  className="h-full flex flex-col"
                  style={{ transform: "rotateY(180deg)" }}
                >
                  <div className="flex-1 overflow-auto p-4 sm:p-5">
                    <div className="flex min-h-full flex-col rounded-lg border border-success/30 bg-success/10 px-5 py-5 sm:px-7 sm:py-6">
                      <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-success">{t.review.answer}</div>
                      <div className="flex flex-1 items-center py-6">
                        <Markdown className="w-full break-words font-medium [&_code]:break-words [&_li]:text-base [&_li]:leading-8 [&_p]:text-base [&_p]:leading-8">
                          {currentCard.answer}
                        </Markdown>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 border-t border-border px-4 py-2 text-center">
                    <span className="text-[10px] text-muted">{t.review.tapQuestion}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title={t.review.noCards}
              action={
                <Link
                  href={`/problems/${problemId}`}
                  prefetch={false}
                  className={buttonClasses({ size: "sm" })}
                >
                  {t.review.addCard}
                </Link>
              }
            />
          </div>
        )}
      </div>

    </div>
  );
}
