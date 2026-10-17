// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxItem } from "../model/githubTasks";
import { clearGitlabCache } from "../model/gitlab";
import { InboxDetail } from "./InboxView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const pipelineUrl = "https://gitlab.example.com/acme/web/-/pipelines/7";
const item: InboxItem = {
  provider: "gitlab",
  kind: "pr",
  repo: "acme/web",
  number: 42,
  title: "Update sidebar",
  url: "https://gitlab.example.com/acme/web/-/merge_requests/42",
  state: "open",
  updatedAt: "2026-10-16T12:00:00Z",
  labels: [],
  assignees: [{ login: "Sam", avatarUrl: "https://example.com/sam.png" }],
  draft: false,
  projectPath: "/tmp/web",
};

let root: Root;
let container: HTMLDivElement;
let pipelineStatus: string;
let url: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearGitlabCache();
  vi.mocked(openUrl).mockReset();
  pipelineStatus = "success";
  url = pipelineUrl;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "gitlab_work_item_details")
        return {
          body: "",
          author: "Alex",
          authorAvatarUrl: "https://example.com/alex.png",
          pipelineStatus,
          pipelineUrl: url,
        };
      if (command === "gitlab_work_item_thread")
        return { comments: [], truncated: false };
      throw new Error(`Unexpected command: ${command}`);
    });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(revision = 0, overrides: Partial<InboxItem> = {}) {
  await act(async () =>
    root.render(
      createElement(InboxDetail, {
        item: { ...item, ...overrides },
        cwd: "/tmp/web",
        projects: [],
        revision,
        relatedSessions: [],
        onStart: vi.fn(),
      }),
    ),
  );
}

it.each([
  ["success", "passed"],
  ["failed", "failed"],
  ["running", "running"],
])("shows a %s pipeline and opens its GitLab page", async (status, label) => {
  pipelineStatus = status;
  await render();
  const badge = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === `Pipeline ${label}`,
  )!;
  expect(badge).toBeDefined();
  await act(async () => badge.click());
  expect(openUrl).toHaveBeenCalledWith(pipelineUrl);
  expect(container.textContent).toContain("!42");
  expect(container.textContent).toContain("Send to chat");
  expect(container.textContent).toContain("Copy context");
  expect(container.textContent).toContain("Alex");
  expect(container.textContent).toContain("Sam");
  expect(container.querySelectorAll("img")).toHaveLength(0);
});

it("updates a running pipeline when the inbox is refreshed", async () => {
  pipelineStatus = "running";
  await render();
  expect(container.textContent).toContain("Pipeline running");
  pipelineStatus = "failed";
  await render(1);
  expect(container.textContent).toContain("Pipeline failed");
  expect(container.textContent).not.toContain("Pipeline running");
});

it("disables the pipeline action if GitLab did not provide a URL", async () => {
  url = "";
  await render();
  const badge = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Pipeline passed",
  )!;
  expect(badge.disabled).toBe(true);
  badge.click();
  expect(openUrl).not.toHaveBeenCalled();
});

it("does not show a result for canceled pipelines or issues", async () => {
  pipelineStatus = "canceled";
  await render();
  expect(container.textContent).not.toContain("Pipeline ");
  pipelineStatus = "success";
  await render(1, {
    kind: "issue",
    url: item.url.replace("merge_requests", "issues"),
  });
  expect(container.textContent).not.toContain("Pipeline ");
});
