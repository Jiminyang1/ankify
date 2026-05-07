"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider } from "@ankify/core";

const MODEL_PRESETS: Record<AiProvider, string[]> = {
  "": [],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-5", "gpt-4o", "gpt-4o-mini"],
  // DeepSeek V4 (April 2026). `deepseek-v4-pro` = 1.6T MoE for hard reasoning;
  // `deepseek-v4-flash` = 284B MoE, ~10x cheaper, fine for card generation.
  // Legacy `deepseek-chat` / `deepseek-reasoner` retire after 2026-07-24.
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
};

export function AiSettingsForm({
  initial,
}: {
  initial: {
    provider: AiProvider;
    model: string;
    hasApiKey: boolean;
  };
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const body: Record<string, unknown> = { provider, model };
    if (clearApiKey) body.apiKey = "";
    else if (apiKey) body.apiKey = apiKey;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg("Saved.");
      setApiKey("");
      setClearApiKey(false);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const models = MODEL_PRESETS[provider] ?? [];

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm">Provider</label>
        <select
          value={provider}
          onChange={(e) => {
            const p = e.target.value as typeof provider;
            setProvider(p);
            const first = MODEL_PRESETS[p]?.[0];
            if (first) setModel(first);
          }}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="block text-sm">Model</label>
        <input
          list="model-presets"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
        />
        <datalist id="model-presets">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div className="space-y-1">
        <label className="block text-sm">
          API key {initial.hasApiKey && <span className="text-muted">(currently set; leave blank to keep)</span>}
        </label>
        <input
          type="password"
          value={apiKey}
          disabled={clearApiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          className="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm"
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
            Clear stored key
          </label>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-border bg-accent/10 px-4 py-2 text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
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
          <span className="block text-sm">Token name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-border bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          Generate token
        </button>
      </form>

      {newKey && (
        <div className="rounded-md border border-accent/30 bg-accent/10 p-3">
          <p className="text-sm font-medium text-accent">Copy this token now. It is shown only once.</p>
          <code className="mt-2 block break-all rounded bg-bg p-2 font-mono text-xs">{newKey}</code>
        </div>
      )}

      <div className="rounded-lg border border-border">
        {loading ? (
          <p className="p-3 text-sm text-muted">Loading tokens...</p>
        ) : keys.length === 0 ? (
          <p className="p-3 text-sm text-muted">No extension tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">{key.name ?? "Extension token"}</div>
                  <div className="mt-1 text-xs text-muted">
                    {key.start ? <code className="font-mono">{key.start}...</code> : "hidden"} · created{" "}
                    {new Date(key.createdAt).toLocaleDateString()} · last used{" "}
                    {key.lastRequest ? new Date(key.lastRequest).toLocaleDateString() : "never"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeKey(key.id)}
                  disabled={busy}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-subtle hover:text-fg disabled:opacity-50"
                >
                  Revoke
                </button>
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
      setMsg("Saved.");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-1">
        <label className="block text-sm">Daily review limit</label>
        <input
          type="number"
          min={1}
          max={100}
          value={dailyReviewLimit}
          onChange={(e) => setDailyReviewLimit(Number(e.target.value))}
          className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm tabular-nums"
        />
        <p className="text-xs text-muted">
          Caps how many due problems enter today&apos;s review queue. Extra due problems roll over.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-border bg-accent/10 px-4 py-2 text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save review settings"}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </form>
  );
}
