import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
      // tsconfig baseUrl="." lets server code import bare paths like
      // "server/storage". Vitest 4's resolver no longer honors tsconfig
      // baseUrl implicitly (vitest 2 did), so map it explicitly.
      server: path.resolve(templateRoot, "server"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/**/*.test.ts"],
  },
});
