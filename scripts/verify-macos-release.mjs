import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyMacRelease(tag, feed, assets, version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(
    tag,
    `mac-v${version}`,
    "Release tag must match the app version",
  );
  assert.equal(
    feed.version,
    version,
    "Updater feed must match the app version",
  );
  const names = new Set(assets.map(({ name }) => name));
  assert(names.has("latest.json"), "Release must include the updater feed");
  assert(
    [...names].some((name) => name.endsWith("_aarch64.dmg")),
    "Apple Silicon DMG is missing",
  );
  assert(
    Object.keys(feed.platforms ?? {}).every((target) =>
      ["darwin-aarch64", "darwin-aarch64-app"].includes(target),
    ),
    "Feed must contain only Apple Silicon",
  );
  const entry = feed.platforms?.["darwin-aarch64"];
  assert(entry, "Updater feed is missing darwin-aarch64");
  if (feed.platforms["darwin-aarch64-app"]) {
    assert.deepEqual(feed.platforms["darwin-aarch64-app"], entry);
  }
  assert.equal(typeof entry.signature, "string");
  assert(
    entry.signature.trim(),
    "Updater signature is missing for darwin-aarch64",
  );
  const url = new URL(entry.url);
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  const prefix = `/vrnrn/vorkspace/releases/download/${tag}/`;
  assert(
    url.pathname.startsWith(prefix),
    "Updater must download this fork's tagged release",
  );
  const name = decodeURIComponent(url.pathname.slice(prefix.length));
  assert.match(name, /^[^/]+_aarch64\.app\.tar\.gz$/);
  assert(names.has(name), `Updater archive is missing: ${name}`);
  assert(
    names.has(`${name}.sig`),
    `Updater signature asset is missing: ${name}.sig`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [tag, feedPath, assetsPath] = process.argv.slice(2);
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  verifyMacRelease(
    tag,
    readJson(feedPath),
    readJson(assetsPath).assets,
    readJson("package.json").version,
  );
  console.log("Verified Apple Silicon updater assets and fork download URLs.");
}
