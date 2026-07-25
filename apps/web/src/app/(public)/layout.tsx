import { LanguageProvider } from "@/components/LanguageProvider";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DEFAULT_LANGUAGE } from "@/lib/i18n";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider initialLanguage={DEFAULT_LANGUAGE}>
      <ThemeProvider>
        <Nav user={null} />
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </ThemeProvider>
    </LanguageProvider>
  );
}
