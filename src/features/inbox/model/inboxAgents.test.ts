import { afterEach, beforeEach, expect, it } from "vitest";
import { inboxAgentFor, loadInboxAgents, setInboxAgent } from "./inboxAgents";

const KEY = "monocode.inboxAgents.v1";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

it("starts with no default agent for any source", () => {
  expect(loadInboxAgents()).toEqual({});
  expect(inboxAgentFor("jira")).toBeUndefined();
});

it("keeps only Jira and GitLab entries that name a known provider", () => {
  store.set(
    KEY,
    JSON.stringify({ jira: "codex", gitlab: "nope", github: "claude" }),
  );
  expect(loadInboxAgents()).toEqual({ jira: "codex" });
});

it("saves and clears the default agent for each source", () => {
  setInboxAgent("gitlab", "claude");
  setInboxAgent("jira", "pi");
  expect(loadInboxAgents()).toEqual({ gitlab: "claude", jira: "pi" });
  expect(inboxAgentFor("gitlab")).toBe("claude");

  setInboxAgent("gitlab", null);
  expect(loadInboxAgents()).toEqual({ jira: "pi" });
  expect(inboxAgentFor("gitlab")).toBeUndefined();
});

it("never applies a default agent to GitHub items", () => {
  setInboxAgent("jira", "claude");
  expect(inboxAgentFor("github")).toBeUndefined();
});
