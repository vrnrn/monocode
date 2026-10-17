import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraftEnvelope, ComposerDraftPayload } from "./draftCache";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
type Store = typeof import("./draftCache");
let store: Store;
let rows: Map<string, ComposerDraftEnvelope>;
function payload(text = ""): ComposerDraftPayload {
  return {
    cwd: "/project",
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
    attachments: [],
    mcpTags: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function open(id: string, value = payload()) {
  store.openComposerDraft(id, value);
}
function commands(name: string) {
  return invoke.mock.calls.filter(([command]) => command === name);
}
function backend(command: string, args: Record<string, unknown>) {
  if (command === "composer_draft_get") {
    const id = args.sessionId as string;
    return structuredClone(
      rows.get(id) ?? { sessionId: id, revision: 0, payload: payload() },
    );
  }
  if (command === "composer_draft_set") {
    const request = args.request as {
      sessionId: string;
      expectedRevision: number;
      payload: ComposerDraftPayload;
    };
    const current = rows.get(request.sessionId);
    if ((current?.revision ?? 0) !== request.expectedRevision) {
      if (
        current?.revision === request.expectedRevision + 1 &&
        JSON.stringify(current.payload) === JSON.stringify(request.payload)
      )
        return structuredClone(current);
      throw {
        code: "conflict",
        message: "A newer draft exists",
        current: structuredClone(current),
      };
    }
    const saved = {
      sessionId: request.sessionId,
      revision: request.expectedRevision + 1,
      payload: structuredClone(request.payload),
    };
    rows.set(request.sessionId, saved);
    return structuredClone(saved);
  }
  if (command === "composer_draft_cache_attachment")
    return "/app-data/composer-attachments/pasted.png";
  if (command === "inspect_paths")
    return (args.paths as string[]).map((path) => ({ path }));
  throw new Error(`Unexpected command ${command}`);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  rows = new Map();
  invoke.mockReset();
  invoke.mockImplementation(backend);
  store = await import("./draftCache");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("durable composer drafts", () => {
  it("restores exact Unicode, UTF-16 selection, ordered attachment refs and MCP tags", async () => {
    const saved = payload("A😀中\ne\u0301");
    saved.selectionStart = 1;
    saved.selectionEnd = 3;
    saved.attachments = [
      {
        id: "b",
        name: "b.png",
        kind: "image",
        mimeType: "image/png",
        size: 12,
        path: "/b.png",
      },
      {
        id: "a",
        name: "a.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 5,
        path: "/a.txt",
      },
    ];
    saved.mcpTags = [
      {
        token: "@mcp/docs",
        server: {
          provider: "codex",
          name: "docs",
          scope: "project",
          configPath: "/config.toml",
          transport: "stdio",
        },
      },
    ];
    rows.set("unicode", { sessionId: "unicode", revision: 9, payload: saved });
    open("unicode");
    await store.hydrateComposerDraft("unicode");
    expect(store.composerDraftState("unicode")?.payload).toEqual(saved);
    expect(store.getComposerDraft("unicode")).toBe(saved.text);
    expect(store.getComposerMcpTags("unicode")).toEqual(saved.mcpTags);
    expect(commands("composer_draft_set")).toHaveLength(0);
    expect(commands("inspect_paths")[0]?.[1]).toEqual({
      paths: ["/b.png", "/a.txt"],
    });
  });

  it("keeps new typing and initialDraft while a late hydration exposes the saved version for recovery", async () => {
    const read = deferred<ComposerDraftEnvelope>();
    invoke.mockImplementation((command, args) =>
      command === "composer_draft_get" ? read.promise : backend(command, args),
    );
    open("late", payload("initial seed"));
    const hydration = store.hydrateComposerDraft("late");
    store.captureComposerDraft("late", payload("new typing"));
    read.resolve({
      sessionId: "late",
      revision: 7,
      payload: payload("saved on disk"),
    });
    await hydration;
    expect(store.composerDraftState("late")?.payload.text).toBe("new typing");
    expect(store.composerDraftState("late")?.issue?.stored?.payload.text).toBe(
      "saved on disk",
    );
    await expect(store.flushComposerDraft("late")).rejects.toThrow();
    expect(commands("composer_draft_set")).toHaveLength(0);
  });

  it("never resurrects cleared or sent input when hydration completes later", async () => {
    const read = deferred<ComposerDraftEnvelope>();
    invoke.mockImplementation((command, args) =>
      command === "composer_draft_get" ? read.promise : backend(command, args),
    );
    open("cleared", payload("sent text"));
    const hydration = store.hydrateComposerDraft("cleared");
    store.clearComposerDraft("cleared");
    const saved = {
      sessionId: "cleared",
      revision: 3,
      payload: payload("previous text"),
    };
    rows.set("cleared", saved);
    read.resolve(saved);
    await hydration;
    await store.flushComposerDraft("cleared");
    expect(rows.get("cleared")?.payload).toEqual(payload());
    expect(rows.get("cleared")?.revision).toBe(4);
    expect(store.composerDraftState("cleared")?.issue).toBeNull();
  });

  it("keeps both windows' versions on CAS conflict until an explicit choice", async () => {
    open("shared");
    await store.hydrateComposerDraft("shared");
    vi.resetModules();
    const other = await import("./draftCache");
    other.openComposerDraft("shared", payload());
    await other.hydrateComposerDraft("shared");
    store.captureComposerDraft("shared", payload("first window"));
    await store.flushComposerDraft("shared");
    other.captureComposerDraft("shared", payload("second window"));
    await expect(other.flushComposerDraft("shared")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(rows.get("shared")?.payload.text).toBe("first window");
    expect(other.composerDraftState("shared")?.payload.text).toBe(
      "second window",
    );
    expect(
      other.composerDraftState("shared")?.issue?.stored?.payload.text,
    ).toBe("first window");
    await other.resolveComposerDraft("shared", "current");
    expect(rows.get("shared")?.payload.text).toBe("second window");
    expect(rows.get("shared")?.revision).toBe(2);
  });

  it("serializes in-flight writes and acknowledges only the captured generation", async () => {
    const first = deferred<ComposerDraftEnvelope>();
    open("serialized");
    await store.hydrateComposerDraft("serialized");
    let active = 0;
    let highest = 0;
    invoke.mockImplementation(async (command, args) => {
      if (command !== "composer_draft_set") return backend(command, args);
      active++;
      highest = Math.max(highest, active);
      try {
        if (commands("composer_draft_set").length === 1)
          return await first.promise;
        return backend(command, args);
      } finally {
        active--;
      }
    });
    store.captureComposerDraft("serialized", payload("first"));
    const flush = store.flushComposerDraft("serialized");
    await vi.waitFor(() =>
      expect(commands("composer_draft_set")).toHaveLength(1),
    );
    store.captureComposerDraft("serialized", payload("newer 😀"));
    const parallelFlush = store.flushComposerDraft("serialized");
    const firstSaved = {
      sessionId: "serialized",
      revision: 1,
      payload: payload("first"),
    };
    rows.set("serialized", firstSaved);
    first.resolve(firstSaved);
    await Promise.all([flush, parallelFlush]);
    expect(highest).toBe(1);
    expect(rows.get("serialized")?.payload.text).toBe("newer 😀");
    expect(rows.get("serialized")?.revision).toBe(2);
  });

  it("caches pasted bytes durably once and writes only metadata", async () => {
    open("clipboard");
    await store.hydrateComposerDraft("clipboard");
    const value = payload("look");
    value.attachments = [
      {
        id: "paste",
        name: "pasted.png",
        kind: "image",
        mimeType: "image/png",
        size: 3,
        data: "YWJj",
        previewUrl: "blob:temporary",
        copyFromPath: false,
      },
    ];
    store.captureComposerDraft("clipboard", value);
    await store.flushComposerDraft("clipboard");
    const file = rows.get("clipboard")?.payload.attachments[0];
    expect(file).toEqual({
      id: "paste",
      name: "pasted.png",
      kind: "image",
      mimeType: "image/png",
      size: 3,
      path: "/app-data/composer-attachments/pasted.png",
    });
    store.captureComposerDraft("clipboard", { ...value, text: "look again" });
    await store.flushComposerDraft("clipboard");
    expect(commands("composer_draft_cache_attachment")).toHaveLength(1);
    expect(
      store.composerDraftState("clipboard")?.payload.attachments[0]?.data,
    ).toBe("YWJj");
  });

  it("discards a superseded attachment snapshot before it can save sent text", async () => {
    const cache = deferred<string>();
    invoke.mockImplementation((command, args) =>
      command === "composer_draft_cache_attachment"
        ? cache.promise
        : backend(command, args),
    );
    open("clear-during-copy");
    await store.hydrateComposerDraft("clear-during-copy");
    const value = payload("send");
    value.attachments = [
      {
        id: "pending",
        name: "pasted.png",
        kind: "image",
        mimeType: "image/png",
        size: 3,
        data: "YWJj",
      },
    ];
    store.captureComposerDraft("clear-during-copy", value);
    const flush = store.flushComposerDraft("clear-during-copy");
    await vi.waitFor(() =>
      expect(commands("composer_draft_cache_attachment")).toHaveLength(1),
    );
    store.clearComposerDraft("clear-during-copy");
    cache.resolve("/app-data/file.png");
    await flush;
    expect(commands("composer_draft_set")).toHaveLength(1);
    expect(rows.get("clear-during-copy")?.payload.text).toBe("");
  });

  it("keeps corrupt stored data and current input intact through recovery attempts", async () => {
    invoke.mockRejectedValue({
      code: "corruptDraft",
      message: "Stored draft preserved for recovery",
    });
    open("corrupt", payload("local work"));
    await store.hydrateComposerDraft("corrupt");
    expect(store.composerDraftState("corrupt")?.payload.text).toBe(
      "local work",
    );
    expect(store.composerDraftState("corrupt")?.issue?.message).toContain(
      "preserved",
    );
    await expect(
      store.resolveComposerDraft("corrupt", "retry"),
    ).rejects.toThrow();
    expect(commands("composer_draft_set")).toHaveLength(0);
  });

  it("retains missing refs and reports names without dropping other attachments", async () => {
    const saved = payload("files");
    saved.attachments = [
      {
        id: "missing",
        name: "gone.txt",
        kind: "file",
        mimeType: "text/plain",
        size: 2,
        path: "/gone.txt",
      },
    ];
    rows.set("missing", { sessionId: "missing", revision: 2, payload: saved });
    invoke.mockImplementation((command, args) =>
      command === "inspect_paths" ? [] : backend(command, args),
    );
    open("missing");
    await store.hydrateComposerDraft("missing");
    expect(store.composerDraftState("missing")?.payload.attachments).toEqual(
      saved.attachments,
    );
    expect(store.composerDraftState("missing")?.issue).toMatchObject({
      kind: "missing",
      message: expect.stringContaining("gone.txt"),
    });
  });

  it("awaits live capture and the committed revision when flushing for quit", async () => {
    const saved = deferred<ComposerDraftEnvelope>();
    open("quit");
    await store.hydrateComposerDraft("quit");
    const unregister = store.registerComposerDraftCapture(() =>
      store.captureComposerDraft("quit", payload("latest DOM text")),
    );
    invoke.mockImplementation((command, args) =>
      command === "composer_draft_set" ? saved.promise : backend(command, args),
    );
    let finished = false;
    const flush = store.flushComposerDrafts().then(() => {
      finished = true;
    });
    await vi.waitFor(() =>
      expect(commands("composer_draft_set")).toHaveLength(1),
    );
    expect(finished).toBe(false);
    saved.resolve({
      sessionId: "quit",
      revision: 1,
      payload: payload("latest DOM text"),
    });
    await flush;
    expect(finished).toBe(true);
    unregister();
  });

  it("strips transient MCP discovery fields before strict metadata persistence", async () => {
    open("mcp-metadata");
    await store.hydrateComposerDraft("mcp-metadata");
    const value = payload("@mcp/docs");
    const server = {
      provider: "codex" as const,
      name: "docs",
      scope: "project" as const,
      configPath: "/config.toml",
      transport: "stdio",
      status: "online",
      availability: "available",
    };
    value.mcpTags = [{ token: "@mcp/docs", server }];
    store.captureComposerDraft("mcp-metadata", value);
    await store.flushComposerDraft("mcp-metadata");
    expect(rows.get("mcp-metadata")?.payload.mcpTags[0]?.server).toEqual({
      provider: "codex",
      name: "docs",
      scope: "project",
      configPath: "/config.toml",
      transport: "stdio",
    });
    expect(
      store.composerDraftState("mcp-metadata")?.payload.mcpTags[0]?.server,
    ).toHaveProperty("status", "online");
  });

  it("retires deleted owners so late write failures cannot block unrelated quit flushes", async () => {
    const pending = deferred<ComposerDraftEnvelope>();
    open("deleted");
    await store.hydrateComposerDraft("deleted");
    store.captureComposerDraft("deleted", payload("delete this"));
    invoke.mockImplementation((command, args) =>
      command === "composer_draft_set"
        ? pending.promise
        : backend(command, args),
    );
    const flushing = store.flushComposerDraft("deleted");
    await vi.waitFor(() =>
      expect(commands("composer_draft_set")).toHaveLength(1),
    );
    store.discardComposerDraft("deleted");
    pending.reject({ code: "sessionDeleted", message: "Session deleted" });
    await flushing;
    await expect(store.flushComposerDrafts()).resolves.toBeUndefined();
    expect(store.getComposerDraft("deleted")).toBeUndefined();
    expect(store.composerDraftState("deleted")?.issue).toBeNull();
  });
});
