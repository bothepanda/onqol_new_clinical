import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "src/content/generated", "migration/legacy-content"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The domain core is environment-neutral: it must not reach for the DOM or
    // for node built-ins, because the same modules run in the browser, in
    // `node --test`, and (later) in a headless replay harness.
    files: ["src/core/**/*.js", "src/content/**/*.js"],
    languageOptions: { globals: {} },
  },
]);
