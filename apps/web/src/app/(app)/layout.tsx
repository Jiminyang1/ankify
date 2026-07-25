import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { requirePageUser } from "@/lib/auth";
import { getRequestLanguage } from "@/lib/i18n-server";
import { getReviewQueueStatus } from "@/lib/review-queue";

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
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </ThemeProvider>
    </LanguageProvider>
  );
}
