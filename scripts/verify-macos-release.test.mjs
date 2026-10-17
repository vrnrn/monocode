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
    assets: [
      "latest.json",
      "vorkspace_0.13.1_aarch64.dmg",
      name,
      `${name}.sig`,
    ].map((name) => ({ name })),
  };
}

test("a complete Apple Silicon release can be published", () => {
  const { feed, assets } = release();
  verifyMacRelease("mac-v0.13.1", feed, assets, "0.13.1");
});

test("rejects an incomplete architecture or missing signature", () => {
  const { feed, assets } = release();
  delete feed.platforms["darwin-aarch64"];
  assert.throws(
    () => verifyMacRelease("mac-v0.13.1", feed, assets, "0.13.1"),
    /missing darwin-aarch64/,
  );
  const unsigned = release();
  unsigned.feed.platforms["darwin-aarch64"].signature = " ";
  unsigned.feed.platforms["darwin-aarch64-app"].signature = " ";
  assert.throws(
    () =>
      verifyMacRelease("mac-v0.13.1", unsigned.feed, unsigned.assets, "0.13.1"),
    /signature is missing/,
  );
});

test("rejects missing release assets", () => {
  const { feed, assets } = release();
  for (const asset of assets) {
    assert.throws(() =>
      verifyMacRelease(
        "mac-v0.13.1",
        feed,
        assets.filter(({ name }) => name !== asset.name),
        "0.13.1",
      ),
    );
  }
});

test("rejects an Intel entry in the Apple Silicon feed", () => {
  const { feed, assets } = release();
  feed.platforms["darwin-x86_64"] = { ...feed.platforms["darwin-aarch64"] };
  assert.throws(
    () => verifyMacRelease("mac-v0.13.1", feed, assets, "0.13.1"),
    /only Apple Silicon/,
  );
});

test("rejects upstream URLs, another version, and unsigned asset paths", () => {
  for (const url of [
    "https://github.com/hardbeat920/monocode/releases/download/mac-v0.13.1/MonoCode_aarch64.app.tar.gz",
    "https://github.com/vrnrn/vorkspace/releases/download/mac-v0.13.0/vorkspace_aarch64.app.tar.gz",
    "https://example.com/vorkspace_aarch64.app.tar.gz",
    "https://github.com/vrnrn/vorkspace/releases/download/mac-v0.13.1/missing_aarch64.app.tar.gz",
  ]) {
    const { feed, assets } = release();
    feed.platforms["darwin-aarch64"].url = url;
    feed.platforms["darwin-aarch64-app"].url = url;
    assert.throws(() =>
      verifyMacRelease("mac-v0.13.1", feed, assets, "0.13.1"),
    );
  }
});

test("rejects tag or feed version mismatches", () => {
  const { feed, assets } = release();
  assert.throws(
    () => verifyMacRelease("mac-v0.13.2", feed, assets, "0.13.1"),
    /tag must match/,
  );
  feed.version = "0.13.2";
  assert.throws(
    () => verifyMacRelease("mac-v0.13.1", feed, assets, "0.13.1"),
    /feed must match/,
  );
});
