import { join } from "node:path";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ChildBackend } from "../src/integrations/harness/core/child";

import {
  isRemoteProvider,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";
import { providerLaunch, resolveProvider } from "./process";

const exec = promisify(execFile);
const ALLOWED_EXEC_ARGS: readonly (readonly string[])[] = [
  ["--version"],
  ["--list-models"],
  ["models", "--verbose"],
  ["models", "--json"],
  ["models"],
  ["status", "--json"],
  ["agent", "list"],
];

function execArgsAllowed(_provider: RemoteProvider, args: string[]): boolean {
  const matches = (allowed: readonly string[]) =>
    allowed.length === args.length &&
    allowed.every((arg, index) => arg === args[index]);
  return ALLOWED_EXEC_ARGS.some(matches);
}

/** Native process implementation for the headless execution proof. */
export class HostChildBackend implements ChildBackend {
  private events = new EventEmitter();
  private children = new Map<string, ChildProcessWithoutNullStreams>();
  private closing = false;

  constructor(
    private readonly binaries: Partial<Record<RemoteProvider, string>> = {},
  ) {
    this.events.setMaxListeners(0);
  }

  async resolve(provider: RemoteProvider): Promise<string> {
    if (this.binaries[provider]) return this.binaries[provider]!;
    return resolveProvider(provider);
  }

  async listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void> {
    this.events.on(event, handler);
    return () => {
      this.events.off(event, handler);
    };
  }

  private emit(event: string, payload: unknown): void {
    this.events.emit(event, { payload });
  }

  async invoke<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const id = String(args.sessionId ?? "");
    if (command.startsWith("harness_resolve_")) {
      const provider = command.slice("harness_resolve_".length);
      if (!isRemoteProvider(provider))
        throw new Error(`Unsupported provider: ${provider}`);
      return {
        path: await this.resolve(provider),
        ...(provider === "antigravity"
          ? { args: process.platform === "linux" ? ["--uid="] : [] }
          : {}),
      } as T;
    }
    switch (command) {
      case "harness_copilot_models": {
        const { stdout } = await exec(
          process.execPath,
          [
            fileURLToPath(new URL("./claude-copilot.mjs", import.meta.url)),
            "--list-models",
          ],
          { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true },
        );
        return JSON.parse(stdout) as T;
      }
      case "harness_exec": {
        const provider = args.binaryProvider;
        if (!isRemoteProvider(provider))
          throw new Error("Unsupported headless catalog command");
        const commandPath = await this.resolve(provider);
        if (
          args.command !== commandPath ||
          !Array.isArray(args.args) ||
          !args.args.every((arg) => typeof arg === "string") ||
          !execArgsAllowed(provider, args.args as string[])
        )
          throw new Error("Unsupported headless catalog command");
        const launch = await providerLaunch(commandPath, args.args as string[]);
        const { stdout } = await exec(launch.command, launch.args, {
          cwd: typeof args.cwd === "string" ? args.cwd : undefined,
          timeout: 10_000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
        });
        return stdout as T;
      }
      case "harness_read_text_file": {
        const path = String(args.path ?? "");
        const info = await stat(path);
        if (!info.isFile() || info.size > 8 * 1024 * 1024)
          throw new Error("File is not a readable text file of at most 8 MiB");
        const bytes = await readFile(path);
        if (bytes.includes(0))
          throw new Error("Binary file is not readable as text");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as T;
      }
      case "harness_spawn":
        return (await this.start(id, args)) as T;
      case "harness_write": {
        const child = this.children.get(id);
        if (!child || child.stdin.destroyed)
          throw new Error("Provider process is not running");
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Provider stdin write timed out")),
            15_000,
          );
          child.stdin.write(`${String(args.line)}\n`, (error) => {
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
          });
        });
        return undefined as T;
      }
      case "harness_kill":
        await this.kill(id);
        return undefined as T;
      case "harness_kill_all":
        await this.close();
        return undefined as T;
      default:
        throw new Error(`Unsupported headless process operation: ${command}`);
    }
  }

  private async start(
    id: string,
    args: Record<string, unknown>,
  ): Promise<number> {
    if (this.closing) throw new Error("Host is stopping");
    await this.kill(id);
    if (this.closing) throw new Error("Host is stopping");
    const account = args.account as { id?: string } | undefined;
    if (account?.id && account.id !== "default")
      throw new Error(
        "Named provider accounts are not supported by this host yet",
      );
    const commandArgs = args.args as string[];

    let launch = await providerLaunch(String(args.command), commandArgs);
    if (
      args.binaryProvider === "claude" &&
      commandArgs.some(
        (arg, index) =>
          arg === "--model" && commandArgs[index + 1]?.startsWith("copilot/"),
      )
    ) {
      launch = {
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./claude-copilot.mjs", import.meta.url)),
          launch.command,
          ...launch.args,
        ],
      };
    }
    if (this.closing) throw new Error("Host is stopping");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./provider-guard.mjs", import.meta.url)),
        launch.command,
        ...launch.args,
      ],
      {
        cwd: String(args.cwd),
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
        env: { ...process.env, MONOCODE_HOST: "1" },
      },
    );
    this.children.set(id, child);
    child.stdin.on("error", () => {
      /* write callbacks report failures */
    });
    this.lines(child, id, "stdout");
    this.lines(child, id, "stderr");
    child.on("close", (code) => {
      if (this.children.get(id) === child) this.children.delete(id);
      this.emit("harness-exit", { sessionId: id, code, pid: child.pid });
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    return child.pid!;
  }

  private lines(
    child: ChildProcessWithoutNullStreams,
    id: string,
    stream: "stdout" | "stderr",
  ): void {
    let buffer = "";
    child[stream].setEncoding("utf8");
    child[stream].on("data", (data: string) => {
      buffer += data;
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.length > 8 * 1024 * 1024) {
          void this.kill(id);
          return;
        }
        this.emit(`harness-${stream}`, { sessionId: id, line });
      }
      if (buffer.length > 8 * 1024 * 1024) {
        buffer = "";
        void this.kill(id);
      }
    });
    child[stream].on("end", () => {
      if (buffer)
        this.emit(`harness-${stream}`, { sessionId: id, line: buffer });
    });
  }

  private signal(
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals,
  ): void {
    try {
      if (process.platform === "win32") child.kill(signal);
      else if (child.pid) process.kill(-child.pid, signal);
    } catch {
      /* already exited */
    }
  }

  async kill(id: string): Promise<void> {
    const child = this.children.get(id);
    if (!child) return;
    this.children.delete(id);
    if (process.platform === "win32") {
      // Kill descendants while the leader still exists. Closing stdin first
      // can let the leader exit, making its remaining children untraceable.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          await exec(
            join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32",
              "taskkill.exe",
            ),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 10_000 },
          );
        } catch {
          child.kill();
        }
      }
      child.stdin.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      return;
    }
    child.stdin.destroy();
    this.signal(child, "SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.signal(child, "SIGKILL");
        resolve();
        // The guard needs a full second to escalate against the provider's
        // separate process group before we may kill the guard itself.
      }, 3_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all([...this.children.keys()].map((id) => this.kill(id)));
  }
}
