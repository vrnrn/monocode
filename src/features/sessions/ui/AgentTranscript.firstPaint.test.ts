// @vitest-environment happy-dom
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

vi.mock("../hooks/useTranscriptLayout", () => ({
  useTranscriptLayout: () => "full",
}));
vi.mock("../hooks/useTranscriptAnchor", () => ({
  useTranscriptAnchor: () => false,
}));

let container: HTMLDivElement;
let root: Root;

function conversation(turns: number): Block[] {
  return Array.from({ length: turns }, (_, index): Block[] => [
    { id: `u${index}`, role: "user", text: `Question ${index}` },
    { id: `a${index}`, role: "assistant", text: `Answer ${index}` },
  ]).flat();
}

function renderedTurns() {
  return container.querySelectorAll("[data-transcript-turn]").length;
}

async function warmNextTurn() {
  await act(async () => {
    vi.advanceTimersToNextFrame();
    await vi.advanceTimersByTimeAsync(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("transcript first paint", () => {
  it("paints the latest turns first and builds the window after", async () => {
    act(() =>
      flushSync(() =>
        root.render(
          createElement(AgentTranscript, {
            blocks: conversation(30),
            visible: true,
          }),
        ),
      ),
    );
    expect(renderedTurns()).toBe(3);

    await warmNextTurn();
    expect(renderedTurns()).toBe(4);
    for (let count = 5; count <= 20; count++) {
      await warmNextTurn();
      expect(renderedTurns()).toBe(count);
    }
    expect(container.textContent).toContain("Load earlier messages");
  });

  it("stays pinned to the end while the window grows above it", async () => {
    act(() =>
      flushSync(() =>
        root.render(
          createElement(AgentTranscript, {
            blocks: conversation(30),
            visible: true,
          }),
        ),
      ),
    );
    const scroller = container.querySelector<HTMLElement>(".agent-transcript");
    if (!scroller) throw new Error("missing scroller");
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => renderedTurns() * 100,
    });

    expect(renderedTurns()).toBe(3);
    for (let count = 4; count <= 20; count++) {
      await warmNextTurn();
      expect(renderedTurns()).toBe(count);
      expect(scroller.scrollTop).toBe(count * 100);
    }
    expect(scroller.scrollTop).toBe(2000);
  });

  it("shows every turn of a short chat at once", () => {
    act(() =>
      flushSync(() =>
        root.render(
          createElement(AgentTranscript, {
            blocks: conversation(2),
            visible: true,
          }),
        ),
      ),
    );
    expect(renderedTurns()).toBe(2);
  });
});
