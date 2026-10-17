import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptySession } from "./EmptySession";

describe("empty session", () => {
  it("keeps the prompt and composer in a still workspace", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        composer: createElement("textarea", { "aria-label": "Message" }),
      }),
    );

    expect(markup).toContain("What should we work on");
    expect(markup).toContain('aria-label="Message"');
    expect(markup).not.toContain("<canvas");
  });
});
