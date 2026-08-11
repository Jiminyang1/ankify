export const QA_PROFILE = "qa";
export const QA_USER_ID = "ankify-qa-user";
export const QA_USER_EMAIL = "qa@ankify.local";
export const QA_SESSION_ID = "ankify-qa-session";
export const QA_SESSION_TOKEN = "ankify-qa-session-token";
export const QA_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function isQaProfile() {
  return process.env.ANKIFY_PROFILE === QA_PROFILE;
}
