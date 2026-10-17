import { useState } from "react";
import {
  resolveComposerDraft,
  type ComposerDraftIssue,
} from "../model/draftCache";

/** Keep both versions inspectable until the user explicitly chooses one. */
export function ComposerDraftRecovery({
  sessionId,
  issue,
  current,
}: {
  sessionId?: string;
  issue: ComposerDraftIssue | null;
  current: string;
}) {
  const [busy, setBusy] = useState(false);
  if (!sessionId || !issue) return null;
  const choose = (choice: "current" | "stored" | "retry" | "dismiss") => {
    setBusy(true);
    void resolveComposerDraft(sessionId, choice)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <div
      role="status"
      className="mx-2 mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-content/80"
    >
      <p>{issue.message}</p>
      {issue.stored ? (
        <details className="mt-1">
          <summary className="cursor-pointer">Compare drafts</summary>
          <p className="mt-2 font-medium">Current input</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
            {current || "(empty)"}
          </pre>
          <p className="mt-2 font-medium">
            Saved input · {issue.stored.payload.cwd}
          </p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap">
            {issue.stored.payload.text || "(empty)"}
          </pre>
          {issue.stored.payload.attachments.length ? (
            <p>
              Saved attachments:{" "}
              {issue.stored.payload.attachments
                .map((file) => file.name)
                .join(", ")}
            </p>
          ) : null}
        </details>
      ) : null}
      <div className="mt-2 flex gap-3">
        {issue.stored ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => choose("current")}
              className="font-medium hover:underline"
            >
              Keep current input
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => choose("stored")}
              className="font-medium hover:underline"
            >
              Restore saved draft
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              choose(issue.kind === "missing" ? "dismiss" : "retry")
            }
            className="font-medium hover:underline"
          >
            {issue.kind === "missing" ? "Dismiss" : "Retry saving"}
          </button>
        )}
      </div>
    </div>
  );
}
