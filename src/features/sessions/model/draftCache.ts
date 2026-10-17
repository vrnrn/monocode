import { invoke } from "@tauri-apps/api/core";
import type { McpTag } from "./mcpPicker";
import type { Attachment } from "./session";
import {
  checkDraftAttachments,
  durableDraftAttachments,
} from "./draftAttachments";

/** Ordinary unsent input; explicit Block.draft turns remain transcript data. */
export type ComposerDraftPayload = {
  cwd: string;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  attachments: Attachment[];
  mcpTags: McpTag[];
};
export type ComposerDraftEnvelope = {
  sessionId: string;
  revision: number;
  payload: ComposerDraftPayload;
};
export type ComposerDraftIssue = {
  kind: "conflict" | "error" | "missing";
  message: string;
  stored?: ComposerDraftEnvelope;
};
type Entry = {
  sessionId: string;
  payload: ComposerDraftPayload;
  revision: number | null;
  generation: number;
  restored: number;
  dirty: boolean;
  cleared: boolean;
  retired: boolean;
  issue: ComposerDraftIssue | null;
  hydration?: Promise<void>;
  writing?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<() => void>;
};
const drafts = new Map<string, string>();
const mcpTags = new Map<string, McpTag[]>();
const entries = new Map<string, Entry>();
const captures = new Set<() => void>();
const SAVE_DELAY = 400;

export function nativeComposerDraftsAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function getComposerDraft(sessionId: string): string | undefined {
  return drafts.get(sessionId);
}
/** Memory writes also support quick composers without a stable durable owner. */
export function setComposerDraft(sessionId: string, text: string): void {
  if (text) drafts.set(sessionId, text);
  else {
    drafts.delete(sessionId);
    mcpTags.delete(sessionId);
  }
}
export function getComposerMcpTags(sessionId: string): McpTag[] {
  return mcpTags.get(sessionId) ?? [];
}
export function setComposerMcpTags(sessionId: string, tags: McpTag[]): void {
  if (tags.length) mcpTags.set(sessionId, tags);
  else mcpTags.delete(sessionId);
}
function empty(cwd: string): ComposerDraftPayload {
  return {
    cwd,
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
    attachments: [],
    mcpTags: [],
  };
}
function remember(entry: Entry): void {
  setComposerDraft(entry.sessionId, entry.payload.text);
  setComposerMcpTags(entry.sessionId, entry.payload.mcpTags);
}
function publish(entry: Entry): void {
  for (const listener of entry.listeners) listener();
}
function equal(
  left: ComposerDraftPayload,
  right: ComposerDraftPayload,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function hasInput(payload: ComposerDraftPayload): boolean {
  return (
    !!payload.text ||
    payload.attachments.length > 0 ||
    payload.mcpTags.length > 0
  );
}
function envelope(value: unknown, sessionId: string): ComposerDraftEnvelope {
  const result = value as ComposerDraftEnvelope | null;
  if (
    !result ||
    result.sessionId !== sessionId ||
    !Number.isSafeInteger(result.revision) ||
    result.revision < 0 ||
    !result.payload ||
    typeof result.payload.cwd !== "string" ||
    typeof result.payload.text !== "string" ||
    !Number.isInteger(result.payload.selectionStart) ||
    !Number.isInteger(result.payload.selectionEnd) ||
    result.payload.selectionStart < 0 ||
    result.payload.selectionStart > result.payload.selectionEnd ||
    result.payload.selectionEnd > result.payload.text.length ||
    !Array.isArray(result.payload.attachments) ||
    !Array.isArray(result.payload.mcpTags)
  ) {
    throw new Error(
      "Composer draft storage returned an invalid response. The current input was kept.",
    );
  }
  return result;
}
function message(reason: unknown): string {
  if (reason && typeof reason === "object" && "message" in reason)
    return String(reason.message);
  return String(reason);
}
function schedule(entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.retired) return;
  if (entry.issue && entry.issue.kind !== "missing") return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    void flushEntry(entry).catch(() => undefined);
  }, SAVE_DELAY);
}
export function openComposerDraft(
  sessionId: string,
  initial: ComposerDraftPayload,
): {
  payload: ComposerDraftPayload;
  restored: number;
  issue: ComposerDraftIssue | null;
} {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = {
      sessionId,
      payload: initial,
      revision: null,
      generation: 0,
      restored: 0,
      dirty: hasInput(initial),
      cleared: false,
      retired: false,
      issue: null,
      listeners: new Set(),
    };
    entries.set(sessionId, entry);
  }
  return {
    payload: entry.payload,
    restored: entry.restored,
    issue: entry.issue,
  };
}
export function composerDraftState(sessionId: string):
  | {
      payload: ComposerDraftPayload;
      restored: number;
      issue: ComposerDraftIssue | null;
    }
  | undefined {
  const entry = entries.get(sessionId);
  return (
    entry && {
      payload: entry.payload,
      restored: entry.restored,
      issue: entry.issue,
    }
  );
}
export function subscribeComposerDraft(
  sessionId: string,
  listener: () => void,
): () => void {
  const entry = entries.get(sessionId);
  entry?.listeners.add(listener);
  return () => {
    entry?.listeners.delete(listener);
  };
}
export function registerComposerDraftCapture(capture: () => void): () => void {
  captures.add(capture);
  return () => {
    captures.delete(capture);
  };
}
export async function hydrateComposerDraft(sessionId: string): Promise<void> {
  const entry = entries.get(sessionId);
  if (!entry || !nativeComposerDraftsAvailable()) return;
  if (entry.hydration) return entry.hydration;
  const generation = entry.generation;
  entry.hydration = (async () => {
    try {
      const saved = envelope(
        await invoke("composer_draft_get", { sessionId }),
        sessionId,
      );
      if (entry.retired) return;
      entry.revision = saved.revision;
      if (saved.revision === 0 || entry.cleared) {
        if (entry.dirty) schedule(entry);
        return;
      }
      if (equal(entry.payload, saved.payload)) {
        entry.dirty = false;
        return;
      }
      if (
        entry.generation !== generation ||
        hasInput(entry.payload) ||
        saved.payload.cwd !== entry.payload.cwd
      ) {
        if (hasInput(saved.payload)) {
          entry.issue = {
            kind: "conflict",
            message:
              "A saved draft is available. Your current input has been kept.",
            stored: saved,
          };
          publish(entry);
          return;
        }
        if (entry.dirty) schedule(entry);
        return;
      }
      let missing: string[] = [];
      let checkError: string | undefined;
      try {
        missing = await checkDraftAttachments(saved.payload.attachments);
      } catch (reason) {
        checkError = message(reason);
      }
      // File validation is asynchronous too. Never replace intervening typing,
      // sends, clears, or a composer that acquired a different local snapshot.
      if (entry.generation !== generation || entry.cleared) {
        if (!entry.cleared && hasInput(saved.payload)) {
          entry.issue = {
            kind: "conflict",
            message:
              "A saved draft is available. Your newer input has been kept.",
            stored: saved,
          };
        } else if (entry.dirty) schedule(entry);
        publish(entry);
        return;
      }
      entry.payload = saved.payload;
      entry.dirty = false;
      entry.restored++;
      if (missing.length || checkError)
        entry.issue = {
          kind: "missing",
          message:
            checkError ??
            `Draft restored, but these files are missing. Attach them again or remove them: ${missing.join(", ")}`,
        };
      remember(entry);
      publish(entry);
    } catch (reason) {
      entry.issue = { kind: "error", message: message(reason) };
      publish(entry);
    }
  })();
  return entry.hydration;
}
/** Captures DOM offsets in JavaScript UTF-16 units, including selection-only edits. */
export function captureComposerDraft(
  sessionId: string,
  payload: ComposerDraftPayload,
): void {
  const entry = entries.get(sessionId);
  if (!entry || entry.retired || equal(entry.payload, payload)) return;
  entry.payload = payload;
  entry.generation++;
  entry.dirty = true;
  entry.cleared = !hasInput(payload);
  remember(entry);
  schedule(entry);
  publish(entry);
}
export function clearComposerDraft(sessionId: string): void {
  drafts.delete(sessionId);
  mcpTags.delete(sessionId);
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.retired) return;
  entry.payload = empty(entry.payload.cwd);
  entry.generation++;
  entry.dirty = true;
  entry.cleared = true;
  if (entry.issue?.kind === "missing") entry.issue = null;
  schedule(entry);
  publish(entry);
}
async function flushEntry(entry: Entry): Promise<void> {
  if (!nativeComposerDraftsAvailable() || entry.retired) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = undefined;
  await hydrateComposerDraft(entry.sessionId);
  if (entry.retired) return;
  if (entry.writing) {
    await entry.writing;
    if (!entry.dirty) return;
  }
  if (!entry.dirty) return;
  if (entry.issue && entry.issue.kind !== "missing")
    throw new Error(entry.issue.message);
  if (entry.revision == null)
    throw new Error("Composer draft has not loaded yet.");
  entry.writing = (async () => {
    while (entry.dirty && !entry.retired) {
      const generation = entry.generation;
      const snapshot = entry.payload;
      try {
        const attachments = await durableDraftAttachments(snapshot.attachments);
        if (entry.retired) return;
        if (entry.generation !== generation) continue;
        const saved = envelope(
          await invoke("composer_draft_set", {
            request: {
              sessionId: entry.sessionId,
              expectedRevision: entry.revision,
              payload: {
                ...snapshot,
                attachments,
                mcpTags: snapshot.mcpTags.map(({ token, server }) => ({
                  token,
                  server: {
                    provider: server.provider,
                    name: server.name,
                    scope: server.scope,
                    configPath: server.configPath,
                    transport: server.transport,
                    ...(server.enabled != null
                      ? { enabled: server.enabled }
                      : {}),
                  },
                })),
              },
            },
          }),
          entry.sessionId,
        );
        entry.revision = saved.revision;
        if (entry.generation === generation) {
          entry.dirty = false;
          entry.cleared = false;
        }
      } catch (reason) {
        if (entry.retired) return;
        const error = reason as { code?: string; current?: unknown } | null;
        let stored: ComposerDraftEnvelope | undefined;
        if (error?.code === "conflict" && error.current) {
          try {
            stored = envelope(error.current, entry.sessionId);
          } catch {
            /* retain the local input */
          }
        }
        entry.issue = {
          kind: stored ? "conflict" : "error",
          message: message(reason),
          ...(stored ? { stored } : {}),
        };
        publish(entry);
        throw reason;
      }
    }
    publish(entry);
  })();
  try {
    await entry.writing;
  } finally {
    entry.writing = undefined;
  }
}
export async function flushComposerDraft(sessionId: string): Promise<void> {
  const entry = entries.get(sessionId);
  if (entry) await flushEntry(entry);
}
/** Retire only after successful session deletion; late writes then stay inert. */
export function discardComposerDraft(sessionId: string): void {
  drafts.delete(sessionId);
  mcpTags.delete(sessionId);
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = undefined;
  entry.retired = true;
  entry.dirty = false;
  entry.issue = null;
  entry.payload = empty(entry.payload.cwd);
  publish(entry);
}
/** Quit awaits every active field capture, attachment copy, and SQLite receipt. */
export async function flushComposerDrafts(): Promise<void> {
  for (const capture of captures) capture();
  await Promise.all([...entries.values()].map(flushEntry));
}
export async function resolveComposerDraft(
  sessionId: string,
  choice: "current" | "stored" | "retry" | "dismiss",
): Promise<void> {
  const entry = entries.get(sessionId);
  if (!entry) return;
  const stored = entry.issue?.stored;
  if (choice === "dismiss") {
    if (entry.issue?.kind === "missing") entry.issue = null;
    publish(entry);
    return;
  }
  if (choice === "stored" && stored) {
    entry.payload = stored.payload;
    entry.revision = stored.revision;
    entry.generation++;
    entry.restored++;
    entry.dirty = false;
    entry.cleared = false;
    entry.issue = null;
    remember(entry);
    publish(entry);
    try {
      const generation = entry.generation;
      const missing = await checkDraftAttachments(entry.payload.attachments);
      if (generation === entry.generation && missing.length) {
        entry.issue = {
          kind: "missing",
          message: `These draft files are missing. Attach them again or remove them: ${missing.join(", ")}`,
        };
        publish(entry);
      }
    } catch (reason) {
      entry.issue = { kind: "missing", message: message(reason) };
      publish(entry);
    }
    return;
  }
  if (stored) entry.revision = stored.revision;
  entry.issue = null;
  if (entry.revision == null) {
    entry.hydration = undefined;
    await hydrateComposerDraft(sessionId);
  }
  publish(entry);
  await flushEntry(entry);
}
