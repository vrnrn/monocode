// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  defaultSessionChoice,
  filterPickerModels,
  getPickerVisibilitySnapshot,
  isPickerModelVisible,
  loadFavoriteModels,
  loadHiddenPickerModels,
  pickerModelsFor,
  preferredModelId,
  resetHarnessModelOverlays,
  resolveModel,
  saveDefaultModel,
  saveFavoriteModels,
  saveLastModelChoice,
  savePickerModelsVisible,
  setHarnessModels,
  subscribePickerVisibility,
} from "./models";
import { setProjectModelsHidden } from "./projectProviders";
import { newSession } from "./session";

const luna = {
  id: "codex:gpt-5.6-luna",
  harness: "codex" as const,
  name: "GPT-5.6 Luna",
};
const sol = {
  id: "codex:gpt-6.1-sol",
  harness: "codex" as const,
  name: "GPT-6.1 Sol",
};

beforeEach(() => {
  localStorage.clear();
  resetHarnessModelOverlays();
  setHarnessModels("codex", [luna, sol]);
});
afterEach(() => resetHarnessModelOverlays());

it("hides a model from new choices while preserving its catalog, favorites and existing chats", () => {
  saveFavoriteModels([luna.id, sol.id]);
  saveDefaultModel("codex", luna.id);
  saveLastModelChoice("codex", luna.id);
  const chat = newSession("codex", "/repo", luna.id);
  savePickerModelsVisible([luna.id], false);
  expect(pickerModelsFor("codex")).toEqual([sol]);
  expect(filterPickerModels([luna, sol])).toEqual([sol]);
  expect(resolveModel("codex", luna.id)).toEqual(luna);
  expect(chat.model).toBe(luna.id);
  expect(loadFavoriteModels()).toEqual([luna.id, sol.id]);
  expect(preferredModelId("codex")).toBe(sol.id);
  expect(defaultSessionChoice("/repo")).toEqual({
    harness: "codex",
    model: sol.id,
  });
  savePickerModelsVisible([luna.id], true);
  expect(pickerModelsFor("codex")).toEqual([luna, sol]);
  expect(preferredModelId("codex")).toBe(luna.id);
});

it("keeps project visibility scoped and restores project choices after a global mask is removed", () => {
  setProjectModelsHidden("/one", [luna.id], true);
  expect(pickerModelsFor("codex", "/one")).toEqual([sol]);
  expect(pickerModelsFor("codex", "/two")).toEqual([luna, sol]);
  savePickerModelsVisible([sol.id], false);
  expect(pickerModelsFor("codex", "/one")).toEqual([]);
  setProjectModelsHidden("/one", [sol.id], false);
  expect(isPickerModelVisible(sol.id, "/one")).toBe(false);
  savePickerModelsVisible([sol.id], true);
  expect(pickerModelsFor("codex", "/one")).toEqual([sol]);
  expect(loadHiddenPickerModels()).toEqual([]);
});

it("starts new chats on another provider if all of the default provider's models are hidden", () => {
  saveLastModelChoice("codex", luna.id);
  savePickerModelsVisible([luna.id, sol.id], false);
  expect(defaultSessionChoice("/repo").harness).toBe("claude");
});

it("loads saved visibility after reopening and ignores malformed values", () => {
  localStorage.setItem(
    "monocode.hiddenPickerModels",
    JSON.stringify([luna.id, null, 4]),
  );
  expect(pickerModelsFor("codex")).toEqual([sol]);
  localStorage.setItem("monocode.hiddenPickerModels", "broken");
  expect(pickerModelsFor("codex")).toEqual([luna, sol]);
});

it("updates open model controls when another window changes visibility", () => {
  const changed = vi.fn();
  const unsubscribe = subscribePickerVisibility(changed);
  const before = getPickerVisibilitySnapshot();
  localStorage.setItem(
    "monocode.hiddenPickerModels",
    JSON.stringify([luna.id]),
  );
  window.dispatchEvent(
    new StorageEvent("storage", { key: "monocode.hiddenPickerModels" }),
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(getPickerVisibilitySnapshot()).toBeGreaterThan(before);
  expect(pickerModelsFor("codex")).toEqual([sol]);
  unsubscribe();
});
