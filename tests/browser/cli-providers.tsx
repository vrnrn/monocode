import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";

const providers = ["claude", "codex", "pi", "omp", "antigravity"] as const;
Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args?: Record<string, unknown>) => {
      if (command.startsWith("harness_resolve_"))
        return { path: `/dummy/${command.slice("harness_resolve_".length)}` };
      if (command === "harness_exec")
        return `${args?.binaryProvider === "codex" ? "codex-cli" : args?.binaryProvider} 1.2.3`;
      if (command === "fetch_claude_usage")
        return { status: "unavailable", error: "Sign in to connect" };
      if (command === "provider_account_identity") return null;
      return undefined;
    },
  },
});
const { applyThemePreference } =
  await import("../../src/features/settings/model/appearance");
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark",
);
const { registerBuiltinHarnesses } =
  await import("../../src/integrations/harness/core/register");
registerBuiltinHarnesses();
const { setHarnessModels } =
  await import("../../src/features/sessions/model/models");
for (const harness of providers)
  setHarnessModels(harness, [
    { id: `${harness}:demo`, harness, name: "Demo model" },
  ]);
const { setHarnessAvailability, markHarnessAvailabilityProbed } =
  await import("../../src/integrations/harness/core/availabilityState");
setHarnessAvailability({
  claude: true,
  codex: true,
  pi: true,
  omp: true,
  antigravity: true,
});
markHarnessAvailabilityProbed();
const { SettingsView } =
  await import("../../src/features/settings/ui/SettingsView");
createRoot(document.getElementById("root")!).render(
  <div className="h-screen">
    <SettingsView
      section="providers"
      cwd=""
      sessions={[]}
      onClose={() => {}}
      onSelectSection={() => {}}
      onOpenSession={() => {}}
      onArchiveSession={() => {}}
      onDeleteSession={() => {}}
      onOpenWhatsNew={() => {}}
    />
  </div>,
);
