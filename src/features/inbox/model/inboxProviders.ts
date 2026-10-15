export const INBOX_PROVIDERS = ["github", "gitlab", "jira"] as const;
export type InboxProvider = (typeof INBOX_PROVIDERS)[number];

export function isInboxProvider(value: unknown): value is InboxProvider {
  return INBOX_PROVIDERS.some((provider) => provider === value);
}
