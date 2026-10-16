import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Check,
  MoreHorizontal,
  Plus,
  Square,
  Trash2,
} from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { Shimmer } from "../../../shared/ui/Shimmer";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { ArtifactCard } from "../../artifacts/ui/ArtifactCard";
import { LaunchedSessionCard } from "./LaunchedSessionCard";
import type { OpenFileFn } from "../../search/model/search";
import {
  findMono,
  listMonos,
  monoLook,
  type Mono,
  type MonoState,
} from "../model/mono";
import {
  updateMonoChannel,
  type MonoChannel,
  type MonoChannelMessage,
} from "../model/monoChannels";

export type MonoChannelViewProps = {
  channel: MonoChannel;
  /** Live state of each Mono in the app, keyed by Mono ID. */
  monoStates: ReadonlyMap<string, MonoState>;
  /** Monos currently running or queued in this channel, in order. */
  activeChannelMonoIds: readonly string[];
  onSendMessage: (channelId: string, text: string) => void;
  onStopChannel?: (channelId: string) => void;
  onOpenMono: (monoId: string) => void;
  onDeleteChannel: (channelId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
  onOpenFile?: OpenFileFn;
};

function formatChannelTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function MonoChannelView({
  channel,
  monoStates,
  activeChannelMonoIds,
  onSendMessage,
  onStopChannel,
  onOpenMono,
  onDeleteChannel,
  onOpenArtifact,
  onOpenSession,
  onOpenFile,
}: MonoChannelViewProps) {
  const [draft, setDraft] = useState("");
  const [manageAnchor, setManageAnchor] = useState<HTMLElement | null>(null);
  const [editingName, setEditingName] = useState(channel.name);
  const [editingTopic, setEditingTopic] = useState(channel.topic ?? "");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setEditingName(channel.name);
    setEditingTopic(channel.topic ?? "");
  }, [channel.id, channel.name, channel.topic]);

  const allMonos = useMemo(() => listMonos(), [channel.updatedAt, monoStates]);
  const memberMonos = useMemo(
    () =>
      channel.memberIds
        .map((id) => findMono(id))
        .filter((mono): mono is Mono => Boolean(mono)),
    [channel.memberIds, allMonos],
  );

  // Auto-scroll to bottom when new messages arrive or active speakers change.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [channel.id, channel.messages.length, activeChannelMonoIds.length]);

  const insertMention = useCallback((name: string) => {
    const token = `@${name} `;
    setDraft((prev) => {
      if (prev.includes(`@${name}`)) return prev;
      const prefix = prev && !prev.endsWith(" ") ? `${prev} ` : prev;
      return `${prefix}${token}`;
    });
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setDraft("");
    onSendMessage(channel.id, trimmed);
  }, [channel.id, draft, onSendMessage]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const toggleMember = (monoId: string) => {
    const exists = channel.memberIds.includes(monoId);
    if (exists && channel.memberIds.length <= 1) return;
    const nextMembers = exists
      ? channel.memberIds.filter((id) => id !== monoId)
      : [...channel.memberIds, monoId];
    updateMonoChannel(channel.id, (current) => ({
      ...current,
      memberIds: nextMembers,
    }));
  };

  const activeSpeakerMonos = useMemo(
    () =>
      activeChannelMonoIds
        .map((id) => findMono(id))
        .filter((mono): mono is Mono => Boolean(mono)),
    [activeChannelMonoIds, allMonos],
  );

  const empty = channel.messages.length === 0;

  return (
    <div
      data-mono-channel-view={channel.id}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-sans"
    >
      {/* Top bar with channel name, topic, member pills, and manage popover */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/45 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-6 items-center gap-1 rounded-md bg-content/[0.06] px-2 text-[13px] font-semibold text-content">
            <span className="text-content/45">#</span>
            <span>{channel.name}</span>
          </span>
          {channel.topic ? (
            <span className="min-w-0 truncate text-[12px] text-content/50">
              {channel.topic}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-1">
            {memberMonos.map((mono) => {
              const look = monoLook(mono);
              const state = monoStates.get(mono.id) ?? { status: "idle" };
              const speakingInChannel = activeChannelMonoIds.includes(mono.id);
              const effectiveStatus = speakingInChannel
                ? "working"
                : state.status;
              return (
                <button
                  key={mono.id}
                  type="button"
                  onClick={() => onOpenMono(mono.id)}
                  title={`Open ${look.name} (${effectiveStatus})`}
                  className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border/60 bg-surface-raised/60 pr-2.5 pl-1.5 text-[11px] font-medium text-content/80 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                >
                  <PixelMascot
                    name={look.mascot}
                    color={look.color}
                    status={effectiveStatus}
                    className="size-3.5 shrink-0"
                  />
                  {speakingInChannel ? (
                    <Shimmer as="span" duration={1.4} className="truncate">
                      {look.name}
                    </Shimmer>
                  ) : (
                    <span className="truncate">{look.name}</span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            title="Channel settings & members"
            aria-label="Channel settings and members"
            onClick={(event) =>
              setManageAnchor((prev) => (prev ? null : event.currentTarget))
            }
            className="grid size-6 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/[0.08] hover:text-content"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Scrollable transcript */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none px-6 py-6"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          {/* Channel Hero Header */}
          <header
            className={`flex flex-col items-center px-6 text-center ${
              empty ? "my-auto py-10" : "pb-6 pt-2"
            }`}
          >
            <div className="flex items-center justify-center -space-x-2">
              {memberMonos.map((mono, index) => {
                const look = monoLook(mono);
                const speaking = activeChannelMonoIds.includes(mono.id);
                return (
                  <div
                    key={mono.id}
                    style={{ zIndex: memberMonos.length - index }}
                    className="rounded-full bg-background-base/80 p-1 backdrop-blur-sm"
                  >
                    <PixelMascot
                      name={look.mascot}
                      color={look.color}
                      status={speaking ? "working" : "idle"}
                      className={empty ? "size-11" : "size-7"}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mono-pill -mt-1.5 flex h-8 items-center gap-1 rounded-full border px-3.5 backdrop-blur-md">
              <span className="text-[13px] font-medium text-content/45">#</span>
              <h2 className="text-[13px] font-semibold leading-none text-content">
                {channel.name}
              </h2>
            </div>
            <p className="mt-2.5 max-w-md text-[12.5px] leading-relaxed text-content/50">
              {channel.topic ||
                (memberMonos.length
                  ? `Shared channel with ${memberMonos
                      .map((mono) => monoLook(mono).name)
                      .join(", ")}. Mention @Name to direct a turn, or message the room and each Mono will weigh in.`
                  : "Add Monos to this channel so they can collaborate here.")}
            </p>
            {empty && memberMonos.length > 0 ? (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onSendMessage(
                      channel.id,
                      "@all Give a quick status check on your projects and anything you need from each other.",
                    )
                  }
                  className="rounded-full border border-border/60 bg-surface-raised/60 px-3 py-1.5 text-[12px] text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                >
                  @all Quick status check across projects
                </button>
                {memberMonos.length >= 2 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const first = monoLook(memberMonos[0]).name;
                      const second = monoLook(memberMonos[1]).name;
                      setDraft(
                        `@${first} @${second} Let's align on the API contract and implementation plan: `,
                      );
                      textareaRef.current?.focus();
                    }}
                    className="rounded-full border border-border/60 bg-surface-raised/60 px-3 py-1.5 text-[12px] text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                  >
                    Coordinate between {monoLook(memberMonos[0]).name} &{" "}
                    {monoLook(memberMonos[1]).name}
                  </button>
                ) : null}
              </div>
            ) : null}
          </header>

          {/* Messages */}
          <div className="flex flex-col gap-5">
            {channel.messages.map((message) => (
              <ChannelMessageRow
                key={message.id}
                message={message}
                onOpenMono={onOpenMono}
                onOpenArtifact={onOpenArtifact}
                onOpenSession={onOpenSession}
                onOpenFile={onOpenFile}
              />
            ))}

            {/* Live speaker indicator */}
            {activeSpeakerMonos.length > 0 ? (
              <div
                data-channel-active-speakers
                className="flex items-center justify-between gap-3 rounded-xl border border-border/45 bg-surface-raised/45 px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <PixelMascot
                    name={monoLook(activeSpeakerMonos[0]).mascot}
                    color={monoLook(activeSpeakerMonos[0]).color}
                    status="working"
                    className="size-5 shrink-0"
                  />
                  <Shimmer
                    as="span"
                    duration={1.4}
                    className="truncate text-[12.5px] font-medium text-content/80"
                  >
                    {activeSpeakerMonos.length === 1
                      ? `${monoLook(activeSpeakerMonos[0]).name} is replying in #${channel.name}...`
                      : `${monoLook(activeSpeakerMonos[0]).name} is replying (${activeSpeakerMonos.length - 1} more queued)...`}
                  </Shimmer>
                </div>
                {onStopChannel ? (
                  <button
                    type="button"
                    onClick={() => onStopChannel(channel.id)}
                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] font-medium text-content/65 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                  >
                    <Square className="size-2.5 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Channel Composer */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border/65 bg-surface-raised/85 p-3 shadow-sm backdrop-blur-md">
          {/* Quick @Mention chips */}
          {memberMonos.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-content/40">Mention:</span>
              <button
                type="button"
                onClick={() => insertMention("all")}
                className="inline-flex h-5 items-center rounded-full border border-border/55 bg-content/[0.04] px-2 text-[11px] font-medium text-content/65 transition-colors hover:border-content/25 hover:bg-content/[0.08] hover:text-content"
              >
                @all
              </button>
              {memberMonos.map((mono) => {
                const look = monoLook(mono);
                return (
                  <button
                    key={mono.id}
                    type="button"
                    onClick={() => insertMention(look.name)}
                    className="inline-flex h-5 items-center gap-1 rounded-full border border-border/55 bg-content/[0.04] px-2 text-[11px] font-medium text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.08] hover:text-content"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: look.color }}
                    />
                    <span>@{look.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${channel.name} — use @Name to direct a turn, or write to the whole room...`}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-content placeholder:text-content/40 focus:outline-none"
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={handleSubmit}
              aria-label={`Send to #${channel.name}`}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-opacity disabled:opacity-35"
            >
              <ArrowUp className="size-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>

      {/* Manage Channel Popover */}
      {manageAnchor ? (
        <Popover
          anchor={manageAnchor}
          onDismiss={() => setManageAnchor(null)}
          align="end"
          className="w-72 p-3 font-sans"
        >
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-content/45">
            Channel Settings
          </div>
          <label className="mb-2 block">
            <span className="mb-1 block text-[11px] text-content/55">Name</span>
            <input
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onBlur={() => {
                if (editingName.trim()) {
                  updateMonoChannel(channel.id, (current) => ({
                    ...current,
                    name: editingName,
                  }));
                }
              }}
              className="h-7 w-full rounded-md border border-border/65 bg-content/[0.04] px-2 text-[12.5px] text-content focus:border-accent focus:outline-none"
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-content/55">
              Topic
            </span>
            <input
              type="text"
              value={editingTopic}
              placeholder="What do Monos coordinate here?"
              onChange={(event) => setEditingTopic(event.target.value)}
              onBlur={() => {
                updateMonoChannel(channel.id, (current) => ({
                  ...current,
                  topic: editingTopic.trim() || undefined,
                }));
              }}
              className="h-7 w-full rounded-md border border-border/65 bg-content/[0.04] px-2 text-[12.5px] text-content placeholder:text-content/35 focus:border-accent focus:outline-none"
            />
          </label>
          <div className="mb-1.5 text-[11px] font-medium text-content/55">
            Members ({channel.memberIds.length})
          </div>
          <div className="mb-3 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
            {allMonos.map((mono) => {
              const look = monoLook(mono);
              const included = channel.memberIds.includes(mono.id);
              return (
                <button
                  key={mono.id}
                  type="button"
                  onClick={() => toggleMember(mono.id)}
                  className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-content/85 hover:bg-content/[0.06]"
                >
                  <PixelMascot
                    name={look.mascot}
                    color={look.color}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{look.name}</span>
                  {included ? (
                    <Check
                      className="size-3.5 shrink-0 text-accent"
                      strokeWidth={2}
                    />
                  ) : (
                    <Plus
                      className="size-3.5 shrink-0 text-content/35"
                      strokeWidth={1.75}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border/50 pt-2">
            <button
              type="button"
              onClick={() => {
                setManageAnchor(null);
                onDeleteChannel(channel.id);
              }}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-danger hover:bg-danger/10"
            >
              <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>Delete channel</span>
            </button>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

function ChannelMessageRow({
  message,
  onOpenMono,
  onOpenArtifact,
  onOpenSession,
  onOpenFile,
}: {
  message: MonoChannelMessage;
  onOpenMono: (monoId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
  onOpenFile?: OpenFileFn;
}) {
  if (message.from.kind === "user") {
    return (
      <div
        data-channel-message={message.id}
        data-channel-sender="user"
        className="flex flex-col items-end"
      >
        <div className="max-w-[min(34rem,85%)] rounded-2xl bg-content/[0.08] px-4 py-2.5 text-[13.5px] leading-relaxed text-content">
          <div className="whitespace-pre-wrap break-words">{message.text}</div>
        </div>
        <div className="mt-1 flex items-center gap-2 px-1">
          {message.reactions?.length ? (
            <div className="flex items-center gap-1">
              {message.reactions.map((reaction, idx) => (
                <span
                  key={`${reaction.monoId}-${idx}`}
                  title={reaction.name}
                  className="inline-flex h-5 items-center gap-1 rounded-full border border-border/55 bg-surface-raised px-1.5 text-[11px]"
                >
                  <span>{reaction.emoji}</span>
                  <span className="text-[10px] text-content/55">
                    {reaction.name}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
          <span className="text-[11px] text-content/35">
            {formatChannelTimestamp(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  const sender = message.from;
  const liveMono = findMono(sender.monoId);
  const look = liveMono
    ? monoLook(liveMono)
    : {
        name: sender.name,
        mascot: sender.mascot,
        color: sender.color,
        projects: [],
      };
  const cwd = liveMono?.projects[0];

  return (
    <div
      data-channel-message={message.id}
      data-channel-sender={sender.monoId}
      className="flex items-start gap-3"
    >
      <button
        type="button"
        onClick={() => onOpenMono(sender.monoId)}
        title={`Open ${look.name}`}
        className="mt-0.5 shrink-0 rounded-full p-0.5 transition-transform hover:scale-105"
      >
        <PixelMascot
          name={look.mascot}
          color={look.color}
          className="size-6 shrink-0"
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenMono(sender.monoId)}
            className="text-[13px] font-semibold text-content hover:underline"
          >
            {look.name}
          </button>
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: look.color }}
          />
          <span className="text-[11px] text-content/40">
            {formatChannelTimestamp(message.createdAt)}
          </span>
          {message.hop > 1 ? (
            <span
              title="Autonomous Mono-to-Mono reply hop"
              className="rounded-full bg-content/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-content/50"
            >
              peer hop {message.hop}
            </span>
          ) : null}
        </div>
        <div className="text-[13.5px] leading-relaxed text-content/90">
          <AgentMarkdown
            text={message.text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
        {message.artifacts?.length || message.spawnedSessions?.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {message.artifacts?.map((card) => (
              <ArtifactCard
                key={card.id}
                card={card}
                onOpen={onOpenArtifact}
              />
            ))}
            {message.spawnedSessions?.map((session) => (
              <LaunchedSessionCard
                key={session.sessionId}
                launch={session}
                onOpen={
                  onOpenSession
                    ? () => onOpenSession(session.sessionId, session.cwd)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}
        {message.reactions?.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {message.reactions.map((reaction, idx) => (
              <span
                key={`${reaction.monoId}-${idx}`}
                title={reaction.name}
                className="inline-flex h-5 items-center gap-1 rounded-full border border-border/55 bg-surface-raised px-1.5 text-[11px]"
              >
                <span>{reaction.emoji}</span>
                <span className="text-[10px] text-content/55">
                  {reaction.name}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
