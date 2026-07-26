import { defineManifest } from "@crxjs/vite-plugin";
import { extensionApiOrigin } from "./extension-env";

export default defineManifest(({ mode }) => {
  const apiOrigin = extensionApiOrigin(mode);

  return {
    manifest_version: 3,
    minimum_chrome_version: "116",
    name: "ankify",
    description: "One-click add LeetCode problems to your ankify spaced-repetition deck.",
    version: "0.1.1",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr06aninDU5S6xFipr/A4IT9Dr0v9wgbhBxPFee5LYa4FP3PvzYf9CyPkQtxlD6UDBAPVj9KIRch0FzyCUCNO8MXN3W6/Y7k/yW0XvHu3g6GvFaXByvsF3OTmAY5J4HZQDuqWWUY1jl7vN5WIxdsMug1bBHW9Z9GqR8OEJ22XGNIi3+UUbBT+r4khmn05jLFNAuqoZaMGXbdqkJu5gwmqv1p6d5K5lStqq9/g4IQsRhBf/36i4v2LDWxb3E6tWHyMUeeN4vn5HapGsp8SlfsOkj2wwCikfGpiiLfqP3V+t3I1rZLPmwTfVl7B2K0CieJfqamIobsT62zi+Oii97560QIDAQAB",
    action: {
      default_title: "ankify",
      default_icon: {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png",
      },
    },
    icons: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
    side_panel: {
      default_path: "src/popup/index.html",
    },
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: ["https://leetcode.com/*", `${apiOrigin}/*`],
    homepage_url: apiOrigin,
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none';",
    },
    content_scripts: [
      {
        matches: ["https://leetcode.com/problems/*"],
        js: ["src/content/index.ts"],
        run_at: "document_idle",
      },
    ],
    background: {
      service_worker: "src/background/index.ts",
      type: "module",
    },
  };
});
