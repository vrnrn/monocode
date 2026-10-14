import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import {
  applyTicketContextToTurn,
  parseTicketContextLink,
  ticketContextLink,
  ticketComposerCard,
} from "./ticketContext";
import { clearInboxCache, type InboxItem } from "./githubTasks";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const urls = {
  jira: "https://demo.atlassian.net/browse/DEMO-42",
  github: "https://github.com/acme/demo/issues/42",
  gitlab: "https://gitlab.example.com/acme/nested/demo/-/issues/42",
};
const link = (provider: keyof typeof urls) =>
  ticketContextLink({ provider, url: urls[provider] });
let body = "Initial description";
let comment = "Initial comment";
beforeEach(() => {
  clearInboxCache();
  body = "Initial description";
  comment = "Initial comment";
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => {
      if (command === "jira_status")
        return { connected: true, site: "https://demo.atlassian.net" };
      if (command === "gitlab_status")
        return { connected: true, url: "https://gitlab.example.com" };
      if (String(command).endsWith("details")) return { body, author: "Alex" };
      if (String(command).endsWith("thread"))
        return {
          comments: [
            {
              body: comment,
              author: "Robin",
              createdAt: "2026-10-14T12:00:00Z",
            },
          ],
          truncated: false,
        };
      throw new Error(`Unexpected command: ${command}`);
    });
});

it.each(["jira", "github", "gitlab"] as const)(
  "round trips %s identity without embedding ticket contents",
  (provider) => {
    const ref = parseTicketContextLink(link(provider))!;
    expect(ref.provider).toBe(provider);
    expect(ref.url).toBe(urls[provider]);
    expect(ref.number).toBe(42);
    expect(link(provider)).not.toContain(body);
  },
);
it.each(["jira", "github", "gitlab"] as const)(
  "fetches fresh %s description and comments on every turn",
  async (provider) => {
    const prompt = `Explain this: ${link(provider)}`;
    expect(await applyTicketContextToTurn(prompt, "/tmp/demo")).toContain(
      "Initial description",
    );
    body = "Updated description";
    comment = "Newest decision";
    const resolved = await applyTicketContextToTurn(prompt, "/tmp/demo");
    expect(resolved).toContain("Updated description");
    expect(resolved).toContain("Newest decision");
    expect(resolved).not.toContain("Initial description");
  },
);
it("deduplicates links in one turn while retaining the user's message", async () => {
  const prompt = `Please compare [ticket](${link("jira")}) and ${link("jira")}`;
  const resolved = await applyTicketContextToTurn(prompt, "/tmp/demo");
  expect(resolved.startsWith(prompt)).toBe(true);
  expect(
    vi.mocked(invoke).mock.calls.filter(([c]) => c === "jira_issue_details"),
  ).toHaveLength(1);
});
it("does not contact integrations for ordinary text", async () => {
  expect(await applyTicketContextToTurn("hello", "/tmp/demo")).toBe("hello");
  expect(invoke).not.toHaveBeenCalled();
});
it.each([
  "monocode://context/jira?url=https%3A%2F%2Fuser%3Asecret%40demo.atlassian.net%2Fbrowse%2FDEMO-42",
  "monocode://context/github?url=https%3A%2F%2Fevil.example%2Facme%2Fdemo%2Fissues%2F42",
  "monocode://context/jira?url=http%3A%2F%2Fdemo.atlassian.net%2Fbrowse%2FDEMO-42",
  "monocode://context/gitlab?url=https%3A%2F%2Fgitlab.example.com%2Facme%2Fdemo%2F-%2Fmerge_requests%2F42",
  "monocode://context/jira?url=https%3A%2F%2Fdemo.atlassian.net%2Fbrowse%2FDEMO-42%3Ftoken%3Dsecret",
])("rejects unsupported or credential-bearing references: %s", (value) =>
  expect(parseTicketContextLink(value)).toBeNull(),
);
it("fails closed for a different Jira site", async () => {
  const other = ticketContextLink({
    provider: "jira",
    url: "https://other.atlassian.net/browse/DEMO-42",
  });
  await expect(applyTicketContextToTurn(other, "/tmp/demo")).rejects.toThrow(
    "Connect this Jira site",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("fails closed for a different GitLab host", async () => {
  const other = ticketContextLink({
    provider: "gitlab",
    url: "https://other.example.com/acme/demo/-/issues/42",
  });
  await expect(applyTicketContextToTurn(other, "/tmp/demo")).rejects.toThrow(
    "Connect this GitLab host",
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("reports fetch failures instead of sending an empty context", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("Permission denied"));
  await expect(
    applyTicketContextToTurn(link("github"), "/tmp/demo"),
  ).rejects.toThrow("Could not load github #42 context: Permission denied");
});
it("limits context and reports omitted comments", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    String(command).endsWith("details")
      ? { body: "x".repeat(70_000) }
      : {
          comments: Array.from({ length: 50 }, (_, i) => ({
            body: `Comment ${i}`,
            author: "Alex",
            createdAt: "",
          })),
          truncated: false,
        },
  );
  const resolved = await applyTicketContextToTurn(link("github"), "/tmp/demo");
  expect(resolved).toContain('"truncated":true');
  expect(resolved).not.toContain('"body":"Comment 0"');
  expect(resolved).toContain('"body":"Comment 49"');
});
it("creates the same portable context card for project and Mono composers", () => {
  const item = {
    provider: "jira",
    kind: "jira",
    identifier: "DEMO-42",
    title: "Demo ticket",
    url: urls.jira,
    labels: [],
    repo: "DEMO",
    number: 42,
  } as unknown as InboxItem;
  const card = ticketComposerCard(item, "Older body");
  expect(card.prompt).toContain(link("jira"));
  expect(card.prompt).toContain("Demo ticket");
  expect(card.prompt).not.toContain("Older body");
});
