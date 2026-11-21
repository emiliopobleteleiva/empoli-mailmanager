import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `cloudflare:workers` solo existe dentro de workerd; en tests Node se
      // reemplaza por un stub con el objeto `env` mutable.
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/stubs/cloudflare-workers.ts", import.meta.url),
      ),
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx,mjs}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["app/**/*.{ts,tsx}", "lib/**/*.ts", "docker/*.mjs"],
      exclude: ["app/**/*.d.ts", "app/arpoli.css", "app/globals.css"],
    },
  },
});
