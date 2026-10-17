import { afterEach, expect, it, vi } from "vitest";
import { newSession, type Block } from "../model/session";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
afterEach(() => {
  mocks.invoke.mockReset();
  vi.unstubAllGlobals();
});

it("sanitizes and sends only changed block payloads, preserving order separately", async () => {
  const { upsertSession } = await import("./sessionStore");
  let reads = 0;
  const history: Block[] = [{ id: "u", role: "user", text: "request" }];
  for (let index = 0; index < 100; index++) {
    history.push({
      id: `a${index}`,
      role: "assistant",
      get text() {
        reads++;
        return "history".repeat(4000);
      },
    });
  }
  const value = { ...newSession("codex", "/tmp/incremental"), blocks: history };
  let revision = 0;
  mocks.invoke.mockImplementation(async () => [
    {
      id: value.id,
      cwd: value.cwd,
      harness: value.harness,
      model: value.model,
      runtimeMode: value.runtimeMode,
      title: value.title,
      createdAt: 1,
      updatedAt: 1,
    },
    ++revision,
  ]);
  await upsertSession(value);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  const edited: Block = { id: "a99", role: "assistant", text: "changed tail" };
  await upsertSession({ ...value, blocks: [...history.slice(0, -1), edited] });
  expect(reads).toBe(0);
  const [command, args] = mocks.invoke.mock.calls.at(-1)!;
  expect(command).toBe("session_upsert_delta");
  expect(args.expectedRevision).toBe(1);
  expect(args.session.blocks).toEqual([
    expect.objectContaining({ id: "a99", text: "changed tail" }),
  ]);
  expect(args.blockIds).toEqual(history.map((b) => b.id));
  expect(JSON.stringify(args).length).toBeLessThan(4000);
  await upsertSession({ ...value, blocks: [history[0]] });
  expect(mocks.invoke.mock.calls.at(-1)![1].session.blocks).toEqual([]);
  expect(mocks.invoke.mock.calls.at(-1)![1].blockIds).toEqual(["u"]);
});

it("keeps its last successful baseline after a failed save and never retries a stale writer blindly", async () => {
  const { upsertSession } = await import("./sessionStore");
  const value = {
    ...newSession("codex", "/tmp/incremental-failure"),
    blocks: [{ id: "u", role: "user" as const, text: "old" }],
  };
  const summary = { ...value, createdAt: 1, updatedAt: 1 };
  mocks.invoke.mockResolvedValueOnce([summary, 7]);
  await upsertSession(value);
  const edited = { ...value, blocks: [{ ...value.blocks[0], text: "new" }] };
  mocks.invoke.mockRejectedValueOnce(new Error("disk full"));
  await expect(upsertSession(edited)).rejects.toThrow("disk full");
  mocks.invoke.mockRejectedValueOnce(new Error("SESSION_BASELINE_MISMATCH"));
  await expect(upsertSession(edited)).rejects.toThrow("BASELINE_MISMATCH");
  expect(mocks.invoke).toHaveBeenCalledTimes(3);
  for (const [, args] of mocks.invoke.mock.calls.slice(1)) {
    expect(args.expectedRevision).toBe(7);
    expect(args.session.blocks[0].text).toBe("new");
  }
});

it("keeps revision fences and resends correct payloads when WeakRef is unavailable", async () => {
  vi.stubGlobal("WeakRef", undefined);
  const { upsertSession } = await import("./sessionStore");
  const value = {
    ...newSession("codex", "/tmp/without-weakref"),
    blocks: [
      { id: "u", role: "user" as const, text: "request" },
      { id: "a", role: "assistant" as const, text: "first reply" },
    ],
  };
  const summary = { ...value, createdAt: 1, updatedAt: 1 };
  mocks.invoke
    .mockResolvedValueOnce([summary, 41])
    .mockResolvedValueOnce([summary, 42]);
  await upsertSession(value);
  await upsertSession({
    ...value,
    blocks: [value.blocks[0], { ...value.blocks[1], text: "edited reply" }],
  });
  const [, first] = mocks.invoke.mock.calls[0];
  const [, second] = mocks.invoke.mock.calls[1];
  expect(first.expectedRevision).toBeNull();
  expect(second.expectedRevision).toBe(41);
  expect(second.blockIds).toEqual(["u", "a"]);
  expect(second.session.blocks).toEqual([
    expect.objectContaining({ id: "u", text: "request" }),
    expect.objectContaining({ id: "a", text: "edited reply" }),
  ]);
});
