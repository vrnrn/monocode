// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAutosave } from "../../settings/model/settings";
import { FileEditor } from "./FileEditor";
import {
  EDITOR_HOST_UPDATE_MESSAGE,
  EditorSaveUnavailableError,
} from "../../../platform/tauri/fs";

const native = vi.hoisted(() => ({
  files: new Map<string, string>(),
  legacyHost: false,
  beforeRead: undefined as undefined | (() => Promise<void>),
  beforeWrite: undefined as undefined | (() => Promise<void>),
}));
const digest = (content: string) =>
  createHash("sha256").update(content).digest("hex");
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const path = args?.path as string;
    if (command === "read_editor_text_file") {
      const content = native.files.get(path);
      if (content === undefined) throw new Error("File was deleted");
      await native.beforeRead?.();
      return native.legacyHost
        ? {
            path,
            content,
            hash: null,
            saveDisabledReason: EDITOR_HOST_UPDATE_MESSAGE,
          }
        : { path, content, hash: digest(content) };
    }
    if (command === "write_editor_text_file") {
      if (native.legacyHost) throw new EditorSaveUnavailableError();
      await native.beforeWrite?.();
      const current = native.files.get(path);
      const hash = current === undefined ? null : digest(current);
      if (hash !== args?.expectedHash)
        return { status: "conflict", path, hash };
      const content = args.content as string;
      native.files.set(path, content);
      return { status: "saved", path, hash: digest(content) };
    }
    if (command === "stat_files") return [];
    throw new Error(`Unexpected command: ${command}`);
  }),
);
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("../../../shared/lib/format", () => ({ formatText: async () => null }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Exercise the actual CodeMirror save capture and React document lifecycle;
// only the native transport is replaced.
describe("ordinary editor save conflicts", () => {
  let root: Root;
  let container: HTMLDivElement;
  const dirty = vi.fn();
  const path = "/repo/notes.txt";
  const otherPath = "/repo/other.txt";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", new Storage());
    saveAutosave(false);
    native.files.clear();
    native.legacyHost = false;
    native.files.set(path, "original\r\n");
    native.files.set(otherPath, "other\n");
    native.beforeWrite = undefined;
    native.beforeRead = undefined;
    invoke.mockClear();
    dirty.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(filePath = path) {
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: filePath,
          cwd: "/repo",
          active: true,
          onDirtyChange: dirty,
        }),
      ),
    );
    await act(async () =>
      vi.waitFor(() =>
        expect(container.querySelector(".cm-editor")).not.toBeNull(),
      ),
    );
    return EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
  }
  async function type(view: EditorView, text: string) {
    await act(async () =>
      view.dispatch({ changes: { from: 0, insert: text } }),
    );
  }
  async function save(view: EditorView) {
    await act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
    });
  }
  async function click(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
  const writes = () =>
    invoke.mock.calls
      .filter(([command]) => command === "write_editor_text_file")
      .map(([, args]) => args!);

  it("preserves disk and draft when an external edit wins without a watcher notification", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.set(path, "external\n");
    await save(view);
    expect(native.files.get(path)).toBe("external\n");
    expect(view.state.doc.toString()).toBe("local original\n");
    expect(dirty).toHaveBeenLastCalledWith(path, true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "changed on disk",
    );
    expect(writes()[0]).toEqual({
      path,
      content: "local original\r\n",
      expectedHash: digest("original\r\n"),
    });
    await click("Reload from disk");
    const reloaded = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    expect(reloaded.state.doc.toString()).toBe("external\n");
    expect(dirty).toHaveBeenLastCalledWith(path, false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps newer typing dirty, then saves it against the successful receipt's baseline", async () => {
    const pending = deferred();
    native.beforeWrite = () => pending.promise;
    const view = await render();
    await type(view, "saved ");
    await save(view);
    await type(view, "newer ");
    await act(async () => pending.resolve());
    expect(native.files.get(path)).toBe("saved original\r\n");
    expect(view.state.doc.toString()).toBe("newer saved original\n");
    expect(dirty).toHaveBeenLastCalledWith(path, true);
    expect(container.querySelector("footer")?.textContent).not.toContain(
      "Saved",
    );
    native.beforeWrite = undefined;
    await save(view);
    expect(writes()[1].expectedHash).toBe(digest("saved original\r\n"));
    expect(native.files.get(path)).toBe("newer saved original\r\n");
    expect(dirty).toHaveBeenLastCalledWith(path, false);
    expect(container.querySelector("footer")?.textContent).toContain("Saved");
  });

  it("does not acknowledge another file when an old save completes", async () => {
    const pending = deferred();
    native.beforeWrite = () => pending.promise;
    const view = await render();
    await type(view, "first ");
    await save(view);
    const other = await render(otherPath);
    await act(async () => pending.resolve());
    expect(native.files.get(path)).toBe("first original\r\n");
    expect(other.state.doc.toString()).toBe("other\n");
    expect(container.querySelector("footer")?.textContent).not.toContain(
      "Saved",
    );
    native.beforeWrite = undefined;
    await type(other, "second ");
    await save(other);
    expect(writes()[1].expectedHash).toBe(digest("other\n"));
    expect(dirty).toHaveBeenLastCalledWith(otherPath, false);
  });

  it("does not advance a newly opened instance of the same path from an old save", async () => {
    const pending = deferred();
    native.beforeWrite = () => pending.promise;
    const old = await render();
    await type(old, "old instance ");
    await save(old);
    await render(otherPath);
    const reopened = await render();
    await act(async () => pending.resolve());
    expect(reopened.state.doc.toString()).toBe("original\n");
    expect(container.querySelector("footer")?.textContent).not.toContain(
      "Saved",
    );
    native.beforeWrite = undefined;
    await type(reopened, "new instance ");
    await save(reopened);
    expect(writes()[1].expectedHash).toBe(digest("original\r\n"));
    expect(native.files.get(path)).toBe("old instance original\r\n");
    expect(reopened.state.doc.toString()).toBe("new instance original\n");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not show a stale save failure on a different file", async () => {
    const pending = deferred();
    native.beforeWrite = () => pending.promise;
    const view = await render();
    await type(view, "first ");
    await save(view);
    await render(otherPath);
    await act(async () => pending.reject(new Error("old file unavailable")));
    expect(container.textContent).not.toContain("old file unavailable");
    expect(container.querySelector("footer")?.textContent).not.toContain(
      "Saving",
    );
  });

  it("rechecks the observed external version when explicitly saving local changes", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.set(path, "external\n");
    await save(view);
    const pending = deferred();
    native.beforeWrite = () => pending.promise;
    await click("Save my changes");
    expect(writes()[1].expectedHash).toBe(digest("external\n"));
    native.files.set(path, "external again\n");
    await act(async () => pending.resolve());
    expect(native.files.get(path)).toBe("external again\n");
    expect(view.state.doc.toString()).toBe("local original\n");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    native.beforeWrite = undefined;
    await click("Save my changes");
    expect(native.files.get(path)).toBe("local original\r\n");
    expect(dirty).toHaveBeenLastCalledWith(path, false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a deleted target as a conflict and retains the local draft", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.delete(path);
    await save(view);
    expect(native.files.has(path)).toBe(false);
    expect(view.state.doc.toString()).toBe("local original\n");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await click("Reload from disk");
    expect(view.state.doc.toString()).toBe("local original\n");
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "deleted",
    );
    await click("Save my changes");
    expect(native.files.has(path)).toBe(false);
    expect(view.state.doc.toString()).toBe("local original\n");
  });

  it("keeps typing that occurs while an explicit reload is pending", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.set(path, "external\n");
    await save(view);
    const pending = deferred();
    native.beforeRead = () => pending.promise;
    await click("Reload from disk");
    await type(view, "newer ");
    await act(async () => pending.resolve());
    expect(view.state.doc.toString()).toBe("newer local original\n");
    expect(native.files.get(path)).toBe("external\n");
    expect(dirty).toHaveBeenLastCalledWith(path, true);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("does not repeat an explicit conflict save after switching files", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.set(path, "external\n");
    await save(view);
    await click("Save my changes");
    expect(writes()).toHaveLength(2);
    const other = await render(otherPath);
    expect(other.state.doc.toString()).toBe("other\n");
    expect(writes()).toHaveLength(2);
    expect(container.querySelector("footer")?.textContent).not.toContain(
      "Saved",
    );
  });

  it("clears a conflict when undoing local edits reloads the external content", async () => {
    const view = await render();
    await type(view, "local ");
    native.files.set(path, "external\n");
    await save(view);
    await act(async () =>
      view.dispatch({ changes: { from: 0, to: "local ".length } }),
    );
    expect(view.state.doc.toString()).toBe("external\n");
    expect(dirty).toHaveBeenLastCalledWith(path, false);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("opens old-host files read-only and restores checked saving after a host update", async () => {
    native.legacyHost = true;
    const view = await render();
    expect(view.state.doc.toString()).toBe("original\n");
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.contentEditable).toBe("false");
    expect(container.textContent).toContain(EDITOR_HOST_UPDATE_MESSAGE);
    await save(view);
    expect(writes()).toHaveLength(0);
    native.legacyHost = false;
    await click("Check host update");
    expect(view.state.readOnly).toBe(false);
    await type(view, "updated host ");
    await save(view);
    expect(native.files.get(path)).toBe("updated host original\r\n");
    expect(dirty).toHaveBeenLastCalledWith(path, false);
  });

  it("retains a draft across a host downgrade and does not rebase it when saving becomes available", async () => {
    const view = await render();
    await type(view, "local ");
    native.legacyHost = true;
    await save(view);
    expect(view.state.readOnly).toBe(true);
    expect(view.state.doc.toString()).toBe("local original\n");
    expect(native.files.get(path)).toBe("original\r\n");
    expect(dirty).toHaveBeenLastCalledWith(path, true);
    native.legacyHost = false;
    native.files.set(path, "external while downgraded\n");
    await click("Check host update");
    expect(view.state.readOnly).toBe(false);
    expect(view.state.doc.toString()).toBe("local original\n");
    await save(view);
    expect(writes().at(-1)?.expectedHash).toBe(digest("original\r\n"));
    expect(native.files.get(path)).toBe("external while downgraded\n");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
