import { useSyncExternalStore } from "react";
import { isHarnessId, type HarnessId } from "../../sessions/model/harnessIds";

/** Inbox sources that can name a default agent for the sessions they start. */
export const INBOX_AGENT_SOURCES = ["jira", "gitlab"] as const;

export type InboxAgentSource = (typeof INBOX_AGENT_SOURCES)[number];

export type InboxAgents = Partial<Record<InboxAgentSource, HarnessId>>;

const KEY = "monocode.inboxAgents.v1";
const CHANGE = "monocode:inbox-agents-change";
const NONE: InboxAgents = Object.freeze({});

let lastRaw: string | null | undefined;
let lastAgents: InboxAgents = NONE;

function isInboxAgentSource(value: string): value is InboxAgentSource {
  return (INBOX_AGENT_SOURCES as readonly string[]).includes(value);
}

function parseInboxAgents(raw: string | null): InboxAgents {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return NONE;
    const values = parsed as Record<string, unknown>;
    const agents: InboxAgents = {};
    for (const source of INBOX_AGENT_SOURCES) {
      const harness = values[source];
      if (isHarnessId(harness)) agents[source] = harness;
    }
    return agents;
  } catch {
    return NONE;
  }
}

/** Saved default agents. The same object returns until the saved value changes. */
export function loadInboxAgents(): InboxAgents {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return NONE;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastAgents = parseInboxAgents(raw);
  }
  return lastAgents;
}

/** The default agent for a Jira or GitLab item. Other sources have none. */
export function inboxAgentFor(provider: string): HarnessId | undefined {
  return isInboxAgentSource(provider) ? loadInboxAgents()[provider] : undefined;
}

/** Save or clear a default agent. `null` returns the source to the project default. */
export function setInboxAgent(
  source: InboxAgentSource,
  harness: HarnessId | null,
): void {
  const agents: InboxAgents = { ...loadInboxAgents() };
  if (harness) agents[source] = harness;
  else delete agents[source];
  try {
    localStorage.setItem(KEY, JSON.stringify(agents));
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
}

function subscribeInboxAgents(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useInboxAgents(): InboxAgents {
  return useSyncExternalStore(
    subscribeInboxAgents,
    loadInboxAgents,
    () => NONE,
  );
}
