// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scheduleAfterPaint } from "./afterPaint";

let nextId: number;
let frames: Map<number, FrameRequestCallback>;
let idle: Map<number, () => void>;

function paint() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

beforeEach(() => {
  nextId = 0;
  frames = new Map();
  idle = new Map();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idle.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idle.delete(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("leaves a presentation opportunity before optional work and runs once", () => {
  const work = vi.fn();
  scheduleAfterPaint(work);
  paint();
  expect(idle.size).toBe(0);
  paint();
  expect(work).not.toHaveBeenCalled();
  idle.forEach((callback) => {
    callback();
    callback();
  });
  expect(work).toHaveBeenCalledOnce();
});

it("cancels frames and already queued idle callbacks", () => {
  const work = vi.fn();
  const cancel = scheduleAfterPaint(work);
  cancel();
  paint();
  paint();
  expect(idle.size).toBe(0);
  const cancelIdle = scheduleAfterPaint(work);
  paint();
  paint();
  const late = [...idle.values()][0];
  cancelIdle();
  late();
  expect(work).not.toHaveBeenCalled();
});

it("supports WebKit without idle callbacks and cancels its fallback timer", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("requestIdleCallback", undefined);
  const work = vi.fn();
  const cancel = scheduleAfterPaint(work);
  paint();
  vi.runAllTimers();
  expect(work).not.toHaveBeenCalled();
  paint();
  cancel();
  vi.runAllTimers();
  expect(work).not.toHaveBeenCalled();
  scheduleAfterPaint(work);
  paint();
  paint();
  vi.runAllTimers();
  expect(work).toHaveBeenCalledOnce();
});

it("gives hidden windows a bounded opportunity without relying on frames", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const work = vi.fn();
  const cancel = scheduleAfterPaint(work);
  vi.advanceTimersByTime(249);
  expect(idle.size).toBe(0);
  vi.advanceTimersByTime(1);
  expect(frames.size).toBe(0);
  const late = [...idle.values()][0];
  cancel();
  late();
  expect(work).not.toHaveBeenCalled();
});
