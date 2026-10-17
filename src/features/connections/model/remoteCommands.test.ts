import { beforeEach, expect, it, vi } from "vitest";

const { remoteRequest, remoteMachineFor, invokeLocal } = vi.hoisted(() => ({
  remoteRequest: vi.fn(),
  invokeLocal: vi.fn(),
  remoteMachineFor: vi.fn(async (environmentId: string) =>
    environmentId === "env"
      ? { id: "machine", name: "Home", endpoint: "", environmentId }
      : undefined,
  ),
}));
vi.mock("./connections", () => ({ remoteRequest, remoteMachineFor }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeLocal }));

import { runRemoteCommand } from "./remoteCommands";
import { WORKSPACE_EDITOR_SAVE_CAPABILITY } from "./protocol";
import { parseRemotePath, remotePath } from "./remoteProjects";
import { EDITOR_HOST_UPDATE_MESSAGE, gitCommit, gitLocateFiles, gitStagedContext, listDir, readBinaryFile, readEditorTextFile, readTextFile, statFiles, writeEditorTextFile, writeTextFile } from "../../../platform/tauri/fs";

beforeEach(() => {
  remoteRequest.mockReset();
  invokeLocal.mockReset();
});

it("keeps local writes local when their content mentions a remote path", async () => {
  await writeTextFile("/home/me/note.txt", "remote://env/home/me/repo");
  expect(invokeLocal).toHaveBeenCalledWith("write_text_file", {
    path: "/home/me/note.txt",
    content: "remote://env/home/me/repo",
  });
  expect(remoteRequest).not.toHaveBeenCalled();
});

it("runs the same file command on the machine with host paths", async () => {
  remoteRequest.mockResolvedValue([
    { name: "src", path: "/home/me/repo/src", isDir: true, ignored: false },
  ]);
  expect(await listDir("remote://env/home/me/repo")).toEqual([
    {
      name: "src",
      path: "remote://env/home/me/repo/src",
      isDir: true,
      ignored: false,
    },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "list_dir",
    args: { path: "/home/me/repo" },
  });
});

it("maps path results back and leaves file contents alone", async () => {
  remoteRequest.mockResolvedValueOnce("remote://not-a-path");
  expect(await readTextFile("remote://env/home/me/a.txt")).toBe(
    "remote://not-a-path",
  );
  remoteRequest.mockResolvedValueOnce([
    { path: "/home/me/a.txt", mtimeMs: 1 },
  ]);
  expect(await statFiles(["remote://env/home/me/a.txt"])).toEqual([
    { path: "remote://env/home/me/a.txt", mtimeMs: 1 },
  ]);
  remoteRequest.mockResolvedValueOnce("/home/me/b.txt");
  expect(
    await runRemoteCommand("rename_path", {
      path: "remote://env/home/me/a.txt",
      name: "b.txt",
    }),
  ).toBe("remote://env/home/me/b.txt");
  remoteRequest.mockResolvedValueOnce("C:/work/x.ts");
  expect(
    await runRemoteCommand("create_path", {
      parent: "remote://env/C:/work",
      name: "x.ts",
      isDir: false,
    }),
  ).toBe("remote://env/C:/work/x.ts");
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "create_path",
    args: { parent: "C:/work", name: "x.ts", isDir: false },
  });
});

it("decodes remote binary reads", async () => {
  remoteRequest.mockResolvedValueOnce("AAEC/w==");
  expect(await readBinaryFile("remote://env/home/me/image.png")).toEqual(
    new Uint8Array([0, 1, 2, 255]),
  );
});

it("preserves Windows drive and UNC paths", () => {
  expect(parseRemotePath(remotePath("env", "C:\\work\\repo"))?.hostPath).toBe(
    "C:/work/repo",
  );
  expect(parseRemotePath(remotePath("env", "\\\\server\\share\\repo"))?.hostPath).toBe(
    "//server/share/repo",
  );
});

it("adds remote paths to Git index entries", async () => {
  remoteRequest.mockResolvedValueOnce({
    branch: "main",
    files: [{ path: "src/app.ts", relative: "src/app.ts", status: "modified" }],
  });
  const index = await runRemoteCommand("git_diff_index", {
    cwd: "remote://env/home/me/repo",
  }) as { files: { path: string }[] };
  expect(index.files[0].path).toBe("remote://env/home/me/repo/src/app.ts");
});

it("locates remote checkout roots without converting relative filenames", async () => {
  remoteRequest.mockResolvedValueOnce([
    { root: "/home/me/a", relative: "same.txt" }, null,
    { root: "/home/me/b", relative: "same.txt" },
  ]);
  const paths = ["remote://env/home/me/a/same.txt", "remote://env/home/me/outside.txt", "remote://env/home/me/b/same.txt"];
  expect(await gitLocateFiles(paths)).toEqual([
    { root: "remote://env/home/me/a", relative: "same.txt" }, null,
    { root: "remote://env/home/me/b", relative: "same.txt" },
  ]);
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "git_locate_files", args: { paths: paths.map((path) => path.replace("remote://env", "")) },
  });
});

it("passes selected files through remote commit and context calls as repo-relative paths", async () => {
  await gitCommit("remote://env/home/me/a", "Selected", false, ["same.txt", "line\nbreak"]);
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "git_commit", args: { cwd: "/home/me/a", message: "Selected", amend: false, paths: ["same.txt", "line\nbreak"] },
  });
  await gitStagedContext("remote://env/home/me/b", ["same.txt"]);
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "git_staged_context", args: { cwd: "/home/me/b", paths: ["same.txt"] },
  });
  expect(invokeLocal).not.toHaveBeenCalled();
});

it("routes project search through the host and maps match paths", async () => {
  remoteRequest.mockResolvedValueOnce({
    matches: [{ path: "/home/me/repo/src/app.ts", relative: "src/app.ts", line: 4 }],
    truncated: false,
  });
  expect(await runRemoteCommand("search_project", {
    options: { cwd: "remote://env/home/me/repo", query: "hello" },
  })).toMatchObject({
    matches: [{ path: "remote://env/home/me/repo/src/app.ts", line: 4 }],
  });
  expect(remoteRequest).toHaveBeenCalledWith("machine", "workspace.run", {
    command: "search_project",
    args: { options: { cwd: "/home/me/repo", query: "hello" } },
  });
});

it("refuses what the host cannot do and explains outdated hosts", async () => {
  await expect(
    runRemoteCommand("reveal_path", { path: "remote://env/home/me/a" }),
  ).rejects.toThrow("isn’t available for projects on another machine");
  await expect(
    runRemoteCommand("copy_path", {
      from: "/Users/me/local.txt",
      destParent: "remote://env/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("move_path", {
      from: "remote://env/home/me/a",
      destParent: "remote://other/home/me",
    }),
  ).rejects.toThrow("within one machine");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://gone/home/me" }),
  ).rejects.toThrow("isn’t connected");
  remoteRequest.mockRejectedValueOnce("Unsupported remote operation");
  await expect(
    runRemoteCommand("list_dir", { path: "remote://env/home/me" }),
  ).rejects.toThrow("Update vorkspace Host");
  expect(remoteRequest).toHaveBeenCalledTimes(1);
});

it("carries exact editor baselines and maps read/save receipt identity for remote files", async () => {
  const path = "remote://env/home/me/a.txt";
  const hostPath = "/home/me/a.txt";
  const content = "remote://literal/content\r\n";
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockResolvedValueOnce({ path: hostPath, content, hash: "read-digest" });
  expect(await readEditorTextFile(path)).toEqual({ path, content, hash: "read-digest" });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "read_editor_text_file", args: { path: hostPath },
  });
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockResolvedValueOnce({ status: "saved", path: hostPath, hash: "saved-digest" });
  expect(await writeEditorTextFile(path, content, "read-digest")).toEqual({ status: "saved", path, hash: "saved-digest" });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "write_editor_text_file", args: { path: hostPath, content, expectedHash: "read-digest" },
  });
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockResolvedValueOnce({ status: "conflict", path: hostPath, hash: null });
  expect(await writeEditorTextFile(path, content, "saved-digest")).toEqual({ status: "conflict", path, hash: null });
  expect(invokeLocal).not.toHaveBeenCalled();
});


it("keeps old-host editor reads available and blocks every save without an unsafe fallback", async () => {
  const path = "remote://env/home/me/a.txt";
  const content = "legacy host\r\n";
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: ["workspace.run", "git.worktreeCreate"] });
  remoteRequest.mockResolvedValueOnce(content);
  expect(await readEditorTextFile(path)).toEqual({ path, content, hash: null, saveDisabledReason: EDITOR_HOST_UPDATE_MESSAGE });
  expect(remoteRequest).toHaveBeenLastCalledWith("machine", "workspace.run", {
    command: "read_text_file", args: { path: "/home/me/a.txt" },
  });
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: ["workspace.run", "git.worktreeCreate"] });
  await expect(writeEditorTextFile(path, "local\n", "previous-baseline")).rejects.toThrow(EDITOR_HOST_UPDATE_MESSAGE);
  expect(remoteRequest.mock.calls.filter(([, method, params]) => method === "workspace.run" && String((params as { command: string }).command).includes("write"))).toEqual([]);
});

it("detects an upgraded host on the next editor read and restores checked writes", async () => {
  const path = "remote://env/home/me/a.txt";
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [] });
  remoteRequest.mockResolvedValueOnce("before\n");
  expect((await readEditorTextFile(path)).saveDisabledReason).toBeTruthy();
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockResolvedValueOnce({ path: "/home/me/a.txt", content: "before\n", hash: "baseline" });
  expect(await readEditorTextFile(path)).toEqual({ path, content: "before\n", hash: "baseline" });
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockResolvedValueOnce({ status: "saved", path: "/home/me/a.txt", hash: "next" });
  expect(await writeEditorTextFile(path, "after\n", "baseline")).toEqual({ status: "saved", path, hash: "next" });
});

it("fails safely when an advertised editor command is missing", async () => {
  const path = "remote://env/home/me/a.txt";
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockRejectedValueOnce(new Error("Unsupported workspace command"));
  remoteRequest.mockResolvedValueOnce("readable\n");
  expect((await readEditorTextFile(path)).saveDisabledReason).toBe(EDITOR_HOST_UPDATE_MESSAGE);
  remoteRequest.mockResolvedValueOnce({ environmentId: "env", capabilities: [WORKSPACE_EDITOR_SAVE_CAPABILITY] });
  remoteRequest.mockRejectedValueOnce(new Error("Unsupported workspace command"));
  await expect(writeEditorTextFile(path, "local\n", "baseline")).rejects.toThrow(EDITOR_HOST_UPDATE_MESSAGE);
  expect(remoteRequest.mock.calls.some(([, method, params]) => method === "workspace.run" && (params as { command: string }).command === "write_text_file")).toBe(false);
});
