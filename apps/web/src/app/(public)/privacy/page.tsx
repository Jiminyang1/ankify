import type { Metadata } from "next";
import { PrivacyContent } from "./privacy-content";

export const metadata: Metadata = {
  title: "Privacy policy · ankify",
  description: "How ankify and its Chrome extension handle user data.",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
