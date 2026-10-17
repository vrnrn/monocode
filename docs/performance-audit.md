# Performance follow-ups

The recent startup, persistence, transcript, search, and scheduling changes are complete. Their implementation details, tests, and historical measurements are available in the [0.13.7 performance audit](https://github.com/vrnrn/vorkspace/blob/mac-v0.13.7/docs/performance-audit.md). The opportunities below remain open; profile the relevant workload before expanding them.

## Measure remaining history retention before deeper virtualization

[AgentTranscript](../src/features/sessions/ui/AgentTranscript.tsx) starts with a recent-turn window, normally 20 turns. It trims paged-in history after the reader follows the end again, with guards for selection and search. [HistoryTurn](../src/features/sessions/ui/HistoryTurn.tsx) and [useMeasuredHistory](../src/features/sessions/ui/useMeasuredHistory.ts) preserve exact heights and detach offscreen children from layout. Search, selection and changed widths reveal or invalidate the affected measured content.

Detached children still retain DOM and React state, so deeper unmounting could reduce memory during prolonged history browsing if profiling shows a remaining cost. Preserve character bookmarks, completion/reflow anchors, stable portals, search reveal and cross-turn selection. Do not replace exact measured geometry with estimates without proving equivalent behavior.

Acceptance: compare the existing measured-history implementation with any prototype at 1,000 and 10,000 turns, including live output, selection, find, jump-to-turn, expansion, split panes and revisit. Measure retained heap as well as attached DOM/layout work; detachment and deallocation are different outcomes. Run the reader-anchor and completion tests in both WebKit and Chromium.

## Smaller follow-ups

| Opportunity | Current cost and proposed next slice | Constraint |
| --- | --- | --- |
| Plugin skill settings | [claude_plugin_enabled](../src-tauri/src/skills.rs) repeats ancestor discovery, settings reads, and managed drop-in parsing for each installed plugin | Read settings once per discovery invocation, preserving managed and project precedence and refreshing on the next invocation |
| Session list lookup | [MonoSessionList](../src/features/monos/ui/MonoSessionList.tsx) repeatedly searches live/history arrays per launch and row | Build memoized ID indexes only when profiling demonstrates scale; preserve first-match precedence |
| Long-lived UI maps | `storedSessions` in MonoSessionList, `mainCheckouts` and `sessionProjectsCache` in [MonoChangesView](../src/features/monos/ui/MonoChangesView.tsx), and `noteImageSrcCache` in [AgentMarkdown](../src/features/sessions/ui/AgentMarkdown.tsx) retain visited keys for the window lifetime | Define eviction and invalidation per cache; cached note URLs are strings, not evidence of retained decoded image buffers |
| Provider supervisor retention | [harness.rs](../src-tauri/src/harness.rs) retains session epochs and several dedicated threads per active provider | Measure remaining thread count/stack RSS at high concurrency; removing epochs must retain protection against outstanding spawn races |

The native provider-output queue remains bounded to 16 MiB and 4,096 records per provider. Background reads use four permits before entering the blocking pool. Search still uses its existing blocking path. Do not add a competing worker pool or duplicate resource monitor without evidence of a remaining cost.

Native migrations, submission recovery, and worktree-removal reconciliation must keep their safety ordering. Further native startup changes need per-phase timing and matched packaged launches. The dormant window-transfer collector also needs an explicit save-flush and revision-baseline handoff before activation; transferred dirty contents cannot adopt an arbitrary current database revision.

## Next whole-app profiling workload

Use matched release builds and an isolated fixture with an empty workspace, a long restored chat, a restored editor, multiple parked transcripts, four concurrent streams, and a large repository search. Record existing launch marks, aggregate RSS across native/webview/provider processes, heap snapshots after navigation and idle collection, input-to-paint delay, and p95 search latency. Use repeated runs on the same machine and keep startup and steady-state workloads separate.
