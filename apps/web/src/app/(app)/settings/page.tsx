import Link from "next/link";
import { requirePageUser } from "@/server/auth";
import { getRequestTranslations } from "@/server/i18n";
import { getAiSettings, getGenerationSettings, getReviewSettings } from "@/server/settings";
import {
  AccountDataForm,
  AiSettingsForm,
  AppearanceSettingsForm,
  LanguageRegionSettingsForm,
  ReviewSettingsForm,
} from "./form";
import { InfoTip } from "@/components/ui/info-tip";
import { Surface } from "@/components/ui/surface";
import { buttonClasses } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getExtensionInstallUrl } from "@/lib/extension-install";
import { UserAvatar } from "@/components/user-avatar";
import { getUserDisplayName } from "@/lib/user-identity";

export const dynamic = "force-dynamic";
const SETTINGS_ACTION_CLASS = "min-w-28";

export default async function SettingsPage() {
  const user = await requirePageUser();
  const [ai, generation, review, t] = await Promise.all([
    getAiSettings(user.id),
    getGenerationSettings(user.id),
    getReviewSettings(user.id),
    getRequestTranslations(),
  ]);
  const displayName = getUserDisplayName(user.name, user.email);
  return (
    <PageFrame width="standard" className="space-y-6">
      <PageHeader title={t.settings.title} description={t.settings.subtitle} />

      <Surface as="section" className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar
            name={user.name}
            email={user.email}
            image={user.image}
            size="lg"
          />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{displayName}</h2>
            <p className="truncate text-sm text-muted">{user.email}</p>
            <p className="mt-1 text-xs text-muted">{t.settings.googleManaged}</p>
          </div>
        </div>
        <span className="w-fit rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-medium text-success sm:justify-self-end">
          {t.settings.googleConnected}
        </span>
      </Surface>

      <Surface className="overflow-hidden">
        <div className="divide-y divide-border">
          <SettingsSection title={t.settings.appearance}>
            <AppearanceSettingsForm />
          </SettingsSection>

          <SettingsSection title={t.settings.languageRegion}>
            <LanguageRegionSettingsForm
              initial={{
                generationLanguage: generation.language,
                timeZone: review.timeZone,
              }}
            />
          </SettingsSection>

          <SettingsSection
            title={t.settings.aiProvider}
            info={t.settings.keySecurity}
          >
            <AiSettingsForm
              initial={{
                provider: ai.provider,
                model: ai.model,
                reasoningMode: ai.reasoningMode,
                hasApiKey: Boolean(ai.encryptedApiKey),
              }}
            />
          </SettingsSection>

          <SettingsSection title={t.settings.extensionConnection}>
            <div className="max-w-2xl">
              <p className="text-sm leading-6 text-muted">{t.settings.extensionConnectionHelp}</p>
              <a
                href={getExtensionInstallUrl()}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({
                  className: `mt-4 ${SETTINGS_ACTION_CLASS}`,
                })}
              >
                {t.settings.installExtension}
              </a>
            </div>
          </SettingsSection>

          <SettingsSection title={t.settings.reviewSchedule}>
            <ReviewSettingsForm initial={{ dailyReviewLimit: review.dailyReviewLimit }} />
          </SettingsSection>

          <SettingsSection title={t.settings.accountData}>
            <AccountDataForm email={user.email} />
          </SettingsSection>
        </div>
      </Surface>

      <footer className="flex items-center justify-center gap-5 pb-4 text-xs text-muted">
        <Link href="/privacy" className="transition-colors hover:text-fg">
          {t.settings.privacyPolicy}
        </Link>
        <Link href="/terms" className="transition-colors hover:text-fg">
          {t.settings.termsOfUse}
        </Link>
      </footer>
    </PageFrame>
  );
}

function SettingsSection({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <div className="flex items-center gap-1.5 self-start">
          <h2 className="text-base font-semibold">{title}</h2>
          {info && <InfoTip label={info} align="left" />}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
