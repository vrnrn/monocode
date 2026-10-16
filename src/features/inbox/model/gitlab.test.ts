import { expect, it } from "vitest";
import { gitlabPipelineSummary } from "./gitlab";

it.each([
  ["success", "passed"],
  ["failed", "failed"],
  ["running", "running"],
  ["pending", "running"],
  ["created", "running"],
  ["waiting_for_resource", "running"],
  ["preparing", "running"],
  ["waiting_for_callback", "running"],
  [" FAILED ", "failed"],
  ["canceled", null],
  ["skipped", null],
  ["manual", null],
  ["", null],
  [undefined, null],
])("summarizes pipeline status %j as %j", (status, summary) =>
  expect(gitlabPipelineSummary(status)).toBe(summary),
);
