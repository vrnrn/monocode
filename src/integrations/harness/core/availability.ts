import type { HarnessId } from "../../../features/sessions/model/session";
import { HARNESSES } from "../../../features/sessions/model/session";
import {
  resolveAntigravityBinary,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveOmpBinary,
  resolvePiBinary,
} from "./child";
import { isLiveHarness } from "./registry";
import {
  emitHarnessAvailability,
  harnessAvailabilityProbedAt,
  markHarnessAvailabilityProbed,
  setHarnessAvailability,
  type HarnessAvailability,
} from "./availabilityState";

export type { HarnessAvailability } from "./availabilityState";
export {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "./availabilityState";

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  antigravity: { name: "Antigravity ACP server (agy_acp_server.par)" },
};

let inflight: Promise<void> | null = null;

/**
 * A probe stats ~100 paths across the resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart MonoCode if it is already installed.`;
}

export function probeHarnessAvailability(options?: {
  force?: boolean;
}): Promise<void> {
  if (inflight) return inflight;
  const lastProbe = harnessAvailabilityProbedAt();
  if (!options?.force && lastProbe > 0 && Date.now() - lastProbe < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  inflight = Promise.all(
    HARNESSES.map(async (id) => {
      if (!isLiveHarness(id)) return [id, false] as const;

      if (id === "claude") {
        try {
          await resolveClaudeBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "codex") {
        try {
          await resolveCodexBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }

      if (id === "pi") {
        try {
          await resolvePiBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "omp") {
        try {
          await resolveOmpBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }

      if (id === "antigravity") {
        try {
          await resolveAntigravityBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }

      return [id, false] as const;
    }),
  )
    .then((entries) => {
      const next = {} as HarnessAvailability;
      for (const [id, ok] of entries) next[id] = ok;
      setHarnessAvailability(next);
      emitHarnessAvailability();
    })
    .finally(() => {
      markHarnessAvailabilityProbed();
      inflight = null;
    });
  return inflight;
}
