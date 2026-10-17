import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyMacRelease } from "./verify-macos-release.mjs";

function release() {
  const name = "vorkspace_aarch64.app.tar.gz";
  const entry = {
    signature: "test-signature",
    url: `https://github.com/vrnrn/vorkspace/releases/download/mac-v0.13.1/${name}`,
  };
  return {
    feed: {
      version: "0.13.1",
      platforms: {
        "darwin-aarch64": { ...entry },
        "darwin-aarch64-app": { ...entry },
      },
    },
    name: "vorkspace 0.13.1 (Mac)",
    assets: [
      "latest.json",
      "vorkspace_0.13.1_aarch64.dmg",
      name,
      `${name}.sig`,
      ...["arm64", "x64"].flatMap((arch) => [
        `vorkspace-host-darwin-${arch}.tar.gz`,
        `vorkspace-host-darwin-${arch}.tar.gz.sha256`,
      ]),
    ].map((name) => ({ name })),
  };
}

function verify(value = release()) {
  verifyMacRelease("mac-v0.13.1", value.feed, value, "0.13.1");
}

test("a complete Mac release can be published with optional migration and license assets", () => {
  verify();
  const value = release();
  value.assets.push(
    { name: "LICENSE.vorkspace" },
    { name: "migrate-monocode-to-vorkspace.sh" },
  );
  verify(value);
});

test("rejects an incomplete architecture or missing signature", () => {
  const value = release();
  delete value.feed.platforms["darwin-aarch64"];
  assert.throws(() => verify(value), /missing darwin-aarch64/);
  const unsigned = release();
  unsigned.feed.platforms["darwin-aarch64"].signature = " ";
  unsigned.feed.platforms["darwin-aarch64-app"].signature = " ";
  assert.throws(() => verify(unsigned), /signature is missing/);
});

test("rejects each missing required Mac asset, including remote host checksums", () => {
  const value = release();
  for (const asset of value.assets) {
    assert.throws(() =>
      verify({
        ...value,
        assets: value.assets.filter(({ name }) => name !== asset.name),
      }),
    );
  }
});

test("rejects non-Mac packages and unrelated release assets", () => {
  for (const name of [
    "vorkspace-host-linux-arm64.tar.gz",
    "vorkspace-host-linux-x64.tar.gz.sha256",
    "vorkspace-host-win32-x64.zip",
    "vorkspace-host-win32-arm64.zip.sha256",
    "vorkspace_0.13.1_amd64.deb",
    "vorkspace_0.13.1_x64-setup.exe",
    "unused.txt",
  ]) {
    const value = release();
    value.assets.push({ name });
    assert.throws(() => verify(value), /Unexpected Mac release asset/);
  }
});

test("requires the versioned Mac release title", () => {
  for (const name of [
    "vorkspace 0.13.1",
    "vorkspace 0.13.1 (Windows)",
    "vorkspace 0.13.0 (Mac)",
  ]) {
    assert.throws(
      () => verify({ ...release(), name }),
      /title must identify the Mac build/,
    );
  }
});

test("rejects an Intel desktop entry in the Apple Silicon feed", () => {
  const value = release();
  value.feed.platforms["darwin-x86_64"] = {
    ...value.feed.platforms["darwin-aarch64"],
  };
  assert.throws(() => verify(value), /only Apple Silicon/);
});

test("rejects upstream URLs, another version, and unsigned asset paths", () => {
  for (const url of [
    "https://github.com/hardbeat920/monocode/releases/download/mac-v0.13.1/MonoCode_aarch64.app.tar.gz",
    "https://github.com/vrnrn/vorkspace/releases/download/mac-v0.13.0/vorkspace_aarch64.app.tar.gz",
    "https://example.com/vorkspace_aarch64.app.tar.gz",
    "https://github.com/vrnrn/vorkspace/releases/download/mac-v0.13.1/missing_aarch64.app.tar.gz",
  ]) {
    const value = release();
    value.feed.platforms["darwin-aarch64"].url = url;
    value.feed.platforms["darwin-aarch64-app"].url = url;
    assert.throws(() => verify(value));
  }
});

test("rejects tag or feed version mismatches", () => {
  const value = release();
  assert.throws(
    () => verifyMacRelease("mac-v0.13.2", value.feed, value, "0.13.1"),
    /tag must match/,
  );
  value.feed.version = "0.13.2";
  assert.throws(() => verify(value), /feed must match/);
});
