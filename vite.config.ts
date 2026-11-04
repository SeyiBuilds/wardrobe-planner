import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { assertPublicKey } from "./build/assertPublicKey.ts";

export default defineConfig(({ mode }) => {
  // Vercel passes its settings as real environment variables, so check those too.
  const fileEnv = loadEnv(mode, process.cwd());
  assertPublicKey(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY);

  return {
    plugins: [react()],
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
    },
  };
});
