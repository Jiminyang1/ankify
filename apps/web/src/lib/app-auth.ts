export const APP_SESSION_COOKIE = "ankify_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret() {
  return process.env.APP_PASSWORD ?? "";
}

export function appPasswordConfigured() {
  return secret().length > 0;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSessionCookieValue(now = Date.now()) {
  if (!appPasswordConfigured()) throw new Error("APP_PASSWORD missing");
  const expires = String(now + SESSION_TTL_MS);
  return `v1.${expires}.${await sign(expires)}`;
}

export async function verifySessionCookieValue(value: string | undefined, now = Date.now()) {
  if (!appPasswordConfigured() || !value) return false;
  const [version, expires, signature] = value.split(".");
  if (version !== "v1" || !expires || !signature) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  return signature === await sign(expires);
}
