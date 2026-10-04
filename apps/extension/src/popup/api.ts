import type { ExtSettings } from "../shared/messages";

/** Fired when the API answers 401, so the panel can show the sign-in gate. */
export const AUTH_REQUIRED_EVENT = "ankify:auth-required";

/** Credentialed request to the ankify API; reuses the web session cookie. */
export async function apiFetch(settings: ExtSettings, path: string, init?: RequestInit) {
  const base = settings.apiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  return response;
}
