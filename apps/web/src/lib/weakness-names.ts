import { WEAKNESS_CATEGORIES } from "@ankify/core";

/** Display name for a weak-spot category: built-ins are localized, custom
 *  ones carry their own name. */
export function weaknessCategoryName(
  category: string,
  customName: string | null,
  language: "en" | "zh",
): string {
  const builtIn = WEAKNESS_CATEGORIES.find((entry) => entry.key === category);
  return builtIn ? builtIn.name[language] : (customName ?? category);
}
