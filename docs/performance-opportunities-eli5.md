# Performance improvements in plain English

These five improvements are complete. The [0.13.7 performance audit](https://github.com/vrnrn/vorkspace/blob/mac-v0.13.7/docs/performance-audit.md) preserves their design, tests, and historical measurements. See the [remaining performance opportunities](performance-audit.md) before proposing further changes.

## Save just the new bits

Adding one sentence to a notebook used to mean copying the whole notebook again. Ordinary conversations now save the new or edited pieces and a small list showing their order.

That means less copying during long conversations. Older saved conversations convert when first saved. Large tool results that have not been opened stay safely on disk. Saves check their version so an old window cannot silently overwrite a newer save. Older webviews that lack weak references safely send all the blocks while keeping that version check.

## Put old chats away

The remote host used to keep up to 32 conversation records handy, however large they were. It now also has a size budget. Very large records go straight to storage instead of filling the cache.

That limits the memory used by this particular cache. Returning to an evicted record can need another disk read. Active conversations still belong to their existing runtime owners; this is not a cap on total app memory.

## Open first, do optional chores afterward

Saved conversations can appear before the app checks optional provider logs. Those checks run one conversation at a time after the screen has had a chance to appear. Provider discovery, permission checks, and file-list prefetch also wait for that opportunity.

Safety checks for unfinished submissions and interrupted work still finish before the restored conversation becomes usable. Database upgrades also keep their existing ordering. A delayed repair cannot replace newer typing or replies.

## Unpack occasional tools when opened

Release-note text, the What's New dialog, and optional Mono settings and channel screens load when requested. A restored release-note tab can wait until it is visible.

The app needs about 15% less JavaScript during ordinary startup in the production comparison. Opening one of these features for the first time may require loading its code. Failed loads can be retried.

## Remember the file list briefly

The remote filename search and file picker now share a recently scanned file list. Requests arriving together share one scan. The list expires after one second, and supported file and Git changes invalidate it immediately.

Repeated searches can avoid repeating the same repository scan. Changes made by an outside program appear on a subsequent scan after the short expiry. The cache has both size and folder-count limits.

## What we know so far

The isolated remote-host startup benchmark improved from **50.5 ms to 12.1 ms**, with peak process memory falling from about **163 MiB to 56 MiB**, using 200 idle conversations containing 50 MiB of transcript text. This mainly comes from reading small summaries rather than opening every conversation during startup.

The incremental-save regression checks that changing one block updates one stored block while preserving the other 100 large results. Cache tests check bounds, expiry, invalidation, and failed requests. These checks establish less repeated work; everyday launch time and total app RAM still need measurements from matched packaged builds.

Further work, such as releasing more distant conversation views or changing native startup ordering, remains a separate profiling decision. The audit describes the remaining opportunities and the whole-app workload needed to assess them.
