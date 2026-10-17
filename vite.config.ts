import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
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

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    plugins: [react(), tailwindcss(), bootSplashEntry()],
    clearScreen: false,
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          bootSplash: "src/bootSplash.ts",
          quickComposer: "quick-composer.html",
          monoChat: "mono-chat.html",
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
