import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newSession } from "../src/features/sessions/model/session";
import type { HostSession } from "../src/features/connections/model/protocol";
import { HostStore } from "./store";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "monocode-store-cache-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = store.addProject(directory, "Test");
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, store, project };
}

function storedSession(
  projectId: string,
  cwd: string,
  id: string,
  text: string,
  revision = 1,
): HostSession {
  return {
    session: {
      ...newSession("codex", cwd),
      id,
      blocks: [{ id: `${id}-block`, role: "assistant", text }],
    },
    projectId,
    revision,
    status: "idle",
    createdAt: 1,
    updatedAt: revision,
  };
}

function cache(store: HostStore) {
  return store as unknown as {
    cache: Map<string, { value: HostSession; weight: number }>;
    cacheBytes: number;
  };
}

it("bounds retained snapshots by estimated bytes and promotes LRU hits", () => {
  const { store, project, directory } = fixture();
  const ids = ["cache-a", "cache-b", "cache-c", "cache-d"];
  const payload = "x".repeat(1_100_000);
  for (const id of ids.slice(0, 3))
    store.save(storedSession(project.id, directory, id, payload), {
      type: "test",
    });

  expect(cache(store).cacheBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(store.session(ids[0]).session.id).toBe(ids[0]);
  store.save(storedSession(project.id, directory, ids[3], payload), {
    type: "test",
  });

  expect([...cache(store).cache.keys()]).toEqual([ids[2], ids[0], ids[3]]);
  expect(cache(store).cacheBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  const parse = vi.spyOn(JSON, "parse");
  const stringify = vi.spyOn(JSON, "stringify");
  try {
    store.session(ids[0]);
    expect(parse).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();
    store.session(ids[1]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(stringify).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
    stringify.mockRestore();
  }
});

it("retains no more than the session entry limit for small snapshots", () => {
  const { store, project, directory } = fixture();
  for (let index = 0; index < 40; index++)
    store.save(
      storedSession(project.id, directory, `small-${index}`, "small"),
      { type: "test" },
    );
  expect(cache(store).cache.size).toBe(32);
  expect(cache(store).cacheBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
});

it("skips individually oversized sessions and keeps byte accounting correct on rollback and delete", () => {
  const { store, project, directory } = fixture();
  const oversized = storedSession(
    project.id,
    directory,
    "too-large",
    "y".repeat(2_200_000),
  );
  store.save(oversized, { type: "test" });
  expect(cache(store).cache.has("too-large")).toBe(false);

  const normal = storedSession(project.id, directory, "normal", "small");
  store.save(normal, { type: "test" });
  const beforeRollback = cache(store).cacheBytes;
  expect(() =>
    store.transaction(() => {
      store.save(
        storedSession(project.id, directory, "normal", "replacement", 2),
        { type: "test" },
      );
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(cache(store).cacheBytes).toBe(0);
  expect(store.session("normal").session.blocks[0].text).toBe("small");
  expect(cache(store).cacheBytes).toBe(beforeRollback);

  store.deleteSession("normal");
  expect(cache(store).cache.has("normal")).toBe(false);
  expect(cache(store).cacheBytes).toBe(0);
});
