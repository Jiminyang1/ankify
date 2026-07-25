import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, "../..");

export function extensionApiOrigin(mode: string) {
  const fileEnv = loadEnv(mode, repoRoot, "");
  const configured =
    process.env.ANKIFY_EXTENSION_API_ORIGIN ||
    fileEnv.ANKIFY_EXTENSION_API_ORIGIN ||
    fileEnv.BETTER_AUTH_URL;
  const raw = configured || (mode === "development" ? "http://localhost:3000" : "");

  if (!raw) {
    throw new Error(
      "ANKIFY_EXTENSION_API_ORIGIN is required for production extension builds",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANKIFY_EXTENSION_API_ORIGIN must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("ANKIFY_EXTENSION_API_ORIGIN must use http or https");
  }
  if (mode !== "development" && url.protocol !== "https:") {
    throw new Error("Production extension API origin must use https");
  }
  if (url.username || url.password) {
    throw new Error("ANKIFY_EXTENSION_API_ORIGIN must not contain credentials");
  }

  return url.origin;
}
