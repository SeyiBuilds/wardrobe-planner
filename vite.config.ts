import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { assertPublicKey } from "./build/assertPublicKey.ts";
import { copyMediapipe } from "./build/copyMediapipe.ts";

export default defineConfig(({ mode }) => {
  // Vercel passes its settings as real environment variables, so check those too.
  const fileEnv = loadEnv(mode, process.cwd());
  assertPublicKey(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY);

  return {
    plugins: [react(), copyMediapipe()],
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      testTimeout: 15_000,
    },
  };
});
