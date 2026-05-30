import { requirePageUser } from "@/lib/auth";
import { getRequestTranslations } from "@/lib/i18n-server";
import { getAiSettings, getReviewSettings } from "@/lib/settings";
import { AiSettingsForm, AppearanceSettingsForm, ExtensionConnectionForm, ReviewSettingsForm } from "./form";
import { InfoTip } from "@/components/ui/info-tip";

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
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.appearance}</h2>
        <AppearanceSettingsForm />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted">
          <h2>{t.settings.aiProvider}</h2>
          <InfoTip label={t.settings.keySecurity} align="left" />
        </div>
        <AiSettingsForm
          initial={{
            provider: ai.provider,
            model: ai.model,
            reasoningMode: ai.reasoningMode,
            hasApiKey: Boolean(ai.encryptedApiKey),
          }}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-center gap-1.5 text-sm font-medium uppercase tracking-wide text-muted">
          <h2>{t.settings.extensionConnection}</h2>
          <InfoTip label={t.settings.extensionConnectionHelp} align="left" />
        </div>
        <ExtensionConnectionForm />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.reviewSchedule}</h2>
        <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit }} />
      </section>
    </div>
  );
}
