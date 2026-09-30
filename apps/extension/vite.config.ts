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
    server: {
      // Vite 6 limits dev-server CORS to localhost pages, but the unpacked
      // dev extension loads its modules from a chrome-extension:// origin.
      cors: { origin: [/^chrome-extension:\/\//] },
    },
  };
});
