import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "jira-context.spec.ts",
  webServer: {
    ...base.webServer,
    reuseExistingServer: true,
  },
});
