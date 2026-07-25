import { requirePageUser } from "@/lib/auth";
import { getRequestTranslations } from "@/lib/i18n-server";
import { getAiSettings, getReviewSettings } from "@/lib/settings";
import {
  AccountDataForm,
  AiSettingsForm,
  AppearanceSettingsForm,
  ReviewSettingsForm,
} from "./form";
import { InfoTip } from "@/components/ui/info-tip";
import { getUserDisplayName, UserAvatar } from "@/components/user-avatar";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const [ai, review, t] = await Promise.all([getAiSettings(user.id), getReviewSettings(user.id), getRequestTranslations()]);
  const displayName = getUserDisplayName(user.name, user.email);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.settings.subtitle}</p>
      </div>

      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-5 shadow-card">
        <UserAvatar
          name={user.name}
          email={user.email}
          image={user.image}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{displayName}</h2>
          <p className="truncate text-sm text-muted">{user.email}</p>
          <p className="mt-1 text-xs text-muted">{t.settings.googleManaged}</p>
        </div>
        <span className="rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-medium text-success">
          {t.settings.googleConnected}
        </span>
      </section>

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
        <p className="text-sm leading-6 text-muted">{t.settings.extensionConnectionHelp}</p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">{t.settings.reviewSchedule}</h2>
        <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit, timeZone: review.timeZone }} />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted">
          {t.settings.accountData}
        </h2>
        <AccountDataForm email={user.email} />
      </section>
    </div>
  );
}
