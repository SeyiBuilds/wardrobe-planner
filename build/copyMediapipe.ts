import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

// Serves MediaPipe's WebAssembly from this app instead of a CDN. The files are large,
// so they're copied from node_modules at build time rather than committed.
export function copyMediapipe(): Plugin {
  return {
    name: "copy-mediapipe",
    buildStart() {
      if (process.env.VITEST) return;
      const from = join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
      const to = join(process.cwd(), "public", "mediapipe", "wasm");
      if (!existsSync(from)) throw new Error("@mediapipe/tasks-vision isn't installed. Run npm install.");
      mkdirSync(to, { recursive: true });
      for (const file of readdirSync(from)) {
        if (file.startsWith("vision_wasm_internal") || file.startsWith("vision_wasm_nosimd_internal")) {
          cpSync(join(from, file), join(to, file));
        }
      }
    },
  };
}
