import { describe, expect, it } from "vitest";
import type { OutputBundle, OutputChunk } from "rollup";
import { build } from "vite";
import {
  acquireWarningGuard,
  checkBundleBudget,
  moduleFingerprint,
  strictBuildPlugin,
  strictLogger,
} from "../scripts/buildBudgets";

function chunk(
  name: string,
  size: number,
  modules: string[] = ["/src/ordinary.ts"],
  imports: string[] = [],
): OutputChunk {
  return {
    type: "chunk",
    name,
    fileName: `${name}.js`,
    code: "x".repeat(size),
    imports,
    modules: Object.fromEntries(modules.map((id) => [id, {}])),
  } as OutputChunk;
}
const bundle = (...chunks: OutputChunk[]): OutputBundle =>
  Object.fromEntries(chunks.map((entry) => [entry.fileName, entry]));

describe("production artifact budgets", () => {
  it("normalizes exact roots after virtual markers without dropping their identity", () => {
    const virtual = moduleFingerprint(
      ["\0/repo/src/entry.ts?commonjs-proxy"],
      "/repo",
    );
    expect(virtual).toBe(
      moduleFingerprint(
        ["\0/home/dev/src/vorkspace/src/entry.ts?commonjs-proxy"],
        "/home/dev/src/vorkspace",
      ),
    );
    expect(virtual).not.toBe(
      moduleFingerprint(["/repo/src/entry.ts?commonjs-proxy"], "/repo"),
    );
  });
  it("caps composite artifacts and invalidates exceptions when module membership changes", () => {
    const modules = ["/repo/src/one.ts", "/repo/node_modules/two/index.js"];
    const allowed = [
      {
        name: "reviewed composite",
        fingerprint: moduleFingerprint(modules, "/repo"),
        limit: 600_000,
      },
    ];
    expect(() =>
      checkBundleBudget(
        bundle(chunk("application", 600_000, modules)),
        false,
        allowed,
        "/repo",
      ),
    ).not.toThrow();
    expect(() =>
      checkBundleBudget(
        bundle(chunk("application", 600_001, modules)),
        false,
        allowed,
        "/repo",
      ),
    ).toThrow("600000");
    expect(() =>
      checkBundleBudget(
        bundle(chunk("application", 600_000, [...modules, "/src/new.ts"])),
        false,
        allowed,
        "/repo",
      ),
    ).toThrow("exact reviewed module set");
    expect(moduleFingerprint(modules, "/repo")).toBe(
      moduleFingerprint(
        [
          "/home/dev/src/vorkspace/node_modules/two/index.js",
          "/home/dev/src/vorkspace/src/one.ts",
        ],
        "/home/dev/src/vorkspace",
      ),
    );
  });
  it("rejects ordinary oversized code rather than hiding it behind a vendor ceiling", () => {
    expect(() =>
      checkBundleBudget(bundle(chunk("ordinary", 500_000)), false),
    ).not.toThrow();
    expect(() =>
      checkBundleBudget(bundle(chunk("ordinary", 500_001)), false),
    ).toThrow("500000");
  });
  it.each([
    ["/node_modules/react-material-icon-theme/dist/index.esm.js", 1_150_000],
    ["/node_modules/@shikijs/langs/dist/emacs-lisp.mjs", 800_000],
    ["/node_modules/emojibase-data/en/data.json", 800_000],
  ] as const)("limits the known generated artifact %s", (suffix, limit) => {
    expect(() =>
      checkBundleBudget(
        bundle(chunk("generated", limit, [`${process.cwd()}${suffix}`])),
        false,
      ),
    ).not.toThrow();
    expect(() =>
      checkBundleBudget(
        bundle(chunk("generated", limit + 1, [`${process.cwd()}${suffix}`])),
        false,
      ),
    ).toThrow("Bundle budget exceeded");
    expect(() =>
      checkBundleBudget(
        bundle(
          chunk("generated", limit, [
            `${process.cwd()}${suffix}`,
            "/src/hidden-extra.ts",
          ]),
        ),
        false,
      ),
    ).toThrow("exact reviewed module set");
  });
  it("counts a manually renamed App, follows static imports once, and excludes lazy bodies", () => {
    const deps = Array.from({ length: 6 }, (_, index) =>
      chunk(`dependency${index}`, 450_000),
    );
    const app = chunk(
      "renamed-app",
      10,
      ["/repo/src/app/App.tsx"],
      deps.map((entry) => entry.fileName),
    );
    const main = chunk(
      "main",
      10,
      ["/repo/src/main.tsx"],
      [app.fileName, deps[0].fileName],
    );
    expect(() =>
      checkBundleBudget(bundle(main, app, ...deps, chunk("lazy", 490_000))),
    ).not.toThrow();
    app.code += "x".repeat(40_000);
    expect(() => checkBundleBudget(bundle(main, app, ...deps))).toThrow(
      "Startup budget exceeded",
    );
  });
  it("rejects excessive startup sharding and optional modules made eager", () => {
    const app = chunk("app", 10, ["/repo/src/app/App.tsx"]);
    const main = chunk("main", 10, ["/repo/src/main.ts"], [app.fileName]);
    const optional = chunk("optional", 10, ["/repo/CHANGELOG.md?raw"]);
    app.imports = [optional.fileName];
    expect(() => checkBundleBudget(bundle(main, app, optional))).toThrow(
      "Optional feature became eager",
    );
    const shards = Array.from({ length: 20 }, (_, index) =>
      chunk(`shard${index}`, 1),
    );
    app.imports = shards.map((entry) => entry.fileName);
    expect(() => checkBundleBudget(bundle(main, app, ...shards))).toThrow(
      "Startup chunk budget exceeded",
    );
  });
});

describe("strict warning lifecycle", () => {
  it("rejects Rollup warnings emitted through Vite's normal logger policy", async () => {
    await expect(
      build({
        configFile: false,
        customLogger: strictLogger(),
        logLevel: "silent",
        plugins: [
          {
            name: "emitted-warning-fixture",
            buildStart() {
              this.warn("Emitted Rollup warning fixture");
            },
          },
        ],
        build: { write: false, rollupOptions: { input: "unused.js" } },
      }),
    ).rejects.toThrow("Emitted Rollup warning fixture");
  });
  it("fails a real late build warning and restores console.warn after rejection", async () => {
    const original = console.warn;
    await expect(
      build({
        configFile: false,
        logLevel: "silent",
        plugins: [
          strictBuildPlugin({ startup: false, budgets: false }),
          {
            name: "warning-fixture",
            resolveId: (id) => (id === "virtual:warning-fixture" ? id : null),
            load: (id) =>
              id === "virtual:warning-fixture"
                ? "export const value = 1"
                : null,
            renderChunk() {
              console.warn("CSS optimizer warning fixture");
            },
          },
        ],
        build: {
          write: false,
          rollupOptions: { input: "virtual:warning-fixture" },
        },
      }),
    ).rejects.toThrow("CSS optimizer warning fixture");
    expect(console.warn).toBe(original);
  });
  it("keeps direct console warnings fatal until every concurrent build has released ownership", () => {
    const original = console.warn;
    const first = acquireWarningGuard();
    const second = acquireWarningGuard();
    try {
      expect(() => console.warn("CSS warning")).toThrow("CSS warning");
      first();
      first();
      expect(() => console.warn("worker warning")).toThrow("worker warning");
    } finally {
      second();
      first();
    }
    expect(console.warn).toBe(original);
  });
  it("restores console.warn after an errored build and successful close", () => {
    const original = console.warn;
    const plugin = strictBuildPlugin();
    (plugin.buildStart as () => void)();
    (plugin.buildEnd as (error: Error) => void)(new Error("failure"));
    expect(console.warn).toBe(original);
    (plugin.buildStart as () => void)();
    (plugin.buildStart as () => void)();
    (plugin.closeBundle as () => void)();
    expect(console.warn).toBe(original);
  });
  it("fails Vite and Rollup warnings instead of filtering their messages", () => {
    expect(() => strictLogger().warn("Vite warning")).toThrow("Vite warning");
    expect(() => strictLogger().warnOnce("Vite once")).toThrow("Vite once");
  });
});
