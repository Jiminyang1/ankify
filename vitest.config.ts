import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/visual/**"] },
  resolve: {
    // Mirrors apps/web/tsconfig.json `@/*` so server modules can be tested directly.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }],
  },
});
