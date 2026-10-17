# Production build budgets

The production build fails on emitted Rollup/Vite warnings, direct optimizer warnings, and budget violations. Development logging is unchanged. `vite.config.ts` keeps the existing Rollup chunk layout: splitting the eager graph solely to meet a generic 500 kB heuristic increased startup requests from 10 to 94, without establishing a latency benefit. That experiment was rejected.

The generic Vite size heuristic is replaced by the stricter artifact checks in `scripts/buildBudgets.ts`. Its warning threshold matches the largest explicit artifact ceiling; it is not the limit for ordinary code. Every ordinary JavaScript chunk remains capped at **500,000 UTF-8 bytes** after minification. The following existing artifacts have reviewed exceptions:

| Artifact | Measured bytes | Ceiling | Reason |
| --- | ---: | ---: | --- |
| File icon SVG table | 1,129,836 | 1,150,000 | One generated upstream module; splitting it requires changing dependency representation |
| Workspace App | 1,112,982 | 1,125,000 | Existing application fan-in; preserve startup request/evaluation behavior |
| Shared transcript/Markdown renderer | 865,100 | 875,000 | Existing shared application/library graph; avoid artificial cyclic or highly fragmented chunks |
| Emacs Lisp grammar | 779,854 | 800,000 | One generated upstream grammar module |
| English emoji data | 775,206 | 800,000 | One generated upstream data module |
| Mermaid parser | 688,038 | 700,000 | Existing parser bundle and package helpers |
| C++ grammars | 626,081 | 640,000 | Existing grammar pair |
| Mermaid runtime | 619,618 | 630,000 | Existing diagram runtime and shared library modules |
| Worker Oniguruma WASM | 622,336 | 640,000 | Existing inline WASM data module and its Shiki facade |

Exceptions match SHA-256 fingerprints of the **complete sorted module ID set**, normalized by stripping the exact project root captured from Vite’s resolved configuration. They do not match a chunk filename, a loose package prefix, or the presence of one large module. Adding or removing any module invalidates the exception; code growth inside the same set still encounters its byte ceiling. Unrecognized oversized chunks fail. Review dependency/architecture changes and measure the resulting graph before updating a fingerprint or limit; do not automatically regenerate allowances to make a failing build green.

The union of `main` and the chunk containing `src/app/App.tsx`, recursively following static imports and counting each chunk once, is capped at **2,739,500 bytes and 12 chunks**. The measured pre-cleanup closure was **2,712,471 bytes in 10 chunks**; the byte ceiling allows less than 1% growth. CodeMirror, raw changelog bodies, and optional Mono/release-note dialogs are also forbidden in this eager closure. These checks protect deferred loading even if a future chunking change would otherwise reduce individual artifact sizes. Dynamic imports, CSS, images, and worker artifacts are excluded from the startup-byte total; worker JavaScript still receives individual artifact checks.

These are dependency delivery and retained-layout constraints, not evidence of launch-time or resident-memory improvements. A restored feature may legitimately load its deferred dependencies. Keep separate entry points and actual lazy features intact when changing build output.

## Warning handling and verification

The build uses a strict Vite logger while retaining Vite’s default Rollup diagnostic policy. Vite intentionally discards some non-emitted diagnostics, including pre-existing source-module cycle traces; those are not promoted into a separate refactoring requirement. Emitted Rollup warnings still reach the strict logger and fail the build. Tailwind's optimizer writes some warnings directly to `console.warn`, so a build-scoped guard makes those warnings fatal as well. Main and worker builds share reference-counted ownership; the original function is restored after completion or failure. No runtime application logging is patched. `vite` command-line arguments and production/benchmark mode selection continue through the normal Vite configuration.

Run `npm run build` for the release graph. `src/buildBudgets.test.ts` covers ordinary and reviewed limits, unknown/changed module sets, startup bytes and request counts, forbidden eager features, direct late-build warnings, and cleanup across overlapping/erroring builds. The warning fixture deliberately emits a warning during a real Vite build and must reject rather than merely leave a warning in a log.

Benchmark-only modes (`benchmark` and `benchmark-profile`) keep emitted/direct warnings fatal but skip release artifact and startup budgets. Their fixture routing and profiling React aliases intentionally produce a different, non-shipped module graph. Do not use that exemption in release modes or report instrumented sizes as production evidence.
