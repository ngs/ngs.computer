// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },

  // Strict, type-aware linting for the TypeScript sources.
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
  },

  // Vite config runs in Node, not the browser.
  {
    files: ["vite.config.ts"],
    languageOptions: { globals: globals.node },
  },

  // This flat-config file itself: plain ESM, no type-aware rules.
  {
    files: ["eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },
);
