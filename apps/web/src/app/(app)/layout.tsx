import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { AgentShell } from "@/components/agent/agent-shell";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { getReviewQueueStatus } from "@/server/review-queue";
import { getAiSettings } from "@/server/settings";
import { readStarterAiConfig } from "@/server/starter-ai";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [language, user] = await Promise.all([
    getRequestLanguage(),
    requirePageUser(),
  ]);

  // Seeds the nav badge server-side. getReviewQueueStatus is request-memoized,
  // so pages below that need the same queue reuse this one execution.
  const [queue, ai] = await Promise.all([
    getReviewQueueStatus(user.id).catch(() => null),
    getAiSettings(user.id).catch(() => null),
  ]);
  // Mirrors getAiRuntimeSettings(): a complete own configuration never spends
  // hosted credits. Used only to show the Coach's credit warnings.
  const hasOwnKey = Boolean(ai?.provider && ai.model && ai.encryptedApiKey);
  const usesHostedCredits = !hasOwnKey && readStarterAiConfig() !== null;

  return (
    <LanguageProvider initialLanguage={language}>
      <ThemeProvider>
        <TimeZoneSync userId={user.id} />
        <Nav user={user} initialDueCount={queue?.dueCount ?? 0} />
        <AgentShell usesHostedCredits={usesHostedCredits}>{children}</AgentShell>
      </ThemeProvider>
    </LanguageProvider>
  );
}
