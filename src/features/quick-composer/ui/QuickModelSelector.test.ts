// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickModelSelector } from "./QuickModelSelector";
import {
  resetHarnessModelOverlays,
  setHarnessModels,
  saveLastModelSettings,
  savePickerModelsVisible,
  type AgentModel,
} from "../../sessions/model/models";

import { setProjectModelsHidden } from "../../sessions/model/projectProviders";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

const claude: AgentModel = {
  id: "test-claude",
  name: "Test Claude",
  harness: "claude",
  settings: [
    {
      id: "effort",
      label: "Effort",
      kind: "select",
      value: "low",
      options: [
        { label: "Low", value: "low" },
        { label: "High", value: "high" },
      ],
    },
    {
      id: "fast",
      label: "Fast",
      kind: "toggle",
      value: "false",
      options: [
        { label: "Off", value: "false" },
        { label: "On", value: "true" },
      ],
    },
  ],
};
const grok: AgentModel = {
  id: "test-grok",
  name: "Test Grok",
  harness: "antigravity",
};
let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onSettingsChange = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetHarnessModelOverlays();
  setHarnessModels("claude", [claude]);
  setHarnessModels("antigravity", [grok]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(QuickModelSelector, {
        model: claude,
        values: { effort: "low" },
        availableHarnesses: ["claude", "antigravity"],
        onChange,
        onSettingsChange,
        onClose,
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetHarnessModelOverlays();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("browses one provider at a time and selects a model without closing settings", () => {
  const tabs = container.querySelectorAll('[role="tab"]');
  expect(tabs).toHaveLength(3); // Favorites and the two available providers.
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "Test Claude",
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[role="tab"][aria-label="Antigravity"]',
      )!
      .click(),
  );
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "Test Grok",
  );
  expect(
    container.querySelector('[role="listbox"]')?.textContent,
  ).not.toContain("Test Claude");
  act(() =>
    container.querySelector<HTMLButtonElement>('[role="option"]')!.click(),
  );
  expect(onChange).toHaveBeenCalledWith(grok);
  expect(onClose).not.toHaveBeenCalled();
});

it("updates effort inline and closes with Escape", () => {
  const slider = container.querySelector<HTMLInputElement>(
    'input[type="range"]',
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(slider, "1");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onSettingsChange).toHaveBeenCalledWith({ effort: "high" });
  act(() =>
    slider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("shows saved favorites across provider tabs", () => {
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[title="Add to favorites"]')!
      .click(),
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[role="tab"][aria-label="Favorites"]')!
      .click(),
  );
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "Test Claude",
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[title="Remove from favorites"]')!
      .click(),
  );
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "No favorite models",
  );
});

it("toggles fast mode from the lightning button", () => {
  const fast = container.querySelector<HTMLButtonElement>(
    '[aria-label="Fast mode"]',
  )!;
  expect(fast.getAttribute("aria-pressed")).toBe("false");
  act(() => fast.click());
  expect(onSettingsChange).toHaveBeenCalledWith({
    effort: "low",
    fast: "true",
  });
});

it("resets reasoning and fast mode to saved user defaults", () => {
  saveLastModelSettings({ effort: "high", fast: "false" });
  act(() =>
    root.render(
      createElement(QuickModelSelector, {
        model: claude,
        values: { effort: "low", fast: "true", context: "256k" },
        availableHarnesses: ["claude", "antigravity"],
        onChange,
        onSettingsChange,
        onClose,
      }),
    ),
  );
  const fast = container.querySelector<HTMLButtonElement>(
    '[aria-label="Fast mode"]',
  )!;
  expect(fast.getAttribute("aria-pressed")).toBe("true");
  expect(fast.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Reset to saved defaults"]',
      )!
      .click(),
  );
  expect(onSettingsChange).toHaveBeenCalledWith({
    effort: "high",
    fast: "false",
    context: "256k",
  });
});

it("applies project model visibility live without hiding the model in other projects", () => {
  const render = (project: string) =>
    act(() =>
      root.render(
        createElement(QuickModelSelector, {
          model: claude,
          project,
          values: {},
          availableHarnesses: ["claude", "antigravity"],
          onChange,
          onSettingsChange,
          onClose,
        }),
      ),
    );
  render("/repo");
  act(() => setProjectModelsHidden("/repo", [claude.id], true));
  expect(
    container.querySelector('[role="listbox"]')?.textContent,
  ).not.toContain("Test Claude");
  render("/other");
  expect(container.querySelector('[role="listbox"]')?.textContent).toContain(
    "Test Claude",
  );
  act(() => savePickerModelsVisible([claude.id], false));
  expect(
    container.querySelector('[role="listbox"]')?.textContent,
  ).not.toContain("Test Claude");
});
