"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider, AiReasoningMode } from "@ankify/core";
import { getTranslations, type Language } from "@/lib/i18n";
import { useLanguage } from "@/components/LanguageProvider";
import { useTheme } from "@/components/ThemeProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";
import { TimeZonePicker } from "./time-zone-picker";

export function AppearanceSettingsForm() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl space-y-2">
      <label className="block text-sm font-medium text-fg" htmlFor="appearance-theme">
        {t.theme.label}
      </label>
      <Select
        id="appearance-theme"
        value={theme}
        onChange={(event) =>
          setTheme(event.target.value as "system" | "light" | "dark")
        }
      >
        <option value="system">{t.theme.system}</option>
        <option value="light">{t.theme.light}</option>
        <option value="dark">{t.theme.dark}</option>
      </Select>
    </div>
  );
}

/** Fallback model lists shown until the user clicks "Refresh". After
 *  refresh, the live `/v1/models` response from the provider replaces these.
 *  The input is freeform — datalist entries are suggestions only. */
const MODEL_PRESETS: Record<AiProvider, string[]> = {
  "": [],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-4o", "gpt-4o-mini"],
  // DeepSeek V4 (April 2026). `deepseek-v4-pro` = 1.6T MoE for hard reasoning;
  // `deepseek-v4-flash` = 284B MoE, ~10x cheaper, fine for card generation.
  // Legacy `deepseek-chat` / `deepseek-reasoner` retire after 2026-07-24.
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
};

type ModelEntry = { id: string; label?: string };
const SETTINGS_ACTION_CLASS = "min-w-28";

export function AiSettingsForm({
  initial,
}: {
  initial: {
    provider: AiProvider;
    model: string;
    reasoningMode: AiReasoningMode;
    hasApiKey: boolean;
  };
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [provider, setProvider] = useState(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [reasoningMode, setReasoningMode] = useState(initial.reasoningMode);
  const [apiKey, setApiKey] = useState("");
  const [hasStoredApiKey, setHasStoredApiKey] = useState(initial.hasApiKey);
  const [storedKeyProvider, setStoredKeyProvider] = useState<AiProvider>(
    initial.hasApiKey ? initial.provider : "",
  );
  const [saving, setSaving] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [removeKeyDialogOpen, setRemoveKeyDialogOpen] = useState(false);
  const [removeKeyError, setRemoveKeyError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | { kind: "ok"; latencyMs: number; model: string }
    | { kind: "err"; message: string }
    | null
  >(null);
  const [liveModels, setLiveModels] = useState<Record<AiProvider, ModelEntry[] | null>>({
    "": null,
    anthropic: null,
    openai: null,
    deepseek: null,
  });
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const showGenerationMode = provider === "deepseek";

  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        setHasStoredApiKey(initial.hasApiKey);
        setStoredKeyProvider(initial.hasApiKey ? initial.provider : "");
      },
      0,
    );
    return () => window.clearTimeout(timer);
  }, [initial.hasApiKey, initial.provider]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const body: Record<string, unknown> = { provider, model, reasoningMode: showGenerationMode ? reasoningMode : "fast" };
    if (apiKey) {
      body.apiKey = apiKey;
    } else if (hasStoredApiKey && storedKeyProvider !== provider) {
      // Never carry a credential across providers: keys are provider-specific.
      body.apiKey = "";
    }
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      if (apiKey) {
        setHasStoredApiKey(true);
        setStoredKeyProvider(provider);
      } else if (storedKeyProvider !== provider) {
        setHasStoredApiKey(false);
        setStoredKeyProvider("");
      }
      setApiKey("");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    const body: Record<string, unknown> = { provider, model };
    // Only override the key if the user typed a new one in this session.
    // Otherwise the server falls back to the stored encrypted key.
    if (apiKey) body.apiKey = apiKey;
    try {
      const res = await fetch("/api/settings/ai-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; latencyMs: number; model: string }
        | { ok: false; code: string; message: string }
        | null;
      if (!res.ok || !json) {
        setTestResult({ kind: "err", message: `HTTP ${res.status}` });
      } else if (json.ok) {
        setTestResult({ kind: "ok", latencyMs: json.latencyMs, model: json.model });
      } else {
        setTestResult({ kind: "err", message: json.message || json.code });
      }
    } catch (e) {
      setTestResult({ kind: "err", message: e instanceof Error ? e.message : t.settings.networkError });
    } finally {
      setTesting(false);
    }
  }

  async function removeApiKey() {
    setRemovingKey(true);
    setRemoveKeyError(null);
    setMsg(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, model, reasoningMode: showGenerationMode ? reasoningMode : "fast", apiKey: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setApiKey("");
      setHasStoredApiKey(false);
      setStoredKeyProvider("");
      setMsg(t.common.saved);
      setRemoveKeyDialogOpen(false);
      router.refresh();
    } catch (e) {
      setRemoveKeyError(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setRemovingKey(false);
    }
  }

  const hasUsableStoredKey = hasStoredApiKey && storedKeyProvider === provider;
  const storedKeyBelongsElsewhere = hasStoredApiKey && !hasUsableStoredKey;
  const canTest = Boolean(provider && model && (apiKey || hasUsableStoredKey));
  const canRefreshModels = Boolean(provider && (apiKey || hasUsableStoredKey));

  async function refreshModels() {
    if (!provider) return;
    setRefreshingModels(true);
    setModelsError(null);
    const body: Record<string, unknown> = { provider };
    if (apiKey) body.apiKey = apiKey;
    try {
      const res = await fetch("/api/settings/ai-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; provider: AiProvider; models: ModelEntry[] }
        | { ok: false; code: string; message: string }
        | null;
      if (!res.ok || !json) {
        setModelsError(`HTTP ${res.status}`);
      } else if (json.ok) {
        setLiveModels((prev) => ({ ...prev, [json.provider]: json.models }));
      } else {
        setModelsError(json.message || json.code);
      }
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : t.settings.networkError);
    } finally {
      setRefreshingModels(false);
    }
  }

  const live = liveModels[provider];
  const presets = MODEL_PRESETS[provider] ?? [];
  const models: ModelEntry[] = live ?? presets.map((id) => ({ id }));
  const modelsSourceLabel = live ? t.settings.fromProvider(live.length) : t.settings.suggestions(presets.length);

  /** Whether the current model value doesn't match any listed option. */
  const isCustomModel = !models.some((m) => m.id === model);

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <ConfirmDialog
        open={removeKeyDialogOpen}
        title={t.settings.removeApiKey}
        description={t.settings.removeApiKeyConfirm}
        cancelLabel={t.common.cancel}
        confirmLabel={removingKey ? t.settings.removingApiKey : t.settings.removeApiKey}
        busy={removingKey}
        error={removeKeyError}
        onClose={() => {
          if (!removingKey) {
            setRemoveKeyDialogOpen(false);
            setRemoveKeyError(null);
          }
        }}
        onConfirm={() => void removeApiKey()}
      />
      <div className="space-y-2">
        <label className="block text-sm font-medium text-fg" htmlFor="ai-provider">
          {t.settings.provider}
        </label>
        <Select
          id="ai-provider"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as typeof provider;
            setProvider(p);
            const first = MODEL_PRESETS[p]?.[0];
            setModel(first ?? "");
            setApiKey("");
            setMsg(null);
            setTestResult(null);
            setModelsError(null);
            if (p !== "deepseek") setReasoningMode("fast");
          }}
        >
          <option value="">{t.settings.chooseProvider}</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-fg" htmlFor="ai-model">
          {t.settings.model}
        </label>
        <Select
          id="ai-model"
          value={isCustomModel ? "__custom__" : model}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setModel("");
            } else {
              setModel(e.target.value);
            }
          }}
          autoComplete="off"
          className="font-mono"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}{m.label ? ` — ${m.label}` : ""}
            </option>
          ))}
          <option value="__custom__">{t.settings.other}</option>
        </Select>
        {isCustomModel && (
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t.settings.enterModel}
            autoComplete="off"
            aria-label={t.settings.customModelAria}
            className="font-mono"
          />
        )}
        <div className="flex min-h-7 items-center justify-between gap-3">
          <span className="text-xs text-muted">{modelsSourceLabel}</span>
          <Button
            className={SETTINGS_ACTION_CLASS}
            onClick={refreshModels}
            disabled={refreshingModels || !canRefreshModels}
            title={!canRefreshModels ? t.settings.setProviderKeyFirst : undefined}
          >
            {refreshingModels
              ? t.settings.refreshing
              : live
                ? t.settings.refresh
                : t.settings.loadFromProvider}
          </Button>
        </div>
        {modelsError && (
          <p className="text-xs text-danger" role="alert">{t.settings.couldNotLoadModels(modelsError)}</p>
        )}
      </div>

      {showGenerationMode && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="ai-reasoning-mode" className="font-medium text-fg">
              {t.settings.generationMode}
            </label>
            <InfoTip label={t.settings.deepseekOnly} align="left" />
          </div>
          <Select
            id="ai-reasoning-mode"
            value={reasoningMode}
            onChange={(event) =>
              setReasoningMode(event.target.value as AiReasoningMode)
            }
          >
            <option value="fast">{t.settings.fast}</option>
            <option value="thinking">{t.settings.thinking}</option>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="ai-api-key" className="font-medium text-fg">
            {t.settings.apiKey}
          </label>
          {hasUsableStoredKey && <InfoTip label={t.settings.apiKeySet} align="left" />}
        </div>
        <Input
          id="ai-api-key"
          name="ankify-ai-provider-key"
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasUsableStoredKey ? "••••••••••••••••••••" : "sk-..."}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          style={apiKey ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
          className="font-mono"
        />
        {storedKeyBelongsElsewhere && !apiKey && (
          <p className="mt-1 text-xs text-warning" role="status">
            {t.settings.apiKeyForOtherProvider}
          </p>
        )}
        {hasUsableStoredKey && (
          <div className="flex min-h-7 items-center text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              {t.settings.apiKeySaved}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <div className="mr-auto flex items-center gap-3">
          {hasUsableStoredKey && (
            <Button
              className={SETTINGS_ACTION_CLASS}
              onClick={() => {
                setRemoveKeyError(null);
                setRemoveKeyDialogOpen(true);
              }}
              disabled={removingKey || saving}
            >
              {removingKey ? t.settings.removingApiKey : t.settings.removeApiKey}
            </Button>
          )}
          {msg && (
            <span className="text-sm text-muted" role="status" aria-live="polite">
              {msg}
            </span>
          )}
        </div>
        <Button
          className={SETTINGS_ACTION_CLASS}
          onClick={testConnection}
          disabled={testing || !canTest}
          title={!canTest ? t.settings.setAiFirst : undefined}
        >
          {testing ? t.settings.testing : t.settings.testConnection}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className={SETTINGS_ACTION_CLASS}
          disabled={saving}
        >
          {saving ? t.common.saving : t.common.save}
        </Button>
      </div>

      {testResult && (
        <div
          role={testResult.kind === "err" ? "alert" : "status"}
          aria-live="polite"
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (testResult.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger")
          }
        >
          {testResult.kind === "ok" ? (
            <>
              {t.settings.connectedTo} <span className="font-mono">{testResult.model}</span>
              <span className="text-muted"> · {testResult.latencyMs} ms</span>
            </>
          ) : (
            <>✗ {testResult.message}</>
          )}
        </div>
      )}
    </form>
  );
}

export function LanguageRegionSettingsForm({
  initial,
}: {
  initial: {
    generationLanguage: Language;
    timeZone: string;
  };
}) {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [interfaceLanguage, setInterfaceLanguage] = useState<Language>(language);
  const [generationLanguage, setGenerationLanguage] = useState<Language>(
    initial.generationLanguage,
  );
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generationLanguage, timeZone }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (interfaceLanguage !== language) setLanguage(interfaceLanguage);
      setMsg(getTranslations(interfaceLanguage).common.saved);
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <div className="grid gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="interface-language" className="font-medium text-fg">
              {t.settings.interfaceLanguage}
            </label>
            <InfoTip label={t.settings.interfaceLanguageHelp} align="left" />
          </div>
          <Select
            id="interface-language"
            value={interfaceLanguage}
            onChange={(event) => setInterfaceLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="generation-language" className="font-medium text-fg">
              {t.settings.generationLanguage}
            </label>
            <InfoTip label={t.settings.generationLanguageHelp} align="left" />
          </div>
          <Select
            id="generation-language"
            value={generationLanguage}
            onChange={(event) => setGenerationLanguage(event.target.value as Language)}
          >
            <option value="en">{t.settings.generationLanguageEnglish}</option>
            <option value="zh">{t.settings.generationLanguageChinese}</option>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="review-time-zone" className="font-medium text-fg">
              {t.settings.timeZone}
            </label>
            <InfoTip label={t.settings.timeZoneHelp} align="left" />
          </div>
          <TimeZonePicker
            id="review-time-zone"
            value={timeZone}
            onChange={setTimeZone}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          className={SETTINGS_ACTION_CLASS}
          disabled={saving}
        >
          {saving ? t.common.saving : t.settings.saveLanguageRegion}
        </Button>
      </div>
    </form>
  );
}

export function ReviewSettingsForm({ initial }: { initial: { dailyReviewLimit: number } }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [dailyReviewLimit, setDailyReviewLimit] = useState(initial.dailyReviewLimit);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyReviewLimit }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <div className="max-w-sm space-y-1">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="daily-review-limit">{t.settings.dailyReviewLimit}</label>
          <InfoTip label={t.settings.dailyReviewHelp} align="left" />
        </div>
        <Input
          id="daily-review-limit"
          type="number"
          min={1}
          max={100}
          value={dailyReviewLimit}
          onChange={(e) => setDailyReviewLimit(Number(e.target.value))}
          className="tabular-nums"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          className={SETTINGS_ACTION_CLASS}
          disabled={saving}
        >
          {saving ? t.common.saving : t.settings.saveReviewSettings}
        </Button>
      </div>
    </form>
  );
}

export function AccountDataForm({ email }: { email: string }) {
  const { t } = useLanguage();
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const matches = confirmationEmail.trim().toLowerCase() === email.toLowerCase();

  async function deleteAccount() {
    if (!matches) return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: confirmationEmail.trim(),
          confirmation: "DELETE",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      window.location.assign("/login?deleted=1");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.settings.deleteAccountFailed,
      );
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t.settings.deleteAccount}
        description={t.settings.deleteAccountConfirm}
        cancelLabel={t.common.cancel}
        confirmLabel={deleting ? t.settings.deletingAccount : t.settings.deleteAccount}
        busy={deleting}
        error={message}
        onClose={() => {
          if (!deleting) {
            setDeleteDialogOpen(false);
            setMessage(null);
          }
        }}
        onConfirm={() => void deleteAccount()}
      />
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-4">
        <a
          href="/api/account/export"
          download
          className={buttonClasses({
            variant: "secondary",
            className: SETTINGS_ACTION_CLASS,
          })}
        >
          {t.settings.exportData}
        </a>
        <p className="text-sm text-muted">{t.settings.exportDataHelp}</p>
      </div>

      <details className="group overflow-hidden rounded-lg border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-muted transition hover:bg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
          <span>{t.settings.advancedAccountActions}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          >
            <path
              d="m6 8 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="space-y-3 border-t border-border bg-danger/5 p-4">
          <div>
            <h3 className="text-sm font-medium text-danger">
              {t.settings.deleteAccount}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {t.settings.deleteAccountHelp}
            </p>
          </div>
          <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={confirmationEmail}
              onChange={(event) => setConfirmationEmail(event.target.value)}
              placeholder={t.settings.typeEmailToDelete(email)}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Button
              variant="danger"
              onClick={() => {
                setMessage(null);
                setDeleteDialogOpen(true);
              }}
              disabled={!matches || deleting}
              className={`${SETTINGS_ACTION_CLASS} shrink-0`}
            >
              {deleting ? t.settings.deletingAccount : t.settings.deleteAccount}
            </Button>
          </div>
          {message && !deleteDialogOpen && (
            <p className="text-sm text-danger" role="alert">
              {message}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
