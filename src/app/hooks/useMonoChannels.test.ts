// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMono, saveMonoName } from "../../features/monos/model/mono";
import {
  createMonoChannel,
  findMonoChannel,
} from "../../features/monos/model/monoChannels";
import { shouldPersistSession } from "../../features/sessions/data/sessionStore";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import { useMonoChannels, type MonoChannelHost } from "./useMonoChannels";
import type { ControlOutcome } from "../../features/orchestration/model/orchestration";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mountHook(host: MonoChannelHost) {
  let latest!: ReturnType<typeof useMonoChannels>;
  function Harness() {
    latest = useMonoChannels(host);
    return null;
  }
  act(() => {
    root.render(createElement(Harness));
  });
  return {
    get current() {
      return latest;
    },
  };
}

describe("useMonoChannels", () => {
  it.each(["turn", "cancellation"])(
    "serializes restart when %s settles first after Stop",
    async (firstToSettle) => {
      const mono = createMono(["/code/api"]);
      const channel = createMonoChannel({
        name: "restart",
        memberIds: [mono.id],
      });
      const sessions: Session[] = [];
      const settlements: ((outcome: ControlOutcome) => void)[] = [];
      let finishCancellation!: () => void;
      const cancellation = new Promise<void>((resolve) => {
        finishCancellation = resolve;
      });
      const host: MonoChannelHost = {
        sessions: () => sessions,
        ensureMono: async () => newSession("codex", "/code/api"),
        openSession: async () => undefined,
        addSession: (session) => {
          sessions.push(session);
        },
        runTurn: vi.fn(
          () =>
            new Promise((resolve) => {
              settlements.push(resolve);
            }),
        ),
        stopSession: vi.fn(() => cancellation),
      };
      const hook = mountHook(host);
      await act(async () => {
        hook.current.sendUserChannelMessage(channel.id, "Original request");
      });
      const backingId = sessions[0].id;
      let stopping!: Promise<void>;
      act(() => {
        stopping = hook.current.stopChannel(channel.id);
      });
      await act(async () => {
        hook.current.sendUserChannelMessage(channel.id, "Replacement request");
      });
      expect(host.runTurn).toHaveBeenCalledTimes(1);

      const finishTurn = () =>
        settlements[0]({ status: "completed", text: "Stale reply" });
      await act(async () => {
        if (firstToSettle === "turn") finishTurn();
        else finishCancellation();
      });
      expect(host.runTurn).toHaveBeenCalledTimes(1);
      expect(
        findMonoChannel(channel.id)?.memberCursors[mono.id],
      ).toBeUndefined();
      expect(
        findMonoChannel(channel.id)?.messages.some(
          (m) => m.text === "Stale reply",
        ),
      ).toBe(false);

      await act(async () => {
        if (firstToSettle === "turn") finishCancellation();
        else finishTurn();
        await stopping;
      });
      expect(host.runTurn).toHaveBeenCalledTimes(2);
      expect(hook.current.busyChannelIds.has(channel.id)).toBe(true);
      expect(hook.current.currentHop(backingId)).toBe(1);

      // A later message queues behind the replacement, and Stop still targets it.
      await act(async () => {
        hook.current.sendUserChannelMessage(channel.id, "Third request");
      });
      expect(host.runTurn).toHaveBeenCalledTimes(2);
      await act(async () => {
        await hook.current.stopChannel(channel.id);
      });
      expect(host.stopSession).toHaveBeenLastCalledWith(backingId);
      expect(host.stopSession).toHaveBeenCalledTimes(2);
      await act(async () => {
        settlements[1]({ status: "cancelled", text: "" });
      });
      expect(host.runTurn).toHaveBeenCalledTimes(2);
      expect(hook.current.busyChannelIds.has(channel.id)).toBe(false);
    },
  );

  it("does not launch a stopped turn when backing-session setup finishes late", async () => {
    const mono = createMono(["/code/api"]);
    const channel = createMonoChannel({ name: "setup", memberIds: [mono.id] });
    const sessions: Session[] = [];
    let finishSetup!: (session: Session) => void;
    const setup = new Promise<Session>((resolve) => {
      finishSetup = resolve;
    });
    const host: MonoChannelHost = {
      sessions: () => sessions,
      ensureMono: vi.fn(() => setup),
      openSession: async () => undefined,
      addSession: (session) => {
        sessions.push(session);
      },
      runTurn: vi.fn(async () => ({
        status: "completed" as const,
        text: "Fresh reply",
      })),
      stopSession: vi.fn(async () => {}),
    };
    const hook = mountHook(host);
    await act(async () => {
      hook.current.sendUserChannelMessage(channel.id, "Original request");
    });
    await act(async () => {
      await hook.current.stopChannel(channel.id);
    });
    await act(async () => {
      hook.current.sendUserChannelMessage(channel.id, "New request");
    });
    expect(host.ensureMono).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishSetup(newSession("codex", "/code/api"));
    });
    expect(sessions).toHaveLength(1);
    expect(host.runTurn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(host.runTurn).mock.calls[0][1]).toContain("New request");
    expect(hook.current.busyChannelIds.has(channel.id)).toBe(false);
  });

  it("inherits the Mono session runtimeMode, persists backing sessions, and queues follow-up turns for an active speaker", async () => {
    const alpha = createMono(["/code/api"]);
    saveMonoName(alpha.id, "Alpha");
    const alphaMonoSession: Session = {
      ...newSession("claude", "/code/api", "claude-sonnet-4-6", "auto"),
      id: alpha.id,
    };

    const sessions: Session[] = [alphaMonoSession];
    const prompts: string[] = [];
    let resolveFirstTurn!: () => void;
    const firstTurnGate = new Promise<void>((resolve) => {
      resolveFirstTurn = resolve;
    });

    const host: MonoChannelHost = {
      sessions: () => sessions,
      ensureMono: async (id) =>
        id === alpha.id ? alphaMonoSession : undefined,
      openSession: async (id) => sessions.find((s) => s.id === id),
      addSession: (session) => {
        sessions.push(session);
      },
      runTurn: async (sessionId, prompt) => {
        prompts.push(prompt);
        const s = sessions.find((entry) => entry.id === sessionId);
        if (s) {
          s.blocks.push({
            id: `u-${prompts.length}`,
            role: "user",
            text: prompt,
          });
        }
        if (prompts.length === 1) {
          await firstTurnGate;
          return { status: "completed", text: "First reply from Alpha." };
        }
        return { status: "completed", text: "Second reply from Alpha." };
      },
      stopSession: async () => {},
    };

    const channel = createMonoChannel({
      name: "alpha-sync",
      memberIds: [alpha.id],
    });
    const hook = mountHook(host);

    // Send first user message
    act(() => {
      hook.current.sendUserChannelMessage(channel.id, "@Alpha First task");
    });

    // Wait for first turn to start
    await vi.waitFor(() => {
      expect(prompts).toHaveLength(1);
    });

    const backingId = findMonoChannel(channel.id)?.memberSessions[alpha.id];
    expect(backingId).toBeDefined();
    const backing = sessions.find((s) => s.id === backingId)!;
    // Must preserve the Mono's selected permission mode ("auto", not "full-access")
    expect(backing.runtimeMode).toBe("auto");
    // Must be persistable once populated (not ephemeral)
    expect(backing.ephemeral).toBeUndefined();
    expect(shouldPersistSession(backing)).toBe(true);

    // While Alpha is still running turn 1, user sends a second follow-up message
    act(() => {
      hook.current.sendUserChannelMessage(
        channel.id,
        "@Alpha Second follow-up",
      );
    });

    // Finish turn 1; turn 2 should automatically run and receive the follow-up!
    await act(async () => {
      resolveFirstTurn();
    });

    await vi.waitFor(() => {
      expect(prompts).toHaveLength(2);
    });
    expect(prompts[1]).toContain("Second follow-up");
    expect(prompts[1]).not.toContain("First reply from Alpha.");

    await vi.waitFor(() => {
      expect(hook.current.busyChannelIds.has(channel.id)).toBe(false);
    });
    expect(findMonoChannel(channel.id)?.messages.map((m) => m.text)).toEqual([
      "@Alpha First task",
      "@Alpha Second follow-up",
      "First reply from Alpha.",
      "Second reply from Alpha.",
    ]);
  });

  it("clears channel active state when backing-session setup rejects so future messages still run", async () => {
    const alpha = createMono(["/code/api"]);
    saveMonoName(alpha.id, "Alpha");
    const alphaMonoSession: Session = {
      ...newSession("claude", "/code/api", "claude-sonnet-4-6", "supervised"),
      id: alpha.id,
    };

    const sessions: Session[] = [alphaMonoSession];
    let shouldFailSetup = true;
    const prompts: string[] = [];

    const host: MonoChannelHost = {
      sessions: () => sessions,
      ensureMono: async () => {
        if (shouldFailSetup) throw new Error("Transient storage error");
        return alphaMonoSession;
      },
      openSession: async (id) => sessions.find((s) => s.id === id),
      addSession: (session) => {
        sessions.push(session);
      },
      runTurn: async (_sessionId, prompt) => {
        prompts.push(prompt);
        return { status: "completed", text: "Recovered reply." };
      },
      stopSession: async () => {},
    };

    const channel = createMonoChannel({
      name: "recovery-room",
      memberIds: [alpha.id],
    });
    const hook = mountHook(host);

    act(() => {
      hook.current.sendUserChannelMessage(
        channel.id,
        "@Alpha Try during outage",
      );
    });

    await vi.waitFor(() => {
      expect(hook.current.busyChannelIds.has(channel.id)).toBe(false);
    });

    shouldFailSetup = false;
    act(() => {
      hook.current.sendUserChannelMessage(
        channel.id,
        "@Alpha Try after recovery",
      );
    });

    await vi.waitFor(() => {
      expect(prompts).toHaveLength(1);
    });
    expect(prompts[0]).toContain("Try after recovery");
  });
});
