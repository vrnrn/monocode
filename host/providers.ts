import * as codex from "../src/integrations/harness/providers/codex/codex";
import * as claude from "../src/integrations/harness/providers/claude/claude";

import * as pi from "../src/integrations/harness/providers/pi/pi";
import * as omp from "../src/integrations/harness/providers/omp/omp";

import * as antigravity from "../src/integrations/harness/providers/antigravity/antigravity";

import type {
  SendTurnInput,
  CompactContextInput,
  ApprovalDecision,
} from "../src/integrations/harness/core/types";
import type { UserQuestionReply } from "../src/features/sessions/model/userQuestion";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import type { GeneratedSessionTitle } from "../src/features/sessions/model/sessionTitle";
import { generateCodexSessionTitle } from "../src/integrations/harness/providers/codex/codexTitle";
import { generateClaudeSessionTitle } from "../src/integrations/harness/providers/claude/claudeTitle";
import { generateCodexBranchName } from "../src/integrations/harness/providers/codex/codexGit";
import { generateClaudeBranchName } from "../src/integrations/harness/providers/claude/claudeGit";

import {
  generatePiSessionTitle,
  generateOmpSessionTitle,
} from "../src/integrations/harness/providers/pi/piTitle";
import {
  PI_FLAVOR,
  OMP_FLAVOR,
} from "../src/integrations/harness/providers/pi/piFlavor";
import { respondQuestion as respondPiQuestion } from "../src/integrations/harness/providers/pi/piFamily";

export interface HostProvider {
  send(input: SendTurnInput): Promise<void>;
  compact?(input: CompactContextInput): Promise<void>;
  cancel(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  bind(id: string, providerId: string, cwd: string): void;
  approve(id: string, request: number, decision: ApprovalDecision): void;
  answer(id: string, request: number, reply: UserQuestionReply): void;
  generateTitle?(input: {
    sessionId: string;
    cwd: string;
    message: string;
  }): Promise<GeneratedSessionTitle | null>;
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
}

export const hostProviders: Record<RemoteProvider, HostProvider> = {
  codex: {
    send: codex.sendCodexTurn,
    compact: codex.compactCodexContext,
    cancel: codex.cancelCodexTurn,
    stop: codex.forgetCodexSession,
    bind: codex.bindCodexSession,
    approve: codex.respondCodexApproval,
    answer: codex.respondCodexQuestion,
    generateTitle: generateCodexSessionTitle,
    generateBranchName: generateCodexBranchName,
  },
  claude: {
    send: claude.sendClaudeTurn,
    compact: claude.compactClaudeContext,
    cancel: claude.cancelClaudeTurn,
    stop: claude.forgetClaudeSession,
    bind: claude.bindClaudeSession,
    approve: claude.respondClaudeApproval,
    answer: claude.respondClaudeQuestion,
    generateTitle: generateClaudeSessionTitle,
    generateBranchName: generateClaudeBranchName,
  },
  pi: {
    send: pi.sendPiTurn,
    compact: pi.compactPiContext,
    cancel: pi.cancelPiTurn,
    stop: pi.forgetPiSession,
    bind: pi.bindPiSession,
    approve: pi.respondPiApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(PI_FLAVOR, id, request, reply),
    generateTitle: generatePiSessionTitle,
  },
  omp: {
    send: omp.sendOmpTurn,
    compact: omp.compactOmpContext,
    cancel: omp.cancelOmpTurn,
    stop: omp.forgetOmpSession,
    bind: omp.bindOmpSession,
    approve: omp.respondOmpApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(OMP_FLAVOR, id, request, reply),
    generateTitle: generateOmpSessionTitle,
  },
  antigravity: {
    send: antigravity.sendAntigravityTurn,
    cancel: antigravity.cancelAntigravityTurn,
    stop: antigravity.forgetAntigravitySession,
    bind: antigravity.bindAntigravitySession,
    approve: antigravity.respondAntigravityApproval,
    answer: unsupportedQuestion,
  },
};

function unsupportedQuestion(): never {
  throw new Error("This provider does not support questions");
}
