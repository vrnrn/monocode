import { defineConfig, type Plugin, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { strictBuildPlugin, strictLogger } from "./scripts/buildBudgets";

const host = process.env.TAURI_DEV_HOST;

// Keep the small splash entry independent of the workspace module graph, so
// the prepared artwork can appear while the rest of the application loads.
function bootSplashEntry(): Plugin {
  return {
    name: "standalone-boot-splash",
    transformIndexHtml: {
      order: "post",
      handler(html, { bundle }) {
        if (!bundle || !html.includes("/src/bootSplash.ts")) return html;
        const entry = Object.values(bundle).find(
          (output) =>
            output.type === "chunk" &&
            output.isEntry &&
            output.name === "bootSplash",
        );
        if (!entry) throw new Error("Missing boot splash entry.");
        return html.replace("/src/bootSplash.ts", `/${entry.fileName}`);
      },
    },
  };
}

export default defineConfig(async ({ mode, command }): Promise<UserConfig> => {
  const stable = mode === "stable";

  return {
    customLogger: command === "build" ? strictLogger() : undefined,
    plugins: [
      react(),
      tailwindcss(),
      bootSplashEntry(),
      strictBuildPlugin({ budgets: !mode.startsWith("benchmark") }),
    ],
    worker: {
      format: "es" as const,
      plugins: () => [
        strictBuildPlugin({
          startup: false,
          budgets: !mode.startsWith("benchmark"),
        }),
      ],
    },
    resolve: {
      alias: [
        ...(mode.startsWith("benchmark")
          ? [
              {
                find: /^@tauri-apps\/api\/core$/,
                replacement: new URL(
                  "./tests/browser/tauriFixture.ts",
                  import.meta.url,
                ).pathname,
              },
            ]
          : []),
        ...(mode === "benchmark-profile"
          ? [{ find: "react-dom/client", replacement: "react-dom/profiling" }]
          : []),
      ],
    },
    clearScreen: false,
    build: {
      // Replace the generic heuristic with per-artifact and startup budgets.
      // The largest exception is one unchanged generated vendor table.
      chunkSizeWarningLimit: 1150,
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          bootSplash: "src/bootSplash.ts",
          quickComposer: "quick-composer.html",
          monoChat: "mono-chat.html",
          ...(mode.startsWith("benchmark")
            ? { workspaceBenchmark: "tests/browser/workspace-performance.html" }
            : {}),
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**"],
      },
    },
  };
});
