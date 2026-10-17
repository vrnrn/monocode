import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function tauriArguments(args) {
  return args[0] === "dev"
    ? [
        "dev",
        "--config",
        "src-tauri/tauri.development.conf.json",
        ...args.slice(1),
      ]
    : args;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = tauriArguments(process.argv.slice(2));
  if (args[0] === "dev")
    process.stderr.write(
      "vorkspace Dev: isolated profile com.vrnrn.vorkspace.development; frontend http://localhost:1430\n",
    );
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
      ),
      ...args,
    ],
    { stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
