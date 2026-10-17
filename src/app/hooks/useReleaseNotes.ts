import { useEffect, useState } from "react";
import type { ReleaseNotesDocument } from "../model/releaseNotes";
import { releaseNotesLoader } from "../model/releaseNotesLoader";

/** Hidden restored tabs do not read bodies until first opened. */
export function useReleaseNotes(version: string, visible = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    version: string;
    notes: ReleaseNotesDocument | null | undefined;
    error?: boolean;
  }>(() => ({ version, notes: releaseNotesLoader.get(version) }));
  useEffect(() => {
    if (!visible) return;
    let current = true;
    setState({ version, notes: releaseNotesLoader.get(version) });
    void releaseNotesLoader.load(version).then(
      (notes) => {
        if (current) setState({ version, notes });
      },
      () => {
        if (current) setState({ version, notes: undefined, error: true });
      },
    );
    return () => {
      current = false;
    };
  }, [version, visible, attempt]);
  return {
    notes: state.version === version ? state.notes : undefined,
    error: state.version === version && !!state.error,
    retry: () => setAttempt((value) => value + 1),
  };
}
