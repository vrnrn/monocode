// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTicketDeepLinks } from "./useTicketDeepLinks";
import {
  requestOpenTicketContext,
  ticketContextLink,
} from "../../features/inbox/model/ticketContext";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  listen: vi.fn(),
  message: vi.fn(),
  unlisten: vi.fn(),

  focus: vi.fn(),
  show: vi.fn(),
  unminimize: vi.fn(),
  label: "main",
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.claim,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: mocks.message }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: mocks.label,
    setFocus: mocks.focus,
    show: mocks.show,
    unminimize: mocks.unminimize,
  }),
}));
let root: Root;
let container: HTMLDivElement;
let event: () => void;
let pendingLinks: string[];
const receive = (urls: string[]) => {
  pendingLinks = urls;
  event();
};
const link = ticketContextLink({
  provider: "jira",
  url: "https://demo.atlassian.net/browse/DEMO-42",
});
function Fixture({ open }: { open: (ref: never) => Promise<void> }) {
  useTicketDeepLinks(open);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.label = "main";
  pendingLinks = [];
  mocks.claim.mockImplementation(async () =>
    mocks.label === "main" ? pendingLinks.splice(0) : [],
  );
  mocks.listen.mockImplementation(async (_name, handler) => {
    event = handler;
    return mocks.unlisten;
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
it("opens a cold-start link as an unsent ticket and focuses the window", async () => {
  pendingLinks = [link];
  const open = vi.fn(async () => {});
  await act(async () => root.render(createElement(Fixture, { open })));
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "jira", key: "DEMO-42" }),
  );
  expect(mocks.focus).toHaveBeenCalledOnce();
});
it("handles warm links and ignores malformed or unrelated URLs", async () => {
  const open = vi.fn(async () => {});
  await act(async () => root.render(createElement(Fixture, { open })));
  await act(async () =>
    receive(["https://example.com", "monocode://context/jira?url=bad", link]),
  );
  expect(open).toHaveBeenCalledOnce();
});
it("does not duplicate a native link in another workspace window", async () => {
  mocks.label = "window-1";
  const open = vi.fn(async () => {});
  await act(async () => root.render(createElement(Fixture, { open })));
  await act(async () => receive([link]));
  expect(open).not.toHaveBeenCalled();
});
it("handles links clicked inside the current workspace", async () => {
  mocks.label = "window-1";
  const open = vi.fn(async () => {});
  await act(async () => root.render(createElement(Fixture, { open })));
  await act(async () => requestOpenTicketContext(link));
  expect(open).toHaveBeenCalledOnce();
});
it("surfaces an opening failure and removes the listener on unmount", async () => {
  const open = vi.fn(async () => {
    throw new Error("No workspace available");
  });
  await act(async () => root.render(createElement(Fixture, { open })));
  await act(async () => receive([link]));
  expect(mocks.message).toHaveBeenCalledWith(
    "No workspace available",
    expect.objectContaining({ kind: "error" }),
  );
  act(() => root.unmount());
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  root = createRoot(container);
});
