// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TicketContextActions } from "./TicketContextActions";
import { copyText } from "../../../platform/tauri/clipboard";
import type { InboxItem } from "../model/githubTasks";

vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn(async () => {}),
}));
vi.mock("../../../shared/ui/Popover", async () => {
  const { createElement } = await import("react");
  return {
    Popover: ({
      children,
      onKeyDown,
      role,
    }: {
      children: unknown;
      onKeyDown: () => void;
      role: string;
    }) => createElement("div", { role, onKeyDown }, children as never),
  };
});
let root: Root;
let container: HTMLDivElement;
const ticket = {
  provider: "jira",
  kind: "jira",
  title: "Demo ticket",
  url: "https://demo.atlassian.net/browse/DEMO-42",
  projectPath: "",
} as InboxItem;
const projects = [
  {
    path: "/tmp/demo",
    name: "Demo project",
    logoPath: null,
    mascotName: "crab",
    mascotColor: "blue",
  },
];
const monos = [
  { id: "mono-demo", name: "Demo Mono", mascot: "crab", color: "blue" },
];
const onStart = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function render(
  extra: Partial<Parameters<typeof TicketContextActions>[0]> = {},
) {
  act(() =>
    root.render(
      createElement(TicketContextActions, {
        item: ticket,
        cwd: "/tmp/demo",
        projects,
        monos,
        onStart,
        ...extra,
      }),
    ),
  );
}
function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === text,
  )!;
}
async function choose(text: string) {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Choose chat destination"]',
      )!
      .click(),
  );
  await act(async () => button(text).click());
}
it("offers both kinds of destination and sends to the selected project", async () => {
  render();
  await act(async () => button("Send to chat").click());
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({ projectPath: "/tmp/demo" }),
    undefined,
    undefined,
  );
});
it("sends to the selected Mono without assigning its project path", async () => {
  render();
  await choose("Demo Mono");
  await act(async () => button("Send to chat").click());
  expect(onStart).toHaveBeenCalledWith(ticket, undefined, "mono-demo");
});
it("works with a Mono even when there are no projects", async () => {
  render({ projects: [] });
  expect(button("Send to chat").disabled).toBe(false);
  await act(async () => button("Send to chat").click());
  expect(onStart).toHaveBeenCalledWith(ticket, undefined, "mono-demo");
});
it("keeps copy available when there are no destinations", async () => {
  render({ projects: [], monos: [] });
  expect(button("Send to chat").disabled).toBe(true);
  await act(async () => button("Copy context").click());
  expect(copyText).toHaveBeenCalledWith(
    expect.stringContaining("monocode://context/jira?url="),
  );
  expect(button("Copied")).toBeDefined();
});
it("shows clipboard errors without claiming the link was copied", async () => {
  vi.mocked(copyText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  render();
  await act(async () => button("Copy context").click());
  expect(container.querySelector('[role="alert"]')!.textContent).toBe(
    "Clipboard unavailable",
  );
  expect(button("Copy context")).toBeDefined();
});
it("allows retry after an opening failure", async () => {
  onStart.mockRejectedValueOnce(new Error("Could not open Mono"));
  render();
  await choose("Demo Mono");
  await act(async () => button("Send to chat").click());
  expect(container.querySelector('[role="alert"]')!.textContent).toBe(
    "Could not open Mono",
  );
  expect(button("Send to chat").disabled).toBe(false);
});
it("blocks duplicate sends while a destination is opening", async () => {
  let finish!: () => void;
  onStart.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  render();
  await act(async () => {
    button("Send to chat").click();
    button("Send to chat").click();
  });
  expect(onStart).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});
