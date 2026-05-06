import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { getReviewQueueStatus } from "@/lib/review-queue";
import "./globals.css";

export const metadata: Metadata = {
  title: "ankify",
  description: "Daily LeetCode review with spaced repetition and Q&A flashcards",
};

async function getDueCount(): Promise<number> {
  try {
    const queue = await getReviewQueueStatus();
    return queue.dueCount;
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const dueCount = await getDueCount();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("ankify-theme")||"system";if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}}catch(e){}})()`,
          }}
        />
        <ThemeProvider>
          <Nav dueCount={dueCount} />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
