import type { InboxItem } from "./githubTasks";
import { jiraIssueDetails, peekJiraIssueDetails } from "./jira";

/** Load tracker context before opening a session, including from list actions. */
export async function inboxTrackerDescription(
  item: InboxItem,
  body?: string,
): Promise<string | undefined> {
  if (item.provider !== "jira") return body;
  if (body !== undefined) return body;
  const key = item.identifier?.trim();
  if (!key) throw new Error("Missing Jira issue key");
  return (peekJiraIssueDetails(key) ?? (await jiraIssueDetails(key))).body;
}
