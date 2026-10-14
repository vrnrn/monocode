// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { JiraSettings } from "./JiraSettings";
import {
  loadHiddenJiraProjectIds,
  loadJiraInboxFilter,
  saveJiraInboxFilter,
  saveHiddenJiraProjectIds,
} from "../../inbox/model/jira";
import { saveMaskEmails } from "../model/displayPrefs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "jira_status")
      return { connected: false, site: "", email: "" };
    if (command === "jira_set_config") {
      const config = args as { site: string; email: string; token: string };
      return {
        connected: Boolean(config.token),
        site: config.site,
        email: config.email,
      };
    }
    if (command === "jira_list_projects")
      return [{ id: "10000", key: "ENG", name: "Engineering" }];
    if (command === "jira_list_issues") return [];
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function mountConnected() {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "jira_status")
      return {
        connected: true,
        site: "acme.atlassian.net",
        email: "ada@example.com",
      };
    return original(command, args);
  });
  await act(async () => root.render(createElement(JiraSettings)));
}

async function selectMode(mode: "Project" | "JQL") {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Filter tickets by:"]',
  )!;
  await act(async () => trigger.click());
  const option = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((button) => button.textContent?.trim() === mode)!;
  await act(async () => option.click());
}

async function enterJql(value: string) {
  const field = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("validates and saves JQL, preserving project choices when modes are switched", async () => {
  saveHiddenJiraProjectIds(["10000"]);
  await mountConnected();
  await selectMode("JQL");
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  const apply = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  expect(apply.disabled).toBe(true);
  await enterJql(
    "  project = ENG AND statusCategory != Done ORDER BY updated DESC  ",
  );
  expect(loadJiraInboxFilter().mode).toBe("project");
  await submit();
  expect(invoke).toHaveBeenCalledWith("jira_list_issues", {
    assignedToMe: false,
    state: "all",
    projectIds: [],
    limit: 1,
    jql: "project = ENG AND statusCategory != Done ORDER BY updated DESC",
  });
  expect(loadJiraInboxFilter()).toEqual({
    mode: "jql",
    jql: "project = ENG AND statusCategory != Done ORDER BY updated DESC",
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "JQL query applied.",
  );
  expect(apply.disabled).toBe(true);
  await selectMode("Project");
  expect(loadJiraInboxFilter().mode).toBe("project");
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .checked,
  ).toBe(false);
  await selectMode("JQL");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "project = ENG AND statusCategory != Done ORDER BY updated DESC",
  );
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
});

it("keeps the saved query active when a new JQL query is rejected", async () => {
  saveJiraInboxFilter({ mode: "jql", jql: "project = ENG" });
  await mountConnected();
  expect(invoke).not.toHaveBeenCalledWith("jira_list_projects");
  await enterJql("unknown = value");
  vi.mocked(invoke).mockRejectedValueOnce(
    new Error("Field 'unknown' does not exist"),
  );
  await submit();
  expect(loadJiraInboxFilter()).toEqual({ mode: "jql", jql: "project = ENG" });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Field 'unknown' does not exist",
  );
  expect(
    container.querySelector("textarea")?.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    container.querySelector<HTMLButtonElement>('button[type="submit"]')!
      .disabled,
  ).toBe(false);
});

it("disables changes during JQL validation and restores the saved mode on reopen", async () => {
  await mountConnected();
  await selectMode("JQL");
  await enterJql("filter = 12345");
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
  );
  await submit();
  expect(container.querySelector("fieldset")!.disabled).toBe(true);
  expect(
    container.querySelector<HTMLTextAreaElement>("textarea")!.disabled,
  ).toBe(true);
  expect(container.textContent).toContain("Checking JQL…");
  expect(loadJiraInboxFilter().mode).toBe("project");
  await act(async () => finish());
  await act(async () => root.render(null));
  await act(async () => root.render(createElement(JiraSettings)));
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "filter = 12345",
  );
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "JQL query applied.",
  );
});

it("connects Jira, synchronizes project filters, and disconnects", async () => {
  saveMaskEmails(true);
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme.atlassian.net");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "secret");
  await submit();
  expect(invoke).toHaveBeenCalledWith("jira_set_config", {
    site: "acme.atlassian.net",
    email: "ada@example.com",
    token: "secret",
  });
  expect(container.textContent).toContain("ada@example.com");
  const email = container.querySelector<HTMLButtonElement>(
    '[aria-label="Reveal email"]',
  )!;
  expect(email.querySelector("span")?.className).toContain("blur-[5px]");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Hide email");
  await act(async () => email.click());
  expect(email.getAttribute("aria-label")).toBe("Reveal email");
  expect(container.querySelector('input[type="password"]')).toBeNull();
  const project = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
  expect(project.checked).toBe(true);
  await act(async () => project.click());
  expect(loadHiddenJiraProjectIds()).toEqual(["10000"]);
  expect(project.checked).toBe(false);
  const disconnect = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Disconnect",
  )!;
  await act(async () => disconnect.click());
  expect(invoke).toHaveBeenCalledWith("jira_set_config", {
    site: "",
    email: "",
    token: "",
  });
  expect(
    container.querySelector<HTMLInputElement>('input[type="password"]')!.value,
  ).toBe("");
});

it("shows authentication errors without claiming a successful connection", async () => {
  await act(async () => root.render(createElement(JiraSettings)));
  await input("Jira site", "acme");
  await input("Atlassian email", "ada@example.com");
  await input("Jira API token", "bad-token");
  vi.mocked(invoke).mockRejectedValueOnce(
    new Error("Jira email or API token is invalid"),
  );
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "invalid",
  );
  expect(container.querySelector("form")).not.toBeNull();
  expect(container.textContent).not.toContain("Projects");
});
