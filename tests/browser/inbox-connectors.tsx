import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string) => {
      if (command === "git_github_status")
        return {
          connected: true,
          installed: true,
          authenticated: true,
          login: "demo",
        };
      if (command === "gitlab_status")
        return { connected: true, url: "https://gitlab.example.com" };
      if (command === "jira_status")
        return {
          connected: true,
          site: "https://demo.atlassian.net",
          email: "demo@example.com",
        };
      if (command === "jira_list_projects")
        return [{ id: "10000", key: "ENG", name: "Engineering" }];
      if (command === "jira_list_issues") return [];
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
const { SettingsView } =
  await import("../../src/features/settings/ui/SettingsView");
createRoot(document.getElementById("root")!).render(
  <div className="h-screen">
    <SettingsView
      section="inbox"
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
