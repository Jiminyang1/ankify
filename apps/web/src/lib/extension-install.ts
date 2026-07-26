/**
 * Where "Get the extension" points.
 *
 * The extension is not on the Chrome Web Store yet, so the default sends people
 * to the repository, whose README documents loading it unpacked. Once it ships,
 * set NEXT_PUBLIC_EXTENSION_INSTALL_URL to the store listing — no code change.
 */
const FALLBACK_INSTALL_URL =
  "https://github.com/Jiminyang1/ankify#quick-start-local-dev-sqlite";

export function getExtensionInstallUrl() {
  const configured = process.env.NEXT_PUBLIC_EXTENSION_INSTALL_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : FALLBACK_INSTALL_URL;
}
