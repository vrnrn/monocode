// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  inboxNotificationProject,
  knownNotificationProject,
  knownNotificationProjectSelection,
  loadNotificationProjects,
  rememberNotificationProjects,
} from "./notificationProjects";

it("ignores retired provider-only catalog rows while retaining local Azure checkouts", () => {
  const azure = {
    id: "repository:dev.azure.com/acme/app",
    name: "acme/app",
    detail: "dev.azure.com",
    kind: "repository",
    paths: [],
  };
  localStorage.setItem(
    "monocode.notificationProjects.v2",
    JSON.stringify([
      azure,
      {
        id: "linear:project:old",
        name: "Old project",
        detail: "Linear",
        kind: "linear",
        paths: [],
      },
      { ...azure, id: "local:/work/app", paths: ["/work/app"] },
    ]),
  );
  expect(
    knownNotificationProjectSelection(["/work/app"]).projects.map(
      (project) => project.id,
    ),
  ).toEqual(["local:/work/app"]);
});

beforeEach(() => localStorage.clear());

it("groups Jira notification preferences by site and stable project ID", () => {
  const item = {
    provider: "jira" as const, repo: "ENG", teamId: "10000",
    teamName: "Engineering", url: "https://acme.atlassian.net/browse/ENG-42",
  };
  const project = inboxNotificationProject(item);
  expect(project).toEqual({
    id: "jira:acme.atlassian.net:project:10000", name: "Engineering",
    detail: "Jira · acme.atlassian.net", kind: "jira", paths: [],
  });
  expect(
    inboxNotificationProject({
      ...item,
      repo: "RENAMED",
      url: "https://acme.atlassian.net/browse/RENAMED-1",
    }).id,
  ).toBe(project.id);
  expect(
    inboxNotificationProject({
      ...item,
      url: "https://other.atlassian.net/browse/ENG-42",
    }).id,
  ).not.toBe(project.id);
  rememberNotificationProjects([project]);
  expect(loadNotificationProjects()).toContainEqual(project);
});

it("derives local notification identity immediately from the normalized path", () => {
  expect(knownNotificationProject("C:/Work/App")).toEqual({
    id: "local:c:/work/app",
    name: "App",
    detail: "C:/Work/App",
    kind: "local",
    paths: ["C:/Work/App"],
  });
  expect(knownNotificationProject("c:\\work\\app")?.id).toBe(
    "local:c:/work/app",
  );
});

it("keeps separate checkout and worktree paths as separate projects", () => {
  const selection = knownNotificationProjectSelection([
    "/work/app",
    "/work/app-review",
  ]);
  expect(selection.projects.map((project) => project.id)).toEqual([
    "local:/work/app",
    "local:/work/app-review",
  ]);
});

it("includes requested paths and provider-only catalog projects", () => {
  rememberNotificationProjects([
    {
      id: "jira:demo.atlassian.net:project:roadmap",
      name: "Roadmap",
      detail: "Jira",
      kind: "jira",
      paths: [],
    },
    {
      id: "local:/old/path",
      name: "old",
      detail: "/old/path",
      kind: "local",
      paths: ["/old/path"],
    },
  ]);
  expect(
    knownNotificationProjectSelection(["/work/app"]).projects.map(
      (project) => project.id,
    ),
  ).toEqual(["jira:demo.atlassian.net:project:roadmap", "local:/work/app"]);
});

it("uses the same local ID when Inbox enriches a path with repository metadata", () => {
  const project = inboxNotificationProject({
    provider: "github",
    repo: "acme/app",
    url: "https://github.com/acme/app/pull/5",
    projectPath: "/work/app",
  });
  expect(project).toMatchObject({
    id: "local:/work/app",
    name: "acme/app",
    kind: "repository",
  });
  rememberNotificationProjects([project]);
  expect(knownNotificationProject("/work/app")).toEqual(project);
});

it("uses a new catalog version so old Git-derived path mappings are ignored", () => {
  localStorage.setItem(
    "monocode.notificationProjects.v1",
    JSON.stringify([
      {
        id: "repository:github.com/old/app",
        name: "old/app",
        detail: "github.com",
        kind: "repository",
        paths: ["/work/app"],
      },
    ]),
  );
  expect(loadNotificationProjects()).toEqual([]);
  expect(knownNotificationProject("/work/app")?.id).toBe("local:/work/app");
});
