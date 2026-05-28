import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ankify-theme")||"system";if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}}catch(e){}})()`,
          }}
        />
        <ThemeProvider>
          <Nav />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
