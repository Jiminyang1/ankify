import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ankify",
  description: "One-click add LeetCode problems to your ankify spaced-repetition deck.",
  version: "0.0.1",
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
  permissions: ["storage", "activeTab", "scripting", "sidePanel", "tabs"],
  host_permissions: [
    "https://leetcode.com/*",
    "https://*.leetcode.com/*",
    "http://localhost:3000/*",
    "http://localhost:*/*",
    "https://*.vercel.app/*",
  ],
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
});
