import type { InboxItem, InboxComposerCard } from "./githubTasks";
import { ticketComposerCard } from "./ticketContext";
import type { Session } from "../../sessions/model/session";

/** Attach before revealing the Mono, preserving its conversation and current draft. */
export async function openTicketInMono(
  item: InboxItem,
  monoId: string,
  host: {
    ensure: (id: string) => Promise<Session | undefined>;
    current: (id: string) => Session | undefined;
    attach: (id: string, card: InboxComposerCard) => void;
    reveal: (id: string) => Promise<void>;
  },
  body?: string,
) {
  const card = ticketComposerCard(item, body);
  const session = await host.ensure(monoId);
  if (!session)
    throw new Error(
      "This Mono is no longer available. Choose another destination.",
    );
  if ((host.current(session.id) ?? session).inboxCard)
    throw new Error(
      "This Mono already has a ticket attached. Send or remove it before attaching another.",
    );
  host.attach(session.id, card);
  await host.reveal(monoId);
}
