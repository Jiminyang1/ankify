import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TimeZoneSync } from "@/components/TimeZoneSync";
import { requirePageUser } from "@/lib/auth";
import { getRequestLanguage } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [language, user] = await Promise.all([
    getRequestLanguage(),
    requirePageUser(),
  ]);

  return (
    <LanguageProvider initialLanguage={language}>
      <ThemeProvider>
        <TimeZoneSync />
        <Nav user={user} />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </ThemeProvider>
    </LanguageProvider>
  );
}
