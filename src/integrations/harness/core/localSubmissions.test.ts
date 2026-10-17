import { describe, expect, it, vi } from "vitest";
import type { Session } from "../../../features/sessions/model/session";
import {
  canAutoContinue,
  INTERRUPT_MESSAGE,
} from "../../../features/sessions/model/inFlight";
import { appendUser } from "./apply";
import {
  restoreLocalSubmissions,
  runLocalSubmission,
  submissionPayload,
  submissionUserTurn,
  type LocalSubmissionAttempt,
  type LocalSubmissionReceipt,
  type LocalSubmissionStore,
} from "./localSubmissions";

function ledger() {
  const records = new Map<string, LocalSubmissionReceipt>();
  const payloads = new Map<string, string>();
  const store: LocalSubmissionStore = {
    reserve: vi.fn(async (input) => {
      const previous = records.get(input.attemptId);
      if (previous) {
        if (payloads.get(input.attemptId) !== submissionPayload(input))
          throw new Error("different scope or content");
        return { created: false, receipt: { ...previous } };
      }
      const receipt: LocalSubmissionReceipt = {
        ...input,
        signature: input.payloadJson,
        phase: "reserved",
        outcome: null,
        error: null,
      };
      records.set(input.attemptId, receipt);
      payloads.set(input.attemptId, submissionPayload(input));
      return { created: true, receipt: { ...receipt } };
    }),
    dispatch: vi.fn(async (id) => {
      const receipt = records.get(id)!;
      const claimed = receipt.phase === "reserved";
      if (claimed) receipt.phase = "dispatching";
      return { claimed, receipt: { ...receipt } };
    }),
    settle: vi.fn(async (id, outcome, error) => {
      const receipt = records.get(id)!;
      Object.assign(receipt, {
        phase: outcome === "uncertain" ? "uncertain" : "settled",
        outcome: outcome === "uncertain" ? null : outcome,
        error: error ?? null,
      });
      return { ...receipt };
    }),
  };
  return { store, records };
}
function attempt(id: string): LocalSubmissionAttempt {
  return {
    attemptId: id,
    userTurnId: id,
    sessionId: "session",
    payloadJson: submissionPayload({
      cwd: "/repo",
      harness: "pi",
      text: "hello",
      attachments: [{ data: "exact bytes" }],
    }),
    userTurn: { id, role: "user", text: "hello" },
  };
}
function session(): Session {
  return {
    id: "session",
    cwd: "/repo",
    harness: "pi",
    model: "pi:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Test",
    providerSessionId: "provider",
    blocks: [{ id: "interrupt", role: "system", text: INTERRUPT_MESSAGE }],
  };
}

describe("durable local submission service", () => {
  it("shares concurrent matching attempts, deduplicates settled retries and keeps one visible row", async () => {
    const { store } = ledger();
    let finish!: () => void;
    const input = attempt("same-attempt");
    let visible = session();
    const dispatch = vi.fn(async () => {
      visible = appendUser(visible, "hello", [], { id: input.userTurnId });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = runLocalSubmission(input, dispatch, store);
    const concurrent = runLocalSubmission({ ...input }, dispatch, store);
    expect(first).toBe(concurrent);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    finish();
    expect((await first).phase).toBe("settled");
    await concurrent;
    const retry = await runLocalSubmission(input, dispatch, store);
    expect(retry.userTurnId).toBe(input.userTurnId);
    expect(dispatch).toHaveBeenCalledOnce();
    visible = appendUser(visible, "hello", [], { id: input.userTurnId });
    expect(
      visible.blocks.filter((block) => block.role === "user"),
    ).toHaveLength(1);
  });

  it("rejects changed text, attachments or scope under the same attempt ID", async () => {
    const { store } = ledger();
    const input = attempt("mismatch");
    const dispatch = vi.fn(async () => undefined);
    await runLocalSubmission(input, dispatch, store);
    for (const changed of [
      { ...input, sessionId: "other" },
      { ...input, userTurnId: "other-turn" },
      { ...input, payloadJson: submissionPayload({ text: "changed" }) },
      {
        ...input,
        payloadJson: submissionPayload({ attachments: [{ data: "changed" }] }),
      },
    ])
      await expect(
        runLocalSubmission(changed, dispatch, store),
      ).rejects.toThrow("different scope or content");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("never reaches provider I/O after reservation or dispatch persistence errors", async () => {
    for (const command of ["reserve", "dispatch"] as const) {
      const { store } = ledger();
      store[command] = vi.fn(async () => {
        throw new Error("database unavailable");
      });
      const dispatch = vi.fn(async () => undefined);
      await expect(
        runLocalSubmission(attempt(`error-${command}`), dispatch, store),
      ).rejects.toThrow("database unavailable");
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it("does not replay a reservation left at either side of the dispatch boundary", async () => {
    for (const phase of ["reserved", "dispatching", "uncertain"] as const) {
      const { store, records } = ledger();
      const input = attempt(`crash-${phase}`);
      await store.reserve(input);
      records.get(input.attemptId)!.phase = phase;
      const dispatch = vi.fn(async () => undefined);
      await expect(runLocalSubmission(input, dispatch, store)).rejects.toThrow(
        "not sent again",
      );
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it("reports uncertainty when provider completion could not be settled and never retries it", async () => {
    const { store } = ledger();
    store.settle = vi.fn(async () => {
      throw new Error("disk full");
    });
    const dispatch = vi.fn(async () => undefined);
    const input = attempt("settlement-error");
    await expect(runLocalSubmission(input, dispatch, store)).rejects.toThrow(
      "outcome is uncertain",
    );
    await expect(runLocalSubmission(input, dispatch, store)).rejects.toThrow(
      "not sent again",
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("restores honest uncertainty without duplicating the accepted user turn or auto continuing", async () => {
    const { store, records } = ledger();
    const input = attempt("restored");
    await store.reserve(input);
    const original = session();
    expect(canAutoContinue(original)).toBe(true);
    const restored = restoreLocalSubmissions(original, [...records.values()]);
    const reopened = restoreLocalSubmissions(restored, [...records.values()]);
    expect(reopened.localSubmissionUncertain).toBe(true);
    expect(canAutoContinue(reopened)).toBe(false);
    expect(
      reopened.blocks.filter((block) => block.id === input.userTurnId),
    ).toHaveLength(1);
    expect(
      reopened.blocks.filter((block) => block.notice === "error"),
    ).toHaveLength(1);
    expect(reopened.blocks.at(-1)?.text).toContain("not replayed");
  });

  it("persists recovery metadata without base64, blob URLs or private adapter fields", () => {
    const clean = submissionUserTurn({
      id: "row",
      role: "user",
      text: "hello",
      internal: true,
      attachments: [
        {
          id: "image",
          kind: "image",
          name: "image.png",
          mimeType: "image/png",
          size: 4,
          data: "base64",
          previewUrl: "blob:private",
          path: "data:private",
        },
      ],
    });
    expect(clean).toMatchObject({ id: "row", internal: true });
    expect(clean.attachments?.[0]).toEqual({
      id: "image",
      kind: "image",
      name: "image.png",
      mimeType: "image/png",
      size: 4,
    });
  });
});

it.each(["completed", "failed"] as const)(
  "does not auto replay a settled %s receipt behind a stale quit marker",
  async (outcome) => {
    const { store, records } = ledger();
    const input = attempt(`settled-${outcome}`);
    await store.reserve(input);
    await store.dispatch(input.attemptId);
    await store.settle(input.attemptId, outcome);
    const saved = session();
    saved.blocks.unshift(input.userTurn!);
    const restored = restoreLocalSubmissions(saved, [...records.values()]);
    expect(canAutoContinue(restored)).toBe(false);
    expect(restored.localSubmissionReplayBlocked).toBe(true);
    expect(restored.localSubmissionUncertain).not.toBe(true);
  },
);
