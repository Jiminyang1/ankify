export const QA_PROFILE = "qa";
export const QA_USER_ID = "ankify-qa-user";
export const QA_USER_EMAIL = "qa@ankify.local";
export const QA_SESSION_ID = "ankify-qa-session";
export const QA_SESSION_TOKEN = "ankify-qa-session-token";
export const QA_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A second QA account that `/api/qa/login?as=fresh` wipes and recreates on
 *  every login, for walking through onboarding as a brand-new user. */
export const QA_FRESH_USER_ID = "ankify-qa-fresh-user";
export const QA_FRESH_USER_EMAIL = "fresh@ankify.local";
export const QA_FRESH_SESSION_ID = "ankify-qa-fresh-session";
export const QA_FRESH_SESSION_TOKEN = "ankify-qa-fresh-session-token";

export function isQaProfile() {
  return process.env.ANKIFY_PROFILE === QA_PROFILE;
}
