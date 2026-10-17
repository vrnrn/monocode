import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadInboxMonos, setInboxMono } from "./inboxMonos";

const KEY = "monocode.inboxMonos.v1";
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

it("starts without a default Mono for either source", () => {
  expect(loadInboxMonos()).toEqual({});
});

it("keeps only Jira and GitLab entries with nonempty Mono IDs", () => {
  store.set(
    KEY,
    JSON.stringify({ jira: " mono-jira ", gitlab: 42, github: "mono-other" }),
  );
  expect(loadInboxMonos()).toEqual({ jira: "mono-jira" });
});

it.each(["null", "[]", "broken", '{"jira":" "}'])(
  "ignores invalid settings: %s",
  (raw) => {
    store.set(KEY, raw);
    expect(loadInboxMonos()).toEqual({});
  },
);

it("saves and clears separate default Monos", () => {
  setInboxMono("gitlab", "mono-reviews");
  setInboxMono("jira", "mono-tickets");
  expect(loadInboxMonos()).toEqual({
    gitlab: "mono-reviews",
    jira: "mono-tickets",
  });
  setInboxMono("gitlab", null);
  expect(loadInboxMonos()).toEqual({ jira: "mono-tickets" });
});

it("does not interpret the old provider defaults as Mono IDs", () => {
  store.set(
    "monocode.inboxAgents.v1",
    JSON.stringify({ jira: "codex", gitlab: "claude" }),
  );
  expect(loadInboxMonos()).toEqual({});
});

it("returns a stable snapshot until saved settings change", () => {
  setInboxMono("jira", "mono-tickets");
  const initial = loadInboxMonos();
  expect(loadInboxMonos()).toBe(initial);
  setInboxMono("jira", "mono-other");
  expect(loadInboxMonos()).not.toBe(initial);
});
