import { requirePageUser } from "@/lib/auth";
import { getRequestTranslations } from "@/lib/i18n-server";
import { getAiSettings, getReviewSettings } from "@/lib/settings";
import { AiSettingsForm, AppearanceSettingsForm, ExtensionConnectionForm, ReviewSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const [ai, review, t] = await Promise.all([getAiSettings(user.id), getReviewSettings(user.id), getRequestTranslations()]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t.settings.title}</h1>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <div className="mb-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{t.settings.appearance}</h2>
          <p className="mt-1 text-sm text-muted">{t.settings.appearanceHelp}</p>
        </div>
        <AppearanceSettingsForm />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.aiProvider}</h2>
        <AiSettingsForm
          initial={{
            provider: ai.provider,
            model: ai.model,
            reasoningMode: ai.reasoningMode,
            hasApiKey: Boolean(ai.encryptedApiKey),
          }}
        />
        <p className="mt-3 text-xs text-muted">
          {t.settings.keySecurity}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.extensionConnection}</h2>
        <ExtensionConnectionForm />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.reviewSchedule}</h2>
        <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit }} />
      </section>
    </div>
  );
}
