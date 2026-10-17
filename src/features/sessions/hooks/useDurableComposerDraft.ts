import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  captureComposerDraft,
  clearComposerDraft,
  composerDraftState,
  flushComposerDraft,
  hydrateComposerDraft,
  nativeComposerDraftsAvailable,
  openComposerDraft,
  registerComposerDraftCapture,
  subscribeComposerDraft,
  type ComposerDraftIssue,
  type ComposerDraftPayload,
} from "../model/draftCache";

/** Each owner serializes writes in the shared controller across pane remounts. */
export function useDurableComposerDraft(options: {
  sessionId?: string;
  cwd?: string;
  enabled: boolean;
  read: () => ComposerDraftPayload;
  restore: (payload: ComposerDraftPayload) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const [issue, setIssue] = useState<ComposerDraftIssue | null>(null);
  const context = useRef({ prop: options.cwd, saved: options.cwd });
  if (context.current.prop !== options.cwd)
    context.current = { prop: options.cwd, saved: options.cwd };
  const capture = useCallback(() => {
    const current = latest.current;
    if (!mounted.current || !current.sessionId) return;
    const payload = current.read();
    captureComposerDraft(current.sessionId, {
      ...payload,
      cwd: context.current.saved ?? payload.cwd,
    });
  }, []);

  useLayoutEffect(() => {
    const current = latest.current;
    if (!current.sessionId || !current.cwd || !nativeComposerDraftsAvailable())
      return;
    const sessionId = current.sessionId;
    const captureOwner = () => {
      if (latest.current.sessionId === sessionId) capture();
    };
    const existed = composerDraftState(sessionId);
    const initial = openComposerDraft(sessionId, current.read());
    let restored = initial.restored;
    mounted.current = true;
    if (existed) {
      context.current.saved = initial.payload.cwd;
      current.restore(initial.payload);
    }
    setIssue(initial.issue);
    const stop = subscribeComposerDraft(sessionId, () => {
      const state = composerDraftState(sessionId);
      if (!state) return;
      setIssue(state.issue);
      if (state.restored !== restored) {
        restored = state.restored;
        context.current.saved = state.payload.cwd;
        latest.current.restore(state.payload);
      }
    });
    const unregister = registerComposerDraftCapture(captureOwner);
    void hydrateComposerDraft(sessionId);
    const hide = () => {
      if (document.visibilityState === "hidden") {
        captureOwner();
        void flushComposerDraft(sessionId).catch(() => undefined);
      }
    };
    const pagehide = () => {
      captureOwner();
      void flushComposerDraft(sessionId).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", pagehide);
    return () => {
      captureOwner();
      mounted.current = false;
      unregister();
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", pagehide);
      void flushComposerDraft(sessionId).catch(() => undefined);
    };
  }, [options.sessionId, !!options.cwd, capture]);

  // Sample after every committed render; DOM selection events additionally
  // call capture directly, so moving only the cursor is durable as well.
  useLayoutEffect(() => {
    capture();
  });
  useLayoutEffect(() => {
    if (!options.enabled && options.sessionId) {
      capture();
      void flushComposerDraft(options.sessionId).catch(() => undefined);
    }
  }, [options.enabled, options.sessionId, capture]);

  const clear = useCallback(() => {
    if (latest.current.sessionId) clearComposerDraft(latest.current.sessionId);
  }, []);
  return { issue, capture, clear };
}
