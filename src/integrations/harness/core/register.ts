import { ensureClaudeRegistered } from "../providers/claude/claudeAdapter";
import { ensureCodexRegistered } from "../providers/codex/codexAdapter";
import { ensureOmpRegistered } from "../providers/omp/ompAdapter";
import { ensurePiRegistered } from "../providers/pi/piAdapter";
import { ensureAntigravityRegistered } from "../providers/antigravity/antigravityAdapter";

/** Register all known live harness adapters. Idempotent. */
export function registerBuiltinHarnesses(): void {
  ensureClaudeRegistered();
  ensureCodexRegistered();
  ensurePiRegistered();
  ensureOmpRegistered();
  ensureAntigravityRegistered();
}
