#!/bin/bash
# macOS profile handoff. Copies only; never removes the original profile.
set -eo pipefail
umask 077
usage() {
  cat <<'USAGE'
Usage: bash migrate-monocode-to-vorkspace.sh [--apply] [--backup-dir PATH]
       [--source PROFILE --destination PROFILE]

Dry-run is the default. Quit MonoCode, vorkspace and any local host first.
vorkspace already uses MonoCode's com.monocode.desktop profile on this Mac.
--apply makes a private backup; the default handoff needs no profile move.
An optional recovery copy requires both paths and an absent/empty destination.
The normal app consumes ~/Library/Application Support/com.monocode.desktop.
Keychain stays on this Mac; external provider homes and workspaces are not copied.
Symlinks are preserved, not followed. Originals are never deleted.
USAGE
}
fail() { printf '%s\n' "$*" >&2; exit 1; }
apply=0 source_profile='' destination='' backup=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1; shift ;;
    --dry-run) apply=0; shift ;;
    --backup-dir|--source|--destination)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "Missing path for $1"
      case "$1" in
        --backup-dir) backup=$2 ;;
        --source) source_profile=$2 ;;
        --destination) destination=$2 ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[ "$(uname -s)" = Darwin ] || fail 'This helper supports macOS only.'
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail 'HOME must be an existing directory.'
home=$(cd "$HOME" && pwd -P)
# Normalize paths using the nearest existing parent, without creating anything.
absolute() {
  local path=$1 suffix='' leaf
  case "$path" in /*) ;; *) fail 'Use absolute paths.' ;; esac
  while [ ! -e "$path" ] && [ ! -L "$path" ]; do
    leaf=$(basename "$path")
    case "$leaf" in .|..) fail 'Use normalized paths without dot components.' ;; esac
    suffix="/$leaf$suffix"; path=$(dirname "$path")
  done
  [ -d "$path" ] || fail 'A path parent is not a directory.'
  printf '%s%s\n' "$(cd "$path" && pwd -P)" "$suffix"
}
if [ -n "$source_profile" ] || [ -n "$destination" ]; then
  [ -n "$source_profile" ] && [ -n "$destination" ] || fail 'Recovery requires --source and --destination together.'
  [ -d "$source_profile" ] && [ ! -L "$source_profile" ] || fail 'Recovery source must be a real directory.'
  source_profile=$(absolute "$source_profile")
  [ ! -L "$destination" ] || fail 'Recovery destination cannot be a symlink.'
  destination=$(absolute "$destination")
  case "$destination/" in "$source_profile/"*) fail 'Recovery destination overlaps its source.' ;; esac
  case "$source_profile/" in "$destination/"*) fail 'Recovery destination overlaps its source.' ;; esac
  if [ -e "$destination" ]; then
    [ -d "$destination" ] || fail 'Recovery destination must be a directory.'
    [ -z "$(find "$destination" -mindepth 1 -maxdepth 1 -print -quit)" ] || fail 'Recovery destination is populated; refusing to overwrite it.'
  fi
fi
backup=${backup:-"$home/vorkspace-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"}
[ ! -e "$backup" ] && [ ! -L "$backup" ] || fail 'Backup destination already exists.'
backup=$(absolute "$backup")
paths=()
add() { [ ! -e "$home/$1" ] && [ ! -L "$home/$1" ] || paths+=("$1"); }
for relative in \
  'Library/Application Support/com.monocode.desktop' \
  'Library/Preferences/com.monocode.desktop.plist' \
  'Library/WebKit/com.monocode.desktop' \
  'Library/Caches/com.monocode.desktop' \
  'Library/HTTPStorages/com.monocode.desktop' \
  'Library/HTTPStorages/com.monocode.desktop.binarycookies' \
  'Library/Cookies/com.monocode.desktop.binarycookies' \
  'Library/Saved Application State/com.monocode.desktop.savedState' \
  'Library/LaunchAgents/com.monocode.host.plist'; do add "$relative"; done
shopt -s nullglob
for path in "$home"/.monocode* "$home"/Library/Preferences/ByHost/com.monocode.desktop.*.plist; do
  add "${path#"$home/"}"
done
for relative in "${paths[@]}"; do
  case "$backup/" in "$home/$relative/"*) fail 'Backup must be outside all source paths.' ;; esac
done
if [ -n "$source_profile" ]; then
  case "$backup/" in "$source_profile/"*) fail 'Backup must be outside the recovery source.' ;; esac
  case "$backup/" in "$destination/"*) fail 'Backup must be outside the recovery destination.' ;; esac
  case "$destination/" in "$backup/"*) fail 'Recovery destination must be outside the backup.' ;; esac
fi
printf 'vorkspace reuses the existing MonoCode profile (com.monocode.desktop).\n'
printf 'App-owned locations found: %s\nBackup: %s\n' "${#paths[@]}" "$backup"
for relative in "${paths[@]}"; do printf '  %s\n' "$relative"; done
[ -z "$source_profile" ] || printf 'Recovery profile: %s -> %s\n' "$source_profile" "$destination"
if [ "$apply" -eq 0 ]; then printf 'Dry-run only. Use --apply after closing the apps.\n'; exit 0; fi
# Check process names without printing command lines, tokens, or environment.
closed() {
  if pgrep "$@" >/dev/null; then fail 'Close MonoCode, vorkspace and the local host before applying.'
  else [ "$?" -eq 1 ] || fail 'Unable to check running apps; refusing to copy live data.'; fi
}
apps_closed() {
  closed -x 'monocode|MonoCode|vorkspace'
  closed -f '(build/host/(monocode|vorkspace)-host[.]mjs|/[.]monocode-host/.*host[.]mjs).*serve'
}
apps_closed
[ -z "$source_profile" ] || [ -x /usr/bin/perl ] || fail 'Recovery requires macOS /usr/bin/perl.'
[ "${#paths[@]}" -gt 0 ] || [ -n "$source_profile" ] || fail 'No app-owned data found; nothing to copy.'
mkdir -p "$(dirname "$backup")"
mkdir -m 700 "$backup"
for relative in "${paths[@]}"; do
  mkdir -p "$(dirname "$backup/$relative")"
  if [ -L "$home/$relative" ]; then cp -pP "$home/$relative" "$backup/$relative"
  else ditto "$home/$relative" "$backup/$relative"; fi
  printf '%s\n' "$relative" >> "$backup/manifest.txt"
done
if [ -n "$source_profile" ]; then
  # Back up the complete recovery input before publishing the requested copy.
  ditto "$source_profile" "$backup/recovery-source"
  mkdir -p "$(dirname "$destination")"
  staging=$(mktemp -d "$(dirname "$destination")/.vorkspace-recovery.XXXXXXXX")
  trap '[ -z "$staging" ] || rm -rf "$staging"' EXIT
  trap 'exit 1' HUP INT TERM
  ditto "$backup/recovery-source" "$staging"
  chmod 700 "$staging"
  apps_closed
  # POSIX directory rename refuses a now-populated directory or symlink target.
  /usr/bin/perl -e 'rename $ARGV[0], $ARGV[1] or die "Recovery destination changed; refusing to overwrite: $!\n"' -- "$staging" "$destination"
  staging=''
fi
printf 'Backup complete: %s\nOriginal files and Keychain entries remain in place.\n' "$backup"
