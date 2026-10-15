// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyInboxFilters,
  DEFAULT_INBOX_FILTERS,
  filterInboxByKind,
  filterInboxByProject,
  filterInboxByProvider,
  filterInboxByStatus,
  filterInboxByTime,
  hasActiveInboxFilters,
  inboxFetchState,
  pruneInboxFilters,
  connectableInboxSources,
  loadInboxConnections,
  loadInboxSource,
  resolveInboxSource,
  saveInboxConnections,
  visibleInboxSources,
} from "./inboxFilters";
import type { InboxConnectors } from "./inboxConnectors";
import type { InboxItem } from "./githubTasks";

it("falls back to GitHub for a saved removed-provider selection", () => {
  for (const source of ["linear", "azuredevops"]) {
    localStorage.setItem("monocode.inboxSource", source);
    expect(loadInboxSource()).toBe("github");
  }
});

function item(
  overrides: Partial<InboxItem> & Pick<InboxItem, "number" | "updatedAt">,
): InboxItem {
  return {
    kind: "issue",
    title: "Item",
    url: "https://github.com/acme/web/issues/1",
    state: "open",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    projectPath: "/tmp/web",
    provider: "github",
    ...overrides,
  };
}

describe("filterInboxByProject", () => {
  it("hides selected projects", () => {
    const rows = [
      item({
        number: 1,
        updatedAt: "2026-08-27T10:00:00Z",
        projectPath: "/tmp/web",
      }),
      item({
        number: 2,
        updatedAt: "2026-08-27T10:00:00Z",
        projectPath: "/tmp/docs",
      }),
    ];
    expect(
      filterInboxByProject(rows, ["/tmp/web/"]).map((row) => row.number),
    ).toEqual([2]);
  });
});

describe("filterInboxByKind", () => {
  it("hides selected kinds", () => {
    const rows = [
      item({ number: 1, kind: "issue", updatedAt: "2026-08-27T10:00:00Z" }),
      item({ number: 2, kind: "pr", updatedAt: "2026-08-27T10:00:00Z" }),
      item({
        number: 9,
        kind: "jira",
        provider: "jira",
        updatedAt: "2026-08-27T10:00:00Z",
      }),
    ];
    expect(filterInboxByKind(rows, ["pr"]).map((row) => row.number)).toEqual([
      1, 9,
    ]);
    expect(filterInboxByKind(rows, ["jira"]).map((row) => row.number)).toEqual([
      1, 2,
    ]);
  });
});

describe("filterInboxByStatus", () => {
  const rows = [
    item({ number: 1, updatedAt: "2026-08-27T10:00:00Z", state: "open" }),
    item({
      number: 2,
      kind: "pr",
      updatedAt: "2026-08-27T10:00:00Z",
      state: "open",
      draft: true,
    }),
    item({ number: 3, updatedAt: "2026-08-27T10:00:00Z", state: "closed" }),
    item({
      number: 4,
      kind: "pr",
      updatedAt: "2026-08-27T10:00:00Z",
      state: "merged",
    }),
  ];

  it("keeps every item when no status is selected", () => {
    expect(
      filterInboxByStatus(rows, DEFAULT_INBOX_FILTERS.status).map(
        (row) => row.number,
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  it("matches any selected status", () => {
    expect(
      filterInboxByStatus(rows, {
        open: true,
        draft: false,
        closed: true,
        merged: false,
      }).map((row) => row.number),
    ).toEqual([1, 3]);
  });
});

describe("filterInboxByTime", () => {
  const now = new Date("2026-08-27T15:00:00").getTime();

  it("keeps items updated today", () => {
    const rows = [
      item({
        number: 1,
        updatedAt: new Date("2026-08-27T10:00:00").toISOString(),
      }),
      item({
        number: 2,
        updatedAt: new Date("2026-08-20T10:00:00").toISOString(),
      }),
    ];
    expect(
      filterInboxByTime(rows, "today", now).map((row) => row.number),
    ).toEqual([1]);
  });
});

describe("applyInboxFilters", () => {
  it("combines project, kind, and search filters", () => {
    const rows = [
      item({
        number: 1,
        title: "Fix checkout",
        kind: "pr",
        projectPath: "/tmp/web",
        updatedAt: "2026-08-27T10:00:00Z",
      }),
      item({
        number: 2,
        title: "Fix checkout",
        kind: "issue",
        projectPath: "/tmp/docs",
        updatedAt: "2026-08-27T10:00:00Z",
      }),
    ];
    expect(
      applyInboxFilters(
        rows,
        { ...DEFAULT_INBOX_FILTERS, hiddenProjects: ["/tmp/docs"] },
        "checkout",
      ).map((row) => row.number),
    ).toEqual([1]);
  });

  it("scopes to a provider tab", () => {
    const rows = [
      item({
        number: 1,
        title: "Fix checkout",
        kind: "pr",
        updatedAt: "2026-08-27T10:00:00Z",
      }),
      item({
        number: 9,
        title: "Fix checkout",
        kind: "jira",
        provider: "jira",
        updatedAt: "2026-08-27T10:00:00Z",
      }),
    ];
    expect(
      applyInboxFilters(
        rows,
        DEFAULT_INBOX_FILTERS,
        "checkout",
        Date.now(),
        "jira",
      ).map((row) => row.number),
    ).toEqual([9]);
  });

  it("ignores local project exclusions in GitLab's attention view", () => {
    const gitlab = item({
      number: 9,
      provider: "gitlab",
      repo: "acme/web",
      projectPath: "/tmp/web",
      updatedAt: "2026-08-27T10:00:00Z",
    });
    expect(
      applyInboxFilters(
        [gitlab],
        {
          ...DEFAULT_INBOX_FILTERS,
          assignedToMe: true,
          hiddenProjects: ["/tmp/web"],
        },
        "",
        Date.now(),
        "gitlab",
      ),
    ).toEqual([gitlab]);
  });
});

describe("hasActiveInboxFilters", () => {
  it("is false for defaults", () => {
    expect(hasActiveInboxFilters(DEFAULT_INBOX_FILTERS)).toBe(false);
  });

  it("is true when a project is hidden", () => {
    expect(
      hasActiveInboxFilters({
        ...DEFAULT_INBOX_FILTERS,
        hiddenProjects: ["/tmp/web"],
      }),
    ).toBe(true);
  });
});

describe("inboxFetchState", () => {
  it("fetches everything while no status is selected", () => {
    expect(inboxFetchState(DEFAULT_INBOX_FILTERS)).toBe("all");
  });

  it("narrows to open once only open or draft is selected", () => {
    expect(
      inboxFetchState({
        ...DEFAULT_INBOX_FILTERS,
        status: { ...DEFAULT_INBOX_FILTERS.status, open: true },
      }),
    ).toBe("open");
    expect(
      inboxFetchState({
        ...DEFAULT_INBOX_FILTERS,
        status: { ...DEFAULT_INBOX_FILTERS.status, draft: true },
      }),
    ).toBe("open");
  });

  it("widens to all when closed or merged is selected", () => {
    expect(
      inboxFetchState({
        ...DEFAULT_INBOX_FILTERS,
        status: { ...DEFAULT_INBOX_FILTERS.status, closed: true },
      }),
    ).toBe("all");
    expect(
      inboxFetchState({
        ...DEFAULT_INBOX_FILTERS,
        status: { ...DEFAULT_INBOX_FILTERS.status, open: true, merged: true },
      }),
    ).toBe("all");
  });
});

describe("pruneInboxFilters", () => {
  it("drops hidden projects that are no longer in the rail", () => {
    const pruned = pruneInboxFilters(
      { ...DEFAULT_INBOX_FILTERS, hiddenProjects: ["/tmp/web", "/tmp/gone"] },
      ["/tmp/web"],
    );
    expect(pruned.hiddenProjects).toEqual(["/tmp/web"]);
  });
});

describe("visibleInboxSources", () => {
  it("drops sources that are known to be disconnected", () => {
    expect(
      visibleInboxSources({
        github: false,

        jira: false,
        gitlab: false,
      }),
    ).toEqual([]);
    expect(
      visibleInboxSources({
        github: true,

        jira: false,
        gitlab: false,
      }),
    ).toEqual(["github"]);
    expect(
      visibleInboxSources({
        github: false,

        jira: true,
        gitlab: false,
      }),
    ).toEqual(["jira"]);
    expect(
      visibleInboxSources({
        github: true,

        jira: true,
        gitlab: true,
      }),
    ).toEqual(["github", "jira", "gitlab"]);
  });

  it("keeps unresolved sources visible so tabs do not flash away", () => {
    expect(
      visibleInboxSources({
        github: null,

        jira: null,
        gitlab: null,
      }),
    ).toEqual(["github", "jira", "gitlab"]);
  });
});

describe("connectableInboxSources", () => {
  it("offers only the sources confirmed to be disconnected", () => {
    expect(
      connectableInboxSources({
        github: true,

        jira: false,
        gitlab: true,
      }),
    ).toEqual(["jira"]);
    expect(
      connectableInboxSources({
        github: false,

        jira: false,
        gitlab: false,
      }),
    ).toEqual(["github", "jira", "gitlab"]);
  });

  it("offers nothing while the checks are unresolved", () => {
    expect(
      connectableInboxSources({
        github: null,

        jira: null,
        gitlab: null,
      }),
    ).toEqual([]);
  });
});

describe("resolveInboxSource", () => {
  it("falls back to the first visible source when the selection disconnects", () => {
    expect(
      resolveInboxSource("jira", {
        github: true,

        jira: false,
        gitlab: true,
      }),
    ).toBe("github");
    expect(
      resolveInboxSource("github", {
        github: false,

        jira: false,
        gitlab: true,
      }),
    ).toBe("gitlab");
  });

  it("keeps GitHub as an internal fallback when every source is disconnected", () => {
    expect(
      resolveInboxSource("jira", {
        github: false,

        jira: false,
        gitlab: false,
      }),
    ).toBe("github");
  });

  it("leaves a still-visible selection alone", () => {
    expect(
      resolveInboxSource("jira", {
        github: false,

        jira: true,
        gitlab: false,
      }),
    ).toBe("jira");
    expect(
      resolveInboxSource("github", {
        github: true,

        jira: true,
        gitlab: false,
      }),
    ).toBe("github");
  });
});

function mockLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

describe("inbox connection cache", () => {
  const KEY = "monocode.inboxConnections";
  beforeEach(mockLocalStorage);

  it("round-trips the last known connect state", () => {
    saveInboxConnections({
      github: true,

      jira: true,
      gitlab: false,
    });
    expect(loadInboxConnections()).toEqual({
      github: true,

      jira: true,
      gitlab: false,
    });
  });

  it("reads unknown when nothing is stored", () => {
    expect(loadInboxConnections()).toEqual({
      github: null,

      jira: null,
      gitlab: null,
    });
  });

  it("reads unknown rather than trusting a malformed value", () => {
    localStorage.setItem(KEY, "not json");
    expect(loadInboxConnections()).toEqual({
      github: null,

      jira: null,
      gitlab: null,
    });
    localStorage.setItem(KEY, '{"jira":"yes"}');
    expect(loadInboxConnections()).toEqual({
      github: null,

      jira: null,
      gitlab: null,
    });
  });
});


describe("disabled Inbox connectors", () => {
  const enabled: InboxConnectors = {
    github: false,

    jira: false,
    gitlab: true,
  };

  it("hides disabled connected and unresolved sources from tabs", () => {
    expect(
      visibleInboxSources(
        {
          github: true,
          jira: null,
          gitlab: true,
        },
        enabled,
      ),
    ).toEqual(["gitlab"]);
  });

  it("hides disabled disconnected sources from Add connection", () => {
    expect(
      connectableInboxSources(
        {
          github: false,
          jira: false,
          gitlab: false,
        },
        enabled,
      ),
    ).toEqual(["gitlab"]);
  });

  it("selects the next enabled connected source after switching one off", () => {
    expect(
      resolveInboxSource(
        "github",
        {
          github: true,
          jira: true,
          gitlab: true,
        },
        enabled,
      ),
    ).toBe("gitlab");
  });

  it("shows no source tabs or connect actions when every connector is off", () => {
    const disabled = Object.fromEntries(
      Object.keys(enabled).map((key) => [key, false]),
    ) as InboxConnectors;
    const connections = { github: true, jira: null, gitlab: true };
    expect(visibleInboxSources(connections, disabled)).toEqual([]);
    expect(connectableInboxSources(connections, disabled)).toEqual([]);
  });
});
