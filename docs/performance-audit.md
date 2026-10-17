# Performance audit and optimization proposals

Reviewed October 17, 2026 and reconciled with main `b55a4720` after PR #26. This pass implements the five approved follow-through changes, alongside the smaller startup, transcript-grouping, and search optimizations. Existing reader anchors, worker ownership, memory budgets, submission recovery, and lazy tool-output behavior remain part of the contract.

The strongest measured improvement is remote-host initialization with substantial idle history. Desktop startup also loads less JavaScript. Neither measurement establishes a whole-app launch-time or steady-state RAM improvement; those require a matched packaged-app workload including the native process, webviews, and provider children.

## What main already implements

| Original opportunity | Status after PR #26 | Remaining scope |
| --- | --- | --- |
| Memory budgets for retained conversations | Frontend parked and loaded-session caches already have budgets | This change adds the remote-host snapshot budget; profile hosted panes separately |
| Reduce offscreen history work | Partly implemented: measured placeholders remove offscreen content from layout, and paged history trims after returning to the end | Detached content retains DOM/React state; consider deeper unmounting only if retained memory remains material |
| Save ordinary conversations incrementally | Not implemented by PR #26 | Implemented here using block rows and revision fencing; omitted output is preserved |
| Move independent startup work later | Single-session restoration already exposes stored content before optional log repairs | This change extends that split to boot and defers optional probes; native safety readiness keeps its ordering |
| Reduce background/streaming contention | Per-session subscriptions, worker highlighting/diffs, selected four-permit background reads, lower child priority and audio suspension are implemented | Measure the combined app before proposing another scheduling or worker layer |

The imported turn cache reuses settled prefixes but still groups the final merged Mono conversation, so the linear completion fix remains useful. Preserve per-session notification ordering, hidden-pane catch-up, immediate lifecycle flushes, reader bookmarks, and resource-pressure behavior.

See [upstream patch imports](upstream-imports.md) for the imported behavior and its existing validation limits.

## Implemented changes

| Area | Change | Evidence |
| --- | --- | --- |
| Remote-host startup | Read existing session summaries for provider bindings; load full snapshots only for running-session recovery or incomplete legacy summaries | Seven-process benchmark below; regression tests prove idle transcript text is not parsed and legacy binding metadata repairs once |
| Desktop startup | Route global editor search through a small synchronous command bridge; register CodeMirror callbacks when the editor module loads | CodeMirror view, state, and search disappear from the initial dependency closure; shortcut, preview, IME, and hidden-editor tests pass |
| Mono transcript grouping | Track the latest user start incrementally when merging completion runs | A deterministic 1,000-completion regression bounds work below 10,000 role reads; the former accumulated-history scan needed roughly 500,000 |
| Native content search | Borrow case-sensitive lines and prepare the query once per batch | Removes one line copy per case-sensitive fallback check and up to two query allocations per git-search result; indexed/fallback column tests preserve behavior |
| Host content search | Compile the escaped literal query once per request, then reuse it for line matching | Whole-word, case, and multi-line regression tests; no per-line query escaping or RegExp construction |

Sources: [host startup](../host/engine.ts), [summary loading](../host/store.ts), [editor command bridge](../src/features/files/editor/editorSearchCommands.ts), [transcript grouping](../src/features/sessions/model/transcriptActivity.ts), [native search](../src-tauri/src/search.rs), [host search](../host/workspace.ts).

### Host startup benchmark against current main

Workload: 200 idle sessions, each containing 262,144 ASCII transcript characters, for 50 MiB of transcript text. Each sample opens the same temporary SQLite database in a fresh Node process and constructs `HostStore` and `HostEngine`. Seven samples per variant alternate execution order. No provider processes are started. The database resides on the local filesystem with a warm OS cache.

Measured on Apple Silicon macOS with Node v26.3.1. Values are medians; heap growth is sampled immediately after construction, before another garbage collection. Peak RSS covers the worker process and is separate from heap growth.

| Metric | Before | After |
| --- | ---: | ---: |
| Store and engine construction | 50.47 ms | 12.07 ms |
| Characters passed to `JSON.parse` | 52,507,360 | 63,760 |
| Immediate JS heap growth | 100.38 MiB | 0.36 MiB |
| Peak worker RSS | 162.83 MiB | 56.00 MiB |

Run the isolated benchmark with:

```sh
node scripts/benchmark-host-startup.mjs \
  --baseline b55a47203f3cc6897dba9611beb72befff96b39e \
  --sessions 200 --chars 262144 --runs 7
```

The comparison substitutes only `host/engine.ts` and `host/store.ts` from the baseline revision, keeping dependencies and other helpers identical. It creates and deletes its own fixture; it never opens application data. Legacy rows without complete summaries still require a one-time snapshot read and repair. Running sessions still load and settle their snapshots without replaying provider sends. These seven-sample measurements were rerun against PR #26 with the combined host changes present. They do not measure provider launch or whole-app memory.

### Desktop startup dependency measurement

A Vite `generateBundle` inspection walked the static imports of both `main` and `App`, counting each emitted JavaScript chunk once. `main` starts loading `App` immediately and awaits it before the first render. CSS, image assets, and subsequent dynamic feature imports are excluded.

The comparison was rerun on main `b55a4720`, switching only App's editor-command import between main's direct import and our local bridge. The other local changes, including transcript grouping, are present in both builds.

| Metric | Before bridge | After bridge |
| --- | ---: | ---: |
| Minified JavaScript in startup closure | 3,187,550 bytes | 2,913,528 bytes |
| App chunk | 1,588,743 bytes | 1,314,721 bytes |
| CodeMirror packages in startup closure | view, state, search | none |

The local bridge still defers 274,022 bytes, or 8.6% of that JavaScript closure, until an editor or another feature using CodeMirror is opened. A restored editor will still load CodeMirror. Byte counts measure dependency delivery, not elapsed startup time or resident memory.

## Approved changes and remaining larger opportunities

### 1. Remote-host snapshot budget — implemented

The frontend already owns budgets for parked transcripts and recently loaded sessions. The [remote host store](../host/store.ts) now keeps its existing 32-entry LRU and adds a 16 MiB estimated retained-byte budget with an 8 MiB per-record admission cap. Individually oversized records bypass the cache. Active runs and pending operations retain their existing ownership.

The estimate is four bytes per serialized UTF-16 code unit, with a 4 KiB floor. It uses the JSON already read or serialized, avoiding another traversal. It is a policy estimate rather than an exact heap measurement. Hits only promote LRU order. Eviction, deletion, replacement, and transaction rollback share byte accounting. Tests exercise byte and entry limits, hot reads without parsing/serialization, oversized admission, and rollback.

The tradeoff is another parse when revisiting an evicted record. These initial budgets constrain the cache; packaged-host workloads should guide later tuning. Total app memory and reopen latency remain separate measurements.

### 2. Measure remaining history retention before deeper virtualization

[AgentTranscript](../src/features/sessions/ui/AgentTranscript.tsx) starts with a recent-turn window, normally 20 turns. It now trims paged-in history after the reader follows the end again, with guards for selection and search. [HistoryTurn](../src/features/sessions/ui/HistoryTurn.tsx) and [useMeasuredHistory](../src/features/sessions/ui/useMeasuredHistory.ts) preserve exact heights and detach offscreen children from layout. Search, selection and changed widths reveal or invalidate the affected measured content.

That solves a substantial part of the original proposal. Detached children still retain DOM and React state, so deeper unmounting could reduce memory during prolonged history browsing if profiling shows a remaining cost. It would be a separate, substantial change. Preserve the imported character bookmarks, completion/reflow anchors, stable portals, search reveal and cross-turn selection. Do not replace exact measured geometry with estimates without proving equivalent behavior.

Acceptance: compare the existing measured-history implementation with any prototype at 1,000 and 10,000 turns, including live output, selection, find, jump-to-turn, expansion, split panes and revisit. Measure retained heap as well as attached DOM/layout work; detachment and deallocation are different outcomes. Run the imported reader-anchor and completion tests in both WebKit and Chromium.

### 3. Ordinary session incremental persistence — implemented

The ordinary branch of [upsertSession](../src/features/sessions/data/sessionStore.ts) now compares immutable block references inside the existing per-session write queue. It sanitizes and sends only changed blocks plus ordered block IDs and the expected revision. The successful-save baseline advances only after the native acknowledgement. Mono retains its separate changed-suffix path.

The additive native schema stores ordinary block JSON independently from the session header. A legacy conversation normalizes on its first delta save inside the same SQLite transaction; conversion, ordering, deletions, metadata, and the new revision commit together. Normal updates inspect IDs and positions without reading unchanged transcript JSON. Updating an omitted tool result restores its existing full detail from that block's row. Compatibility full writes reconstruct normalized history before atomically returning to the legacy representation and invalidating the delta revision.

Reads, search, lazy tool detail, artifact ownership, orchestration cleanup, and attachment collection account for both representations. Revision mismatches fail instead of falling back to an unconditional full overwrite. This protects other windows and native writers; callers must reload an out-of-date conversation before attempting a conflicting save. The frontend still performs a linear reference/ID pass; the large JSON payload and changed-row writes follow changed content rather than total history. This is not constant-time persistence.

Regression tests cover a changed block among 100 unchanged 4 KiB tool results, omitted-detail read/save/reopen, reordering and rewind, full-writer compatibility, deletion, transaction rollback, stale writers on separate connections, and frontend write ordering. The row-write regression observes exactly one updated block with less than 5 KiB rewritten.

### 4. Optional startup work after presentation — implemented

Boot restoration now uses the receipt-checked [readSession](../src/features/sessions/data/sessionStore.ts) path. Interrupted-run markers still persist before the restored workspace is returned. Provider-log enrichment runs sequentially after presentation and idle scheduling, with cancellation and identity checks before publication. It does not persist its stale source; the current-state observer saves a valid merged repair.

The shared scheduler also defers provider availability/catalog probes, notification-permission warmup, and project-file prefetch. Scheduled work is cancelled when its owning effect ends. Optional failures do not prevent the restored workspace from opening. Tests control frame/idle scheduling, cancellation, hidden-window and WebKit fallbacks, sequential repairs, failure, metadata edits, and stale results.

Native migrations, unresolved-submission recovery, and worktree-removal reconciliation keep their safety ordering. Native orphan reaping and attachment cleanup already run in background threads; adding another readiness gate without measurements would duplicate existing work. Further native startup changes require per-phase timing on empty, heavy, and migration-required profiles, followed by matched packaged launch measurements.

## Smaller follow-ups

| Opportunity | Current cost and proposed next slice | Constraint |
| --- | --- | --- |
| Host filename index — implemented | Shared canonical-root cache: 1s TTL, 24 roots, 8 MiB estimated path weight, shared tracked in-flight scans | Supported file/Git mutations invalidate; old flights cannot republish after invalidation; external changes rely on expiry; Git ignore behavior retained |
| Plugin skill settings | [claude_plugin_enabled](../src-tauri/src/skills.rs) repeats ancestor discovery, settings reads, and managed drop-in parsing for each installed plugin | Read settings once per discovery invocation, preserving managed and project precedence and refreshing on the next invocation |
| Changelog loading — implemented | Lightweight titles/types stay synchronous; a retryable dynamic loader reads bodies only when requested | Hidden restored release tabs wait for visibility; stale version requests cannot publish |
| Optional Mono views — implemented | Settings, channels, and What's New use existing lazy-surface boundaries and request-scoped preload | Navigation waits for code before switching, failures retry, stale navigation is rejected, restored rendering has local Suspense |
| Session list lookup | [MonoSessionList](../src/features/monos/ui/MonoSessionList.tsx) repeatedly searches live/history arrays per launch and row | Build memoized ID indexes when profiling demonstrates scale; preserve first-match precedence |
| Long-lived UI maps | `storedSessions` in MonoSessionList, `mainCheckouts` and `sessionProjectsCache` in [MonoChangesView](../src/features/monos/ui/MonoChangesView.tsx), and `noteImageSrcCache` in [AgentMarkdown](../src/features/sessions/ui/AgentMarkdown.tsx) retain visited keys for the window lifetime | Define eviction and invalidation per cache; cached note URLs are strings, not evidence of retained decoded image buffers |
| Provider supervisor retention | [harness.rs](../src-tauri/src/harness.rs) still retains session epochs and uses several dedicated threads per active provider; resource monitoring, explicit process-stop controls and lower child priority are now implemented | Measure remaining thread count/stack RSS at high concurrency; removing epochs must retain protection against outstanding spawn races |

The native provider-output queue remains bounded to 16 MiB and 4,096 records per provider. Highlighting and large-diff preparation now use workers; text-only streaming skips workspace-shell notifications; hidden sessions retain their displayed snapshot and catch up on reveal. [background_work](../src-tauri/src/background_work.rs) limits selected background reads to four permits before they enter the blocking pool. These are implemented improvements to retain and measure, rather than new proposals. Search still uses its existing blocking path. Do not add a competing worker pool, generic hidden-tab disposal policy, or duplicate resource monitor.

## Validation and next profiling workload

The earlier validation below covers main `b55a4720` plus the initial five small optimizations. Final combined follow-through validation is recorded separately below before merge. The imported first-paint tests initially expired under concurrent builds because history now warms one turn per frame/timer cycle. Their tests now control that schedule and verify each growth step and scroll pinning, without changing runtime code or increasing timeouts.

| Check | Result |
| --- | --- |
| Web suite and TypeScript (`NODE_OPTIONS=--no-experimental-webstorage npm run check:web`) | 5,221 passed, 13 skipped; type check passed |
| Host build and full suite (`npm run test:host`) | 130 passed, 6 skipped |
| Rust suite (`cargo test`) | 654 passed, 1 ignored |
| Rust formatting and Clippy with `-D warnings` | Passed using the installed stable toolchain directly |
| Chromium and WebKit (`npm run test:browser`) | 162 passed, 2 optional release-benchmark cases skipped |
| Production Vite build and dependency inspection | Passed |
| Benchmark script syntax, isolated smoke run, and diff whitespace | Passed |

Node v26's experimental global web storage conflicts with the DOM test environment; the web checks disable that Node feature without changing application code. The automated checks establish behavior and build compatibility; the host benchmark and emitted dependency inspection supply the performance evidence above.

The browser run covers the imported completion, reader-position, history retention, tab revisit and real file-pane resizing behavior in both engines. It does not establish the separate release-mode navigation latency budget; that optional benchmark remains a profiling task.

The next whole-app profile should use matched release builds and an isolated fixture with an empty workspace, a long restored chat, a restored editor, multiple parked transcripts, four concurrent streams, and a large repository search. Record launch marks already emitted by `main`, aggregate RSS across native/webview/provider processes, heap snapshots after navigation and idle collection, input-to-paint delay, and p95 search latency. Use repeated runs on the same machine and keep startup and steady-state workloads separate.
