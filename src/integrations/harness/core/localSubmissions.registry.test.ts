import { restoreLocalSubmissions } from "./localSubmissions";
import {
  canAutoContinue,
  INTERRUPT_MESSAGE,
} from "../../../features/sessions/model/inFlight";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appendUser } from "./apply";
import {
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  stopHarnessSession,
  type HarnessAdapter,
} from "./registry";
import type { Session } from "../../../features/sessions/model/session";
import type {
  LocalSubmissionAttempt,
  LocalSubmissionReceipt,
} from "./localSubmissions";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

let trace: string[];
let receipts: Map<string, LocalSubmissionReceipt>;
beforeEach(() => {
  trace = [];
  receipts = new Map();
  mocks.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "local_submission_reserve") {
        trace.push("reserve");
        const input = args.input as LocalSubmissionAttempt;
        const existing = receipts.get(input.attemptId);
        if (existing) return { created: false, receipt: { ...existing } };
        const receipt: LocalSubmissionReceipt = {
          ...input,
          signature: input.payloadJson,
          phase: "reserved",
          outcome: null,
          error: null,
        };
        receipts.set(input.attemptId, receipt);
        return { created: true, receipt: { ...receipt } };
      }
      const receipt = receipts.get(String(args.attemptId));
      if (command === "local_submission_dispatch") {
        trace.push("claim");
        receipt!.phase = "dispatching";
        return { claimed: true, receipt: { ...receipt } };
      }
      if (command === "local_submission_settle") {
        trace.push("settle");
        Object.assign(receipt!, {
          phase: args.outcome === "uncertain" ? "uncertain" : "settled",
          outcome: args.outcome === "uncertain" ? null : args.outcome,
          error: args.error ?? null,
        });
        return { ...receipt };
      }
      trace.push(command);
      return undefined;
    },
  );
});
afterEach(() => {
  resetHarnessIdlePark();
  mocks.invoke.mockReset();
});

function adapter(sendTurn: HarnessAdapter["sendTurn"]): HarnessAdapter {
  return {
    id: "pi",
    live: true,
    sendTurn,
    async steerTurn() {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
  };
}
function input(id: string) {
  return {
    harness: "pi" as const,
    sessionId: "registry-session",
    cwd: "/repo",
    model: "pi:test",
    runtimeMode: "supervised" as const,
    text: "hello",
    submission: { attemptId: id, userTurnId: id },
    onEvent: vi.fn(),
  };
}

it("reserves and claims before rewind/provider I/O, deduplicating a concurrent visible turn", async () => {
  let finish!: () => void;
  let visible: Session = {
    id: "registry-session",
    cwd: "/repo",
    harness: "pi",
    model: "pi:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Test",
    blocks: [],
  };
  const send = vi.fn(async (turn) => {
    trace.push("provider");
    turn.onAccepted();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  registerHarness(adapter(send));
  const turn = {
    ...input("registry-duplicate"),
    beforeDispatch: async () => {
      trace.push("rewind");
    },
    onAccepted: () => {
      visible = appendUser(visible, "hello", [], { id: "registry-duplicate" });
    },
  };
  const first = sendHarnessTurn(turn);
  const duplicate = sendHarnessTurn({ ...turn });
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(trace).toEqual([
    "reserve",
    "claim",
    "rewind",
    "control_authorize_turn",
    "provider",
  ]);
  expect(visible.blocks.filter((block) => block.role === "user")).toHaveLength(
    1,
  );
  finish();
  await Promise.all([first, duplicate]);
  await sendHarnessTurn(turn);
  expect(send).toHaveBeenCalledOnce();
  expect(receipts.get("registry-duplicate")?.phase).toBe("settled");
});

it("fails closed before a rewind or adapter call when local receipt persistence fails", async () => {
  mocks.invoke.mockRejectedValue(new Error("ledger unavailable"));
  const send = vi.fn(async () => undefined);
  const rewind = vi.fn(async () => undefined);
  registerHarness(adapter(send));
  await expect(
    sendHarnessTurn({
      ...input("registry-store-error"),
      beforeDispatch: rewind,
    }),
  ).rejects.toThrow("ledger unavailable");
  expect(rewind).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("settles provider error events as failed even when the adapter resolves", async () => {
  registerHarness(
    adapter(async (turn) => {
      turn.onEvent({ type: "session.error", message: "provider rejected" });
    }),
  );
  await expect(
    sendHarnessTurn(input("registry-provider-error")),
  ).rejects.toThrow("provider rejected");
  expect(receipts.get("registry-provider-error")).toMatchObject({
    phase: "settled",
    outcome: "failed",
    error: "provider rejected",
  });
});

it("does not rewind or dispatch a turn stopped while receipt admission awaits", async () => {
  const implementation = mocks.invoke.getMockImplementation()!;
  let release!: () => void;
  const admission = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "local_submission_reserve") await admission;
      return implementation(command, args);
    },
  );
  const send = vi.fn(async () => undefined);
  const rewind = vi.fn(async () => undefined);
  registerHarness(adapter(send));
  const sending = sendHarnessTurn({
    ...input("stop-during-reserve"),
    beforeDispatch: rewind,
  });
  const rejected = expect(sending).rejects.toThrow("cancelled or replaced");
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "local_submission_reserve",
      expect.anything(),
    ),
  );
  await stopHarnessSession("pi", "registry-session");
  release();
  await rejected;
  expect(rewind).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("rechecks the caller generation after control authorization awaits", async () => {
  const implementation = mocks.invoke.getMockImplementation()!;
  let release!: () => void;
  let current = true;
  const authorization = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "control_authorize_turn") await authorization;
      return implementation(command, args);
    },
  );
  const send = vi.fn(async () => undefined);
  registerHarness(adapter(send));
  const sending = sendHarnessTurn({
    ...input("replace-during-authorize"),
    isCurrent: () => current,
  });
  const rejected = expect(sending).rejects.toThrow("cancelled or replaced");
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "control_authorize_turn",
      expect.anything(),
    ),
  );
  current = false;
  release();
  await rejected;
  expect(send).not.toHaveBeenCalled();
  expect(trace).toContain("control_turn_finished");
});

it.each(["ephemeral", "inbox"])(
  "keeps %s provider turns out of durable receipt storage",
  async (scope) => {
    const send = vi.fn(async () => undefined);
    registerHarness(adapter(send));
    const turn = input(`temporary-${scope}`);
    await sendHarnessTurn({
      ...turn,
      ...(scope === "ephemeral"
        ? { ephemeral: true }
        : { submission: { ...turn.submission, persist: false } }),
    });
    expect(send).toHaveBeenCalledOnce();
    expect(
      mocks.invoke.mock.calls.some(([command]) =>
        String(command).startsWith("local_submission_"),
      ),
    ).toBe(false);
  },
);

it("checkpoints an accepted edited row before settling its durable receipt", async () => {
  registerHarness(
    adapter(async (turn) => {
      turn.onAccepted?.();
      trace.push("provider");
    }),
  );
  await sendHarnessTurn({
    ...input("edited-checkpoint"),
    onAccepted: () => {
      trace.push("accepted");
    },
    afterDispatch: async (completed) => {
      expect(completed).toBe(true);
      trace.push("checkpoint");
      expect(receipts.get("edited-checkpoint")?.phase).toBe("dispatching");
    },
  });
  expect(trace.indexOf("checkpoint")).toBeLessThan(trace.indexOf("settle"));
});

it("keeps a failed final checkpoint uncertain and blocks replay after reopen", async () => {
  registerHarness(adapter(async () => undefined));
  await expect(
    sendHarnessTurn({
      ...input("failed-checkpoint"),
      afterDispatch: async () => {
        throw new Error("disk full");
      },
    }),
  ).rejects.toThrow("outcome is uncertain");
  const receipt = receipts.get("failed-checkpoint")!;
  expect(receipt.phase).toBe("uncertain");
  expect(receipt.outcome).toBeNull();
  const saved: Session = {
    id: "registry-session",
    cwd: "/repo",
    harness: "pi",
    model: "pi:test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Test",
    providerSessionId: "provider",
    blocks: [
      { id: "failed-checkpoint", role: "user", text: "hello" },
      { id: "interrupt", role: "system", text: INTERRUPT_MESSAGE },
    ],
  };
  const restored = restoreLocalSubmissions(saved, [receipt]);
  expect(canAutoContinue(restored)).toBe(false);
  const send = vi.fn(async () => undefined);
  registerHarness(adapter(send));
  await expect(sendHarnessTurn(input("failed-checkpoint"))).rejects.toThrow(
    "not sent again",
  );
  expect(send).not.toHaveBeenCalled();
});
