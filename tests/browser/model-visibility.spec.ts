import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  for (const width of [1000, 560]) {
    test(`${theme}, ${width}px: hide and restore Luna from provider settings`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(() => {
        localStorage.setItem(
          "monocode.favoriteModels",
          JSON.stringify(["codex:gpt-5.6-luna", "codex:gpt-6.1-sol"]),
        );
        localStorage.setItem(
          "monocode.recentModels",
          JSON.stringify([
            { harness: "codex", model: "codex:gpt-5.6-luna" },
            { harness: "codex", model: "codex:gpt-6.1-sol" },
          ]),
        );
      });
      const url = `/tests/browser/cli-providers.html?theme=${theme}`;
      await page.goto(url);
      const trigger = page.getByRole("button", {
        name: "Choose visible Codex models",
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "Codex model visibility",
        exact: true,
      });
      const search = dialog.getByRole("textbox", {
        name: "Search Codex models",
      });
      await search.fill("5.6");
      await expect(dialog.getByRole("menuitemcheckbox")).toHaveCount(1);
      const luna = dialog.getByRole("menuitemcheckbox", {
        name: "GPT-5.6 Luna",
        exact: true,
      });
      await expect(luna).toHaveAttribute("aria-checked", "true");
      await search.press("ArrowDown");
      await expect(luna).toBeFocused();
      await luna.press("Space");
      await expect(luna).toHaveAttribute("aria-checked", "false");
      await search.fill("not a model");
      await expect(dialog.getByText("No matching models.")).toBeVisible();
      await search.fill("");
      if (testInfo.project.name === "chromium")
        await page.screenshot({
          path: testInfo.outputPath("model-visibility.png"),
        });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toContainText("2/3");
      await page.reload();
      await trigger.click();
      await expect(
        dialog.getByRole("menuitemcheckbox", {
          name: "GPT-5.6 Luna",
          exact: true,
        }),
      ).toHaveAttribute("aria-checked", "false");
      await page.goto(`${url}&view=picker`);
      const picker = page.getByRole("button", {
        name: "Codex GPT-5.6 Luna",
        exact: true,
      });
      await expect(picker).toBeVisible(); // Existing chats retain their selected model.
      await picker.click();
      await expect(
        page.getByRole("option", { name: /GPT-5\.6 Luna/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("option", { name: /GPT-6\.1 Sol/ }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Favorites", exact: true }).hover();
      await expect(page.getByRole("option", { name: /Luna/ })).toHaveCount(0);
      await expect(
        page.getByRole("option", { name: /GPT-6.1 Sol/ }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await picker.click({ button: "right" });
      await expect(
        page.getByRole("menuitemradio", { name: /Luna/ }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("menuitemradio", { name: /GPT-6.1 Sol/ }),
      ).toBeVisible();
      await page.goto(url);
      await trigger.click();
      await dialog
        .getByRole("button", { name: "Show all", exact: true })
        .click();
      await expect(
        dialog.getByRole("menuitemcheckbox", {
          name: "GPT-5.6 Luna",
          exact: true,
        }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("project choices inherit global hiding and remain independent of other projects", async ({
  page,
}) => {
  await page.goto("/tests/browser/cli-providers.html");
  const trigger = page.getByRole("button", {
    name: "Choose visible Codex models",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Codex model visibility",
    exact: true,
  });
  await trigger.click();
  await dialog
    .getByRole("menuitemcheckbox", { name: "GPT-5.6 Luna", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", {
      name: "Provider defaults scope: Global",
      exact: true,
    })
    .click();
  await page.getByRole("option", { name: "repo", exact: true }).click();
  await trigger.click();
  await expect(
    dialog.getByRole("menuitemcheckbox", { name: /GPT-5.6 Luna/ }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Hidden globally", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("menuitemcheckbox", { name: "GPT-6.1 Sol", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(trigger).toContainText("1/3");
  await page.goto(
    "/tests/browser/cli-providers.html?view=picker&project=/repo",
  );
  await page
    .getByRole("button", { name: "Codex GPT-5.6 Luna", exact: true })
    .click();
  await expect(page.getByRole("option", { name: /Luna|Sol/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /GPT-6 Astra/ })).toBeVisible();
  await page.goto(
    "/tests/browser/cli-providers.html?view=picker&project=/other",
  );
  await page
    .getByRole("button", { name: "Codex GPT-5.6 Luna", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: /GPT-6\.1 Sol/ }),
  ).toBeVisible();
});
