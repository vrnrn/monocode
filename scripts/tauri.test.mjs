import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tauriArguments } from "./tauri.mjs";

test("development runs select an isolated profile before optional overrides", () => {
  assert.deepEqual(
    tauriArguments([
      "dev",
      "--no-watch",
      "--config",
      "src-tauri/tauri.stable.conf.json",
    ]),
    [
      "dev",
      "--config",
      "src-tauri/tauri.development.conf.json",
      "--no-watch",
      "--config",
      "src-tauri/tauri.stable.conf.json",
    ],
  );
  const production = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  );
  const development = JSON.parse(
    readFileSync(
      new URL("../src-tauri/tauri.development.conf.json", import.meta.url),
    ),
  );
  assert.notEqual(development.identifier, production.identifier);
  assert.equal(development.build.devUrl, "http://localhost:1430");
  assert.deepEqual(development.plugins.updater.endpoints, []);
  assert.deepEqual(development.plugins["deep-link"].desktop.schemes, [
    "vorkspace-dev",
  ]);
});

test("release and diagnostic commands retain their original arguments", () => {
  for (const args of [
    ["build", "--target", "aarch64-apple-darwin"],
    ["info"],
    ["--version"],
  ])
    assert.deepEqual(tauriArguments(args), args);
});
