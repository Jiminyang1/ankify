import type { Metadata } from "next";
import { TermsContent } from "./terms-content";

export const metadata: Metadata = {
  title: "Terms of use · ankify",
  description: "Terms governing use of ankify and its Chrome extension.",
};

export default function TermsPage() {
  return <TermsContent />;
}
