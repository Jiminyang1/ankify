import type { Metadata } from "next";
import { PublicHome } from "./public-home";

export const metadata: Metadata = {
  title: "ankify · Remember the problems you solve",
  description:
    "Turn LeetCode problems, submissions, notes, and failed cases into spaced reviews, flashcards, and focused quizzes.",
};

export default function HomePage() {
  return <PublicHome />;
}
