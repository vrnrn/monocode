import { expect, test } from "@playwright/test";

test("native transcript search styles are installed and remain valid in the browser", async ({
  page,
}) => {
  await page.goto("/tests/browser/transcript.html");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { findTranscript?: unknown })
        .findTranscript === "function",
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        findTranscript: (id: string, query: string) => void;
      }
    ).findTranscript("reply-19", "settled answer"),
  );
  const styles = page.locator("#monocode-transcript-search-highlight-styles");
  await expect(styles).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const style = document.getElementById(
          "monocode-transcript-search-highlight-styles",
        ) as HTMLStyleElement;
        const selectors = [...(style.sheet?.cssRules ?? [])].map(
          (rule) => (rule as CSSStyleRule).selectorText,
        );
        const registry = (
          CSS as unknown as { highlights: Map<string, Set<Range>> }
        ).highlights;
        return {
          selectors,
          matches:
            (registry.get("monocode-transcript-search-match")?.size ?? 0) > 0,
          current:
            (registry.get("monocode-transcript-search-current")?.size ?? 0) > 0,
        };
      }),
    )
    .toEqual({
      selectors: [
        "::highlight(monocode-transcript-search-match)",
        "::highlight(monocode-transcript-search-current)",
      ],
      matches: true,
      current: true,
    });
  await page.evaluate(() =>
    (
      window as unknown as {
        findTranscript: (id: string | null, query?: string) => void;
      }
    ).findTranscript(null),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has(
          "monocode-transcript-search-current",
        ),
      ),
    )
    .toBe(false);
  await expect(styles).toHaveCount(1);
});
