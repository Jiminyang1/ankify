/**
 * Where "Get the extension" points.
 *
 * Production has a stable Web Store ID. The environment override remains useful
 * for trusted-test or future listing migrations, but users should never fall
 * back to local-development instructions.
 */
const FALLBACK_INSTALL_URL =
  "https://chromewebstore.google.com/detail/ankify/gcldkcaidjnkaagngppblefddapdpaeb";

export function getExtensionInstallUrl() {
  const configured = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : FALLBACK_INSTALL_URL;
}
