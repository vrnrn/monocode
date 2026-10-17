import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import {
  parseTicketContextLink,
  OPEN_TICKET_CONTEXT_EVENT,
  type TicketReference,
} from "../../features/inbox/model/ticketContext";

/** Native links open an unsent ticket card; only one workspace handles each event. */
export function useTicketDeepLinks(
  open: (ref: TicketReference) => Promise<void>,
) {
  const callback = useRef(open);
  callback.current = open;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const inApp = (event: Event) => {
      const ref = parseTicketContextLink((event as CustomEvent<string>).detail);
      if (ref)
        void callback.current(ref).catch((error) =>
          message(String(error), {
            title: "Could not open ticket context",
            kind: "error",
          }),
        );
    };
    window.addEventListener(OPEN_TICKET_CONTEXT_EVENT, inApp);
    const receive = async () => {
      const urls = await invoke<string[]>("take_ticket_context_links");
      if (disposed) return;
      for (const url of urls) {
        const ref = parseTicketContextLink(url);
        if (!ref) continue;
        try {
          await getCurrentWindow().unminimize();
          await getCurrentWindow().show();
          await getCurrentWindow().setFocus();
          await callback.current(ref);
        } catch (error) {
          await message(
            error instanceof Error ? error.message : String(error),
            { title: "Could not open ticket context", kind: "error" },
          );
        }
      }
    };
    void (async () => {
      unlisten = await listen("monocode:ticket-context-links", () => {
        void receive().catch((error) =>
          console.error("Could not receive ticket links", error),
        );
      });
      if (disposed) {
        unlisten();
        return;
      }
      await receive();
    })().catch((error) =>
      console.error("Could not listen for ticket context links", error),
    );
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(OPEN_TICKET_CONTEXT_EVENT, inApp);
    };
  }, []);
}
