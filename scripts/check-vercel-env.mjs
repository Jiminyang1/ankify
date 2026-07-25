const env = process.env;
const errors = [];

function required(name) {
  const value = env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required`);
    return "";
  }
  return value;
}

function parseUrl(name, value, protocols) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) {
      errors.push(`${name} must use ${protocols.join(" or ")}`);
    }
    if (url.username || url.password) {
      errors.push(`${name} must not contain embedded credentials`);
    }
    return url;
  } catch {
    errors.push(`${name} must be a valid URL`);
    return null;
  }
}

const vercelEnvironment = required("VERCEL_ENV");
if (vercelEnvironment && !["preview", "production"].includes(vercelEnvironment)) {
  errors.push("build:vercel only supports Vercel Preview or Production deployments");
}

const declaredEnvironment = required("ANKIFY_DEPLOYMENT_ENV");
if (
  declaredEnvironment &&
  vercelEnvironment &&
  declaredEnvironment !== vercelEnvironment
) {
  errors.push(
    `ANKIFY_DEPLOYMENT_ENV=${declaredEnvironment} does not match VERCEL_ENV=${vercelEnvironment}`,
  );
}

const tursoUrl = required("TURSO_DATABASE_URL");
required("TURSO_AUTH_TOKEN");
const authSecret = required("BETTER_AUTH_SECRET");
const authUrlValue = required("BETTER_AUTH_URL");
required("GOOGLE_CLIENT_ID");
required("GOOGLE_CLIENT_SECRET");
const encryptionSecret = required("AI_KEY_ENCRYPTION_SECRET");

parseUrl("TURSO_DATABASE_URL", tursoUrl, ["libsql:", "https:"]);
const authUrl = parseUrl("BETTER_AUTH_URL", authUrlValue, ["https:"]);

if (authSecret && authSecret.length < 32) {
  errors.push("BETTER_AUTH_SECRET must be at least 32 characters");
}
if (encryptionSecret && encryptionSecret.length < 32) {
  errors.push("AI_KEY_ENCRYPTION_SECRET must be at least 32 characters");
}
if (authSecret && encryptionSecret && authSecret === encryptionSecret) {
  errors.push("BETTER_AUTH_SECRET and AI_KEY_ENCRYPTION_SECRET must be different");
}
if (env.LOCAL_DB_PATH?.trim()) {
  errors.push("LOCAL_DB_PATH must not be set on Vercel");
}

const signupDisabled = /^(1|true|yes)$/i.test(
  env.ANKIFY_DISABLE_SIGNUP?.trim() ?? "",
);

const extensionOrigins = (env.ANKIFY_EXTENSION_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (
  extensionOrigins.some(
    (origin) => !/^chrome-extension:\/\/[a-p]{32}$/i.test(origin),
  )
) {
  errors.push(
    "ANKIFY_EXTENSION_ORIGINS must contain comma-separated chrome-extension://<32-character-id> origins",
  );
}
if (vercelEnvironment === "production" && extensionOrigins.length === 0) {
  errors.push(
    "ANKIFY_EXTENSION_ORIGINS is required in Production for cookie-session extension authentication",
  );
}

const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.toLowerCase();
if (
  vercelEnvironment === "preview" &&
  authUrl &&
  productionHost &&
  authUrl.hostname.toLowerCase() === productionHost
) {
  errors.push(
    "Preview BETTER_AUTH_URL points at the Production domain; use a stable Preview branch domain",
  );
}

if (errors.length > 0) {
  console.error("Vercel environment validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `✓ Vercel ${vercelEnvironment} environment validated (${extensionOrigins.length} extension origin${extensionOrigins.length === 1 ? "" : "s"}, public signup ${signupDisabled ? "paused" : "on"})`,
);
