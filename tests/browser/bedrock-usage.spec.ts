import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`${theme}: Bedrock replaces the disconnected state`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/tests/browser/bedrock-usage.html?theme=${theme}`);
    const chip = page.getByRole("button", {
      name: "Claude Code usage details",
    });
    await expect(chip).toHaveText("AWS Bedrock");
    await chip.click();
    await expect(page.getByRole("dialog")).toContainText("AWS Bedrock");
    await expect(
      page.getByText("Authentication required", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("not connected", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Sign in to Claude Code" }),
    ).toHaveCount(0);
    if (testInfo.project.name === "chromium")
      await page.screenshot({ path: testInfo.outputPath("bedrock-usage.png") });
  });
}
