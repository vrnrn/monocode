import { buildOutgoingHandoffPrompt } from "./handoff";
import {
  cancelHarnessTurn,
  respondHarnessApproval,
  respondHarnessQuestion,
  sendHarnessTurn,
} from "../../../integrations/harness/core/registry";
import { mergeStream } from "../../../integrations/harness/core/streamText";
import type { Block, HarnessId } from "./session";

const HANDOFF_TIMEOUT_MS = 45_000;

export async function requestOutgoingHandoff(input: {
  userTurnId?: string;
  userTurn?: Block;
  isCurrent?: () => boolean;
  persist?: boolean;
  beforeAdmission?: () => Promise<void>;
  afterDispatch?: () => Promise<void>;
  harness: HarnessId;
  sessionId: string;
  cwd: string;
  model: string;
  modelSettings?: Record<string, string>;
  providerAccountId?: string;
  userRequest: string;
}): Promise<string> {
  let brief = "";
  const timer = setTimeout(() => {
    void cancelHarnessTurn(input.harness, input.sessionId);
  }, HANDOFF_TIMEOUT_MS);
  try {
    await sendHarnessTurn({
      isCurrent: input.isCurrent,
      beforeAdmission: input.beforeAdmission,
      afterDispatch: input.afterDispatch,
      ...(input.userTurnId
        ? {
            submission: {
              attemptId: `${input.userTurnId}:handoff`,
              userTurnId: input.userTurnId,
              userTurn: input.userTurn,
              persist: input.persist,
            },
          }
        : {}),
      harness: input.harness,
      sessionId: input.sessionId,
      cwd: input.cwd,
      model: input.model,
      modelSettings: input.modelSettings,
      providerAccountId: input.providerAccountId,
      runtimeMode: "supervised",
      text: buildOutgoingHandoffPrompt(input.userRequest),
      onEvent: (event) => {
        if (event.type === "message.delta") {
          brief = mergeStream(brief, event.text);
        }
        if (event.type === "approval.requested") {
          respondHarnessApproval(
            input.harness,
            input.sessionId,
            event.requestId,
            "deny",
          );
        }
        if (event.type === "question.asked") {
          respondHarnessQuestion(
            input.harness,
            input.sessionId,
            event.requestId,
            { kind: "skipped" },
          );
        }
      },
    });
  } catch {
    // Caller falls back to the deterministic packet.
  } finally {
    clearTimeout(timer);
  }
  return brief.trim();
}
