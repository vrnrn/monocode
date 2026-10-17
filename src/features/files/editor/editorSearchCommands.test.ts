// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveKeybindingOverride } from "../../settings/model/settings";
import {
  handleEditorFindKey,
  openFindInActiveEditor,
  registerEditorSearchCommands,
} from "./editorSearchCommands";
import {
  handleFilePreviewFindKey,
  openFindInActiveFilePreview,
} from "../ui/FilePreviewSearch";

vi.mock("../ui/FilePreviewSearch", () => ({
  handleFilePreviewFindKey: vi.fn(() => false),
  openFindInActiveFilePreview: vi.fn(() => false),
}));

let unregister: (() => void) | undefined;
afterEach(() => {
  unregister?.();
  unregister = undefined;
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(handleFilePreviewFindKey).mockReturnValue(false);
  vi.mocked(openFindInActiveFilePreview).mockReturnValue(false);
  document.body.replaceChildren();
});

function key(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key, cancelable: true, ...init });
}

describe("editor search command bridge", () => {
  it("does not consume editor shortcuts before the editor loads", () => {
    const event = key("f", { ctrlKey: true });
    expect(handleEditorFindKey(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(openFindInActiveEditor()).toBe(false);
  });

  it.each<[string, boolean]>([
    ["Editor: Find", false],
    ["Editor: Replace", true],
  ])(
    "suppresses overridden %s defaults before registration",
    (command, altKey) => {
      saveKeybindingOverride(command, { disabled: true });
      const event = key("f", { ctrlKey: true, altKey });
      expect(handleEditorFindKey(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    },
  );

  it("delegates keys and menu commands synchronously after registration", () => {
    const handleKey = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
      return true;
    });
    const openFind = vi.fn(() => true);
    unregister = registerEditorSearchCommands({ handleKey, openFind });
    for (const event of [
      key("f", { ctrlKey: true }),
      key("f", { ctrlKey: true, altKey: true }),
      key("F3"),
      key("g", { ctrlKey: true, shiftKey: true }),
      key("Escape"),
    ]) {
      expect(handleEditorFindKey(event)).toBe(true);
      expect(handleKey).toHaveBeenLastCalledWith(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(openFindInActiveEditor()).toBe(true);
    expect(openFind).toHaveBeenCalledOnce();
    unregister();
    expect(handleEditorFindKey(key("F3"))).toBe(false);
    expect(openFindInActiveEditor()).toBe(false);
  });

  it("gives preview search priority over a registered editor", () => {
    const handleKey = vi.fn(() => true);
    const openFind = vi.fn(() => true);
    unregister = registerEditorSearchCommands({ handleKey, openFind });
    vi.mocked(handleFilePreviewFindKey).mockReturnValue(true);
    vi.mocked(openFindInActiveFilePreview).mockReturnValue(true);
    expect(handleEditorFindKey(key("f", { ctrlKey: true }))).toBe(true);
    expect(openFindInActiveEditor()).toBe(true);
    expect(handleKey).not.toHaveBeenCalled();
    expect(openFind).not.toHaveBeenCalled();
  });

  it("excludes IME composition and picker events before either handler", () => {
    const handleKey = vi.fn(() => true);
    unregister = registerEditorSearchCommands({
      handleKey,
      openFind: () => true,
    });
    expect(
      handleEditorFindKey(key("f", { ctrlKey: true, isComposing: true })),
    ).toBe(false);
    for (const picker of ["file", "model", "branch", "skill", "mention"]) {
      const host = document.createElement("div");
      host.setAttribute(`data-${picker}-picker`, "");
      const input = document.createElement("input");
      host.append(input);
      document.body.append(host);
      const event = key("f", { ctrlKey: true });
      input.dispatchEvent(event);
      expect(handleEditorFindKey(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(handleKey).not.toHaveBeenCalled();
    expect(handleFilePreviewFindKey).not.toHaveBeenCalled();
  });

  it("uses the loaded editor for find, replace, navigation and Escape while skipping hidden editors", async () => {
    const { EditorView } = await import("@codemirror/view");
    const { EditorState } = await import("@codemirror/state");
    const { SearchQuery, setSearchQuery, searchPanelOpen } =
      await import("@codemirror/search");
    const { editorSearch } = await import("./editorSearch");
    const hiddenHost = document.createElement("div");
    hiddenHost.className = "hidden";
    const visibleHost = document.createElement("div");
    document.body.append(hiddenHost, visibleHost);
    const views = [hiddenHost, visibleHost].map(
      (parent) =>
        new EditorView({
          parent,
          state: EditorState.create({
            doc: "one two one",
            extensions: [editorSearch],
          }),
        }),
    );
    const [hidden, visible] = views;
    // Focus must not make a parked editor eligible for a global Find command.
    hidden.focus();
    try {
      expect(openFindInActiveEditor()).toBe(true);
      expect(searchPanelOpen(hidden.state)).toBe(false);
      expect(searchPanelOpen(visible.state)).toBe(true);
      visible.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "one" })),
      });
      expect(handleEditorFindKey(key("F3"))).toBe(true);
      expect(visible.state.selection.main.from).toBe(0);
      expect(handleEditorFindKey(key("g", { ctrlKey: true }))).toBe(true);
      expect(visible.state.selection.main.from).toBe(8);
      expect(handleEditorFindKey(key("F3", { shiftKey: true }))).toBe(true);
      expect(visible.state.selection.main.from).toBe(0);
      expect(
        handleEditorFindKey(key("f", { ctrlKey: true, altKey: true })),
      ).toBe(true);
      expect(visible.dom.querySelector(".cm-find.is-replace")).not.toBeNull();
      const escape = key("Escape");
      expect(handleEditorFindKey(escape)).toBe(true);
      expect(escape.defaultPrevented).toBe(true);
      expect(searchPanelOpen(visible.state)).toBe(false);
      expect(handleEditorFindKey(key("Escape"))).toBe(false);
      expect(handleEditorFindKey(key("f", { ctrlKey: true }))).toBe(true);
      expect(searchPanelOpen(visible.state)).toBe(true);
    } finally {
      views.forEach((view) => view.destroy());
      // Drop the module registration after exercising the real implementation.
      registerEditorSearchCommands({
        handleKey: () => false,
        openFind: () => false,
      })();
    }
  });
});
