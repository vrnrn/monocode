import { keybindingPressed } from "../../settings/model/settings";
import {
  handleFilePreviewFindKey,
  openFindInActiveFilePreview,
} from "../ui/FilePreviewSearch";

type EditorSearchCommands = {
  handleKey: (event: KeyboardEvent) => boolean;
  openFind: () => boolean;
};

let commands: EditorSearchCommands | undefined;

/** Installed when the editor loads; this bridge never retains editor views. */
export function registerEditorSearchCommands(next: EditorSearchCommands) {
  commands = next;
  return () => {
    if (commands === next) commands = undefined;
  };
}

export function handleEditorFindKey(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      "[data-file-picker], [data-model-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker]",
    )
  )
    return false;

  if (handleFilePreviewFindKey(event)) return true;

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const defaultReplace = mod && event.altKey && !event.shiftKey && key === "f";
  const defaultFind = mod && !event.altKey && !event.shiftKey && key === "f";
  // Suppress overridden defaults even before any editor has been loaded.
  if (
    (defaultReplace && !keybindingPressed("Editor: Replace", event, true)) ||
    (defaultFind && !keybindingPressed("Editor: Find", event, true))
  ) {
    event.preventDefault();
    return true;
  }

  return commands?.handleKey(event) ?? false;
}

export function openFindInActiveEditor(): boolean {
  return openFindInActiveFilePreview() || (commands?.openFind() ?? false);
}
