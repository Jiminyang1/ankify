import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";
import { extensionApiOrigin } from "./extension-env";

export default defineConfig(({ mode }) => {
  const apiOrigin = extensionApiOrigin(mode);
  return {
    plugins: [react(), crx({ manifest })],
    define: {
      __ANKIFY_DEFAULT_API_ORIGIN__: JSON.stringify(apiOrigin),
    },
    build: {
      outDir: "dist",
    },
  };
});
