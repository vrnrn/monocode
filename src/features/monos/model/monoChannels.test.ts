// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMono, saveMonoName } from "./mono";
import {
  addChannelReaction,
  buildChannelTurnPrompt,
  channelForMemberSession,
  cleanMonoCollaborativeReply,
  createMonoChannel,
  enqueueMonoPeerMessage,
  findMonoChannel,
  isMonoPassReply,
  listMonoChannels,
  listMonoPeerSummaries,
  markChannelCursor,
  MAX_CHANNEL_AUTONOMOUS_HOPS,
  MAX_PEER_AUTONOMOUS_HOPS,
  monoPeersAndChannelsBrief,
  parseChannelMentions,
  postChannelMessage,
  removeMonoChannel,
  resolveMonoPeer,
  setChannelMemberSession,
} from "./monoChannels";
import { canSteerQueuedHead } from "../../sessions/model/messageQueue";
import { newSession } from "../../sessions/model/session";
import { handleAgentApp, type AgentAppHost } from "../../agent-app/model/agentApp";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("monoChannels & peer Mono collaboration", () => {
  it("resolves peer Monos by id or case-insensitive name and lists summaries", () => {
    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");

    expect(resolveMonoPeer("skull")?.id).toBe(skull.id);
    expect(resolveMonoPeer("@Cypress")?.id).toBe(cypress.id);
    expect(resolveMonoPeer(cypress.id)?.id).toBe(cypress.id);
    expect(resolveMonoPeer("Skull", skull.id)).toBeUndefined();

    const peersForSkull = listMonoPeerSummaries({ excludeMonoId: skull.id });
    expect(peersForSkull).toHaveLength(1);
    expect(peersForSkull[0]).toMatchObject({
      id: cypress.id,
      name: "Cypress",
      projects: [{ name: "web", path: "/code/web" }],
    });
  });

  it("queues direct peer Mono messages idempotently and never steers mid-turn", () => {
    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");

    const session = {
      ...newSession("claude", "/code/web"),
      id: cypress.id,
      busy: true,
      turnReady: true,
    };

    const first = enqueueMonoPeerMessage(session, {
      fromMonoId: skull.id,
      toMonoId: cypress.id,
      text: "What auth header does web send?",
      requestId: "req-1",
      expectReply: true,
      hop: 1,
    });
    expect(first.alreadyQueued).toBe(false);
    expect(first.session.queuedMessages).toHaveLength(1);
    expect(first.session.queuedMessages?.[0]?.monoPeerMessage).toMatchObject({
      fromMonoId: skull.id,
      fromName: "Skull",
      expectReply: true,
      hop: 1,
      requestId: "req-1",
    });

    // Peer messages must wait for an idle turn rather than steering mid-reply.
    expect(canSteerQueuedHead(first.session)).toBe(false);

    // Retrying with the same requestId is idempotent.
    const duplicate = enqueueMonoPeerMessage(first.session, {
      fromMonoId: skull.id,
      toMonoId: cypress.id,
      text: "What auth header does web send?",
      requestId: "req-1",
      expectReply: true,
      hop: 1,
    });
    expect(duplicate.alreadyQueued).toBe(true);
    expect(duplicate.session.queuedMessages).toHaveLength(1);
  });

  it("parses @mentions and routes user vs Mono channel messages with hop limits", () => {
    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");
    const boba = createMono(["/code/infra"]);
    saveMonoName(boba.id, "Boba");

    const channel = createMonoChannel({
      name: "Backend Sync",
      topic: "API & Web coordination",
      memberIds: [skull.id, cypress.id, boba.id],
    });
    expect(channel.name).toBe("backend-sync");
    expect(listMonoChannels()).toHaveLength(1);

    // 1. User message without @mentions wakes all member Monos in roster order.
    const broadcast = postChannelMessage({
      channelId: channel.id,
      from: { kind: "user" },
      text: "Status check everyone!",
    });
    expect(broadcast.wakeMonoIds).toEqual([skull.id, cypress.id, boba.id]);

    // 2. User message with specific @mention wakes only the mentioned Mono(s).
    const targeted = postChannelMessage({
      channelId: channel.id,
      from: { kind: "user" },
      text: "Hey @Cypress can you check the login form?",
    });
    expect(targeted.wakeMonoIds).toEqual([cypress.id]);

    // 3. Mono message wakes only explicitly @mentioned peers (never itself).
    const monoToMono = postChannelMessage({
      channelId: channel.id,
      from: { kind: "mono", monoId: cypress.id },
      text: "@Skull I need the new `/v2/session` schema.",
      hop: 1,
    });
    expect(monoToMono.wakeMonoIds).toEqual([skull.id]);

    // 4. Mono message without @mentions does not wake other Monos (prevents loops).
    const monoSummary = postChannelMessage({
      channelId: channel.id,
      from: { kind: "mono", monoId: skull.id },
      text: "Here is the schema summary for the room.",
      hop: 2,
    });
    expect(monoSummary.wakeMonoIds).toEqual([]);

    // 5. Mono message at MAX_CHANNEL_AUTONOMOUS_HOPS does not wake further Monos.
    const capped = postChannelMessage({
      channelId: channel.id,
      from: { kind: "mono", monoId: skull.id },
      text: "@Boba please deploy this.",
      hop: MAX_CHANNEL_AUTONOMOUS_HOPS,
    });
    expect(capped.wakeMonoIds).toEqual([]);
  });

  it("tracks per-Mono unread channel cursors and backing sessions", () => {
    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");

    const channel = createMonoChannel({
      name: "release-room",
      memberIds: [skull.id, cypress.id],
    });
    setChannelMemberSession(channel.id, skull.id, "backing-skull-1");
    expect(channelForMemberSession("backing-skull-1")).toEqual({
      channel: expect.objectContaining({ id: channel.id }),
      monoId: skull.id,
    });

    const first = postChannelMessage({
      channelId: channel.id,
      from: { kind: "user" },
      text: "@Skull check tests",
    });
    const turn1 = buildChannelTurnPrompt(
      findMonoChannel(channel.id)!,
      skull.id,
      1,
    );
    expect(turn1.prompt).toContain("#release-room");
    expect(turn1.prompt).toContain("@Skull check tests");
    expect(turn1.lastMessageId).toBe(first.message.id);

    markChannelCursor(channel.id, skull.id, first.message.id);
    const second = postChannelMessage({
      channelId: channel.id,
      from: { kind: "mono", monoId: cypress.id },
      text: "@Skull frontend is green",
      hop: 1,
    });

    const turn2 = buildChannelTurnPrompt(
      findMonoChannel(channel.id)!,
      skull.id,
      2,
    );
    expect(turn2.prompt).toContain("@Skull frontend is green");
    expect(turn2.lastMessageId).toBe(second.message.id);

    addChannelReaction(channel.id, second.message.id, skull.id, "👍");
    expect(
      findMonoChannel(channel.id)?.messages.find(
        (m) => m.id === second.message.id,
      )?.reactions,
    ).toEqual([{ emoji: "👍", monoId: skull.id, name: "Skull" }]);

    removeMonoChannel(channel.id);
    expect(findMonoChannel(channel.id)).toBeUndefined();
  });

  it("recognizes <pass/> replies and builds the collaboration brief", () => {
    expect(isMonoPassReply("<pass/>")).toBe(true);
    expect(isMonoPassReply("PASS")).toBe(true);
    expect(cleanMonoCollaborativeReply("<pass/>")).toBe("");
    expect(cleanMonoCollaborativeReply("Ship it <pass/>")).toBe("Ship it");

    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");
    createMonoChannel({
      name: "arch",
      topic: "Architecture",
      memberIds: [skull.id, cypress.id],
    });

    const brief = monoPeersAndChannelsBrief(skull.id);
    expect(brief).toContain("<mono_collaboration_rules>");
    expect(brief).toContain("Cypress");
    expect(brief).toContain("#arch");
    expect(brief).toContain("app monos.send");
    expect(brief).toContain("app channels.post");
  });

  it("handles monos.* and channels.* CLI actions through handleAgentApp", async () => {
    const skull = createMono(["/code/api"]);
    saveMonoName(skull.id, "Skull");
    const cypress = createMono(["/code/web"]);
    saveMonoName(cypress.id, "Cypress");

    const skullSession = {
      ...newSession("claude", "/code/api"),
      id: skull.id,
    };
    const cypressSession = {
      ...newSession("codex", "/code/web"),
      id: cypress.id,
      blocks: [
        { id: "u1", role: "user" as const, text: "Check web build" },
        { id: "a1", role: "assistant" as const, text: "Web build passed." },
      ],
    };

    const sentPeerMessages: unknown[] = [];
    const postedChannels: unknown[] = [];

    const host: AgentAppHost = {
      start: async () => {},
      sessions: async () => [],
      session: async (id) => (id === cypress.id ? cypressSession : null),
      send: async () => ({ alreadySubmitted: false }),
      draft: async () => ({ alreadySaved: false, draft: true }),
      stop: async () => {},
      remove: async () => {},
      worktrees: async () => ({ worktrees: [] }),
      createWorktree: async () => ({
        path: "/code/web",
        branch: "main",
        head: "abc",
        main: true,
        locked: false,
        missing: false,
      }),
      notes: async () => [],
      note: async () => null,
      saveNote: async (n) => ({
        id: n.id ?? "n1",
        title: n.title ?? "",
        body: n.body,
        tags: n.tags ?? [],
        createdAt: 1,
        updatedAt: 1,
      }),
      isMono: (id) => id === skull.id || id === cypress.id,
      monoOf: (id) =>
        id === skull.id
          ? { id: skull.id, projects: ["/code/api"] }
          : id === cypress.id
            ? { id: cypress.id, projects: ["/code/web"] }
            : undefined,
      monos: {
        session: async (id) => (id === cypress.id ? cypressSession : null),
        send: async (input) => {
          sentPeerMessages.push(input);
          return { alreadyQueued: false };
        },
      },
      channels: {
        currentHop: () => 0,
        onPosted: (channel, message, wakeMonoIds) => {
          postedChannels.push({
            channelId: channel.id,
            messageId: message.id,
            wakeMonoIds,
          });
        },
      },
      agentFiles: async (id) => ({
        id,
        dir: `/data/${id}`,
        soul: "",
        soulHash: "h1",
        memory: "",
        memoryHash: "m1",
        memoryPath: `/data/${id}/MEMORY.md`,
        topics: [],
      }),
      readAgentFile: async () => ({ text: "", hash: "h1" }),
      writeAgentFile: async () => "h2",
    };

    const listed = (await handleAgentApp(
      skullSession,
      "req-list",
      "monos.list",
      {},
      host,
    )) as { monos: { id: string; name: string }[] };
    expect(listed.monos).toHaveLength(1);
    expect(listed.monos[0]?.name).toBe("Cypress");

    const readResult = (await handleAgentApp(
      skullSession,
      "req-read",
      "monos.read",
      { mono: "Cypress", limit: 2 },
      host,
    )) as {
      mono: { name: string };
      turns: { assistant: { text: string; truncated: boolean } | null }[];
    };
    expect(readResult.mono.name).toBe("Cypress");
    expect(readResult.turns[0]?.assistant?.text).toContain("Web build passed.");

    const sendResult = (await handleAgentApp(
      skullSession,
      "req-send",
      "monos.send",
      { to: "Cypress", message: "Can you verify the CORS origin?" },
      host,
    )) as { queued: boolean; expectReply: boolean; hop: number };
    expect(sendResult).toMatchObject({
      queued: true,
      expectReply: true,
      hop: 1,
    });
    expect(sentPeerMessages).toHaveLength(1);

    // Rejects self-messaging
    await expect(
      handleAgentApp(
        skullSession,
        "req-self",
        "monos.send",
        { to: "Skull", message: "Hi me" },
        host,
      ),
    ).rejects.toThrow(/yourself/);

    // Rejects when hop limit is exceeded
    const exhaustedSession = {
      ...skullSession,
      blocks: [
        {
          id: "p1",
          role: "user" as const,
          text: "Peer prompt",
          monoPeerMessage: {
            fromMonoId: cypress.id,
            fromName: "Cypress",
            fromMascot: cypress.mascot,
            fromColor: cypress.color,
            text: "hop 4",
            expectReply: false,
            hop: MAX_PEER_AUTONOMOUS_HOPS,
            requestId: "r4",
          },
        },
      ],
    };
    await expect(
      handleAgentApp(
        exhaustedSession,
        "req-over-hop",
        "monos.send",
        { to: "Cypress", message: "One more hop" },
        host,
      ),
    ).rejects.toThrow(/hop limit/);

    // Channels create, post, read, list
    const createdChan = (await handleAgentApp(
      skullSession,
      "req-chan-create",
      "channels.create",
      {
        name: "release-coordination",
        members: ["Cypress"],
        topic: "Release v2",
        message: "@Cypress ready for cut?",
      },
      host,
    )) as {
      channel: { id: string; name: string };
      posted: { wokeMonos: { name: string }[] };
    };
    expect(createdChan.channel.name).toBe("release-coordination");
    expect(createdChan.posted.wokeMonos).toEqual([
      { id: cypress.id, name: "Cypress" },
    ]);
    expect(postedChannels).toHaveLength(1);

    const postedChan = (await handleAgentApp(
      skullSession,
      "req-chan-post",
      "channels.post",
      {
        channel: "release-coordination",
        message: "Tag v2.0.0 is pushed.",
        to: ["Cypress"],
      },
      host,
    )) as { wokeMonos: { name: string }[] };
    expect(postedChan.wokeMonos).toEqual([{ id: cypress.id, name: "Cypress" }]);

    const readChan = (await handleAgentApp(
      skullSession,
      "req-chan-read",
      "channels.read",
      { channel: "release-coordination", limit: 10 },
      host,
    )) as { messages: { text: string }[] };
    expect(readChan.messages).toHaveLength(2);
  });
});
