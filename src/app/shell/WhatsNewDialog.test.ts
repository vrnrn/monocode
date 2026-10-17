import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatsNewBody } from "./WhatsNewDialog";
import { releaseNotesLoader } from "../model/releaseNotesLoader";

describe("WhatsNewBody", () => {
  it("renders the version notes without the changelog heading", async () => {
    await releaseNotesLoader.load("0.1.25");
    const markup = renderToStaticMarkup(
      createElement(WhatsNewBody, { version: "0.1.25" }),
    );

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain("What&#x27;s new in vorkspace 0.1.25");
    expect(markup).not.toContain("## [0.1.25]");
  });
});
