import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [1000, 480]) {
    test(`${theme}, ${width}px: dropdown hides Jira notification rows and restores them`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 850 });
      await page.goto(
        `/tests/browser/jira-filter-settings.html?theme=${theme}`,
      );
      const notifications = page.getByRole("region", {
        name: "Project notifications",
      });
      await expect(
        notifications.getByRole("button", {
          name: "Notification categories for Engineering",
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Filter tickets by: Project",
          exact: true,
        })
        .click();
      const list = page.getByRole("listbox", { name: "Filter tickets by" });
      await expect(list).toBeFocused();
      await expect(
        page.getByRole("option", { name: "Project", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      if (testInfo.project.name === "chromium")
        await page.screenshot({ path: testInfo.outputPath("dropdown.png") });
      await list.press("ArrowDown");
      await list.press("Enter");
      await expect(
        page.getByRole("button", {
          name: "Filter tickets by: JQL",
          exact: true,
        }),
      ).toBeFocused();
      await expect(
        page.getByRole("textbox", { name: "JQL query" }),
      ).toHaveValue("project = ENG");
      await expect(notifications).not.toContainText("Engineering");
      await expect(notifications).not.toContainText("Support");
      await expect(notifications).toContainText("Demo repository");
      await expect(
        page.getByRole("button", { name: "Refresh projects", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("monocode.jiraInboxFilter")!).mode,
        ),
      ).toBe("project");
      await page
        .getByRole("button", { name: "Apply JQL", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText("JQL query applied.");
      if (testInfo.project.name === "chromium")
        await page.screenshot({
          path: testInfo.outputPath("jql-settings.png"),
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Filter tickets by: JQL", exact: true })
        .click();
      await page.getByRole("option", { name: "Project", exact: true }).click();
      await expect(
        notifications.getByRole("button", {
          name: "Notification categories for Engineering",
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Refresh projects", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test("saved JQL mode opens with no Jira notification project rows", async ({
  page,
}) => {
  await page.goto("/tests/browser/jira-filter-settings.html?mode=jql");
  await expect(
    page.getByRole("button", { name: "Filter tickets by: JQL", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Project notifications" }),
  ).not.toContainText("Engineering");
  await expect(page.getByRole("textbox", { name: "JQL query" })).toHaveValue(
    "project = ENG",
  );
});
