import type { Metadata } from "next";
import { PublicHome } from "./public-home";
import { getSiteUrl } from "@/lib/site-url";

const title = "ankify · Remember the problems you solve";
const description =
  "Spaced repetition for LeetCode: capture your problems and failed submissions, then review with FSRS scheduling, AI quizzes built from your own mistakes, and a Study Coach that has read your code.";

/** This is the only indexable page, so the crawler- and share-facing tags live
 *  here rather than in the root layout (which the authenticated app shares). */
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "ankify",
    title,
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ankify review workspace with an AI quiz and Study Coach" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function HomePage() {
  return <PublicHome />;
}
