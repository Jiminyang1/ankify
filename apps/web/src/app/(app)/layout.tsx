import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { AgentShell } from "@/components/agent/agent-shell";
import { LeetcodeSiteProvider } from "@/components/leetcode-site-provider";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { getPreferredLeetcodeSite } from "@/server/leetcode-account";
import { getReviewQueueStatus } from "@/server/review-queue";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [language, user] = await Promise.all([
    getRequestLanguage(),
    requirePageUser(),
  ]);

  // Seeds the nav badge server-side. getReviewQueueStatus is request-memoized,
  // so pages below that need the same queue reuse this one execution.
  const [queue, site] = await Promise.all([
    getReviewQueueStatus(user.id).catch(() => null),
    getPreferredLeetcodeSite(user.id).catch(() => "com" as const),
  ]);

  return (
    <LanguageProvider initialLanguage={language}>
      <ThemeProvider>
        <TimeZoneSync userId={user.id} />
        <Nav user={user} initialDueCount={queue?.dueCount ?? 0} />
        <LeetcodeSiteProvider site={site}>
          <AgentShell>{children}</AgentShell>
        </LeetcodeSiteProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
