import { useState } from "react";
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
      if (command === "jira_status")
        return {
          connected: true,
          site: "https://demo.atlassian.net",
          email: "demo@example.com",
        };
      if (command === "jira_list_projects")
        return [
          { id: "10000", key: "ENG", name: "Engineering" },
          { id: "10001", key: "SUP", name: "Support" },
        ];
      if (command === "jira_list_issues") return [];
      return null;
    },
  },
});

const { rememberNotificationProjects } =
  await import("../../src/features/notifications/model/notificationProjects");
const { saveJiraInboxFilter, loadJiraInboxFilter } =
  await import("../../src/features/inbox/model/jira");
const { applyThemePreference } =
  await import("../../src/features/settings/model/appearance");
const theme =
  new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark";
applyThemePreference(theme);
saveJiraInboxFilter({
  mode:
    new URLSearchParams(location.search).get("mode") === "jql"
      ? "jql"
      : "project",
  jql: "project = ENG",
});
rememberNotificationProjects([
  {
    id: "jira:demo.atlassian.net:project:10000",
    name: "Engineering",
    detail: "Jira · demo.atlassian.net",
    kind: "jira",
    paths: [],
  },
  {
    id: "jira:demo.atlassian.net:project:10001",
    name: "Support",
    detail: "Jira · demo.atlassian.net",
    kind: "jira",
    paths: [],
  },
  {
    id: "repository:github.com/demo/app",
    name: "Demo repository",
    detail: "github.com",
    kind: "repository",
    paths: [],
  },
]);
const { JiraSettings } =
  await import("../../src/features/settings/ui/JiraSettings");
const { ProjectNotificationSettings } =
  await import("../../src/features/notifications/ui/ProjectNotificationSettings");
function Fixture() {
  const [mode, setMode] = useState(() => loadJiraInboxFilter().mode);
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6 text-content">
      <h1 className="text-[18px] font-semibold">Inbox &amp; Notes</h1>
      <ProjectNotificationSettings cwd="" jiraFilterMode={mode} />
      <section className="overflow-hidden rounded-xl border border-content/10">
        <h2 className="border-b border-content/10 px-4 py-3 text-[13px] font-semibold">
          Jira
        </h2>
        <JiraSettings onFilterModeChange={setMode} />
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
