import { requirePageUser } from "@/lib/auth";
import { getAiSettings, getReviewSettings } from "@/lib/settings";
import { AiSettingsForm, ExtensionConnectionForm, ReviewSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const [ai, review] = await Promise.all([getAiSettings(user.id), getReviewSettings(user.id)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">AI provider</h2>
        <AiSettingsForm
          initial={{
            provider: ai.provider,
            model: ai.model,
            hasApiKey: Boolean(ai.encryptedApiKey),
          }}
        />
        <p className="mt-3 text-xs text-muted">
          API keys are encrypted before they are stored. Each user must provide their own provider key.
        </p>
      </section>
      <section className="border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Extension connection</h2>
        <ExtensionConnectionForm />
      </section>
      <section className="border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Review schedule</h2>
        <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit }} />
      </section>
    </div>
  );
}
