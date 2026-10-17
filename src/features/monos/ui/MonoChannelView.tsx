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
  ChevronRight as ArrowRight,
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
  MAX_CHANNEL_AUTONOMOUS_HOPS,
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

type MessageFlowNode =
  | {
      key: string;
      kind: "user";
      label: string;
      state: "sent";
    }
  | {
      key: string;
      kind: "mono";
      monoId: string;
      name: string;
      mascot: string;
      color: string;
      hop?: number;
      state: "sent" | "speaking" | "queued";
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

/**
 * Build the message-passing flow chain for the latest exchange in the channel
 * so the user can visually see how messages are being routed from User -> Mono
 * -> Peer Mono -> Queued Monos.
 */
function buildChannelMessageFlow(
  messages: readonly MonoChannelMessage[],
  activeChannelMonoIds: readonly string[],
): MessageFlowNode[] {
  const nodes: MessageFlowNode[] = [];
  if (messages.length === 0 && activeChannelMonoIds.length === 0) return nodes;

  let startIndex = Math.max(0, messages.length - 6);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].from.kind === "user") {
      startIndex = i;
      break;
    }
  }

  for (const msg of messages.slice(startIndex)) {
    if (msg.from.kind === "user") {
      nodes.push({
        key: `msg-${msg.id}`,
        kind: "user",
        label: "You",
        state: "sent",
      });
    } else {
      const liveMono = findMono(msg.from.monoId);
      const look = liveMono
        ? monoLook(liveMono)
        : {
            name: msg.from.name,
            mascot: msg.from.mascot,
            color: msg.from.color,
          };
      nodes.push({
        key: `msg-${msg.id}`,
        kind: "mono",
        monoId: msg.from.monoId,
        name: look.name,
        mascot: look.mascot,
        color: look.color,
        hop: msg.hop,
        state: "sent",
      });
    }
  }

  activeChannelMonoIds.forEach((monoId, index) => {
    const mono = findMono(monoId);
    if (!mono) return;
    const look = monoLook(mono);
    nodes.push({
      key: `active-${monoId}-${index}`,
      kind: "mono",
      monoId,
      name: look.name,
      mascot: look.mascot,
      color: look.color,
      state: index === 0 ? "speaking" : "queued",
    });
  });

  return nodes;
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

  const flowNodes = useMemo(
    () => buildChannelMessageFlow(channel.messages, activeChannelMonoIds),
    [channel.messages, activeChannelMonoIds],
  );

  const empty = channel.messages.length === 0;

  return (
    <div
      data-mono-channel-view={channel.id}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col font-sans"
    >
      {/* Slack-like Top Channel Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke bg-selection-subtle px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-stroke bg-content/[0.05] px-2.5 text-[13.5px] font-semibold text-content">
            <span className="font-bold text-accent">#</span>
            <span className="truncate">{channel.name}</span>
          </div>
          {channel.topic ? (
            <>
              <span className="h-3.5 w-px shrink-0 bg-stroke" />
              <span className="min-w-0 truncate text-[12px] text-content/55">
                {channel.topic}
              </span>
            </>
          ) : null}
          <span className="shrink-0 rounded-full bg-content/[0.05] px-2 py-0.5 text-[11px] tabular-nums text-content/45">
            {channel.messages.length}{" "}
            {channel.messages.length === 1 ? "message" : "messages"}
          </span>
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
                  className={`inline-flex h-6 items-center gap-1.5 rounded-full border pr-2.5 pl-1.5 text-[11px] font-medium transition-colors ${
                    speakingInChannel
                      ? "border-accent/45 bg-accent/10 text-content"
                      : "border-stroke bg-selection-subtle text-content/80 hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                  }`}
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
            className="grid size-7 place-items-center rounded-md text-content/55 transition-colors hover:bg-content/[0.08] hover:text-content"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Message-Passing Flow Strip: visualizes messages being passed around */}
      {flowNodes.length > 0 ? (
        <div
          data-channel-message-flow
          className="flex shrink-0 items-center justify-between gap-3 border-b border-stroke bg-content/[0.02] px-5 py-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-content/40">
              Message Flow
            </span>
            {flowNodes.map((node, idx) => (
              <div key={node.key} className="flex shrink-0 items-center gap-1.5">
                {idx > 0 ? (
                  <ArrowRight
                    className="size-3 shrink-0 text-content/35"
                    strokeWidth={2}
                  />
                ) : null}
                {node.kind === "user" ? (
                  <span className="inline-flex h-5 items-center gap-1 rounded-md border border-stroke bg-selection-subtle px-2 text-[11px] font-medium text-content/75">
                    <span>{node.label}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenMono(node.monoId)}
                    className={`inline-flex h-5 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                      node.state === "speaking"
                        ? "border-accent/50 bg-accent/12 text-content"
                        : node.state === "queued"
                          ? "border-dashed border-stroke bg-content/[0.03] text-content/55"
                          : "border-stroke bg-selection-subtle text-content/85 hover:border-content/30"
                    }`}
                  >
                    <PixelMascot
                      name={node.mascot}
                      color={node.color}
                      status={node.state === "speaking" ? "working" : "idle"}
                      className="size-3 shrink-0"
                    />
                    {node.state === "speaking" ? (
                      <Shimmer as="span" duration={1.4}>
                        {node.name}
                      </Shimmer>
                    ) : (
                      <span>{node.name}</span>
                    )}
                    {node.hop != null && node.hop > 0 ? (
                      <span className="text-[9.5px] tabular-nums text-content/45">
                        h{node.hop}
                      </span>
                    ) : null}
                    {node.state === "queued" ? (
                      <span className="text-[9.5px] text-content/40">
                        next
                      </span>
                    ) : null}
                  </button>
                )}
              </div>
            ))}
          </div>

          {activeSpeakerMonos.length > 0 && onStopChannel ? (
            <button
              type="button"
              onClick={() => onStopChannel(channel.id)}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-stroke bg-selection-subtle px-2 text-[11px] font-medium text-content/70 transition-colors hover:border-content/30 hover:bg-content/[0.06] hover:text-content"
            >
              <Square className="size-2.5 fill-current" />
              <span>Stop</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Scrollable Slack-style transcript */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none px-6 py-5"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          {/* Channel Hero Header */}
          <header
            className={`flex flex-col items-start border-b border-stroke pb-5 ${
              empty ? "my-auto items-center border-none py-10 text-center" : "mb-4 pt-1"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center -space-x-2">
                {memberMonos.map((mono, index) => {
                  const look = monoLook(mono);
                  const speaking = activeChannelMonoIds.includes(mono.id);
                  return (
                    <div
                      key={mono.id}
                      style={{ zIndex: memberMonos.length - index }}
                      className="rounded-full bg-background-base/90 p-1 ring-1 ring-stroke backdrop-blur-sm"
                    >
                      <PixelMascot
                        name={look.mascot}
                        color={look.color}
                        status={speaking ? "working" : "idle"}
                        className={empty ? "size-9" : "size-6"}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-lg font-bold text-accent">#</span>
                <h2 className="text-base font-semibold text-content">
                  {channel.name}
                </h2>
              </div>
            </div>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-content/55">
              {channel.topic ||
                (memberMonos.length
                  ? `This is the start of #${channel.name} with ${memberMonos
                      .map((mono) => monoLook(mono).name)
                      .join(", ")}. Mention @Name to pass a message to a specific Mono, or write to the room so each Mono weighs in.`
                  : "Add Monos to this channel so they can pass messages and collaborate here.")}
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
                  className="rounded-full border border-stroke bg-selection-subtle px-3 py-1.5 text-[12px] text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
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
                    className="rounded-full border border-stroke bg-selection-subtle px-3 py-1.5 text-[12px] text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                  >
                    Coordinate between {monoLook(memberMonos[0]).name} &{" "}
                    {monoLook(memberMonos[1]).name}
                  </button>
                ) : null}
              </div>
            ) : null}
          </header>

          {/* Slack-style Message Stream */}
          <div className="flex flex-col divide-y divide-stroke">
            {channel.messages.map((message) => (
              <ChannelMessageRow
                key={message.id}
                channelName={channel.name}
                memberMonos={memberMonos}
                message={message}
                onOpenMono={onOpenMono}
                onOpenArtifact={onOpenArtifact}
                onOpenSession={onOpenSession}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>

          {/* Live speaker indicator in the feed */}
          {activeSpeakerMonos.length > 0 ? (
            <div
              data-channel-active-speakers
              className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.05] px-3.5 py-2.5"
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
                  className="truncate text-[12.5px] font-medium text-content/85"
                >
                  {activeSpeakerMonos.length === 1
                    ? `${monoLook(activeSpeakerMonos[0]).name} is replying in #${channel.name}...`
                    : `${monoLook(activeSpeakerMonos[0]).name} is replying (passing next to ${activeSpeakerMonos
                        .slice(1)
                        .map((m) => monoLook(m).name)
                        .join(", ")})...`}
                </Shimmer>
              </div>
              {onStopChannel ? (
                <button
                  type="button"
                  onClick={() => onStopChannel(channel.id)}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-stroke bg-selection-subtle px-2 text-[11px] font-medium text-content/70 transition-colors hover:border-content/25 hover:bg-content/[0.06] hover:text-content"
                >
                  <Square className="size-2.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Slack-like Channel Composer */}
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border border-stroke bg-selection-subtle p-3 shadow-sm backdrop-blur-md">
          {/* Quick @Mention chips */}
          {memberMonos.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-content/45">Pass to:</span>
              <button
                type="button"
                onClick={() => insertMention("all")}
                className="inline-flex h-5 items-center rounded-full border border-stroke bg-content/[0.04] px-2 text-[11px] font-medium text-content/65 transition-colors hover:border-content/25 hover:bg-content/[0.08] hover:text-content"
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
                    className="inline-flex h-5 items-center gap-1 rounded-full border border-stroke bg-content/[0.04] px-2 text-[11px] font-medium text-content/75 transition-colors hover:border-content/25 hover:bg-content/[0.08] hover:text-content"
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
              placeholder={`Message #${channel.name} — use @Name to pass a message to a Mono, or message the whole room...`}
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
              className="h-7 w-full rounded-md border border-stroke bg-content/[0.04] px-2 text-[12.5px] text-content focus:border-accent focus:outline-none"
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
              className="h-7 w-full rounded-md border border-stroke bg-content/[0.04] px-2 text-[12.5px] text-content placeholder:text-content/35 focus:border-accent focus:outline-none"
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
          <div className="border-t border-stroke pt-2">
            <button
              type="button"
              onClick={() => {
                setManageAnchor(null);
                onDeleteChannel(channel.id);
              }}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-red-500 hover:bg-red-500/10"
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
  channelName,
  memberMonos,
  message,
  onOpenMono,
  onOpenArtifact,
  onOpenSession,
  onOpenFile,
}: {
  channelName: string;
  memberMonos: readonly Mono[];
  message: MonoChannelMessage;
  onOpenMono: (monoId: string) => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenSession?: (sessionId: string, cwd: string) => void;
  onOpenFile?: OpenFileFn;
}) {
  const fromMono = message.from.kind === "mono" ? message.from : undefined;
  const isUser = !fromMono;
  const senderMono = fromMono ? findMono(fromMono.monoId) : undefined;
  const senderLook = fromMono
    ? senderMono
      ? monoLook(senderMono)
      : {
          name: fromMono.name,
          mascot: fromMono.mascot,
          color: fromMono.color,
          projects: [],
        }
    : undefined;

  const recipientMonos = useMemo(() => {
    const ids = message.mentions.filter(
      (id) => !(fromMono && fromMono.monoId === id),
    );
    return ids
      .map((id) => findMono(id) ?? memberMonos.find((m) => m.id === id))
      .filter((m): m is Mono => Boolean(m));
  }, [fromMono, memberMonos, message.mentions]);

  const cwd = senderMono?.projects[0];

  return (
    <div
      data-channel-message={message.id}
      data-channel-sender={fromMono ? fromMono.monoId : "user"}
      className="-mx-3 flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-content/[0.025]"
    >
      {/* Left Slack-style Avatar */}
      {isUser ? (
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-stroke bg-content/[0.07] text-[11px] font-bold uppercase tracking-wider text-content/75">
          You
        </div>
      ) : (
        <button
          type="button"
          onClick={() =>
            message.from.kind === "mono" && onOpenMono(message.from.monoId)
          }
          title={`Open ${senderLook?.name ?? "Mono"}`}
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-stroke bg-selection-subtle transition-transform hover:scale-105"
        >
          <PixelMascot
            name={senderLook?.mascot ?? "invader"}
            color={senderLook?.color ?? "hsl(215 85% 60%)"}
            className="size-5 shrink-0"
          />
        </button>
      )}

      {/* Right Content Column */}
      <div className="min-w-0 flex-1">
        {/* Header: Sender + Routing / Message-Passing Target + Hop + Timestamp */}
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {isUser ? (
            <span className="text-[13px] font-semibold text-content">You</span>
          ) : (
            <button
              type="button"
              onClick={() =>
                message.from.kind === "mono" && onOpenMono(message.from.monoId)
              }
              className="text-[13px] font-semibold text-content hover:underline"
            >
              {senderLook?.name}
            </button>
          )}

          {/* Explicit Message-Passing Route Pill */}
          {recipientMonos.length > 0 ? (
            <span
              data-message-route="targeted"
              className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/[0.08] px-1.5 py-0.5 text-[10.5px] font-medium text-content/85"
            >
              <ArrowRight className="size-2.5 text-accent" strokeWidth={2.2} />
              <span>
                {recipientMonos.map((m) => `@${monoLook(m).name}`).join(", ")}
              </span>
            </span>
          ) : isUser ? (
            <span
              data-message-route="broadcast"
              className="inline-flex items-center gap-1 rounded-md bg-content/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium text-content/55"
            >
              <ArrowRight className="size-2.5 text-content/40" strokeWidth={2} />
              <span>#{channelName} (all Monos)</span>
            </span>
          ) : (
            <span
              data-message-route="room"
              className="inline-flex items-center gap-1 rounded-md bg-content/[0.04] px-1.5 py-0.5 text-[10.5px] text-content/45"
            >
              <ArrowRight className="size-2.5 text-content/35" strokeWidth={2} />
              <span>#{channelName}</span>
            </span>
          )}

          {!isUser && message.hop > 0 ? (
            <span
              title="Autonomous Mono-to-Mono turn hop"
              className="rounded-md bg-content/[0.05] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-content/45"
            >
              hop {message.hop}/{MAX_CHANNEL_AUTONOMOUS_HOPS}
            </span>
          ) : null}

          <span className="ml-auto text-[11px] tabular-nums text-content/35">
            {formatChannelTimestamp(message.createdAt)}
          </span>
        </div>

        {/* Message Body */}
        <div className="text-[13.5px] leading-relaxed text-content/90">
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.text}</div>
          ) : (
            <AgentMarkdown
              text={message.text}
              cwd={cwd}
              onOpenFile={onOpenFile}
            />
          )}
        </div>

        {/* Attached Artifacts & Spawned Sessions */}
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

        {/* Slack-style Emoji Reactions */}
        {message.reactions?.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {message.reactions.map((reaction, idx) => (
              <span
                key={`${reaction.monoId}-${idx}`}
                title={`Reacted by ${reaction.name}`}
                className="inline-flex h-5 items-center gap-1 rounded-full border border-stroke bg-selection-subtle px-2 text-[11px]"
              >
                <span>{reaction.emoji}</span>
                <span className="text-[10px] font-medium text-content/60">
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
