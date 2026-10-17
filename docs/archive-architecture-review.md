# Architecture improvements worth borrowing from the Vorkspace archive

This comparison records the source state reviewed on October 16, 2026. The accompanying implementation adds development-profile isolation, editor baseline checks, durable unsent drafts, provider-output budgets, and local send receipts. The comparisons below describe the original baseline; they are not a fresh audit of the resulting implementation.

The archive contains useful engineering work, especially around durable drafts, edit conflicts, run ownership, and explicit resource limits. We can adopt those contracts inside the current React, Tauri, Rust, and remote-host architecture. The strongest case is for a series of contained improvements at existing boundaries; the comparison does not justify another platform rewrite.

The most useful starting points are an isolated development profile and conflict-aware editor saves. If ordinary unsent input should survive restart, the archive also provides a concrete autosave design. Provider-output queue budgets are another concrete hardening opportunity. Local submission receipts and structured cleanup outcomes deserve a design pass before implementation because they touch several existing execution paths.

## Recommended priorities

“Implemented” below means the archive has supporting source and, where cited, contract tests. It does not mean its native app reached complete interaction parity or that these tests were rerun for this review. Effort describes the breadth of a change, not a delivery estimate.

| Priority | Idea | Comparative finding | Effort | First useful slice |
| --- | --- | --- | --- | --- |
| Start | Isolate development data | Archive makes the development data root and app identity explicit; current production profile reuse is intentional | Small to medium | Add a development-only launch configuration and audit all storage consumers |
| Start | Detect editor save conflicts | Archive carries a read digest and draft revision through saving; current ordinary editor writes are atomic but lack a disk-baseline precondition | Medium | Add an expected digest and typed save/conflict receipt to the ordinary editor path |
| Start | Autosave unsent composer input | Archive persists text, selection and attachment references; current ordinary composer cache lasts only for the process | Medium | Add a separate revisioned draft store alongside current session persistence |
| Next | Bound provider output by bytes | Archive bounds aggregate queues; current local batching limits batch size rather than producer queue growth | Medium | Add byte accounting and a tested pressure policy to one local output path |
| When needed | Continue history search and reveal exact hits | Archive has query-bound cursors and revision-checked reveal; current cross-session search has truncation, while Monos already have separate paging/find | Medium to large | Extend the existing search contract without replacing its storage or cross-session behavior |
| Design first | Persist local send attempt receipts | Archive deduplicates exact attempts durably; current remote host already does this, but normal local sends rely on in-process admission | Large | Define attempt identity and uncertain crash states before adding a local ledger |
| Design first | Report cleanup evidence | Archive retains unresolved cleanup ownership; current adapters usually return `Promise<void>` | Medium to large | Prove drain/exit semantics for one adapter and expose a truthful result |
| Selectively | Return Git outcome and observation separately | Archive can represent a failed operation alongside changed repository state | Medium | Add an observation envelope to one mutation and reconcile the UI even after failure |

## Isolate development data without changing the production profile

The archive packages a distinct development bundle identifier and stable development data directory. Application startup accepts an explicit data-directory argument or packaged setting and refuses to open an unspecified store. Its install helper checks whether the development app is running, validates the destination identity, and uses a same-volume rename or swap. These are concrete development affordances, independent of Swift as a UI framework. See [development configuration](/Users/vrana/Development/vorkspace-archive/scripts/native-build.sh:7), [data directory admission](/Users/vrana/Development/vorkspace-archive/native/macos/Sources/VorkspaceApp/Application.swift:17), and [install checks](/Users/vrana/Development/vorkspace-archive/scripts/native-app.swift:13).

The current app deliberately keeps the `com.monocode.desktop` production identity. Session storage resolves the application data directory and opens `monocode.db`; the stable development override changes the frontend command rather than the profile. The profile handoff script explicitly documents that reuse. This comparison establishes an opportunity for safer development tooling, not evidence that current development runs have corrupted data. See [current identity](/Users/vrana/Development/vorkspace/src-tauri/tauri.conf.json:5), [store startup](/Users/vrana/Development/vorkspace/src-tauri/src/session_store.rs:75), [stable override](/Users/vrana/Development/vorkspace/src-tauri/tauri.stable.conf.json:1), and [intentional profile reuse](/Users/vrana/Development/vorkspace/scripts/migrate-monocode-to-vorkspace.sh:10).

Add a development-only configuration with an unmistakable identity and isolated data root. Preserve production paths, migrations, the signed updater, and existing release verification. Inventory every application-data consumer, secondary window, and webview preference store: changing only the session database or bundle identifier is insufficient to establish complete isolation. Verify localhost-origin `localStorage` behavior as well. Keep the development profile empty by default rather than copying production history or credentials.

**Completion evidence:** a development launch prints its selected profile; writes to drafts, Notes, session state and preferences stay within that profile; secondary windows inherit it; the normal installed app continues to use its existing profile.

## Carry the editor read baseline into saving

The archive creates a save ticket containing the project, exact path, document instance, captured draft revision, and baseline SHA-256. The engine rejects a mismatched disk digest, and a save completion only acknowledges the revision it actually saved. Typing during an in-flight save therefore remains dirty. The implementation and tests are in [FileDocument](/Users/vrana/Development/vorkspace-archive/native/macos/Sources/WorkspaceUI/FileDocument.swift:29), [write admission](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:715), [external edit contract](/Users/vrana/Development/vorkspace-archive/native/engine/tests/workspace_contract.rs:298), and [typing during save test](/Users/vrana/Development/vorkspace-archive/native/macos/Tests/WorkspaceUITests/FileDocumentTests.swift:54).

The current ordinary editor serializes saves and preserves line endings. Its Rust writer uses a temporary file, syncs it, retains permissions, and atomically renames it into place. However, the command receives only path and content. File watchers can notice an external edit, but a watcher notification is not a write precondition. See [editor save queue](/Users/vrana/Development/vorkspace/src/features/files/ui/FileEditor.tsx:339), [native writer](/Users/vrana/Development/vorkspace/src-tauri/src/fs.rs:5960), and [watcher protection test](/Users/vrana/Development/vorkspace/src/features/files/ui/FilePaneLineEndings.test.ts:144). Some current writes already have expected-hash protection, including [Mono file saves](/Users/vrana/Development/vorkspace/src/features/monos/model/monoFiles.ts:144); this recommendation concerns the ordinary file editor.

Extend the editor read result with a baseline digest, send that digest with saves, and return a typed receipt containing the saved identity and resulting baseline. A conflict keeps the draft intact and offers the existing reload/save decision surface. Update the baseline and clean state only for the matching save revision. Preserve current CRLF handling, atomic replacement, file modes, and error reporting.

This improves conflict detection and recovery, but must not be advertised as filesystem compare-and-swap. The archive explicitly documents the remaining publication race and recovery behavior in its [filesystem contract](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:44). Its macOS rename implementation should not be transplanted across supported platforms without equivalent semantics.

**Completion evidence:** a detected baseline mismatch preserves both external disk content and the unsaved draft; newer typing remains dirty after an older save finishes; stale completions cannot acknowledge another file or document instance; CRLF and permissions survive. Test the publication-race recovery policy separately from the initial digest check.

## Persist ordinary unsent composer drafts separately from saved turns

Durable autosave would add restart survival for ordinary unsent typing to the current app. The archive stores ordinary composer text and UTF-16 selection separately from submitted history, scoped to a project and conversation. Writes compare the expected revision inside a transaction. Clearing retains a revision so a delayed old write cannot resurrect deleted text. Attachment drafts store ordered metadata references with similar ownership and revision rules. See [draft model and writes](/Users/vrana/Development/vorkspace-archive/native/engine/src/conversation_drafts.rs:15), [clear semantics](/Users/vrana/Development/vorkspace-archive/native/engine/src/conversation_drafts.rs:75), and [attachment draft contract](/Users/vrana/Development/vorkspace-archive/native/engine/src/conversation_attachment_drafts.rs:29). Existing tests cover [Unicode, selection and reopen](/Users/vrana/Development/vorkspace-archive/native/engine/tests/conversation_draft_contract.rs:174) and [attachment reopen](/Users/vrana/Development/vorkspace-archive/native/engine/tests/conversation_attachment_draft_engine_contract.rs:166).

Current ordinary composer input is retained in a module-level map and a pane ref. The cache explicitly says it survives pane remounts but not process restart or full reload. See [draft cache](/Users/vrana/Development/vorkspace/src/features/sessions/model/draftCache.ts:1) and [composer wiring](/Users/vrana/Development/vorkspace/src/features/sessions/ui/SessionPane.tsx:646).

Current Vorkspace also has a deliberate **Save draft** workflow that stores a `Block.draft` user turn, including attachments, in session history. That is already persisted through session storage and has send/remove semantics. It must remain distinct from continuously autosaving whatever the user is typing. See [saved draft creation](/Users/vrana/Development/vorkspace/src/app/App.tsx:6775), [saved draft lookup](/Users/vrana/Development/vorkspace/src/features/sessions/model/session.ts:731), and [session persistence](/Users/vrana/Development/vorkspace/src/features/sessions/data/sessionStore.ts:424).

Add a separate unsent-draft table through a forward migration and hydrate the existing cache from it. Define the owner key and revision policy before wiring debounced writes, send/clear, deletion, and window transfer. Start with ordinary local session composers, then cover Mono and remote-backed composers deliberately; a remote session's unsent local input does not automatically belong in the remote transcript store. Preserve attachment order and metadata, but revalidate restored paths. Do not automatically send restored input. MCP tags and other composer selections also need an explicit persistence decision rather than accidentally disappearing when text becomes durable.

**Completion evidence:** exact Unicode text, selection and intended attachment references survive restart; two windows cannot overwrite a newer revision; clearing defeats delayed writes; corrupt draft rows are preserved for recovery; an existing saved `Block.draft` and unsent typing do not overwrite one another. Adopt the archive's boundary-test patterns, not its fixed size quotas without checking current workloads.

## Put byte admission around provider output queues

The archive bounds both item count and aggregate bytes for process and runtime-notice queues. Waiting for capacity remains cancellation-aware, and oversized records produce explicit errors. The source includes tests for blocked byte budgets, release, cancellation and oversize behavior. See [process queue definitions](/Users/vrana/Development/vorkspace-archive/native/engine/src/runtimes/process.rs:19), [budget admission](/Users/vrana/Development/vorkspace-archive/native/engine/src/runtimes/process.rs:152), and [queue tests](/Users/vrana/Development/vorkspace-archive/native/engine/src/runtimes/process.rs:2928).

Current local output is batched by time and a one-MiB batch threshold, but the Rust producer uses an unbounded channel. That threshold closes a batch; it does not cap queued data behind a slow consumer. The frontend's pre-watch replay limit counts lines rather than bytes. The remote backend already limits unfinished-line growth using decoded JavaScript string length, rather than byte accounting. That limit is useful but different from an aggregate queue budget. See [local batcher](/Users/vrana/Development/vorkspace/src-tauri/src/harness.rs:53), [pre-watch replay](/Users/vrana/Development/vorkspace/src/integrations/harness/core/child.ts:117), and [remote line limit](/Users/vrana/Development/vorkspace/host/child-backend.ts:226).

Add byte accounting and an explicit pressure policy at one current producer boundary. Choose limits from observed record and burst sizes. Preserve ordered delivery and flush-before-exit behavior. Protocol records must not disappear silently: reader blocking, a visible run failure, and dropping expendable diagnostic replay have different consequences and need separate policies. Blocking pipes can also stall a provider waiting to receive cancellation, so cancellation must remain serviceable while a queue is full.

**Completion evidence:** sustained output against a stalled consumer stays within the configured budget; oversized records fail visibly; cancellation unblocks full queues; approval and completion records remain ordered; final output arrives before exit settlement. This is an explicit resource bound, not a measured performance improvement.

## Extend search with continuation and exact reveal when the workflow needs it

Archive search cursors bind the conversation, generation, query and case mode, plus a scan ceiling. Its reveal API checks the exact history row and revision before returning a bounded context. Stale results cannot silently open a different version of a hit. See [search cursor contract](/Users/vrana/Development/vorkspace-archive/native/engine/src/history_search.rs:24), [reveal validation](/Users/vrana/Development/vorkspace-archive/native/engine/src/history_reveal.rs:53), [cursor tests](/Users/vrana/Development/vorkspace-archive/native/engine/tests/history_search_contract.rs:70), and [reveal tests](/Users/vrana/Development/vorkspace-archive/native/engine/tests/history_reveal_contract.rs:107).

Current search spans saved sessions and exposes cancellation and a `truncated` result. It does not expose a continuation cursor in that contract. Monos already have separate paging and find APIs; the host also has revisioned deltas and snapshot fallback. The archive's per-conversation search is therefore not a replacement for current search. See [cross-session search API](/Users/vrana/Development/vorkspace/src/features/sessions/data/sessionStore.ts:566), [Mono history APIs](/Users/vrana/Development/vorkspace/src/features/sessions/data/sessionStore.ts:608), and [host event fallback](/Users/vrana/Development/vorkspace/host/store.ts:252).

If truncated searches are a real workflow problem, extend the existing query with a bounded, query-and-scope-bound cursor. If opening an old hit needs more context, pass exact session/block identity through an async reveal operation and reject stale results. Reuse Mono paging where appropriate. Ordinary sessions' `blocks_json` and Mono's indexed blocks need different query plans; this does not require converting every transcript into the archive's row store.

**Completion evidence:** continuation finds older hits without duplicates; changing query, scope or archive filters invalidates the cursor; deleted or revised hits fail explicitly; selecting another session during reveal cannot move its scroll position; appending new turns does not invalidate an otherwise stable scan unexpectedly.

## Define durable local send attempts before moving more orchestration

The archive assigns a stable submission ID, hashes its exact payload and scope, and reserves the attempt durably. Matching retries return the existing reservation; changed content under the same ID is rejected. The coordinator does not create another actor for an already reserved attempt. See [payload digest](/Users/vrana/Development/vorkspace-archive/native/engine/src/session_persistence.rs:315), [reservation admission](/Users/vrana/Development/vorkspace-archive/native/engine/src/session_persistence.rs:568), and [duplicate-send test](/Users/vrana/Development/vorkspace-archive/native/engine/tests/session_coordinator_contract.rs:408).

Current normal local sends already have busy-state gates, per-session harness queues, generation checks and ordered persistence. The narrower difference is the absence of a queryable durable attempt receipt at that dispatch boundary. Current **remote** commands already hash the request and atomically persist state with a receipt before starting effects. See [local admission](/Users/vrana/Development/vorkspace/src/app/App.tsx:6883), [harness serialization](/Users/vrana/Development/vorkspace/src/integrations/harness/core/registry.ts:149), [session write ordering](/Users/vrana/Development/vorkspace/src/features/sessions/data/sessionStore.ts:394), and [remote acceptance receipts](/Users/vrana/Development/vorkspace/host/engine.ts:416).

The useful architecture lesson is to give the local send operation a durable owner and result independent of the React callback that initiated it. Define one attempt identity for one visible user turn, including managed/operator calls and edited resends. Then add an additive local ledger alongside current persistence and a small service that reserves, dispatches and settles an attempt. Keep provider adapters and their authentication boundaries intact. This is a useful seam for reducing orchestration inside `App.tsx`; merely moving callbacks into more files would not establish ownership.

A receipt proves durable local acceptance, not exactly-once provider execution. A crash around provider I/O can leave execution uncertain. Reopening must show that uncertainty without replaying the request. Remote receipts already make this [acceptance distinction explicit](/Users/vrana/Development/vorkspace/host/engine.ts:692).

**Completion evidence:** matching duplicate attempts share the same accepted user-turn identity; changed text, attachments or scope under the same ID reject; crashes before and after provider I/O recover an honest state; recovery never sends again automatically; edited-resend rollback and remote routes keep their current behavior.

## Make cleanup outcomes explicit where an adapter can prove them

The archive does not equate a provider's completion notice with released resources. It requires process reaping and output-stream drain, retains unresolved cleanup ownership, and offers bounded retry. See [cleanup ownership](/Users/vrana/Development/vorkspace-archive/native/engine/src/session_coordinator.rs:546), [drain criteria](/Users/vrana/Development/vorkspace-archive/native/engine/src/session_coordinator.rs:1726), and [incomplete-drain tests](/Users/vrana/Development/vorkspace-archive/native/engine/tests/session_coordinator_contract.rs:556).

Current stop paths already await cancellation and stop. Orchestration holds a cancelling worker slot until stop resolves, and the host has its own settlement retries. The remaining design difference is that the common adapter methods return `Promise<void>` rather than structured evidence about exit and drain. This comparison found no demonstrated current process leak. See [adapter lifecycle](/Users/vrana/Development/vorkspace/src/integrations/harness/core/registry.ts:52), [current stop](/Users/vrana/Development/vorkspace/src/app/App.tsx:10317), and [orchestration ownership test](/Users/vrana/Development/vorkspace/src/features/orchestration/model/orchestration.test.ts:979).

Start with one adapter whose child and streams we own. Define a cleanup result, grace timeout, retained-owner retry, and final disposal policy. An adapter that cannot prove drain must return uncertainty rather than inventing proof. Avoid applying one global quiescence rule to local sessions, remote runs, prompt helpers and orchestration workers with different owners.

**Completion evidence:** a terminal provider notice with an open stream does not claim fully released resources; failed stop remains visible and retryable under a bound; cancellation and completion races cannot release another run's owner.

## Separate Git operation outcome from observed repository state

The archive returns both the operation result/error and the repository observation made after the attempt. A subprocess can fail or exceed an output limit after changing repository state; an error alone cannot describe the resulting HEAD, index and worktree. See [mutation envelope](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:24), [observation wrapping](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:284), and [mutation contracts](/Users/vrana/Development/vorkspace-archive/native/engine/tests/workspace_contract.rs:715).

Current mutations commonly return a `Result` and leave refresh/error reconciliation to the UI. Start with a single commit or checkout command and return separate operation and observation outcomes, including observation failure. Have the caller refresh from that observation even when the operation failed. See the [current commit boundary](/Users/vrana/Development/vorkspace/src-tauri/src/fs.rs:1095).

Do not copy the archive's commit/index algorithm wholesale. It documents unresolved HEAD timing and concurrent-index publication conditions in its [Git contract](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:32). The transferable improvement is an honest post-attempt result.

**Completion evidence:** a command that changes state and then fails still reconciles the visible branch/index/status; an ordinary rejected preflight reports unchanged observation; observation failure is not mislabeled as operation failure.

## Other useful ideas that need a narrower case

| Idea | What the archive gets right | Why it is not an immediate port |
| --- | --- | --- |
| Prepared history batches | Expected row revisions, active-run admission and atomic rejection of an invalid batch | Current already serializes session writes, incrementally writes Mono suffixes, and revisions remote events. Profile before replacing ordinary snapshots; preserve all migrations |
| Rooted file operations and exact byte paths | Pinned directory descriptors, no-follow traversal and tagged Unix byte paths | Current intentionally supports symlink navigation and external files; TypeScript paths are strings and Windows needs separate semantics. This is a product/API change, not a save-command cleanup |
| Editor retention budgets | Makes retained document bytes and dirty-draft ownership explicit | Measure current tab retention first. Do not copy the archive's eight-document limit or evict dirty/saving content |
| Bounded expensive read lanes | Admission, timeout and completion are owned together | Add limits only to a measured or demonstrated piling-up path; arbitrary rejection can break existing callers |
| Central durable cancellation fence | One storage gate can reject late history/control ingress | Current already has `turnGen`, provider epochs and run guards. No stale-write defect was established; another generation system must earn its complexity |

Supporting source: [prepared batches](/Users/vrana/Development/vorkspace-archive/native/engine/src/history_ingress.rs:65), [current serialized/suffix writes](/Users/vrana/Development/vorkspace/src/features/sessions/data/sessionStore.ts:394), [rooted filesystem contract](/Users/vrana/Development/vorkspace-archive/native/engine/src/workspace/mod.rs:44), [current non-UTF-8 omission](/Users/vrana/Development/vorkspace/src-tauri/src/fs.rs:536), [archive editor budgets](/Users/vrana/Development/vorkspace-archive/native/macos/Sources/WorkspaceUI/FileDocument.swift:93), [bridge lane admission](/Users/vrana/Development/vorkspace-archive/native/macos/Sources/EngineBridge/EngineConnection.swift:179), and [current stop generation](/Users/vrana/Development/vorkspace/src/app/App.tsx:10317).

## Current architecture worth keeping

Several attractive archive ideas already exist in the current repo. Reimplementing them would add competing owners rather than improve the architecture.

| Area | Current strength | Implication |
| --- | --- | --- |
| Transcript identity | Immutable block updates and cached unchanged turn arrays, with focused performance tests | Strengthen DOM-identity, stale-callback and selection regressions around the existing cache |
| Hidden session state | A bounded pool retains mounted transcripts and handles eviction and stale hosts | Preserve visibility versus disposal semantics instead of adding another retention layer |
| Workspace navigation | Recursive pane layout and persisted workspace validation | Archive session splits, transfers and multi-window restoration were still unfinished |
| Remote execution | Durable command receipts, run identity, per-block revisions and delta/snapshot recovery | Preserve host authority; do not impose the archive's local connection lifetime on remote sessions |
| Provider readiness | Binary discovery and authentication failures are separate; native provider protocols already have adapters | Keep the existing adapters and capability work rather than replacing them to match the archive |
| Database evolution | Versioned migrations and repair of incomplete earlier schema changes | A fresh-schema-only reset would regress existing-user durability |
| Recovery | Local and remote recovery mark uncertain/running work interrupted without automatically replaying it | This is an existing invariant, not a missing archive feature |
| Terminal replay | The frontend already bounds replay by bytes and whole chunks | Do not confuse the provider-output queue finding with a lack of PTY replay limits |

Sources: [turn cache](/Users/vrana/Development/vorkspace/src/features/sessions/model/transcriptTurnCache.ts:11), [performance tests](/Users/vrana/Development/vorkspace/src/features/sessions/ui/AgentTranscript.performance.test.ts:58), [transcript pool](/Users/vrana/Development/vorkspace/src/features/sessions/ui/TranscriptPool.tsx:11), [pool tests](/Users/vrana/Development/vorkspace/src/features/sessions/ui/TranscriptPool.test.ts:82), [recursive layout](/Users/vrana/Development/vorkspace/src/features/workspace/model/layout.ts:84), [archive navigation gaps](/Users/vrana/Development/vorkspace-archive/future-work.md:13), [host revisions](/Users/vrana/Development/vorkspace/host/store.ts:137), [binary availability boundary](/Users/vrana/Development/vorkspace/src/integrations/harness/core/availability.ts:27), [auth classification](/Users/vrana/Development/vorkspace/src/integrations/harness/core/authSupport.ts:25), [migration repair](/Users/vrana/Development/vorkspace/src-tauri/src/session_store.rs:667), [local recovery](/Users/vrana/Development/vorkspace/src/features/sessions/model/inFlight.ts:71), [remote recovery](/Users/vrana/Development/vorkspace/host/engine.ts:268), and [PTY replay limits](/Users/vrana/Development/vorkspace/src/platform/tauri/pty.ts:19).

## What should stay in the archive

- The Swift/AppKit replacement of React/Tauri. Its platform reset does not supply a measured whole-app advantage or current feature parity.
- The exact four-runtime scope, four-active-run cap, fresh-schema-only admission and removed feature lists. These were archive product decisions, not requirements for current Vorkspace.
- The assumption that a smaller native UI has a better workspace model. Current recursive panes, remote execution and broader workflows need to survive any adoption.
- Replacing Tauri promise correlation or provider JSON-RPC IDs with a second request-ID wrapper. Current calls already correlate their results; durable business-attempt identity is a separate concern.
- Hard-coded archive quotas and wholesale row-store/IPC migrations without workload evidence.
- Archive automation, Inbox, quick-composer, terminal or navigation surfaces described as complete replacements. Its own backlog records substantial unfinished integration and interaction work.

The archive explicitly disclaims a whole-app performance advantage and says its old comparison baseline is no longer reproducible from that checkout. It also names projection cloning, growing-row persistence and missing viewport virtualization as future profiling work. Those limitations make “native will be faster” an unsupported basis for another redesign. See [performance limits](/Users/vrana/Development/vorkspace-archive/architecture.md:57), [profiling backlog](/Users/vrana/Development/vorkspace-archive/future-work.md:22), and [unfinished features](/Users/vrana/Development/vorkspace-archive/future-work.md:7).

## A practical adoption sequence

1. **Add development isolation.** One developer configuration, storage inventory and profile-isolation check; no production migration.
2. **Add editor conflict receipts.** One ordinary read/save path, expected digest, explicit conflict behavior, and file-race/CRLF tests. Preserve existing Mono hash saves.
3. **Add unsent composer autosave.** One additive schema migration and one ordinary composer owner, followed by restore/clear, saved-draft coexistence and Unicode tests. Extend to other composer types separately.
4. **Bound one provider output path.** Measure burst sizes, define overflow and cancellation behavior, and add pressure/ordering tests before expanding limits elsewhere.
5. **Choose the next seam from a concrete problem.** Search continuation for incomplete search workflows; a local attempt ledger for uncertain acceptance; structured drain for ambiguous cleanup; Git observation receipts for failed-mutation reconciliation. Each can proceed without a new UI framework or wholesale data model.

For persistence changes, adapt the archive's two-connection revision races, rejection-without-partial-writes, corruption preservation and reopen tests. Retain current migration repair, session-write concurrency, remote receipt, provider lifecycle and real-browser scroll tests. Performance work needs matched release workloads with long history, live output, multiple parked sessions/panes, input and scrolling, aggregate memory, and tail latency. Source structure and queue constants establish no speedup by themselves.

## Scope and evidence

| Checkout | Revision reviewed | Local state |
| --- | --- | --- |
| `/Users/vrana/Development/vorkspace-archive` | `92cc4377ffb0f15cf6c1133adac9ae14eb9c67ed` on `codex/native-only-cleanup` | Clean archived native redesign |
| `/Users/vrana/Development/vorkspace` | `6330a7209e3a36ba26fd55d2143394fefad66218` on `main` | Includes the existing uncommitted UI cleanup and splash work |

Reviewed on October 16, 2026. Nine `gpt-6-luna` subagents ran at **high** effort: three documentation scouts, five subsystem source comparisons, and one skeptical evidence review. The primary agent consolidated the findings and checked development-profile behavior. Source and existing tests were inspected; no archive/current build, test suite, live provider run or matched benchmark was performed for this comparison. No application code, credentials, settings or archive content was changed. Links point to the reviewed local source locations and may move as implementation changes.
