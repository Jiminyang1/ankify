import { cookies } from "next/headers";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_NAME,
  getTranslations,
  normalizeLanguage,
  type Language,
} from "./i18n";

export async function getRequestLanguage(): Promise<Language> {
  try {
    const store = await cookies();
    return normalizeLanguage(store.get(LANGUAGE_COOKIE_NAME)?.value);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export async function getRequestTranslations() {
  return getTranslations(await getRequestLanguage());
}
