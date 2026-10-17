import { beforeEach, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import { flushComposerDrafts } from "../../features/sessions/model/draftCache";
import { handleQuitRequested } from "./appLifecycle";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  message: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../features/sessions/model/draftCache", () => ({
  flushComposerDrafts: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(message).mockResolvedValue(undefined);
});

it("explains a draft conflict and keeps the app open when quit cannot save it", async () => {
  vi.mocked(flushComposerDrafts).mockRejectedValue(
    new Error("This draft changed in another window."),
  );
  expect(await handleQuitRequested()).toBe(false);
  expect(message).toHaveBeenCalledWith(
    expect.stringContaining("This draft changed in another window."),
    { title: "Message not saved", kind: "error" },
  );
});

it("still preserves unsaved work when displaying the error fails", async () => {
  vi.mocked(flushComposerDrafts).mockRejectedValue(new Error("Disk is full"));
  vi.mocked(message).mockRejectedValue(new Error("Dialog unavailable"));
  expect(await handleQuitRequested()).toBe(false);
});

it("shows serialized native storage errors in the quit explanation", async () => {
  vi.mocked(flushComposerDrafts).mockRejectedValue({
    code: "storageUnavailable",
    message: "The draft database could not be opened",
  });
  expect(await handleQuitRequested()).toBe(false);
  expect(message).toHaveBeenCalledWith(
    expect.stringContaining("The draft database could not be opened"),
    expect.any(Object),
  );
});
