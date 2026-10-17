import { persistableAttachment } from "../../../features/sessions/model/attachments";
import { invoke } from "@tauri-apps/api/core";
import type { Block, Session } from "../../../features/sessions/model/session";

export type LocalSubmissionReceipt = {
  attemptId: string;
  userTurnId: string;
  sessionId: string;
  signature: string;
  phase: "reserved" | "dispatching" | "settled" | "uncertain";
  outcome: "completed" | "failed" | null;
  error: string | null;
  userTurn?: Block | null;
};
export type LocalSubmissionAttempt = {
  attemptId: string;
  userTurnId: string;
  sessionId: string;
  payloadJson: string;
  userTurn?: Block;
};
export type LocalSubmissionStore = {
  reserve(
    input: LocalSubmissionAttempt,
  ): Promise<{ created: boolean; receipt: LocalSubmissionReceipt }>;
  dispatch(
    attemptId: string,
  ): Promise<{ claimed: boolean; receipt: LocalSubmissionReceipt }>;
  settle(
    attemptId: string,
    outcome: "completed" | "failed" | "uncertain",
    error?: string,
  ): Promise<LocalSubmissionReceipt>;
};
const nativeStore: LocalSubmissionStore = {
  reserve: (input) => invoke("local_submission_reserve", { input }),
  dispatch: (attemptId) => invoke("local_submission_dispatch", { attemptId }),
  settle: (attemptId, outcome, error) =>
    invoke("local_submission_settle", { attemptId, outcome, error }),
};

/** Keep the recovery row small and independent of live attachment URLs. */
export function submissionUserTurn(block: Block): Block {
  return {
    id: block.id,
    role: "user",
    text: block.text,
    ...(block.internal ? { internal: true } : {}),
    ...(block.monocode ? { monocode: true } : {}),
    ...(block.intent ? { intent: block.intent } : {}),
    ...(block.appRequestId ? { appRequestId: block.appRequestId } : {}),
    ...(block.attachments?.length
      ? {
          attachments: block.attachments.map((file) => {
            const metadata = persistableAttachment(file);
            if (
              metadata.path?.startsWith("blob:") ||
              metadata.path?.startsWith("data:")
            )
              delete metadata.path;
            return metadata;
          }),
        }
      : {}),
  };
}

/** Sort object keys, preserve arrays and exact string/attachment contents. */
export function submissionPayload(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Provider effects may have happened, but their durable checkpoint failed. */
export class LocalSubmissionUncertainError extends Error {}

const pending = new Map<
  string,
  { signature: string; promise: Promise<LocalSubmissionReceipt> }
>();

function duplicate(receipt: LocalSubmissionReceipt): LocalSubmissionReceipt {
  if (receipt.phase !== "settled")
    throw new Error(
      "This local send was already reserved. Its outcome is uncertain; it was not sent again.",
    );
  if (receipt.outcome === "failed")
    throw new Error(
      receipt.error ?? "The previous local send failed; it was not sent again.",
    );
  return receipt;
}

/** Durable admission precedes every provider effect. IPC failures fail closed. */
export function runLocalSubmission(
  attempt: LocalSubmissionAttempt,
  dispatch: () => Promise<void>,
  store: LocalSubmissionStore = nativeStore,
): Promise<LocalSubmissionReceipt> {
  const signature = submissionPayload(attempt);
  const previous = pending.get(attempt.attemptId);
  if (previous) {
    if (previous.signature !== signature)
      return Promise.reject(
        new Error(
          "Local submission ID was already used with different scope or content",
        ),
      );
    return previous.promise;
  }
  const promise = (async () => {
    const reservation = await store.reserve(attempt);
    if (!reservation.created) return duplicate(reservation.receipt);
    const claim = await store.dispatch(attempt.attemptId);
    if (!claim.claimed) return duplicate(claim.receipt);
    let failure: unknown;
    let failed = false;
    try {
      await dispatch();
    } catch (error) {
      failed = true;
      failure = error;
    }
    let receipt: LocalSubmissionReceipt;
    try {
      receipt = await store.settle(
        attempt.attemptId,
        !failed
          ? "completed"
          : failure instanceof LocalSubmissionUncertainError
            ? "uncertain"
            : "failed",
        !failed
          ? undefined
          : String(failure instanceof Error ? failure.message : failure),
      );
    } catch (error) {
      throw new Error(
        `The provider may have received this local send, but its result could not be saved. Its outcome is uncertain; it will not be replayed. ${String(error)}`,
      );
    }
    if (failed) throw failure;
    return receipt;
  })();
  pending.set(attempt.attemptId, { signature, promise });
  void promise
    .finally(() => {
      if (pending.get(attempt.attemptId)?.promise === promise)
        pending.delete(attempt.attemptId);
    })
    .catch(() => undefined);
  return promise;
}

export function listLocalSubmissions(
  sessionId: string,
): Promise<LocalSubmissionReceipt[]> {
  return invoke("local_submission_list", { sessionId });
}

/** A receipt is also the recovery copy of a user row not yet checkpointed. */
export function restoreLocalSubmissions(
  session: Session,
  receipts: LocalSubmissionReceipt[],
): Session {
  if (!receipts.length) return session;
  // Even a settled receipt can outlive a stale in-flight workspace marker.
  // Such a marker must never turn into another automatic provider send.
  const latestUser = [...session.blocks]
    .reverse()
    .find((block) => block.role === "user" && !block.draft);
  const unresolved = receipts.filter((receipt) => receipt.phase !== "settled");
  const blocked = {
    ...session,
    localSubmissionReplayBlocked:
      unresolved.length > 0 ||
      receipts.some((receipt) => receipt.userTurnId === latestUser?.id),
  };
  if (!unresolved.length) return blocked;
  const blocks = [...session.blocks];
  for (const receipt of unresolved) {
    if (!blocks.some((block) => block.id === receipt.userTurnId)) {
      blocks.push(
        receipt.userTurn &&
          receipt.userTurn.id === receipt.userTurnId &&
          receipt.userTurn.role === "user"
          ? receipt.userTurn
          : {
              id: receipt.userTurnId,
              role: "user",
              text: "Local send awaiting confirmation",
            },
      );
    }
    const id = `local-submission-uncertain-${receipt.attemptId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    if (!blocks.some((block) => block.id === id))
      blocks.push({
        id,
        role: "system",
        notice: "error",
        text:
          receipt.error ??
          "This local send has an unconfirmed outcome. The provider may have received it. It was not replayed; review the conversation before sending another message.",
      });
  }
  return {
    ...blocked,
    blocks,
    busy: false,
    turnReady: false,
    localSubmissionUncertain: true,
  };
}
