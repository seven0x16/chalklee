import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { precompileBoxStyleValidator } from "./scripts/box-style-validator";
import { thirdPartyLicenses } from "./scripts/third-party-licenses";

const licenses = thirdPartyLicenses(resolve("out/THIRD_PARTY_LICENSES.txt"));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@chalklee/format", "@chalklee/word", "mathlive"] }), precompileBoxStyleValidator(), licenses],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "mcp-bridge": resolve("src/main/mcpBridge.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), licenses],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          pdfExport: resolve("src/preload/pdfExport.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
    plugins: [react(), licenses],
    worker: { format: "es" },
    build: {
      minify: "esbuild",
      rollupOptions: {
        input: resolve("src/renderer/index.html")
      }
    }
  }
});
