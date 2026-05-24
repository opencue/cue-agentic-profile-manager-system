#!/usr/bin/env bash
# PreToolUse:Write|Edit secrets guard.
#
# Refuses writes/edits to files whose paths look like secrets or credentials.
# The bash-quality-preflight catches destructive shell ops; this catches the
# adjacent failure mode — agent writing/overwriting a credentials file.
#
# Exit 0 = allow, exit 2 = block (Claude sees stderr as the reason).
# No deps; reads the hook payload from stdin (Claude Code hook protocol).
set -euo pipefail

payload="$(cat -)"
target="$(printf '%s' "$payload" | python3 -c 'import sys,json
try: d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))
except Exception: pass' 2>/dev/null)"
if [[ -z "$target" ]]; then exit 0; fi

# Normalize: resolve to absolute path so basename/dir checks work consistently.
abs="$target"
if [[ "$abs" != /* ]]; then abs="$(pwd)/$abs"; fi
base="$(basename "$abs")"
dir="$(dirname "$abs")"

# Allow .env.example / .env.sample — they're meant to be committed.
case "$base" in
  *.example|*.sample|*.template) exit 0 ;;
esac

# Filename patterns that are almost always credentials.
deny_basename=(
  '.env'
  '.env.local' '.env.production' '.env.prod' '.env.staging'
  'credentials.json' '.credentials.json'
  '.netrc' '.pgpass' '.my.cnf'
  'id_rsa' 'id_ed25519' 'id_ecdsa' 'id_dsa'
  'service-account.json' 'gcp-key.json' 'aws-credentials'
  'firebase-adminsdk.json'
)
for needle in "${deny_basename[@]}"; do
  if [[ "$base" == "$needle" ]]; then
    >&2 echo "cue:secrets-guard blocked: refusing to write to '$target' (matches '$needle')"
    >&2 echo "If you really mean it, ask the user first."
    exit 2
  fi
done

# Extension patterns.
case "$base" in
  *.pem|*.key|*.p12|*.pfx|*.keystore|*.jks)
    >&2 echo "cue:secrets-guard blocked: refusing to write key/cert file '$target'"
    exit 2 ;;
esac

# Directory patterns — refuse anything under ~/.ssh, ~/.aws, ~/.gnupg, etc.
deny_dir_substrings=(
  '/.ssh/'
  '/.aws/'
  '/.gnupg/'
  '/.config/gcloud/'
  '/.docker/config.json'
)
for pat in "${deny_dir_substrings[@]}"; do
  if [[ "$abs" == *"$pat"* ]]; then
    >&2 echo "cue:secrets-guard blocked: refusing to write under credentials path '$pat'"
    exit 2
  fi
done

exit 0
