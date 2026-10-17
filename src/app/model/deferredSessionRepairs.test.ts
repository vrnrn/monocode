import { afterEach, expect, it, vi } from "vitest";
import {
  newSession,
  type Session,
} from "../../features/sessions/model/session";
import {
  applySessionRepair,
  repairSession,
} from "../../features/sessions/data/sessionStore";
import { deferSessionRepairs } from "./deferredSessionRepairs";

const scheduler = vi.hoisted(() => ({
  pending: undefined as (() => void) | undefined,
  cancel: vi.fn(),
}));
vi.mock("../../shared/lib/afterPaint", () => ({
  scheduleAfterPaint: (work: () => void) => {
    scheduler.pending = work;
    return scheduler.cancel;
  },
}));
vi.mock("../../features/sessions/data/sessionStore", async (original) => ({
  ...(await original<
    typeof import("../../features/sessions/data/sessionStore")
  >()),
  repairSession: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  scheduler.pending = undefined;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("starts repairs after presentation, serializes log reads and preserves newer metadata", async () => {
  const sources = [newSession("codex", "/repo"), newSession("claude", "/repo")];
  const first = deferred<Session>();
  vi.mocked(repairSession)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(sources[1]);
  let current = sources.map((source) => ({
    ...source,
    title: "Edited while loading",
  }));
  const publish = vi.fn((source: Session, repaired: Session) => {
    current = current.map((session) =>
      applySessionRepair(session, source, repaired),
    );
  });
  deferSessionRepairs(
    sources,
    (id) => current.find((session) => session.id === id),
    publish,
  );
  expect(repairSession).not.toHaveBeenCalled();
  scheduler.pending?.();
  expect(repairSession).toHaveBeenCalledTimes(1);
  expect(repairSession).toHaveBeenCalledWith(sources[0], { persist: false });
  first.resolve({
    ...sources[0],
    blocks: [{ id: "repaired", role: "user", text: "Restored" }],
  });
  await first.promise;
  await Promise.resolve();
  expect(repairSession).toHaveBeenCalledTimes(2);
  expect(publish).toHaveBeenCalledOnce();
  expect(current[0].title).toBe("Edited while loading");
  expect(current[0].blocks[0].id).toBe("repaired");
});

it("skips changed histories and rejects results superseded during their read", async () => {
  const sources = [newSession("codex", "/repo"), newSession("claude", "/repo")];
  const waiting = deferred<Session>();
  vi.mocked(repairSession).mockReturnValueOnce(waiting.promise);
  const current = [{ ...sources[0], blocks: [] }, { ...sources[1] }];
  const publish = vi.fn();
  deferSessionRepairs(
    sources,
    (id) => current.find((session) => session.id === id),
    publish,
  );
  scheduler.pending?.();
  expect(repairSession).toHaveBeenCalledOnce();
  expect(repairSession).toHaveBeenCalledWith(sources[1], { persist: false });
  current[1] = { ...current[1], providerSessionId: "new-owner" };
  waiting.resolve({
    ...sources[1],
    blocks: [{ id: "late", role: "user", text: "Old" }],
  });
  await waiting.promise;
  expect(publish).not.toHaveBeenCalled();
});

it("stops publishing and admitting further repairs after cancellation", async () => {
  const sources = [newSession("codex", "/repo"), newSession("claude", "/repo")];
  const waiting = deferred<Session>();
  vi.mocked(repairSession).mockReturnValueOnce(waiting.promise);
  const publish = vi.fn();
  const stop = deferSessionRepairs(
    sources,
    (id) => sources.find((source) => source.id === id),
    publish,
  );
  scheduler.pending?.();
  stop();
  waiting.resolve({
    ...sources[0],
    blocks: [{ id: "late", role: "user", text: "Old" }],
  });
  await waiting.promise;
  await Promise.resolve();
  expect(scheduler.cancel).toHaveBeenCalledOnce();
  expect(publish).not.toHaveBeenCalled();
  expect(repairSession).toHaveBeenCalledOnce();
});

it("continues with other sessions if one optional log repair fails", async () => {
  const sources = [newSession("codex", "/repo"), newSession("claude", "/repo")];
  vi.mocked(repairSession)
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce(sources[1]);
  const publish = vi.fn();
  deferSessionRepairs(
    sources,
    (id) => sources.find((source) => source.id === id),
    publish,
  );
  scheduler.pending?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(repairSession).toHaveBeenCalledTimes(2);
  expect(publish).not.toHaveBeenCalled();
});
