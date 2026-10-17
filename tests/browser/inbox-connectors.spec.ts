import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [1000, 560]) {
    test(`${theme}, ${width}px: Inbox settings offer only GitHub, GitLab and Jira`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1050 });
      await page.goto(`/tests/browser/inbox-connectors.html?theme=${theme}`);
      const switches = page.getByRole("switch", { name: /inbox connector$/ });
      await expect(switches).toHaveCount(3);
      for (const provider of ["GitHub", "GitLab", "Jira"]) {
        await expect(
          page.getByRole("heading", { name: provider, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("switch", {
            name: `Enable ${provider} inbox connector`,
          }),
        ).toHaveAttribute("aria-checked", "true");
      }
      await expect(
        page.getByRole("button", {
          name: "Filter tickets by: Project",
          exact: true,
        }),
      ).toBeVisible();
      if (testInfo.project.name === "chromium")
        await page.screenshot({
          path: testInfo.outputPath("inbox-connectors.png"),
        });
      await page
        .getByRole("switch", { name: "Enable GitLab inbox connector" })
        .click();
      await expect(
        page.getByRole("switch", { name: "Enable GitLab inbox connector" }),
      ).toHaveAttribute("aria-checked", "false");
      await expect(
        page.getByText("Saved connection details are kept.", { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}
