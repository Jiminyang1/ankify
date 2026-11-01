import type { Metadata } from "next";
import { PublicHome } from "./public-home";
import { getSiteUrl } from "@/lib/site-url";

const title = "ankify · Follow a plan, learn the patterns, keep them";
const description =
  "Spaced repetition for LeetCode: follow a study plan chapter by chapter, and review each problem by telling a Study Coach which technique it takes and why, before you forget it.";

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
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ankify review workspace with the Study Coach checking a spoken answer" }],
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
