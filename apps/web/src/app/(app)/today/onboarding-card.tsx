"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  Check,
  Chrome,
  Circle,
  ExternalLink,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { AiProvider } from "@ankify/core";
import type { OnboardingProgress } from "@/lib/onboarding";
import { Surface } from "@/components/ui/surface";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/utils";

const MODEL_PRESETS: Record<Exclude<AiProvider, "">, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-4o-mini"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
};

type Copy = {
  eyebrow: string;
  title: string;
  description: string;
  progress: (done: number) => string;
  extensionTitle: string;
  extensionBody: string;
  extensionDone: string;
  install: string;
  aiTitle: string;
  optional: string;
  aiBody: string;
  aiConfigured: string;
  aiSkipped: string;
  connectAi: string;
  skip: string;
  usesAi: string;
  aiUses: string[];
  noAi: string;
  noAiUses: string[];
  provider: string;
  model: string;
  apiKey: string;
  chooseProvider: string;
  storedKey: string;
  apiKeyHint: string;
  testAndSave: string;
  testing: string;
  cancel: string;
  testUsage: string;
  aiSuccess: (model: string, latencyMs: number) => string;
  aiMissing: string;
  captureTitle: string;
  captureBody: string;
  captureDone: string;
  openSample: string;
  captureLocked: string;
  reviewTitle: string;
  reviewBody: string;
  reviewDone: string;
  startReview: string;
  reviewLocked: string;
};

const COPY: Record<"en" | "zh", Copy> = {
  en: {
    eyebrow: "Quick setup",
    title: "Build your first review",
    description: "Four small steps take you from a new account to a scheduled memory.",
    progress: (done) => `${done} of 4 handled`,
    extensionTitle: "Install and connect the extension",
    extensionBody: "Install it, then click ankify once so it can reuse this web login and capture from LeetCode.",
    extensionDone: "Extension connected",
    install: "Install extension",
    aiTitle: "Connect AI",
    optional: "Optional",
    aiBody: "Used only for Quiz, AI Card drafts, and Follow-up rewrites. Capture, FSRS, notes, and manual cards work without it.",
    aiConfigured: "AI connected",
    aiSkipped: "Skipped for now",
    connectAi: "Connect AI",
    skip: "Skip for now",
    usesAi: "Uses AI",
    aiUses: ["Generate quizzes", "Draft AI cards", "Rewrite cards with follow-up instructions"],
    noAi: "Does not use AI",
    noAiUses: ["Capture problems and submissions", "FSRS scheduling", "Notes and manual cards"],
    provider: "Provider",
    model: "Model",
    apiKey: "API key",
    chooseProvider: "Choose a provider",
    storedKey: "A saved key is available for this provider.",
    apiKeyHint: "Encrypted before storage and never returned to the browser.",
    testAndSave: "Test and save",
    testing: "Testing connection…",
    cancel: "Cancel",
    testUsage: "The connection test makes one tiny model request and may incur a small provider charge.",
    aiSuccess: (model, latencyMs) => `${model} connected in ${latencyMs} ms.`,
    aiMissing: "Choose a provider and model, then add its API key.",
    captureTitle: "Capture your first problem",
    captureBody: "Open a LeetCode problem, click ankify, then choose “Capture this problem”.",
    captureDone: "First problem captured",
    openSample: "Open Two Sum",
    captureLocked: "Connect the extension first.",
    reviewTitle: "Complete your first review",
    reviewBody: "Recall the approach, inspect your context, then rate it for FSRS scheduling.",
    reviewDone: "First review completed",
    startReview: "Start first review",
    reviewLocked: "Capture a problem first.",
  },
  zh: {
    eyebrow: "快速设置",
    title: "建立你的第一次复习",
    description: "四个小步骤，把新账号变成一条真正开始运转的记忆。",
    progress: (done) => `已处理 ${done}/4`,
    extensionTitle: "安装并连接扩展",
    extensionBody: "安装后点击一次 ankify，让扩展复用当前网页登录并从 LeetCode 捕获数据。",
    extensionDone: "扩展已连接",
    install: "安装扩展",
    aiTitle: "连接 AI",
    optional: "可选",
    aiBody: "只有 Quiz、AI Card 草稿和 Follow-up 改写会使用 AI；捕获、FSRS、Notes 和手动 Card 都不需要。",
    aiConfigured: "AI 已连接",
    aiSkipped: "暂时跳过",
    connectAi: "连接 AI",
    skip: "暂时跳过",
    usesAi: "会使用 AI",
    aiUses: ["生成 Quiz", "生成 AI Card 草稿", "根据 Follow-up 指令改写 Card"],
    noAi: "不会使用 AI",
    noAiUses: ["捕获题目和提交", "FSRS 调度", "Notes 和手动 Card"],
    provider: "供应商",
    model: "模型",
    apiKey: "API Key",
    chooseProvider: "选择供应商",
    storedKey: "这个供应商已有保存的 Key。",
    apiKeyHint: "保存前会加密，之后不会再返回浏览器。",
    testAndSave: "测试并保存",
    testing: "正在测试连接…",
    cancel: "取消",
    testUsage: "连接测试会发起一次很小的模型请求，可能产生少量供应商费用。",
    aiSuccess: (model, latencyMs) => `${model} 连接成功，用时 ${latencyMs} ms。`,
    aiMissing: "请选择供应商和模型，并填写对应的 API Key。",
    captureTitle: "捕获第一道题",
    captureBody: "打开 LeetCode 题目，点击 ankify，然后选择“捕获这道题”。",
    captureDone: "已捕获第一道题",
    openSample: "打开 Two Sum",
    captureLocked: "请先连接扩展。",
    reviewTitle: "完成第一次复习",
    reviewBody: "回忆解法、查看上下文，然后评分并交给 FSRS 安排下次复习。",
    reviewDone: "已完成第一次复习",
    startReview: "开始第一次复习",
    reviewLocked: "请先捕获一道题。",
  },
};

export function OnboardingCard({
  initialProgress,
  initialAi,
  installUrl,
  language,
}: {
  initialProgress: OnboardingProgress;
  initialAi: {
    provider: AiProvider;
    model: string;
    hasApiKey: boolean;
  };
  installUrl: string;
  language: "en" | "zh";
}) {
  const t = COPY[language];
  const [progress, setProgress] = useState(initialProgress);
  const [showAi, setShowAi] = useState(false);
  const [provider, setProvider] = useState<AiProvider>(initialAi.provider);
  const [model, setModel] = useState(initialAi.model);
  const [apiKey, setApiKey] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refreshProgress = useCallback(async () => {
    const response = await fetch("/api/onboarding", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { onboarding: OnboardingProgress };
    setProgress(data.onboarding);
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => void refreshProgress();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refreshProgress]);

  const aiHandled = progress.aiChoice !== "not_started";
  const doneCount = [
    Boolean(progress.extensionConnectedAt),
    aiHandled,
    Boolean(progress.firstCaptureAt),
    Boolean(progress.firstReviewAt),
  ].filter(Boolean).length;
  const providerModels = provider ? MODEL_PRESETS[provider] : [];
  const hasUsableStoredKey =
    initialAi.hasApiKey && provider === initialAi.provider && Boolean(initialAi.provider);
  const canSubmitAi = Boolean(provider && model && (apiKey || hasUsableStoredKey));

  const providerOptions = useMemo(
    () => [
      { value: "anthropic", label: "Anthropic (Claude)" },
      { value: "openai", label: "OpenAI" },
      { value: "deepseek", label: "DeepSeek" },
    ] as const,
    [],
  );

  async function skipAi() {
    setAiBusy(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "skip_ai" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { onboarding: OnboardingProgress };
      setProgress(data.onboarding);
      setShowAi(false);
      setAiMessage(null);
    } catch (error) {
      setAiMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not update onboarding.",
      });
    } finally {
      setAiBusy(false);
    }
  }

  async function testAndSaveAi() {
    if (!canSubmitAi || !provider) {
      setAiMessage({ kind: "error", text: t.aiMissing });
      return;
    }
    setAiBusy(true);
    setAiMessage(null);
    try {
      const response = await fetch("/api/settings/ai-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          ...(apiKey ? { apiKey } : {}),
          saveOnSuccess: true,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; model: string; latencyMs: number }
        | { ok: false; code?: string; message?: string }
        | null;
      if (!response.ok || !data || !data.ok) {
        throw new Error(data && !data.ok ? data.message || data.code || `HTTP ${response.status}` : `HTTP ${response.status}`);
      }
      setApiKey("");
      setAiMessage({ kind: "ok", text: t.aiSuccess(data.model, data.latencyMs) });
      await refreshProgress();
      window.setTimeout(() => setShowAi(false), 900);
    } catch (error) {
      setAiMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "AI connection failed.",
      });
    } finally {
      setAiBusy(false);
    }
  }

  if (progress.complete) return null;

  return (
    <Surface className="overflow-hidden border-accent/25">
      <div className="border-b border-border bg-accent-soft/30 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{t.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{t.description}</p>
          </div>
          <span className="rounded-full border border-accent/20 bg-surface px-3 py-1 text-xs font-medium text-accent tabular-nums">
            {t.progress(doneCount)}
          </span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border/70">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${(doneCount / 4) * 100}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-border">
        <OnboardingStep
          icon={Chrome}
          done={Boolean(progress.extensionConnectedAt)}
          title={t.extensionTitle}
          description={progress.extensionConnectedAt ? t.extensionDone : t.extensionBody}
        >
          {!progress.extensionConnectedAt && (
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              {t.install}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={Sparkles}
          done={aiHandled}
          title={t.aiTitle}
          badge={t.optional}
          description={
            progress.aiChoice === "configured"
              ? t.aiConfigured
              : progress.aiChoice === "skipped"
                ? t.aiSkipped
                : t.aiBody
          }
        >
          {!showAi && progress.aiChoice !== "configured" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={progress.aiChoice === "skipped" ? "secondary" : "primary"} onClick={() => setShowAi(true)}>
                {t.connectAi}
              </Button>
              {progress.aiChoice === "not_started" && (
                <Button size="sm" onClick={() => void skipAi()} disabled={aiBusy}>
                  {t.skip}
                </Button>
              )}
            </div>
          )}
          {showAi && (
            <div className="mt-3 rounded-xl border border-border bg-subtle/60 p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <AiUsage title={t.usesAi} items={t.aiUses} tone="accent" />
                <AiUsage title={t.noAi} items={t.noAiUses} tone="neutral" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Field label={t.provider}>
                  <Select
                    value={provider}
                    onChange={(event) => {
                      const next = event.target.value as AiProvider;
                      setProvider(next);
                      setModel(next ? (MODEL_PRESETS[next][0] ?? "") : "");
                      setApiKey("");
                      setAiMessage(null);
                    }}
                  >
                    <option value="">{t.chooseProvider}</option>
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t.model}>
                  <Input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    list="onboarding-ai-models"
                    disabled={!provider}
                    className="font-mono"
                  />
                  <datalist id="onboarding-ai-models">
                    {providerModels.map((preset) => <option key={preset} value={preset} />)}
                  </datalist>
                </Field>
                <Field
                  label={t.apiKey}
                  hint={hasUsableStoredKey && !apiKey ? t.storedKey : t.apiKeyHint}
                  className="sm:col-span-2"
                >
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={hasUsableStoredKey ? "••••••••" : "sk-…"}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </Field>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted">{t.testUsage}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={aiBusy || !canSubmitAi} onClick={() => void testAndSaveAi()}>
                  {aiBusy ? t.testing : t.testAndSave}
                </Button>
                <Button size="sm" disabled={aiBusy} onClick={() => setShowAi(false)}>{t.cancel}</Button>
                {progress.aiChoice === "not_started" && (
                  <Button size="sm" variant="ghost" disabled={aiBusy} onClick={() => void skipAi()}>{t.skip}</Button>
                )}
              </div>
              {aiMessage && (
                <p className={cn("mt-3 text-sm", aiMessage.kind === "ok" ? "text-success" : "text-danger")}>
                  {aiMessage.text}
                </p>
              )}
            </div>
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={BookOpenCheck}
          done={Boolean(progress.firstCaptureAt)}
          title={t.captureTitle}
          description={progress.firstCaptureAt ? t.captureDone : t.captureBody}
        >
          {!progress.firstCaptureAt && (
            progress.extensionConnectedAt ? (
              <a
                href="https://leetcode.com/problems/two-sum/"
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "primary", size: "sm" })}
              >
                {t.openSample}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs text-muted">{t.captureLocked}</span>
            )
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={Trophy}
          done={Boolean(progress.firstReviewAt)}
          title={t.reviewTitle}
          description={progress.firstReviewAt ? t.reviewDone : t.reviewBody}
        >
          {!progress.firstReviewAt && (
            progress.firstCaptureAt ? (
              <Link href="/review" className={buttonClasses({ variant: "primary", size: "sm" })}>
                {t.startReview}
              </Link>
            ) : (
              <span className="text-xs text-muted">{t.reviewLocked}</span>
            )
          )}
        </OnboardingStep>
      </div>
    </Surface>
  );
}

function OnboardingStep({
  icon: Icon,
  done,
  title,
  description,
  badge,
  children,
}: {
  icon: typeof Chrome;
  done: boolean;
  title: string;
  description: string;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 px-5 py-4 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:items-start sm:px-6">
      <div className={cn(
        "grid size-9 place-items-center rounded-full border",
        done ? "border-success/25 bg-success/10 text-success" : "border-border bg-subtle text-muted",
      )}>
        {done ? <Check className="size-4.5" aria-hidden="true" /> : <Icon className="size-4.5" aria-hidden="true" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge && <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{badge}</span>}
        </div>
        <p className={cn("mt-1 text-sm leading-6", done ? "text-success" : "text-muted")}>{description}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </section>
  );
}

function AiUsage({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "accent" | "neutral";
}) {
  return (
    <div>
      <h3 className={cn("text-xs font-semibold uppercase tracking-wide", tone === "accent" ? "text-accent" : "text-muted")}>
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-muted">
            {tone === "accent" ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" /> : <Circle className="mt-1 size-2.5 shrink-0" aria-hidden="true" />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
