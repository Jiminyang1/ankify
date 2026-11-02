"use client";

import type { LeetcodeSite } from "@ankify/core/leetcode-site";
import { createContext, useContext } from "react";

const LeetcodeSiteContext = createContext<LeetcodeSite>("com");

/** The LeetCode site this user's problem links open on, from their linked
 *  accounts (`preferredLeetcodeSite`). */
export function LeetcodeSiteProvider({ site, children }: { site: LeetcodeSite; children: React.ReactNode }) {
  return <LeetcodeSiteContext.Provider value={site}>{children}</LeetcodeSiteContext.Provider>;
}

export function useLeetcodeSite(): LeetcodeSite {
  return useContext(LeetcodeSiteContext);
}
