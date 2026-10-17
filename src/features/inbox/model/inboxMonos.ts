import { useSyncExternalStore } from "react";

/** Inbox sources that can preselect a Mono in Send to chat. */
export const INBOX_MONO_SOURCES = ["jira", "gitlab"] as const;

export type InboxMonoSource = (typeof INBOX_MONO_SOURCES)[number];

export type InboxMonos = Partial<Record<InboxMonoSource, string>>;

const KEY = "monocode.inboxMonos.v1";
const CHANGE = "monocode:inbox-monos-change";
const NONE: InboxMonos = Object.freeze({});

let lastRaw: string | null | undefined;
let lastMonos: InboxMonos = NONE;

function parseInboxMonos(raw: string | null): InboxMonos {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return NONE;
    const values = parsed as Record<string, unknown>;
    const monos: InboxMonos = {};
    for (const source of INBOX_MONO_SOURCES) {
      const monoId = values[source];
      if (typeof monoId === "string" && monoId.trim())
        monos[source] = monoId.trim();
    }
    return monos;
  } catch {
    return NONE;
  }
}

/** Saved default Mono IDs. The same object returns until the saved value changes. */
export function loadInboxMonos(): InboxMonos {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return NONE;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastMonos = parseInboxMonos(raw);
  }
  return lastMonos;
}

/** Save or clear the Mono preselected as a source's chat destination. */
export function setInboxMono(
  source: InboxMonoSource,
  monoId: string | null,
): void {
  const monos: InboxMonos = { ...loadInboxMonos() };
  if (monoId?.trim()) monos[source] = monoId.trim();
  else delete monos[source];
  try {
    localStorage.setItem(KEY, JSON.stringify(monos));
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE));
}

function subscribeInboxMonos(listener: () => void): () => void {
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

export function useInboxMonos(): InboxMonos {
  return useSyncExternalStore(subscribeInboxMonos, loadInboxMonos, () => NONE);
}
