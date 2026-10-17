import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import "../../src/styles/index.css";

const view = new URLSearchParams(location.search).get("view");
const filePath = "/repo/notes.txt";
let disk = "original\r\n";
const hash = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
Object.assign(window, {
  isTauri: true,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args?: Record<string, unknown>) => {
      if (command === "read_editor_text_file")
        return {
          path: filePath,
          content: disk,
          hash: view === "legacy-editor" ? null : await hash(disk),
          ...(view === "legacy-editor"
            ? {
                saveDisabledReason:
                  "Update this host in Connections to enable checked file saves. You can still read this file.",
              }
            : {}),
        };
      if (command === "write_editor_text_file") {
        const baseline = await hash(disk);
        if (baseline !== args?.expectedHash)
          return { status: "conflict", path: filePath, hash: baseline };
        disk = args?.content as string;
        return { status: "saved", path: filePath, hash: await hash(disk) };
      }
      if (command === "composer_draft_get") {
        const saved = localStorage.getItem("fixture.draft");
        return saved
          ? JSON.parse(saved)
          : {
              sessionId: args?.sessionId,
              revision: 0,
              payload: {
                cwd: "",
                text: "",
                selectionStart: 0,
                selectionEnd: 0,
                attachments: [],
                mcpTags: [],
              },
            };
      }
      if (command === "composer_draft_set") {
        const request = args?.request as {
          sessionId: string;
          expectedRevision: number;
          payload: unknown;
        };
        const saved = localStorage.getItem("fixture.draft");
        const current = saved ? JSON.parse(saved) : { revision: 0 };
        if (current.revision !== request.expectedRevision)
          throw {
            code: "conflict",
            message: "This draft changed in another window.",
            current,
          };
        const next = {
          sessionId: request.sessionId,
          revision: current.revision + 1,
          payload: request.payload,
        };
        localStorage.setItem("fixture.draft", JSON.stringify(next));
        return next;
      }
      if (command === "stat_files") return [];
      return undefined;
    },
  },
});
const { applyThemePreference } =
  await import("../../src/features/settings/model/appearance");
applyThemePreference(
  new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark",
);
const { saveAutosave } =
  await import("../../src/features/settings/model/settings");
saveAutosave(false);
const { FileEditor } = await import("../../src/features/files/ui/FileEditor");
const { useDurableComposerDraft } =
  await import("../../src/features/sessions/hooks/useDurableComposerDraft");
const { ComposerDraftRecovery } =
  await import("../../src/features/sessions/ui/ComposerDraftRecovery");
const { flushComposerDrafts } =
  await import("../../src/features/sessions/model/draftCache");
const { EditorView } = await import("@codemirror/view");
Object.assign(window, {
  reliability: {
    externalEdit: (text: string) => {
      disk = text;
    },
    disk: () => disk,
    editor: () =>
      EditorView.findFromDOM(
        document.querySelector<HTMLElement>(".cm-editor")!,
      ),
    flush: flushComposerDrafts,
    externalDraft: (text: string) => {
      const current = JSON.parse(localStorage.getItem("fixture.draft")!);
      localStorage.setItem(
        "fixture.draft",
        JSON.stringify({
          ...current,
          revision: current.revision + 1,
          payload: { ...current.payload, text },
        }),
      );
    },
  },
});

function DraftPreview() {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = useDurableComposerDraft({
    sessionId: "browser-draft",
    cwd: "/repo",
    enabled: true,
    read: () => ({
      cwd: "/repo",
      text,
      selectionStart: input.current?.selectionStart ?? 0,
      selectionEnd: input.current?.selectionEnd ?? 0,
      attachments: [],
      mcpTags: [],
    }),
    restore: (payload) => {
      setText(payload.text);
      requestAnimationFrame(() =>
        input.current?.setSelectionRange(
          payload.selectionStart,
          payload.selectionEnd,
        ),
      );
    },
  });
  return (
    <div className="mx-auto mt-12 max-w-xl rounded-lg border border-border p-4">
      <label htmlFor="draft">Message</label>
      <textarea
        id="draft"
        ref={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onSelect={draft.capture}
        className="mt-2 w-full rounded bg-background-raised p-3"
      />
      <ComposerDraftRecovery
        sessionId="browser-draft"
        issue={draft.issue}
        current={text}
      />
      <button
        onClick={() => {
          setText("");
          draft.clear();
        }}
        className="mt-4"
      >
        Clear message
      </button>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <main className="h-screen bg-background-base text-content">
    {view === "draft" ? (
      <DraftPreview />
    ) : (
      <FileEditor path={filePath} cwd="/repo" active onDirtyChange={() => {}} />
    )}
  </main>,
);
