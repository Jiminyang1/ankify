import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Root scripts, browser tests, and the shared packages. The two apps carry
// their own configs and run through `pnpm -r lint`.
export default defineConfig([
  globalIgnores(["**/node_modules/**", "artifacts/**", "test-results/**", "playwright-report/**", "apps/**", "packages/db/drizzle/**"]),
  { files: ["**/*.mjs"], extends: [js.configs.recommended], languageOptions: { globals: globals.node } },
  { files: ["**/*.ts"], extends: [tseslint.configs.recommended], languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: "readonly" } } },
]);
