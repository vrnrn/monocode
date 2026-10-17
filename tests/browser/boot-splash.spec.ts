import { expect, test, type Page } from "@playwright/test";

type Reveal = {
  decoded: boolean;
  splashPresent: boolean;
  workspaceReady: boolean;
};
type Preferences = {
  effect?: string;
  theme?: "dark" | "light";
  suspendFrames?: boolean;
};
type RenderEffect = "dither" | "ascii" | "halftone" | "scanlines";

async function prepare(page: Page, preferences: Preferences = {}) {
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.addInitScript(({ effect, theme, suspendFrames }) => {
    if (effect !== undefined)
      localStorage.setItem("monocode.newThreadBackgroundEffect", effect);
    if (theme) localStorage.setItem("monocode.colorScheme", theme);
    const reveals: Reveal[] = [];
    Object.assign(window, {
      isTauri: true,
      __splashReveals: reveals,
      __splashDecoded: false,
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command !== "reveal_launch_window") return;
          reveals.push({
            decoded: Reflect.get(window, "__splashDecoded"),
            splashPresent: !!document.getElementById("boot-splash"),
            workspaceReady:
              !!document.getElementById("root")?.childElementCount,
          });
        },
      },
    });
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      Reflect.set(window, "__splashDecoded", true);
    };
    if (suspendFrames) window.requestAnimationFrame = () => 0;
  }, preferences);
}

async function reveals(page: Page): Promise<Reveal[]> {
  return page.evaluate(() => Reflect.get(window, "__splashReveals"));
}

async function delayArtwork(page: Page) {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/vorkspace-splash.png", async (route) => {
    await pending;
    await route.continue();
  });
  return release;
}

async function appearanceHashes(
  page: Page,
  effect: RenderEffect,
  light: boolean,
) {
  return page.evaluate(
    async ({ effect, light }) => {
      // @ts-expect-error Served directly by the browser test's Vite server.
      const { prepareNewThreadBackgroundEffect } =
        await import("/src/features/settings/model/newThreadBackgroundEffects.ts");
      const source = new URL("/vorkspace-splash.png", location.href).href;
      const blob = await prepareNewThreadBackgroundEffect(
        source,
        source,
        effect,
        light,
      );
      const reference = new Image();
      const objectUrl = URL.createObjectURL(blob);
      reference.src = objectUrl;
      const original = new Image();
      original.src = source;
      await Promise.all([reference.decode(), original.decode()]);
      async function hash(image: HTMLImageElement) {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const digest = await crypto.subtle.digest("SHA-256", pixels);
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      }
      const actual =
        document.querySelector<HTMLImageElement>("#boot-splash img")!;
      const hashes = await Promise.all([
        hash(actual),
        hash(reference),
        hash(original),
      ]);
      URL.revokeObjectURL(objectUrl);
      return hashes;
    },
    { effect, light },
  );
}

test("launch waits for the prepared effect to decode", async ({ page }) => {
  await prepare(page);
  const release = await delayArtwork(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  expect(await reveals(page)).toEqual([]);
  release();
  await expect
    .poll(() => reveals(page))
    .toEqual([{ decoded: true, splashPresent: true, workspaceReady: false }]);
  const image = page.locator("#boot-splash img");
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("#boot-splash")).toHaveAttribute(
    "data-effect",
    "dither",
  );
  await expect(image).toHaveCSS("filter", "none");
  await expect(image).toHaveCSS("object-fit", "cover");
  expect(await image.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
  });
});

test("a ready workspace opens without waiting for the splash effect", async ({
  page,
}) => {
  await prepare(page);
  const release = await delayArtwork(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.getElementById("boot-splash")!.dataset.uiReady = "1";
    document.getElementById("root")!.innerHTML = "<main>Workspace</main>";
    document.dispatchEvent(new Event("vorkspace:workspace-ready"));
  });
  await expect
    .poll(() => reveals(page))
    .toEqual([{ decoded: false, splashPresent: false, workspaceReady: true }]);
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  release();
});

test("a hidden webview with suspended frames still reveals once", async ({
  page,
}) => {
  await prepare(page, { suspendFrames: true });
  await page.goto("/", { waitUntil: "load" });
  await expect
    .poll(() => reveals(page))
    .toEqual([{ decoded: true, splashPresent: true, workspaceReady: false }]);
});

test("an unavailable image cannot strand the launch window", async ({
  page,
}) => {
  await prepare(page);
  await page.route("**/vorkspace-splash.png", (route) => route.abort());
  await page.goto("/", { waitUntil: "load" });
  await expect
    .poll(() => reveals(page))
    .toEqual([{ decoded: false, splashPresent: true, workspaceReady: false }]);
});

for (const [saved, effect, theme] of [
  ["none", "dither", "dark"],
  ["gradient-blur", "dither", "dark"],
  ["dither", "dither", "dark"],
  ["ascii", "ascii", "dark"],
  ["halftone", "halftone", "dark"],
  ["scanlines", "scanlines", "dark"],
  ["invalid", "dither", "dark"],
  ["ascii", "ascii", "light"],
] as const) {
  test(`${saved}, ${theme}: splash matches the appearance renderer's ${effect} pixels`, async ({
    page,
  }, testInfo) => {
    await prepare(page, { effect: saved, theme });
    await page.goto("/", { waitUntil: "load" });
    await expect.poll(async () => (await reveals(page)).length).toBe(1);
    await expect(page.locator("#boot-splash")).toHaveAttribute(
      "data-effect",
      effect,
    );
    const [actual, reference, original] = await appearanceHashes(
      page,
      effect,
      theme === "light",
    );
    expect(actual).toBe(reference);
    expect(actual).not.toBe(original);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("monocode.newThreadBackgroundEffect"),
      ),
    ).toBe(saved);
    if (saved === "none" && testInfo.project.name === "webkit") {
      await page.screenshot({ path: testInfo.outputPath("splash-dither.png") });
    }
  });
}

test("a stalled worker falls back instead of hiding the window forever", async ({
  page,
}) => {
  await prepare(page);
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/", { waitUntil: "load" });
  await expect
    .poll(() => reveals(page))
    .toEqual([{ decoded: true, splashPresent: true, workspaceReady: false }]);
  await expect(page.locator("#boot-splash")).toHaveAttribute(
    "data-effect",
    "none",
  );
});
