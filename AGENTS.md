# Engineering reasoning

Keep this guide timeless and principle based. Record task plans, progress, completed changes, roadmaps, and proposed work separately.

Work from observable behavior, explicit ownership, and evidence. Preserve correctness, continuity, and durable state while removing unnecessary work. Treat implementation choices as hypotheses to test, not patterns to repeat automatically.

## Define the problem before choosing a mechanism

For nontrivial work, establish:

1. **The experience:** What action or condition triggers the problem? What must the user see, retain, or be able to do?
2. **The invariant:** What must remain true before, during, and after the change?
3. **The authority:** Which boundary owns the state or effect? Which other representations are derived, delayed, partial, or displayed?
4. **The failing transition:** Under what ordering, lifecycle change, or workload does the invariant stop holding?
5. **The cause:** Which work, dependency, ownership ambiguity, or timing assumption produces the failure?
6. **The intervention:** What is the smallest coherent change at the owning boundary?
7. **The proof:** What observation would demonstrate success, and what would disprove the proposed explanation?

Keep the depth proportional to the problem. A small fix may need only a short explanation. A change spanning ownership or durability boundaries needs explicit contracts and tradeoffs before a large implementation.

## Trace the whole path

Follow an operation from intent through state changes, notifications, computation, presentation, persistence, and external effects. Inspect both the forward path and what happens when it is interrupted, repeated, superseded, or recovered.

Distinguish the location where a symptom appears from the boundary responsible for it. A presentation defect can originate in identity, scheduling, storage, or lifecycle ownership. Fixing the visible symptom alone can move the failure elsewhere.

Choose the smallest change that closes the entire causal gap. A short patch that leaves the race intact is not simpler than a slightly broader fix with one clear owner. A broad refactor needs evidence that the existing boundary cannot carry the required contract.

## Make ownership precise

- Give each authoritative state or effect a clear owner within its scope. Separate authorities can exist in different runtimes or domains; define how they synchronize rather than merging everything into a global coordinator.
- Publish a complete, consistent state before notifying consumers. Reducing notification frequency must not make authoritative reads stale.
- Separate data freshness from presentation frequency. Different consumers can need different update rates without maintaining conflicting truths.
- Distinguish visibility, activity, attachment, retention, and disposal. One transition does not imply all the others.
- Make ownership transfer explicit. An old owner must not clean up or overwrite a resource after a new owner has taken responsibility for it.

## Preserve meaning and continuity

Preserve the thing the user is interacting with, not merely an incidental coordinate or representation. Identity, selection, focus, reading position, and unfinished input can matter even when the final content is unchanged.

Treat user actions as authoritative when they conflict with automatic behavior. Distinguish deliberate input from programmatic corrections and delayed events.

Check the entire visible transition. A temporary collapse, replay, jump, or stale frame remains a defect even when the final state becomes correct. Preserve identity where rebuilding would repeat effects or discard meaningful state.

Choose representations that survive the transformations the feature permits. If a representation depends on geometry, ordering, interpretation, or configuration, define when it becomes invalid and how it is reconstructed.

## Remove work before moving it

First determine whether the work is necessary. Then consider narrowing its scope, reusing compatible results, deferring it, or moving it away from an interactive path.

- Update only consumers whose relevant information changed.
- Avoid rebuilding unchanged history or copying entire structures for a small change.
- Separate essential readiness from optional enrichment, while preserving required recovery ordering.
- Admit intentional prefetch with explicit priority, cancellation, and bounds.
- Measure the full cost of an optimization, including coordination, copying, invalidation, and reconstruction.

A cache, worker, queue, or extra state layer is a tradeoff, not an improvement by definition. Moving work changes where it happens; it does not necessarily reduce its total cost.

## Design asynchronous work as a lifecycle

Define admission, concurrency, priority, identity, cancellation, publication, failure, and cleanup together.

- Acquire admission before occupying scarce execution resources. Keep urgent control actions from being trapped behind optional background work.
- Carry enough identity and version information to determine whether a result still belongs to the current owner and input.
- Validate again when publishing. Being valid when a task started does not make its result valid when it finishes.
- Distinguish abandonment from continuation. Cancel work with no remaining purpose, but retain reusable progress when a compatible successor can consume it.
- Reuse progress only when both the input and its interpretation remain compatible. Choose checkpoints at stable boundaries and invalidate them deliberately.
- Specify what cancellation actually does: prevent publication, remove queued work, stop active computation, or release resources. Those are different guarantees.
- Give failures a cleanup and recovery path. A failed operation must not retain ownership indefinitely or prevent later useful work.

## Protect durable truth from partial views

A displayed or lazily loaded representation may intentionally omit information. Missing, unknown, unavailable, empty, and explicitly deleted are different meanings.

Define how a partial read participates in a later write before making the read cheaper. Preserve information that the caller never loaded. Place that protection at the persistence boundary rather than relying on every caller to reconstruct complete data correctly.

Preserve write ordering, deletion semantics, ownership checks, migrations, and interrupted-operation recovery. Delayed enrichment must merge against current state rather than replacing newer work with an older snapshot.

Represent uncertain external outcomes honestly. A local record, acknowledgement, or retry does not by itself prove that an external effect happened exactly once. Recovery must respect that uncertainty.

## Budget the resource that matters

Choose bounds that match the cost: retained bytes, object or layout weight, active execution, queued payloads, or reconstruction latency. Entry counts alone rarely describe all of them. Label estimates as estimates.

Retain reusable state when its measured benefit justifies its cost. Release inactive, reconstructible state through its owner, while protecting active work and unsaved input. Avoid allowing one oversized item to displace every inexpensive useful item.

Measure both sides of the tradeoff. More aggressive eviction can increase latency without meaningfully reducing memory. Detached, deferred, or background-owned resources can still consume substantial capacity.

Separate observation from authority to act. A resource snapshot can inform a decision without authorizing a destructive operation. Revalidate current identity and ownership at the point of action; keep explicit control actions distinct from established lifecycle cleanup.

## Match evidence to the claim

Use tests and measurements that exercise the changed contract directly:

- For reuse, compare with a straightforward reference across changed inputs, invalidation, and configuration changes. Check identity and work performed where those are part of the benefit.
- For notification changes, verify both reduced updates and immediately correct authoritative reads.
- For asynchronous work, control completion order, cancellation, stale results, replacement, failure, and recovery.
- For retention, inspect identity, lifecycle effects, actual retained cost, eviction, and reconstruction.
- For partial data, test the complete read, modify, save, and reopen cycle.
- For presentation, observe intermediate frames and real interaction in the relevant rendering environments.
- For performance, use representative workloads, a clear baseline, repeated samples, and measurements covering every process or execution context that owns the cost.

Control scheduling when timing is not the property under test. Avoid fixing an unexplained failure by weakening an assertion or extending a timeout until it disappears.

Keep conclusions within the evidence. Functional correctness does not establish a latency budget. Fewer updates do not prove lower memory use. Smaller delivery size does not prove faster presentation. A component measurement does not establish a whole-system improvement.

## Review transitions and tradeoffs

Exercise the transitions relevant to the change: active and inactive, current and superseded, warm and reconstructed, normal and pressured, partial and complete, successful and interrupted, new and existing data.

Look for interactions between them. A change that works during steady operation may fail when completion, navigation, cancellation, resizing, or saving overlap. Choose cases from the actual ownership and lifecycle model rather than accumulating hypothetical checks.

Extend an existing owner before adding a competing mechanism. Revisit an earlier decision when evidence changes, but understand the contract it protected before replacing it.

Explain the result through the problem, owning boundary, chosen tradeoff, evidence, and remaining uncertainty. Preserve the reasons behind non-obvious decisions so future simplification does not silently remove a correctness guarantee.
