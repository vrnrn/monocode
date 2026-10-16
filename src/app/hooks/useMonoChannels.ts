import { useCallback, useMemo, useRef, useState } from "react";
import type { ControlOutcome } from "../../features/orchestration/model/orchestration";
import { artifactCards } from "../../features/artifacts/artifacts";
import { findMono, monoLook } from "../../features/monos/model/mono";
import {
  addChannelReaction,
  buildChannelTurnPrompt,
  cleanMonoCollaborativeReply,
  clearChannelCursor,
  extractMonoTurnReply,
  findMonoChannel,
  markChannelCursor,
  MAX_CHANNEL_AUTONOMOUS_HOPS,
  postChannelMessage,
  setChannelMemberSession,
  type MonoChannel,
  type MonoChannelMessage,
} from "../../features/monos/model/monoChannels";
import { monoReaction as parseMonoReaction } from "../../features/monos/model/monoReaction";
import { monoSpawnedSessions } from "../../features/monos/model/monoSpawnedSessions";
import { newSession, type Session } from "../../features/sessions/model/session";

export type MonoChannelHost = {
  sessions(): Session[];
  ensureMono(monoId: string): Promise<Session | undefined>;
  openSession(sessionId: string): Promise<Session | undefined>;
  addSession(session: Session): void;
  runTurn(sessionId: string, prompt: string): Promise<ControlOutcome>;
  stopSession(sessionId: string): Promise<void>;
};

type QueuedSpeaker = {
  monoId: string;
  hop: number;
};

export function useMonoChannels(host: MonoChannelHost) {
  const hostRef = useRef(host);
  hostRef.current = host;

  const queuesRef = useRef(new Map<string, QueuedSpeaker[]>());
  // Keep ownership until both the turn and any provider cancellation settle.
  const workersRef = useRef(new Set<string>());
  const generationsRef = useRef(new Map<string, number>());
  const stoppingRef = useRef(new Map<string, Promise<void>>());
  const runningSpeakerRef = useRef(new Map<string, string>());
  const activeSessionByChannelRef = useRef(new Map<string, string>());
  const activeHopBySessionRef = useRef(new Map<string, number>());
  const cliPostedInTurnRef = useRef(new Set<string>());

  const [activeByChannel, setActiveByChannel] = useState<
    ReadonlyMap<string, readonly string[]>
  >(() => new Map());

  const syncChannelActiveState = useCallback((channelId: string) => {
    const current = runningSpeakerRef.current.get(channelId);
    const queued = (queuesRef.current.get(channelId) ?? []).map(
      (item) => item.monoId,
    );
    const combined = [
      ...(current ? [current] : []),
      ...queued.filter((id) => id !== current),
    ];
    setActiveByChannel((prev) => {
      const next = new Map(prev);
      if (combined.length === 0) next.delete(channelId);
      else next.set(channelId, combined);
      return next;
    });
  }, []);

  const ensureBackingSession = useCallback(
    async (channel: MonoChannel, monoId: string): Promise<Session | undefined> => {
      const h = hostRef.current;
      const mono = findMono(monoId);
      if (!mono) return undefined;
      const monoSession = await h.ensureMono(monoId);
      if (!monoSession) return undefined;

      const existingId = channel.memberSessions[monoId];
      if (existingId) {
        const existing =
          h.sessions().find((s) => s.id === existingId) ??
          (await h.openSession(existingId));
        if (existing) return existing;
        // Backing session record was missing from storage; reset the cursor so
        // the newly created backing session replays the channel context.
        clearChannelCursor(channel.id, monoId);
      }

      const look = monoLook(mono);
      const backing: Session = {
        ...newSession(
          monoSession.harness,
          mono.projects[0] ?? monoSession.cwd,
          monoSession.model,
          monoSession.runtimeMode,
          monoSession.modelSettings,
        ),
        title: `${look.name} · #${channel.name}`,
        sidebarHidden: true,
      };
      setChannelMemberSession(channel.id, monoId, backing.id);
      h.addSession(backing);
      return backing;
    },
    [],
  );

  const enqueueChannelTurns = useCallback(
    (channelId: string, monoIds: readonly string[], hop: number) => {
      if (hop > MAX_CHANNEL_AUTONOMOUS_HOPS || monoIds.length === 0) return;
      const queue = queuesRef.current.get(channelId) ?? [];
      for (const monoId of monoIds) {
        if (!findMono(monoId)) continue;
        // Allow at most one pending follow-up in the queue even if monoId is
        // currently the active speaker so concurrent messages are never lost.
        if (queue.some((entry) => entry.monoId === monoId)) {
          continue;
        }
        queue.push({ monoId, hop });
      }
      queuesRef.current.set(channelId, queue);
      syncChannelActiveState(channelId);

      if (workersRef.current.has(channelId)) return;
      workersRef.current.add(channelId);

      void (async () => {
        try {
          while (true) {
            const stopping = stoppingRef.current.get(channelId);
            if (stopping) await stopping.catch(() => undefined);
            const pending = queuesRef.current.get(channelId);
            const next = pending?.shift();
            if (!next) break;
            const generation = generationsRef.current.get(channelId) ?? 0;

            const channel = findMonoChannel(channelId);
            const mono = findMono(next.monoId);
            if (
              !channel ||
              !mono ||
              !channel.memberIds.includes(next.monoId)
            ) {
              syncChannelActiveState(channelId);
              continue;
            }

            runningSpeakerRef.current.set(channelId, next.monoId);
            syncChannelActiveState(channelId);

            let backing: Session | undefined;
            try {
              backing = await ensureBackingSession(channel, next.monoId);
            } catch {
              backing = undefined;
            }
            if (
              !backing ||
              generation !== (generationsRef.current.get(channelId) ?? 0)
            ) {
              syncChannelActiveState(channelId);
              continue;
            }

            const freshChannel = findMonoChannel(channelId);
            if (!freshChannel) break;
            const { prompt, lastMessageId } = buildChannelTurnPrompt(
              freshChannel,
              next.monoId,
              next.hop,
            );
            if (!lastMessageId) {
              syncChannelActiveState(channelId);
              continue;
            }

            activeSessionByChannelRef.current.set(channelId, backing.id);
            activeHopBySessionRef.current.set(backing.id, next.hop);
            cliPostedInTurnRef.current.delete(`${backing.id}:${channelId}`);

            const beforeBlockCount =
              hostRef.current
                .sessions()
                .find((s) => s.id === backing.id)?.blocks.length ?? 0;

            let outcome: ControlOutcome;
            try {
              outcome = await hostRef.current.runTurn(backing.id, prompt);
            } catch (error) {
              outcome = {
                status: "failed",
                text: "",
                error: error instanceof Error ? error.message : String(error),
              };
            } finally {
              activeHopBySessionRef.current.delete(backing.id);
              activeSessionByChannelRef.current.delete(channelId);
            }

            // Stop invalidates this turn even if a new message is already queued.
            // A cancelled turn must not post a reply or advance an unread cursor.
            if (generation !== (generationsRef.current.get(channelId) ?? 0)) {
              cliPostedInTurnRef.current.delete(`${backing.id}:${channelId}`);
              continue;
            }

            // Record the last message this turn actually saw before posting its
            // reply; if new messages arrived concurrently, postChannelMessage
            // preserves this cursor so the queued follow-up turn sees them.
            markChannelCursor(channelId, next.monoId, lastMessageId);

            if (
              outcome.status !== "completed" ||
              cliPostedInTurnRef.current.has(`${backing.id}:${channelId}`)
            ) {
              cliPostedInTurnRef.current.delete(`${backing.id}:${channelId}`);
              continue;
            }

            const latestBacking = hostRef.current
              .sessions()
              .find((s) => s.id === backing.id);
            const rawReply =
              extractMonoTurnReply(latestBacking) || outcome.text || "";
            const reaction = parseMonoReaction(rawReply);
            if (reaction) {
              addChannelReaction(
                channelId,
                lastMessageId,
                next.monoId,
                reaction,
              );
              continue;
            }

            const cleaned = cleanMonoCollaborativeReply(rawReply);
            if (!cleaned) continue;

            const newBlocks =
              latestBacking?.blocks.slice(beforeBlockCount) ?? [];
            const newArtifacts = artifactCards(newBlocks);
            const newLaunches = monoSpawnedSessions(newBlocks);

            const postResult = postChannelMessage({
              channelId,
              from: { kind: "mono", monoId: next.monoId },
              text: cleaned,
              hop: next.hop,
              turnSessionId: backing.id,
              ...(newArtifacts.length ? { artifacts: newArtifacts } : {}),
              ...(newLaunches.length ? { spawnedSessions: newLaunches } : {}),
            });

            if (
              postResult.wakeMonoIds.length > 0 &&
              next.hop + 1 <= MAX_CHANNEL_AUTONOMOUS_HOPS
            ) {
              const currentQueue = queuesRef.current.get(channelId) ?? [];
              for (const targetMonoId of postResult.wakeMonoIds) {
                if (
                  !currentQueue.some((entry) => entry.monoId === targetMonoId)
                ) {
                  currentQueue.push({
                    monoId: targetMonoId,
                    hop: next.hop + 1,
                  });
                }
              }
              queuesRef.current.set(channelId, currentQueue);
              syncChannelActiveState(channelId);
            }
          }
        } finally {
          workersRef.current.delete(channelId);
          runningSpeakerRef.current.delete(channelId);
          activeSessionByChannelRef.current.delete(channelId);
          syncChannelActiveState(channelId);
        }
      })();
    },
    [ensureBackingSession, syncChannelActiveState],
  );

  const sendUserChannelMessage = useCallback(
    (channelId: string, text: string) => {
      const result = postChannelMessage({
        channelId,
        from: { kind: "user" },
        text,
        hop: 0,
      });
      if (result.wakeMonoIds.length > 0) {
        enqueueChannelTurns(channelId, result.wakeMonoIds, 1);
      }
    },
    [enqueueChannelTurns],
  );

  const stopChannel = useCallback(
    async (channelId: string) => {
      generationsRef.current.set(
        channelId,
        (generationsRef.current.get(channelId) ?? 0) + 1,
      );
      queuesRef.current.delete(channelId);
      const activeSessionId = activeSessionByChannelRef.current.get(channelId);
      runningSpeakerRef.current.delete(channelId);
      activeSessionByChannelRef.current.delete(channelId);
      syncChannelActiveState(channelId);
      if (activeSessionId) {
        const stopping = hostRef.current
          .stopSession(activeSessionId)
          .finally(() => {
            if (stoppingRef.current.get(channelId) === stopping) {
              stoppingRef.current.delete(channelId);
            }
          });
        stoppingRef.current.set(channelId, stopping);
        await stopping;
      }
    },
    [syncChannelActiveState],
  );

  const currentHop = useCallback((sourceSessionId: string): number => {
    return activeHopBySessionRef.current.get(sourceSessionId) ?? 0;
  }, []);

  const onCliChannelPosted = useCallback(
    (
      channel: MonoChannel,
      message: MonoChannelMessage,
      wakeMonoIds: string[],
      sourceSessionId: string,
    ) => {
      cliPostedInTurnRef.current.add(`${sourceSessionId}:${channel.id}`);
      if (wakeMonoIds.length > 0 && message.hop <= MAX_CHANNEL_AUTONOMOUS_HOPS) {
        enqueueChannelTurns(channel.id, wakeMonoIds, message.hop);
      }
    },
    [enqueueChannelTurns],
  );

  const busyChannelIds = useMemo(
    () => new Set(activeByChannel.keys()),
    [activeByChannel],
  );

  const activeMonoIdsForChannel = useCallback(
    (channelId: string): readonly string[] =>
      activeByChannel.get(channelId) ?? [],
    [activeByChannel],
  );

  return {
    busyChannelIds,
    activeMonoIdsForChannel,
    sendUserChannelMessage,
    stopChannel,
    currentHop,
    onCliChannelPosted,
    enqueueChannelTurns,
  };
}
