import { afterEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
  vi.unstubAllGlobals();
});

it.each(["cursor", "grok", "opencode", "fx", "hermes", "devin"])(
  "preserves %s history without resuming its native session under another provider",
  async (harness) => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    invoke.mockResolvedValue({
      id: "old-chat",
      cwd: "/repo",
      harness,
      model: `${harness}:old`,
      modelSettings: { oldSetting: "enabled" },
      runtimeMode: "supervised",
      title: "Saved work",
      providerSessionId: "old-native-id",
      providerAccountId: "old-account",
      blocks: [
        { id: "u", role: "user", text: "Review the changes" },
        { id: "a", role: "assistant", text: "Saved response" },
      ],
      queuedMessages: [{ id: "q", text: "Follow up", attachments: [] }],
    });
    const { getSession } = await import("./sessionStore");
    const { HARNESSES } = await import("../model/harnessIds");
    const session = await getSession("old-chat");
    expect(session).not.toBeNull();
    expect(HARNESSES).toContain(session!.harness);
    expect(session!.model).not.toBe(`${harness}:old`);
    expect(session!.modelSettings).toEqual({});
    expect(session!.providerSessionId).toBeUndefined();
    expect(session!.providerAccountId).toBeUndefined();
    expect(session!.queueStatus).toBe("paused");
    expect(session!.blocks.slice(0, 2).map((block) => block.text)).toEqual([
      "Review the changes",
      "Saved response",
    ]);
    expect(session!.blocks.at(-1)?.text).toContain("no longer supported");
  },
);

it("saves hydrated provider migration additions against a normalized revision and reopens them", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  let record = {
    id: "normalized-provider-migration",
    cwd: "/repo",
    harness: "removed-provider",
    model: "removed:old",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Saved work",
    createdAt: 1,
    updatedAt: 1,
    persistenceRevision: 17,
    blocks: [
      { id: "u", role: "user", text: "Review" },
      { id: "a", role: "assistant", text: "Saved response" },
    ],
  };
  invoke.mockImplementation(async (command, args) => {
    if (command === "session_get") return structuredClone(record);
    if (command === "session_upsert_delta") {
      expect(args.expectedRevision).toBe(record.persistenceRevision);
      const byId = new Map(record.blocks.map((block) => [block.id, block]));
      for (const block of args.session.blocks) byId.set(block.id, block);
      // Native rejects an unchanged ID that has never existed in storage.
      for (const id of args.blockIds) expect(byId.has(id)).toBe(true);
      record = {
        ...record,
        ...args.session,
        blocks: args.blockIds.map((id: string) => byId.get(id)!),
        persistenceRevision: record.persistenceRevision + 1,
      };
      return [record, record.persistenceRevision];
    }
    throw new Error(command);
  });
  const { readSession, upsertSession } = await import("./sessionStore");
  const restored = (await readSession(record.id))!;
  expect(restored.blocks.at(-1)?.id).toBe(`provider-removed-${record.id}`);
  await upsertSession(restored);
  const save = invoke.mock.calls.find(
    ([command]) => command === "session_upsert_delta",
  )!;
  expect(save[1].session.blocks).toEqual([
    expect.objectContaining({
      id: `provider-removed-${record.id}`,
      role: "system",
    }),
  ]);
  expect(record.blocks.map((block) => block.id)).toEqual([
    "u",
    "a",
    `provider-removed-${record.id}`,
  ]);
  const reopened = (await readSession(record.id))!;
  expect(reopened.blocks.map((block) => block.text)).toEqual(
    restored.blocks.map((block) => block.text),
  );
  await upsertSession(reopened);
  expect(invoke.mock.calls.at(-1)![1].session.blocks).toEqual([]);
});
