import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [1000, 560]) {
    test(`${theme}, ${width}px: only the five retained agent CLIs are configurable`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/browser/cli-providers.html?theme=${theme}`);
      const group = page.locator("#setting-agent-clis");
      await expect(
        group.getByRole("heading", { name: "Agent CLIs", exact: true }),
      ).toBeVisible();
      const details = group.getByRole("button", {
        name: /^Show .* CLI details$/,
      });
      await expect(details).toHaveCount(5);
      for (const provider of [
        "Claude Code",
        "Codex",
        "Pi",
        "omp",
        "Antigravity",
      ])
        await expect(
          group.getByRole("button", {
            name: `Show ${provider} CLI details`,
            exact: true,
          }),
        ).toBeAttached();
      expect(await group.innerText()).not.toMatch(
        /Cursor|Grok Build|OpenCode|Hermes|Devin|fx CLI/,
      );
      const toggle = group.getByRole("switch", {
        name: "Show Pi in the model picker",
        exact: true,
      });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await page.reload();
      await expect(
        group.getByRole("switch", {
          name: "Show Pi in the model picker",
          exact: true,
        }),
      ).toHaveAttribute("aria-checked", "false");
      await group.scrollIntoViewIfNeeded();
      if (testInfo.project.name === "chromium")
        await group.screenshot({
          path: testInfo.outputPath("cli-providers.png"),
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
