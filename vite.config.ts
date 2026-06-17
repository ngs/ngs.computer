import { defineConfig } from "vite";

// Emit relative paths so the build works even when served from a sub-path.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
  },
});
