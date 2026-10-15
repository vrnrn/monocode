/** The agent CLIs supported by both the desktop and the remote host. */
export const HARNESSES = [
  "claude",
  "codex",
  "pi",
  "omp",
  "antigravity",
] as const;

export type HarnessId = (typeof HARNESSES)[number];

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && HARNESSES.includes(value as HarnessId);
}
