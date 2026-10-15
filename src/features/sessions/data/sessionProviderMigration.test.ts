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
