"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider, AiReasoningMode } from "@ankify/core";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";

export function AppearanceSettingsForm() {
  const { t } = useLanguage();

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-lg border border-border bg-subtle/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{t.language.label}</div>
          <p className="mt-1 text-xs text-muted">{t.settings.languageHelp}</p>
        </div>
        <LanguageToggle className="w-fit" size="md" />
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-subtle/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{t.theme.label}</div>
          <p className="mt-1 text-xs text-muted">{t.settings.themeHelp}</p>
        </div>
        <ThemeToggle className="w-fit" size="md" />
      </div>
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
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const body: Record<string, unknown> = { provider, model, reasoningMode: showGenerationMode ? reasoningMode : "fast" };
    if (clearApiKey) body.apiKey = "";
    else if (apiKey) body.apiKey = apiKey;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      setApiKey("");
      setClearApiKey(false);
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

  const canTest = Boolean(provider && model && (apiKey || initial.hasApiKey) && !clearApiKey);
  const canRefreshModels = Boolean(provider && (apiKey || initial.hasApiKey) && !clearApiKey);

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
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm" htmlFor="ai-provider">{t.settings.provider}</label>
        <Select
          id="ai-provider"
          value={provider}
          onChange={(e) => {
            const p = e.target.value as typeof provider;
            setProvider(p);
            const first = MODEL_PRESETS[p]?.[0];
            if (first) setModel(first);
            if (p !== "deepseek") setReasoningMode("fast");
          }}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </Select>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <label className="block text-sm" htmlFor="ai-model">{t.settings.model}</label>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{modelsSourceLabel}</span>
            <Button
              size="sm"
              onClick={refreshModels}
              disabled={refreshingModels || !canRefreshModels}
              title={!canRefreshModels ? t.settings.setProviderKeyFirst : undefined}
              className="px-2 py-0.5"
            >
              {refreshingModels ? t.settings.refreshing : live ? t.settings.refresh : t.settings.loadFromProvider}
            </Button>
          </div>
        </div>
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
        {modelsError && (
          <p className="text-xs text-danger">{t.settings.couldNotLoadModels(modelsError)}</p>
        )}
      </div>

      {showGenerationMode && (
        <div className="space-y-1">
          <label className="block text-sm">{t.settings.generationMode}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setReasoningMode("fast")}
              className={
                "rounded-md border px-3 py-2 text-sm transition " +
                (reasoningMode === "fast"
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-border bg-bg text-muted hover:bg-subtle hover:text-fg")
              }
            >
              {t.settings.fast}
            </button>
            <button
              type="button"
              onClick={() => setReasoningMode("thinking")}
              className={
                "rounded-md border px-3 py-2 text-sm transition " +
                (reasoningMode === "thinking"
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-border bg-bg text-muted hover:bg-subtle hover:text-fg")
              }
            >
              {t.settings.thinking}
            </button>
          </div>
          <p className="text-xs text-muted">
            {t.settings.deepseekOnly}
          </p>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm" htmlFor="ai-api-key">
          {t.settings.apiKey} {initial.hasApiKey && <span className="text-muted">{t.settings.apiKeySet}</span>}
        </label>
        <Input
          id="ai-api-key"
          type="password"
          value={apiKey}
          disabled={clearApiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          className="font-mono"
        />
        {initial.hasApiKey && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(e) => {
                setClearApiKey(e.target.checked);
                if (e.target.checked) setApiKey("");
              }}
            />
            {t.settings.clearStoredKey}
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.common.saving : t.common.save}
        </Button>
        <Button
          onClick={testConnection}
          disabled={testing || !canTest}
          title={!canTest ? t.settings.setAiFirst : undefined}
        >
          {testing ? t.settings.testing : t.settings.testConnection}
        </Button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>

      {testResult && (
        <div
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

type ExtensionApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: string;
  lastRequest: string | null;
  enabled: boolean;
};

export function ExtensionConnectionForm() {
  const { t } = useLanguage();
  const [keys, setKeys] = useState<ExtensionApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [name, setName] = useState("Chrome extension");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/api-keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { apiKeys: ExtensionApiKey[] };
      setKeys(json.apiKeys ?? []);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load extension tokens");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setNewKey(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { apiKey: { key: string } };
      setNewKey(json.apiKey.key);
      await loadKeys();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to create extension token");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadKeys();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to revoke extension token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={createKey} className="flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 space-y-1">
          <span className="block text-sm">{t.settings.tokenName}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          {t.settings.generateToken}
        </Button>
      </form>

      {newKey && (
        <div className="rounded-md border border-accent/30 bg-accent/10 p-3">
          <p className="text-sm font-medium text-accent">{t.settings.copyTokenNow}</p>
          <code className="mt-2 block break-all rounded bg-bg p-2 font-mono text-xs">{newKey}</code>
        </div>
      )}

      <div className="rounded-lg border border-border">
        {loading ? (
          <p className="p-3 text-sm text-muted">{t.settings.loadingTokens}</p>
        ) : keys.length === 0 ? (
          <p className="p-3 text-sm text-muted">{t.settings.noTokens}</p>
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">{key.name ?? t.settings.extensionToken}</div>
                  <div className="mt-1 text-xs text-muted">
                    {key.start ? <code className="font-mono">{key.start}...</code> : t.settings.hidden} · {t.settings.created}{" "}
                    {new Date(key.createdAt).toLocaleDateString()} · {t.settings.lastUsed}{" "}
                    {key.lastRequest ? new Date(key.lastRequest).toLocaleDateString() : t.settings.never}
                  </div>
                </div>
                <Button size="sm" onClick={() => revokeKey(key.id)} disabled={busy}>
                  {t.settings.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p className="text-sm text-muted">{msg}</p>}
    </div>
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
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm" htmlFor="daily-review-limit">{t.settings.dailyReviewLimit}</label>
        <Input
          id="daily-review-limit"
          type="number"
          min={1}
          max={100}
          value={dailyReviewLimit}
          onChange={(e) => setDailyReviewLimit(Number(e.target.value))}
          className="tabular-nums"
        />
        <p className="text-xs text-muted">
          {t.settings.dailyReviewHelp}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.common.saving : t.settings.saveReviewSettings}
        </Button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </form>
  );
}
