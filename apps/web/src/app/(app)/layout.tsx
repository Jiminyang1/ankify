import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { getReviewQueueStatus } from "@/server/review-queue";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [language, user] = await Promise.all([
    getRequestLanguage(),
    requirePageUser(),
  ]);

  // Seeds the nav badge server-side. getReviewQueueStatus is request-memoized,
  // so pages below that need the same queue reuse this one execution.
  const queue = await getReviewQueueStatus(user.id).catch(() => null);

  return (
    <LanguageProvider initialLanguage={language}>
      <ThemeProvider>
        <TimeZoneSync userId={user.id} />
        <Nav user={user} initialDueCount={queue?.dueCount ?? 0} />
        <main className="mx-auto min-h-[calc(100dvh-94px)] w-full min-w-0 max-w-7xl px-6 py-8 sm:min-h-[calc(100dvh-61px)]">{children}</main>
      </ThemeProvider>
    </LanguageProvider>
  );
}
