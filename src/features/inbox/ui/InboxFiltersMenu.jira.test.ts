// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_INBOX_FILTERS } from "../model/inboxFilters";
import { InboxFiltersMenu } from "./InboxFiltersMenu";

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onChange.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(mode: "project" | "jql") {
  await act(async () =>
    root.render(
      createElement(InboxFiltersMenu, {
        x: 20,
        y: 20,
        source: "jira",
        jiraFilterMode: mode,
        filters: { ...DEFAULT_INBOX_FILTERS, assignedToMe: true },
        projects: [],
        linearProjects: [],
        linearTeams: [],
        hiddenLinearTeamIds: [],
        jiraProjects: [{ id: "10000", key: "ENG", name: "Engineering" }],
        hiddenJiraProjectIds: ["10000"],
        onChange,
        onLinearTeamsChange: vi.fn(),
        onJiraProjectsChange: vi.fn(),
        onClose: vi.fn(),
      }),
    ),
  );
}

it("shows JQL mode without inactive assignment or project controls, retaining display filters", async () => {
  await mount("jql");
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("JQL query from Jira settings");
  expect(menu.textContent).not.toContain("Assigned to me");
  expect(menu.textContent).not.toContain("Engineering");
  expect(menu.textContent).not.toContain("Clear filters");
  const open = [...menu.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Open",
  )!;
  await act(async () => open.click());
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      status: expect.objectContaining({ open: true }),
    }),
  );
  expect(menu.textContent).toContain("Last 7 days");
});

it("preserves the existing assignment and project controls in project mode", async () => {
  await mount("project");
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("Assigned to me");
  expect(menu.textContent).toContain("Engineering");
  expect(menu.textContent).toContain("Clear filters");
});
