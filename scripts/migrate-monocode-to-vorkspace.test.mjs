import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/migrate-monocode-to-vorkspace.sh");
const profile = "Library/Application Support/com.monocode.desktop";
const macTest = (name, fn) =>
  test(name, { skip: process.platform !== "darwin" }, fn);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vorkspace-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home with spaces ' and $characters");
  const tools = join(root, "tools");
  mkdirSync(home);
  mkdirSync(tools);
  writeFileSync(
    join(tools, "pgrep"),
    '#!/bin/sh\nexit "${FIXTURE_PROCESS_STATUS:-1}"\n',
    { mode: 0o700 },
  );
  const put = (relative, value = "private fixture", mode = 0o600) => {
    const path = join(home, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, value, { mode });
    return path;
  };
  const backup = join(root, "backup");
  const run = (args = [], extra = {}) =>
    spawnSync("/bin/bash", [script, "--backup-dir", backup, ...args], {
      encoding: "utf8",
      env: { PATH: `${tools}:/usr/bin:/bin`, HOME: home, ...extra },
    });
  return { root, home, backup, tools, put, run };
}

macTest("dry-run leaves all data in place and creates no backup", (t) => {
  const f = fixture(t);
  f.put(`${profile}/monocode.db`, "session secret");
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry-run only/);
  assert.doesNotMatch(result.stdout, /session secret/);
  assert.equal(existsSync(f.backup), false);
  assert.equal(
    readFileSync(join(f.home, profile, "monocode.db"), "utf8"),
    "session secret",
  );
});

macTest(
  "backs up every app-owned location, metadata and symlinks without traversing providers",
  (t) => {
    const f = fixture(t);
    const files = [
      `${profile}/monocode.db`,
      `${profile}/monocode.db-wal`,
      `${profile}/monos/one/memory.md`,
      `${profile}/provider-accounts/account/auth.json`,
      `${profile}/attachments/file.bin`,
      `${profile}/settings.json`,
      "Library/Preferences/com.monocode.desktop.plist",
      "Library/Preferences/ByHost/com.monocode.desktop.ABC.plist",
      "Library/WebKit/com.monocode.desktop/WebsiteData/LocalStorage/settings",
      "Library/Caches/com.monocode.desktop/cache",
      "Library/HTTPStorages/com.monocode.desktop/data",
      "Library/HTTPStorages/com.monocode.desktop.binarycookies",
      "Library/Cookies/com.monocode.desktop.binarycookies",
      "Library/Saved Application State/com.monocode.desktop.savedState/windows.plist",
      "Library/LaunchAgents/com.monocode.host.plist",
      ".monocode-host/host.db",
      ".monocode-migrations/pending",
    ];
    for (const relative of files) f.put(relative, `secret:${relative}`);
    const external = f.put(".codex/auth.json", "do not copy provider secret");
    f.put(".claude/credentials", "do not copy provider secret");
    f.put(".aws/credentials", "do not copy provider secret");
    f.put("project/file", "do not copy workspace");
    symlinkSync(join(external, ".."), join(f.home, profile, "provider-link"));
    symlinkSync(join(external, ".."), join(f.home, ".monocode-symlink"));
    chmodSync(join(f.home, profile, "settings.json"), 0o400);
    const result = f.run(["--apply"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /secret:/);
    assert.equal(statSync(f.backup).mode & 0o777, 0o700);
    for (const relative of files) {
      assert.equal(
        readFileSync(join(f.backup, relative), "utf8"),
        `secret:${relative}`,
      );
      assert.equal(existsSync(join(f.home, relative)), true);
    }
    assert.equal(
      statSync(join(f.backup, profile, "settings.json")).mode & 0o777,
      0o400,
    );
    assert.equal(
      lstatSync(join(f.backup, profile, "provider-link")).isSymbolicLink(),
      true,
    );
    assert.equal(
      readlinkSync(join(f.backup, profile, "provider-link")),
      join(external, ".."),
    );
    assert.equal(
      lstatSync(join(f.backup, ".monocode-symlink")).isSymbolicLink(),
      true,
    );
    for (const relative of [".codex", ".claude", ".aws", "project"]) {
      assert.equal(existsSync(join(f.backup, relative)), false);
    }
    assert.equal(
      existsSync(join(f.home, "Library/Application Support/vorkspace")),
      false,
    );
  },
);

macTest(
  "refuses live apps and an unavailable process check before writing",
  (t) => {
    const f = fixture(t);
    f.put(`${profile}/monocode.db`);
    for (const status of ["0", "2"]) {
      const result = f.run(["--apply"], { FIXTURE_PROCESS_STATUS: status });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.backup), false);
    }
  },
);

macTest(
  "recovery copies a whole profile into the normal consumer location without deleting source",
  (t) => {
    const f = fixture(t);
    const source = join(f.root, "legacy profile");
    mkdirSync(source);
    writeFileSync(join(source, "monocode.db"), "recovered sessions", {
      mode: 0o600,
    });
    const destination = join(f.home, profile);
    const args = ["--source", source, "--destination", destination];
    assert.equal(f.run(args).status, 0);
    assert.equal(existsSync(destination), false);
    const result = f.run([...args, "--apply"]);
    assert.equal(result.status, 0, result.stderr);
    for (const dir of [
      source,
      destination,
      join(f.backup, "recovery-source"),
    ]) {
      assert.equal(
        readFileSync(join(dir, "monocode.db"), "utf8"),
        "recovered sessions",
      );
    }
  },
);

macTest(
  "refuses populated destinations including hidden files, and existing backups",
  (t) => {
    const f = fixture(t);
    const source = join(f.root, "source");
    mkdirSync(source);
    const destination = join(f.root, "destination");
    mkdirSync(destination);
    writeFileSync(join(destination, ".existing"), "keep me");
    const result = f.run([
      "--apply",
      "--source",
      source,
      "--destination",
      destination,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /populated/);
    assert.equal(existsSync(f.backup), false);
    assert.equal(
      readFileSync(join(destination, ".existing"), "utf8"),
      "keep me",
    );
    mkdirSync(f.backup);
    assert.notEqual(f.run(["--apply"]).status, 0);
    assert.deepEqual(readdirSync(f.backup), []);
  },
);

macTest(
  "refuses overlapping recovery/backup paths and follows no destination symlink",
  (t) => {
    const f = fixture(t);
    const source = join(f.root, "source");
    mkdirSync(source);
    const alias = join(f.root, "alias");
    symlinkSync(source, alias);
    for (const destination of [source, join(source, "nested"), alias]) {
      assert.notEqual(
        f.run(["--apply", "--source", source, "--destination", destination])
          .status,
        0,
      );
    }
    f.put(`${profile}/monocode.db`);
    assert.notEqual(
      f.run(["--apply", "--backup-dir", join(f.home, profile, "backup")])
        .status,
      0,
    );
    assert.equal(existsSync(f.backup), false);
  },
);

macTest("recovery atomically replaces an existing empty destination", (t) => {
  const f = fixture(t);
  const source = join(f.root, "source");
  const destination = join(f.root, "destination");
  mkdirSync(source);
  mkdirSync(destination);
  writeFileSync(join(source, "monocode.db"), "recovered sessions");
  const result = f.run([
    "--apply",
    "--source",
    source,
    "--destination",
    destination,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(destination, "monocode.db"), "utf8"),
    "recovered sessions",
  );
  assert.equal(
    readdirSync(f.root).some((name) => name.startsWith(".vorkspace-recovery.")),
    false,
  );
});

macTest("a destination populated during backup is never overwritten", (t) => {
  const f = fixture(t);
  const source = join(f.root, "source");
  const destination = join(f.root, "destination");
  mkdirSync(source);
  writeFileSync(join(source, "monocode.db"), "old source sessions");
  writeFileSync(
    join(f.tools, "ditto"),
    `#!/bin/sh
set -e
/usr/bin/ditto "$@"
case "$2" in */recovery-source)
  mkdir -p "$FIXTURE_DESTINATION"
  printf '%s' 'new sessions created meanwhile' > "$FIXTURE_DESTINATION/monocode.db"
  ;;
esac
`,
    { mode: 0o700 },
  );
  const result = f.run(
    ["--apply", "--source", source, "--destination", destination],
    {
      FIXTURE_DESTINATION: destination,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Recovery destination changed/);
  assert.equal(
    readFileSync(join(destination, "monocode.db"), "utf8"),
    "new sessions created meanwhile",
  );
  assert.equal(
    readFileSync(join(source, "monocode.db"), "utf8"),
    "old source sessions",
  );
  assert.equal(
    readFileSync(join(f.backup, "recovery-source", "monocode.db"), "utf8"),
    "old source sessions",
  );
  assert.equal(
    readdirSync(f.root).some((name) => name.startsWith(".vorkspace-recovery.")),
    false,
  );
});
