import { describe, expect, it, vi } from "vitest";
import { createReleaseNotesLoader } from "./releaseNotesLoader";

const changelog = "## [0.1.2]\n\nNew release.\n\n## [0.1.1]\n\nOlder release.";

describe("optional release note bodies", () => {
  it("does no eager read and shares one import across different versions", async () => {
    let finish!: (value: string) => void;
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const loader = createReleaseNotesLoader(read);
    expect(loader.get("0.1.1")).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    const newer = loader.load("0.1.2");
    const older = loader.load("0.1.1");
    expect(read).toHaveBeenCalledOnce();
    finish(changelog);
    expect((await newer)?.markdown).toContain("New release.");
    expect((await older)?.markdown).toContain("Older release.");
    expect(loader.get("0.1.1")?.source.version).toBe("0.1.1");
    expect(await loader.load("missing")).toBeNull();
    expect(read).toHaveBeenCalledOnce();
  });

  it("retries an import failure instead of caching the rejection", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(changelog);
    const loader = createReleaseNotesLoader(read);
    await expect(loader.load("0.1.1")).rejects.toThrow("offline");
    expect(loader.get("0.1.1")).toBeUndefined();
    expect((await loader.load("0.1.1"))?.markdown).toContain("Older release.");
    expect(read).toHaveBeenCalledTimes(2);
  });
});
