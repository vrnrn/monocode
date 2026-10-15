// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { DEFAULT_AVAILABLE } = vi.hoisted(() => ({
  DEFAULT_AVAILABLE: (harness: string) => harness === "omp",
}));

vi.mock("../../../integrations/harness/core/availability", () => ({
  getHarnessAvailabilitySnapshot: () => 0,
  hasProbedHarnessAvailability: () => true,
  isHarnessAvailable: vi.fn(DEFAULT_AVAILABLE),
  probeHarnessAvailability: () => Promise.resolve(),
  subscribeHarnessAvailability: () => () => undefined,
}));

vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: () => Promise.resolve(),
}));

import { SecondOpinionButton } from "./SecondOpinionButton";
import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { resetHarnessModelOverlays, setHarnessModels } from "../model/models";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setHarnessModels("omp", [
    {
      id: "omp:review",
      harness: "omp",
      name: "Review Model",
      settings: [
        {
          id: "effort",
          label: "Reasoning",
          kind: "select",
          value: "high",
          options: [
            { value: "xhigh", label: "Extra High" },
            { value: "high", label: "High" },
            { value: "low", label: "Low" },
          ],
        },
      ],
    },
    {
      id: "omp:quick",
      harness: "omp",
      name: "Quick Model",
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  resetHarnessModelOverlays();
  vi.mocked(isHarnessAvailable).mockImplementation(DEFAULT_AVAILABLE);
  container.remove();
  vi.unstubAllGlobals();
});

function hover(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

describe("secondary model target picker", () => {
  it("opens effort beside a hovered model and selects both atomically", () => {
    const onPick = vi.fn();
    act(() =>
      root.render(
        createElement(SecondOpinionButton, {
          from: "pi",
          onPick,
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Second opinion"]')!
        .click(),
    );
    const provider = [...document.querySelectorAll('[role="menuitem"]')].find(
      (row) => row.textContent?.includes("omp"),
    )!;
    hover(provider);

    const modelMenu = document.querySelector(
      '[role="menu"][aria-label="omp models"]',
    )!;
    const model = [...modelMenu.querySelectorAll('[role="menuitem"]')].find(
      (row) => row.textContent?.includes("Review Model"),
    )!;
    hover(model);

    expect(onPick).not.toHaveBeenCalled();
    const effortMenu = document.querySelector(
      '[role="menu"][aria-label="Review Model effort"]',
    )!;
    expect(effortMenu).toBeTruthy();
    const extraHigh = [
      ...effortMenu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ].find((option) => option.textContent === "Extra High")!;
    act(() => extraHigh.click());

    expect(onPick).toHaveBeenCalledWith({
      harness: "omp",
      model: "omp:review",
      modelSettings: { effort: "xhigh" },
    });
  });

  it("selects a model without effort directly", () => {
    const onPick = vi.fn();
    act(() =>
      root.render(
        createElement(SecondOpinionButton, {
          from: "pi",
          onPick,
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Second opinion"]')!
        .click(),
    );
    const provider = [...document.querySelectorAll('[role="menuitem"]')].find(
      (row) => row.textContent?.includes("omp"),
    )!;
    hover(provider);
    const quick = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="omp models"] [role="menuitem"]',
      ),
    ].find((row) => row.textContent?.includes("Quick Model"))!;
    act(() => quick.click());

    expect(onPick).toHaveBeenCalledWith({
      harness: "omp",
      model: "omp:quick",
      modelSettings: {},
    });
  });

  it("hides the current model from a same-harness second opinion", () => {
    const onPick = vi.fn();
    act(() =>
      root.render(
        createElement(SecondOpinionButton, {
          from: "omp",
          fromModel: "omp:review",
          onPick,
          includeCurrent: true,
          excludeFromModel: true,
        }),
      ),
    );

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Second opinion"]')!
        .click(),
    );
    const provider = [...document.querySelectorAll('[role="menuitem"]')].find(
      (row) => row.textContent?.includes("omp"),
    )!;
    hover(provider);

    const modelLabels = [
      ...document.querySelectorAll(
        '[role="menu"][aria-label="omp models"] [role="menuitem"]',
      ),
    ].map((row) => row.textContent);
    expect(modelLabels.some((text) => text?.includes("Review Model"))).toBe(
      false,
    );
    expect(modelLabels.some((text) => text?.includes("Quick Model"))).toBe(
      true,
    );
  });

  it("disables the second-opinion button once the current model is the only one left", () => {
    setHarnessModels("omp", [
      { id: "omp:review", harness: "omp", name: "Review Model" },
    ]);
    const onPick = vi.fn();
    act(() =>
      root.render(
        createElement(SecondOpinionButton, {
          from: "omp",
          fromModel: "omp:review",
          onPick,
          includeCurrent: true,
          excludeFromModel: true,
        }),
      ),
    );

    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="No different model available for a second opinion"]',
    );
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
  });

  it("keeps the button enabled for an installed provider whose catalog has not loaded yet", () => {
    // Codex has no built-in fallback list in MODELS, so modelsFor("codex")
    // is empty until its live catalog loads. If it is the only other
    // installed provider, the button must stay enabled so the menu can
    // open and refreshHarnessCatalogs can populate it - not get disabled
    // first because the (not yet loaded) list looks empty.
    vi.mocked(isHarnessAvailable).mockImplementation(
      (harness: string) => harness === "codex",
    );
    const onPick = vi.fn();
    act(() =>
      root.render(
        createElement(SecondOpinionButton, {
          from: "pi",
          fromModel: "pi:main",
          onPick,
          includeCurrent: true,
          excludeFromModel: true,
        }),
      ),
    );

    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Second opinion"]',
    );
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(false);
  });
});
