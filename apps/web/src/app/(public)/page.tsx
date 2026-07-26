import type { Metadata } from "next";
import { PublicHome } from "./public-home";
import { getSiteUrl } from "@/lib/site-url";

const title = "ankify · Remember the problems you solve";
const description =
  "Turn LeetCode problems, submissions, notes, and failed cases into spaced reviews, flashcards, and focused quizzes.";

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
    images: [{ url: "/og.png", width: 1200, height: 685, alt: "The ankify review dashboard" }],
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
