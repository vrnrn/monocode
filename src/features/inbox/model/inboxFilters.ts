import { isInboxProvider } from "./inboxProviders";
import {
  filterInboxItems,
  inboxItemStatus,
  type InboxItem,
  type InboxKind,
  type InboxProvider,
} from "./githubTasks";
import { loadInboxConnectors, type InboxConnectors } from "./inboxConnectors";
import { normalizeProjectPath } from "../../projects/model/recents";
import {
  timeFilterStart,
  type SessionTimeFilter,
} from "../../sessions/model/sessionFilters";

export type InboxTimeFilter = SessionTimeFilter;

export type InboxStatusFilter = {
  open: boolean;
  draft: boolean;
  closed: boolean;
  merged: boolean;
};

export type InboxFilters = {
  assignedToMe: boolean;
  hiddenProjects: string[];
  hiddenKinds: InboxKind[];
  time: InboxTimeFilter;
  status: InboxStatusFilter;
};

export const DEFAULT_INBOX_STATUS_FILTER: InboxStatusFilter = {
  open: false,
  draft: false,
  closed: false,
  merged: false,
};

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  assignedToMe: false,
  hiddenProjects: [],
  hiddenKinds: [],
  time: "all",
  status: DEFAULT_INBOX_STATUS_FILTER,
};

export type InboxSource = InboxProvider;

export type ConnectableInboxSource = InboxSource;

/** `null` means the status check has not resolved yet. */
export type InboxSourceConnections = Record<
  ConnectableInboxSource,
  boolean | null
>;

export const INBOX_SOURCE_LABELS: Record<InboxSource, string> = {
  github: "GitHub",
  jira: "Jira",
  gitlab: "GitLab",
};

export function visibleInboxSources(
  connections: InboxSourceConnections,
  enabled: InboxConnectors = loadInboxConnectors(),
): InboxSource[] {
  const sources: InboxSource[] = [];
  if (enabled.github && connections.github !== false) sources.push("github");
  if (enabled.jira && connections.jira !== false) sources.push("jira");
  if (enabled.gitlab && connections.gitlab !== false) sources.push("gitlab");
  return sources;
}

export function connectableInboxSources(
  connections: InboxSourceConnections,
  enabled: InboxConnectors = loadInboxConnectors(),
): ConnectableInboxSource[] {
  const sources: ConnectableInboxSource[] = [];
  if (enabled.github && connections.github === false) sources.push("github");
  if (enabled.jira && connections.jira === false) sources.push("jira");
  if (enabled.gitlab && connections.gitlab === false) sources.push("gitlab");
  return sources;
}

/** Account-wide issue trackers: no local repos, no PRs, no draft/merged states. */
export function isTrackerSource(source?: InboxSource): boolean {
  return source === "jira";
}

export function resolveInboxSource(
  source: InboxSource,
  connections: InboxSourceConnections,
  enabled: InboxConnectors = loadInboxConnectors(),
): InboxSource {
  const visible = visibleInboxSources(connections, enabled);
  return visible.includes(source) ? source : (visible[0] ?? "github");
}

const FILTERS_KEY = "monocode.inboxFilters";
const SOURCE_KEY = "monocode.inboxSource";
const CONNECTIONS_KEY = "monocode.inboxConnections";

const UNKNOWN_CONNECTIONS: InboxSourceConnections = {
  github: null,
  jira: null,
  gitlab: null,
};

export function loadInboxSource(): InboxSource {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    return isInboxProvider(raw) ? raw : "github";
  } catch {
    return "github";
  }
}

export function saveInboxSource(source: InboxSource) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    // private mode / quota
  }
}

function connectFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Seeded from the last known answer so a returning user does not watch every
 * tab paint and then drop two. A wrong guess corrects itself on the read.
 */
export function loadInboxConnections(): InboxSourceConnections {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return UNKNOWN_CONNECTIONS;
    const record = parsed as Record<string, unknown>;
    return {
      github: connectFlag(record.github),
      jira: connectFlag(record.jira),
      gitlab: connectFlag(record.gitlab),
    };
  } catch {
    return UNKNOWN_CONNECTIONS;
  }
}

export function saveInboxConnections(connections: InboxSourceConnections) {
  try {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
  } catch {
    // private mode / quota
  }
}

export function loadInboxFilters(): InboxFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_INBOX_FILTERS;
    const parsed = JSON.parse(raw) as Partial<InboxFilters>;
    return {
      assignedToMe: parsed.assignedToMe === true,
      hiddenProjects: Array.isArray(parsed.hiddenProjects)
        ? parsed.hiddenProjects.filter(
            (path): path is string =>
              typeof path === "string" && path.length > 0,
          )
        : [],
      hiddenKinds: Array.isArray(parsed.hiddenKinds)
        ? parsed.hiddenKinds.filter(isGithubInboxKind)
        : [],
      time: isTimeFilter(parsed.time) ? parsed.time : "all",
      status: {
        open: parsed.status?.open === true,
        draft: parsed.status?.draft === true,
        closed: parsed.status?.closed === true,
        merged: parsed.status?.merged === true,
      },
    };
  } catch {
    return DEFAULT_INBOX_FILTERS;
  }
}

export function saveInboxFilters(filters: InboxFilters) {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // private mode / quota
  }
}

export function pruneInboxFilters(
  filters: InboxFilters,
  projectPaths: Iterable<string>,
): InboxFilters {
  const known = new Set(
    [...projectPaths].map((path) => normalizeProjectPath(path)),
  );
  const hiddenProjects = filters.hiddenProjects.filter((path) =>
    known.has(normalizeProjectPath(path)),
  );
  if (hiddenProjects.length === filters.hiddenProjects.length) return filters;
  return { ...filters, hiddenProjects };
}

export function hasActiveInboxFilters(
  filters: InboxFilters,
  source?: InboxSource,
  /** Same for Jira projects. */
  hiddenJiraProjectIds: readonly string[] = [],
): boolean {
  const statusActive = isTrackerSource(source)
    ? filters.status.open || filters.status.closed
    : filters.status.open ||
      filters.status.draft ||
      filters.status.closed ||
      filters.status.merged;
  return (
    filters.assignedToMe ||
    (source === "jira" && hiddenJiraProjectIds.length > 0) ||
    (source !== "jira" && filters.hiddenProjects.length > 0) ||
    (isTrackerSource(source) ? false : filters.hiddenKinds.length > 0) ||
    filters.time !== "all" ||
    statusActive
  );
}

/** No status box checked means "no restriction", so the fetch has to widen with it. */
export function inboxFetchState(filters: InboxFilters): "open" | "all" {
  const { open, draft, closed, merged } = filters.status;
  if (closed || merged) return "all";
  return open || draft ? "open" : "all";
}

export function filterInboxByProject(
  items: readonly InboxItem[],
  hiddenProjects: Iterable<string>,
): InboxItem[] {
  const hidden = new Set(
    [...hiddenProjects].map((path) => normalizeProjectPath(path)),
  );
  if (hidden.size === 0) return [...items];
  return items.filter((item) => {
    const path = normalizeProjectPath(item.projectPath);
    if (!path) return true;
    return !hidden.has(path);
  });
}

export function filterInboxByKind(
  items: readonly InboxItem[],
  hiddenKinds: Iterable<InboxKind>,
): InboxItem[] {
  const hidden = new Set(hiddenKinds);
  if (hidden.size === 0) return [...items];
  return items.filter((item) => !hidden.has(item.kind));
}

export function filterInboxByStatus(
  items: readonly InboxItem[],
  status: InboxStatusFilter,
): InboxItem[] {
  const any = status.open || status.draft || status.closed || status.merged;
  if (!any) return [...items];
  return items.filter((item) => {
    const label = inboxItemStatus(item);
    if (status.open && label === "Open") return true;
    if (status.draft && label === "Draft") return true;
    if (status.closed && label === "Closed") return true;
    if (status.merged && label === "Merged") return true;
    return false;
  });
}

export function filterInboxByTime(
  items: readonly InboxItem[],
  time: InboxTimeFilter,
  now: number,
): InboxItem[] {
  if (time === "all") return [...items];
  const start = timeFilterStart(time, now);
  return items.filter((item) => {
    const updated = Date.parse(item.updatedAt);
    return Number.isFinite(updated) && updated >= start;
  });
}

export function filterInboxByProvider(
  items: readonly InboxItem[],
  source: InboxSource,
): InboxItem[] {
  return items.filter((item) => item.provider === source);
}

export function applyInboxFilters(
  items: readonly InboxItem[],
  filters: InboxFilters,
  query: string,
  now = Date.now(),
  source?: InboxSource,
): InboxItem[] {
  const scoped = source ? filterInboxByProvider(items, source) : [...items];
  const hiddenProjects =
    isTrackerSource(source) || (source === "gitlab" && filters.assignedToMe)
      ? []
      : filters.hiddenProjects;
  const hiddenKinds = isTrackerSource(source) ? [] : filters.hiddenKinds;
  return filterInboxItems(
    filterInboxByStatus(
      filterInboxByTime(
        filterInboxByKind(
          filterInboxByProject(scoped, hiddenProjects),
          hiddenKinds,
        ),
        filters.time,
        now,
      ),
      statusFilterForSource(filters.status, source),
    ),
    query,
  );
}

export function statusFilterForSource(
  status: InboxStatusFilter,
  source?: InboxSource,
): InboxStatusFilter {
  if (!isTrackerSource(source)) return status;
  return {
    open: status.open,
    closed: status.closed,
    draft: false,
    merged: false,
  };
}

function isGithubInboxKind(value: unknown): value is InboxKind {
  return value === "issue" || value === "pr";
}

function isTimeFilter(value: unknown): value is InboxTimeFilter {
  return (
    value === "all" || value === "today" || value === "7d" || value === "30d"
  );
}
