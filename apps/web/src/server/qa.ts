export const QA_PROFILE = "qa";
export const QA_USER_ID = "ankify-qa-user";
export const QA_USER_EMAIL = "qa@ankify.local";
export const QA_SESSION_ID = "ankify-qa-session";
export const QA_SESSION_TOKEN = "ankify-qa-session-token";
export const QA_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** A second, empty account for checking that nothing crosses accounts. */
export const QA_SECOND_USER_ID = "ankify-qa-user-2";
export const QA_SECOND_USER_EMAIL = "qa2@ankify.local";
export const QA_SECOND_SESSION_ID = "ankify-qa-session-2";
export const QA_SECOND_SESSION_TOKEN = "ankify-qa-session-token-2";

export function isQaProfile() {
  return process.env.ANKIFY_PROFILE === QA_PROFILE;
}
