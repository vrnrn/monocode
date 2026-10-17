// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReleaseNotesDocument } from "../model/releaseNotes";
import { releaseNotesLoader } from "../model/releaseNotesLoader";
import { ReleaseNotesSurface } from "./ReleaseNotesSurface";

vi.mock("../model/releaseNotesLoader", () => ({
  releaseNotesLoader: { get: vi.fn(() => undefined), load: vi.fn() },
}));
vi.mock("../../features/sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => createElement("p", null, text),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const notes = (version: string): ReleaseNotesDocument => ({
  source: { version },
  markdown: `Release ${version}`,
});
async function render(version: string, visible = true) {
  await act(async () =>
    root.render(
      createElement(ReleaseNotesSurface, {
        source: { version },
        visible,
      }),
    ),
  );
}

it("does not load restored hidden notes until their tab is visible", async () => {
  vi.mocked(releaseNotesLoader.load).mockResolvedValue(notes("older"));
  await render("older", false);
  expect(releaseNotesLoader.load).not.toHaveBeenCalled();
  await render("older");
  expect(releaseNotesLoader.load).toHaveBeenCalledWith("older");
  expect(container.textContent).toContain("Release older");
});

it("does not publish a late response for a previously selected version", async () => {
  let finishOld!: (value: ReleaseNotesDocument) => void;
  vi.mocked(releaseNotesLoader.load)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(notes("newer"));
  await render("older");
  expect(container.textContent).toContain("Loading release notes");
  await render("newer");
  expect(container.textContent).toContain("Release newer");
  await act(async () => finishOld(notes("older")));
  expect(container.textContent).toContain("Release newer");
  expect(container.textContent).not.toContain("Release older");
});

it("shows an import failure and lets the reader retry", async () => {
  vi.mocked(releaseNotesLoader.load)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(notes("older"));
  await render("older");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load",
  );
  await act(async () => container.querySelector("button")!.click());
  expect(container.textContent).toContain("Release older");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("keeps unavailable versions distinct from loading and failed reads", async () => {
  vi.mocked(releaseNotesLoader.load).mockResolvedValue(null);
  await render("missing");
  expect(container.textContent).toContain("not available in this build");
  expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
});
