import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`older hosts keep files readable without allowing unchecked edits (${theme})`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/reliability.html?view=legacy-editor&theme=${theme}`,
    );
    const editor = page.locator(".cm-content");
    await expect(editor).toHaveText("original");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(
      page.getByRole("button", { name: "Open Connections" }),
    ).toBeVisible();
    await editor.press("ControlOrMeta+s");
    expect(
      await page.evaluate(() => Reflect.get(window, "reliability").disk()),
    ).toBe("original\r\n");
    await page.screenshot({
      path: test.info().outputPath("older-host-editor.png"),
    });
  });

  test(`editor preserves the disk and draft on conflict (${theme})`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/reliability.html?view=editor&theme=${theme}`,
    );
    const editor = page.locator(".cm-content");
    await expect(editor).toHaveText("original");
    await editor.fill("my draft\n");
    await page.evaluate(() =>
      Reflect.get(window, "reliability").externalEdit("external edit\r\n"),
    );
    await editor.press("ControlOrMeta+s");
    await expect(page.getByRole("alert")).toContainText("changed on disk");
    await expect(editor).toHaveText("my draft");
    expect(
      await page.evaluate(() => Reflect.get(window, "reliability").disk()),
    ).toBe("external edit\r\n");
    await page.screenshot({
      path: test.info().outputPath("editor-conflict.png"),
    });
    await page.getByRole("button", { name: "Reload from disk" }).click();
    await expect(editor).toHaveText("external edit");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test(`unsent input survives reload and a conflicting draft stays inspectable (${theme})`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/reliability.html?view=draft&theme=${theme}`,
    );
    const message = page.getByRole("textbox", { name: "Message" });
    await message.fill("Unsent message 👋");
    await page.evaluate(() => Reflect.get(window, "reliability").flush());
    await page.reload();
    await expect(message).toHaveValue("Unsent message 👋");
    await page.evaluate(() =>
      Reflect.get(window, "reliability").externalDraft(
        "Another window's draft",
      ),
    );
    await message.fill("Current window's draft");
    await page.evaluate(() =>
      Reflect.get(window, "reliability")
        .flush()
        .catch(() => undefined),
    );
    await page.getByText("Compare drafts", { exact: true }).click();
    await expect(
      page.getByText("Another window's draft", { exact: true }),
    ).toBeVisible();
    await expect(message).toHaveValue("Current window's draft");
    await page.screenshot({
      path: test.info().outputPath("draft-conflict.png"),
    });
    await page.getByRole("button", { name: "Restore saved draft" }).click();
    await expect(message).toHaveValue("Another window's draft");
    await page.getByRole("button", { name: "Clear message" }).click();
    await page.evaluate(() => Reflect.get(window, "reliability").flush());
    await page.reload();
    await expect(message).toHaveValue("");
  });
}
