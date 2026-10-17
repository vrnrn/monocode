import type { Session } from "../../features/sessions/model/session";
import {
  applySessionRepair,
  repairSession,
} from "../../features/sessions/data/sessionStore";
import { scheduleAfterPaint } from "../../shared/lib/afterPaint";

/** Optional provider logs never gate restoring checked, saved conversations. */
export function deferSessionRepairs(
  sources: readonly Session[],
  current: (id: string) => Session | undefined,
  publish: (source: Session, repaired: Session) => void,
): () => void {
  let stopped = false;
  const cancel = scheduleAfterPaint(() => {
    void (async () => {
      // Read logs one conversation at a time rather than starting one CLI or
      // filesystem scan for every restored tab in the first visible frames.
      for (const source of sources) {
        if (stopped) return;
        const before = current(source.id);
        if (
          !before ||
          before.blocks !== source.blocks ||
          before.harness !== source.harness ||
          before.providerSessionId !== source.providerSessionId ||
          before.providerAccountId !== source.providerAccountId
        )
          continue;
        try {
          const repaired = await repairSession(source, { persist: false });
          if (stopped) return;
          const latest = current(source.id);
          if (latest && applySessionRepair(latest, source, repaired) !== latest)
            publish(source, repaired);
        } catch {
          // Optional enrichment can retry on a later load; another restored
          // conversation must remain readable when one provider log fails.
        }
      }
    })();
  });
  return () => {
    stopped = true;
    cancel();
  };
}
