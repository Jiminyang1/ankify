import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { getRequestLanguage } from "@/lib/i18n-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "ankify",
  description: "Daily LeetCode review with spaced repetition and Q&A flashcards",
  icons: {
    icon: [
      { url: "/ankify-mark.svg", type: "image/svg+xml" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = await getRequestLanguage();
  return (
    <html lang={language === "zh" ? "zh-Hans" : "en"} suppressHydrationWarning>
      <body className="min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ankify-theme")||"system";if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}var l=localStorage.getItem("ankify-language")||"en";document.documentElement.lang=l==="zh"?"zh-Hans":"en"}catch(e){}})()`,
          }}
        />
        <LanguageProvider initialLanguage={language}>
          <ThemeProvider>
            <Nav />
            <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
          </ThemeProvider>
        </LanguageProvider>
        <Analytics />
      </body>
    </html>
  );
}
