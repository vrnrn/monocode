# Upstream patch imports

## Policy and next baseline

This repository intentionally keeps its detached source history. Import applicable bug fixes and features from [hardbeat920/monocode](https://github.com/hardbeat920/monocode) as reviewed patches. Preserve the fork's provider choices/authentication, automation guards, model visibility, Mono collaboration/lifecycle, ticket handling, branding, release versions/updater trust, recovery contracts, and Impeccable configuration. Do not merge unrelated histories or add an ancestry bridge.

**Reviewed upstream baseline:** `399c303360686e804c8657d98db91d93f6ae99b6`.

Advance this baseline only in the same reviewed change as the corresponding implementation and explicit skips. For the next import, fetch fresh refs and review `git log --reverse 399c303360686e804c8657d98db91d93f6ae99b6..upstream/main` plus the incremental tree diff. Account for every intervening commit, including reversions and merge commits, then adapt the final behavior to the fork. Check open import PRs/issues first. If this baseline is no longer an upstream ancestor, inspect the rewrite before choosing another baseline. A skipped release-only commit is reviewed and should not be imported again.

## 2026-10-17 — performance and reader-position fixes

- Target repository ID: `1418411268` (`vrnrn/vorkspace`; former `vrnrn/monocode` URL redirects here).
- Target starting main: `577828a9220d7a411345d722aaa0127b2b0dfab2`.
- Previously included upstream baseline: `e49a5ae4de854e44cac7892a87cd32fc9cded415`, from PR #13 (old merge `fb63899356e53b17936fb3bc2d05e84fad42b40a`).
- Source import root `b33e6e6b09b5202f0d945015386aecdef118a42f` has the same tree (`f79c09c73bd3e93fdba3e6ec77b80bb68d6422f5`) as documented source `d3410213efe0153ebe0124453af214721e23c26f`, which contains the previous baseline. This establishes the content baseline without restoring ancestry.
- Reviewed through `399c303360686e804c8657d98db91d93f6ae99b6`: [upstream PR #1045](https://github.com/hardbeat920/monocode/pull/1045) and its tab-animation replay follow-up.
- Outcome: the final runtime/test delta from `b653a397d180d98097a5f214e9bbdae68d837239` through the reviewed head is adapted on this branch. Implementation commit: `1d1d66f4b7fa65c06d9fd2864e696a3342aa29f6`; import [PR #26](https://github.com/vrnrn/vorkspace/pull/26). [Issue #25](https://github.com/vrnrn/vorkspace/issues/25) records the user's resolved patch-import direction.

### Applied behavior and fork adaptations

Import worker-based code highlighting and large-diff preparation; per-session streaming subscriptions; progressive saved-session repairs; deferred large tool output with storage-preserving saves; measured history retention; completion/reflow/scroll bookmarks; bounded transcript retention under resource pressure; resource process controls; lower-priority background work; configurable smooth text reveal; and audio-context suspension after notification sounds.

The five initial textual conflicts were resolved: keep native ticket modules and the removed Azure integration choice while adding new native modules; check local send receipts before exposing a progressively restored session; retain both receipt-ownership and upstream restore regressions; retain ticket-link plugins/protocols in Markdown; and retain the standalone startup splash while adding worker/benchmark build support. New resource UI/native error strings use vorkspace branding. Combined restore tests verify that uncertainty/replay fences survive deferred provider-log repairs. Review also identified that saved worker tabs needed the local session ID to fetch deferred tool output; `AgentTabView` now supplies it for local sessions, with an expansion regression. A final ref refresh added the animation replay fix at `399c303360686e804c8657d98db91d93f6ae99b6`; its import conflict retains the fork’s removal of decorative transcript components. The workspace browser fixture uses the fork’s checked editor-read and durable-draft contracts.

The fork's concurrent 0.13.6 release (`7f944b3a483c9ac15b0eae2b4f6a328dd7fdd104`) is retained. Upstream 0.14.0 version bumps, release metadata and wholesale changelog reorganization are deliberately skipped. Fork release/updater configuration and `.impeccable/config.json` remain unchanged. The earlier 397 add/add diagnostics describe an unrelated-history merge and are not incremental patch conflicts.

### Reviewed commits

| Upstream commit | Subject | Disposition |
| --- | --- | --- |
| `002d393ab7c4f1341f902e62820a75fdaa1bf82c` | Improve session responsiveness and fix completion scroll jumps | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `53777effb3292760f041abb9b3acac700cd5bfab` | Improve workspace performance and resource management | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `11af7414d3b186cfce96cc7dd9360645f8ac05f8` | Merge remote-tracking branch 'origin/main' | Covered — upstream branch reconciliation is included in the final reviewed patch; no history merge. |
| `51abda1954e4cbed4a6a6dd4e63afcb65acf3a4c` | Optimize workspace performance and preserve transcript state | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `60e2c69dd1b046e72bbdd4a9c8ee04ff387aee43` | Release v0.14.0 | Skipped — upstream release/version/changelog administration; retain the fork’s independent release policy. |
| `fa454fb0226f3cc746fd361b804e09b0aabb76f7` | Measure visible reader position in browser release checks | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `3acdde4131433913257ad67071aa9523a5cbdb16` | Preserve reader anchors near paragraph gaps | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `bb3128c43832a00f85f8e654b729dc64fb741e5a` | Retain displayed snapshots when session panes become hidden | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `9126fb029703cc8fb35be4ffa4c0e49bb63058b6` | Release v0.14.0 from tested main | Skipped — upstream release/version/changelog administration; retain the fork’s independent release policy. |
| `e627a69b1c4e6a6363a9c1791710ba6d76f7384d` | Credit every contributor in the v0.14.0 changelog | Skipped — upstream release/version/changelog administration; retain the fork’s independent release policy. |
| `b653a397d180d98097a5f214e9bbdae68d837239` | Merge pull request #1046 from hardbeat920/release/0.14.0-stable | Skipped — upstream release/version/changelog administration; retain the fork’s independent release policy. |
| `aa2ee18a5a4dde55eaf5f10038ebc35e7c132ae7` | Release hidden transcripts beyond recent tabs to bound memory | Superseded — upstream removed this transient hidden-tab release in b19253fe; import the final behavior. |
| `0dc03a63bfc96529f643bdf32580847494b4a141` | Rename recent IDs hook to released IDs | Superseded — upstream removed this transient hidden-tab release in b19253fe; import the final behavior. |
| `5a7359593ef6addc5f78deb6510cd3209e3488fa` | Defer large tool output until transcript expansion | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `b19253fef6ced0a7675b628329ea9bd2818fe16e` | Remove hidden-tab transcript release | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `b859824091d6c0f36bdd55d4d0520387eaffd127` | Suspend the sound audio context after cues finish playing | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `ebd82fab5e67f0b46a531476a6a0658302655eb9` | Merge published main and retain optimisation notes as unreleased | Covered — upstream branch reconciliation is included in the final reviewed patch; no history merge. |
| `a6940e149f21213debfa8aa32ca7115edcac243e` | Align browser cache coverage with bounded transcript retention | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `edea2ac6ec9d045f206d32d91b5c062196377d51` | Keep reader anchors current throughout wheel momentum | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `a02250d08d59f76512c462c4b3768bce6290415e` | Record scroll adjustments in completion browser traces | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `4de241659479c3b4b2d2018fa5349a4988dba2d0` | Refresh reader bookmarks after delayed native scrolling | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `78bc3079993f03e70c51f0670d3824f37eff30ab` | Preserve character bookmarks through reflow and cached tab restores | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `182bd345863dfec0154dcee310765427fd754e93` | Anchor visible characters and warm the changes review surface | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `3e400e68fa95a3fe4cfe48a422e0325fa4464c53` | Distinguish animation handoffs from native reader scrolling | Applied/adapted — included in the final PR #1045 performance, resource, or regression-test patch. |
| `777f1b707d957e1c530cc2e6054e5ffb198706c6` | Merge pull request #1045 from hardbeat920/release/0.14.0 | Adapted — import the final PR #1045 tree delta on the target, without upstream parents. |
| `399c303360686e804c8657d98db91d93f6ae99b6` | Avoid replaying transcript animations when revisiting tabs | Adapted — preserve portal arrival order, settle tab catch-up fades, and avoid replaying prompt/step entrances; retain removed decorative UI choices. |

### Validation and target outcome

Validation and the exact target implementation commit/PR are finalized on this branch before merge. Keep those results with this record so a future import can distinguish a reviewed skip from an unvalidated pending change.
