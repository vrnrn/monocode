import { createHash } from "node:crypto";
import { createLogger, type Plugin } from "vite";
import type { OutputBundle, OutputChunk } from "rollup";

export const ORDINARY_CHUNK_BYTES = 500_000;
export const STARTUP_BYTES = 2_739_500;
export const STARTUP_CHUNKS = 12;
export type ArtifactBudget = {
  name: string;
  fingerprint: string;
  limit: number;
};
// Exact module sets, not emitted filenames; new modules invalidate an exception.
export const ARTIFACT_BUDGETS: ArtifactBudget[] = [
  {
    name: "worker inline Oniguruma WASM",
    fingerprint:
      "8da0076e36e2fc624eabd871c8c57d6744c82de09fa0319181f28a4716d3c250",
    limit: 640_000,
  },
  {
    name: "index.esm",
    fingerprint:
      "5be8c12019f886b9c6f6f0cf48d62a143aa13553f2bcb4904558270149f854c8",
    limit: 1150000,
  },
  {
    name: "emacs-lisp",
    fingerprint:
      "1e98af8ac1158eb5dfe8bbf9dfa4bd592367ed9837d6526c99029455f4450a6d",
    limit: 800000,
  },
  {
    name: "data",
    fingerprint:
      "215464383c604146eabb55f77d1857b22f77ceb2085219d40f6a10cf5ebb0541",
    limit: 800000,
  },
  {
    name: "cpp",
    fingerprint:
      "d2ce9e7f336c801bd37e035c5c2dc464e873d792279d595b18812806b7e6d3ba",
    limit: 640000,
  },
  {
    name: "mermaid.core",
    fingerprint:
      "fed5b271b44fedcce519683b057d82763c01d425dc678a4a795804186bbb4807",
    limit: 630000,
  },
  {
    name: "App",
    fingerprint:
      "c6c181900541c13ed9e3b0e2c64dcb2eec0553cfa94c63d0194f724a5e0a0b23",
    limit: 1125000,
  },
  {
    name: "mermaid-GHXKKRXX",
    fingerprint:
      "125db4cb8f6e909e0feb54813528b07166cee3bf435a429a152c3cb44dabb764",
    limit: 875000,
  },
  {
    name: "cynefin-VYW2F7L2",
    fingerprint:
      "928b9016f412e2e2f4e0dd087ef549acb5e5f89d81f9d9ab5b1db8632adba30b",
    limit: 700000,
  },
];
export function moduleFingerprint(ids: string[], root = process.cwd()) {
  const prefix = `${root.replace(/\\/g, "/").replace(/\/$/, "")}/`;
  const normalized = ids
    .map((id) => {
      const path = id.replace(/\\/g, "/");
      const marker = path.startsWith("\0") ? "\0" : "";
      const absolute = marker ? path.slice(1) : path;
      return (
        marker +
        (absolute.startsWith(prefix)
          ? `/${absolute.slice(prefix.length)}`
          : absolute)
      );
    })
    .sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex");
}
const bytes = (source: string) => new TextEncoder().encode(source).byteLength;

export function checkBundleBudget(
  bundle: OutputBundle,
  startup = true,
  exceptions = ARTIFACT_BUDGETS,
  root = process.cwd(),
) {
  const chunks = Object.values(bundle).filter(
    (output): output is OutputChunk => output.type === "chunk",
  );
  for (const chunk of chunks) {
    const size = bytes(chunk.code);
    if (size <= ORDINARY_CHUNK_BYTES) continue;
    const modules = Object.keys(chunk.modules);
    const exception = exceptions.find(
      (candidate) => candidate.fingerprint === moduleFingerprint(modules, root),
    );
    const limit = exception?.limit ?? ORDINARY_CHUNK_BYTES;
    if (size > limit)
      throw new Error(
        `Bundle budget exceeded: ${chunk.fileName} is ${size} bytes; limit ${limit}. Exceptions require an exact reviewed module set. Fingerprint ${moduleFingerprint(modules, root)}; modules ${modules.length <= 5 ? modules.join(", ") : modules.length}.`,
      );
  }
  if (!startup) return;
  const roots = chunks.filter(
    (chunk) =>
      chunk.name === "main" ||
      Object.keys(chunk.modules).some((id) =>
        id.replace(/\\/g, "/").endsWith("/src/app/App.tsx"),
      ),
  );
  if (
    !roots.some((chunk) => chunk.name === "main") ||
    !roots.some((chunk) =>
      Object.keys(chunk.modules).some((id) =>
        id.replace(/\\/g, "/").endsWith("/src/app/App.tsx"),
      ),
    )
  )
    throw new Error("Missing startup entries for bundle budget.");
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Set<string>();
  const visit = (chunk: OutputChunk) => {
    if (seen.has(chunk.fileName)) return;
    seen.add(chunk.fileName);
    for (const file of chunk.imports) {
      const dependency = byFile.get(file);
      if (dependency) visit(dependency);
    }
  };
  roots.forEach(visit);
  if (seen.size > STARTUP_CHUNKS)
    throw new Error(
      `Startup chunk budget exceeded: ${seen.size}; limit ${STARTUP_CHUNKS}.`,
    );
  for (const chunk of chunks) {
    if (!seen.has(chunk.fileName)) continue;
    for (const id of Object.keys(chunk.modules))
      if (
        /\/node_modules\/@codemirror\/|\/CHANGELOG\.md\?raw$|\/(?:WhatsNewDialog|MonoSettingsDialog|MonoChannelView)\.tsx$/.test(
          id.replace(/\\/g, "/"),
        )
      )
        throw new Error(`Optional feature became eager: ${id}`);
  }
  const size = chunks.reduce(
    (sum, chunk) => sum + (seen.has(chunk.fileName) ? bytes(chunk.code) : 0),
    0,
  );
  if (size > STARTUP_BYTES)
    throw new Error(
      `Startup budget exceeded: ${size} bytes; limit ${STARTUP_BYTES}.`,
    );
}

let warningOwners = 0;
let originalWarn: typeof console.warn | undefined;
const fatalConsoleWarning: typeof console.warn = (...args) => {
  throw new Error(`Build warning: ${args.map(String).join(" ")}`);
};

/** Tailwind's optimizer warns directly rather than through Vite's logger. */
export function acquireWarningGuard() {
  if (!warningOwners++) {
    originalWarn = console.warn;
    console.warn = fatalConsoleWarning;
  }
  let owned = true;
  return () => {
    if (!owned) return;
    owned = false;
    if (!--warningOwners) {
      console.warn = originalWarn!;
      originalWarn = undefined;
    }
  };
}

export function strictBuildPlugin({
  startup = true,
  budgets = true,
}: { startup?: boolean; budgets?: boolean } = {}): Plugin {
  let release: (() => void) | undefined;
  let root = process.cwd();
  return {
    name: "strict-build-budgets",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      release?.();
      release = acquireWarningGuard();
    },
    buildEnd(error) {
      if (error) release?.();
    },
    renderError() {
      release?.();
    },
    closeBundle() {
      release?.();
    },
    generateBundle(_options, bundle) {
      if (budgets) checkBundleBudget(bundle, startup, ARTIFACT_BUDGETS, root);
    },
  };
}

export function strictLogger() {
  const logger = createLogger();
  const fail = (message: string) => {
    throw new Error(`Build warning: ${message}`);
  };
  return { ...logger, warn: fail, warnOnce: fail };
}
