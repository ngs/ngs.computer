// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier/flat";

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
        // Browser sources live in tsconfig.json; Node scripts in tsconfig.node.json.
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
  },

  // The Vite config and build scripts run in Node, not the browser.
  {
    files: ["vite.config.ts", "scripts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  // This flat-config file itself: plain ESM, no type-aware rules.
  {
    files: ["eslint.config.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },

  // Must come last: turns off ESLint formatting rules that conflict with Prettier.
  eslintConfigPrettier,
);
