import { getAiSettings, getReviewSettings } from "@/lib/settings";
import { AiSettingsForm, ReviewSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [ai, review] = await Promise.all([getAiSettings(), getReviewSettings()]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">AI provider</h2>
        <AiSettingsForm
          initial={{
            provider: ai.provider,
            model: ai.model,
            hasApiKey: Boolean(ai.apiKey),
          }}
        />
        <p className="mt-3 text-xs text-muted">
          API keys: stored values override env vars. If left blank, the corresponding{" "}
          <code>ANTHROPIC_API_KEY</code> / <code>OPENAI_API_KEY</code> / <code>DEEPSEEK_API_KEY</code> env var is used.
        </p>
      </section>
      <section className="border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Review schedule</h2>
        <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit }} />
      </section>
    </div>
  );
}
