#!/usr/bin/env bash
# UserPromptSubmit hook — for every user prompt, detect vendor/tool keywords
# that map to skills NOT in the active profile, and surface them as a
# "💡 Available skills" context block. Makes meta/smart-loader proactive.
#
# Performance contract: <200ms p95. Achieved by:
#   - Pre-building a vendor-keyword index from catalog skill names (cached).
#   - Intersecting prompt tokens against the index — set lookup, not grep.
#   - Skipping the smart-lookup script entirely when no vendor matches.
#   - Throttling per-session to once per ~500ms (epoch-ms stored in file).
#
# Filtering is index-driven, not English-driven: only words that are
# actually skill names (lowercased) qualify. "deploy" never triggers
# unless there's a skill literally named "deploy". "coolify" does because
# deployment/coolify exists.
#
# Exit codes: 0 always (observability hook, never a gate).

set -uo pipefail

payload="$(cat -)"
LOOKUP="${CUE_SMART_LOOKUP:-$HOME/Documents/cue/resources/skills/skills/meta/smart-loader/scripts/smart-lookup.sh}"
CATALOG="${CUE_CATALOG:-$HOME/Documents/cue/resources/skills/catalog/catalog.json}"
CACHE_DIR="${XDG_RUNTIME_DIR:-/tmp}/cue-smart-loader-suggest"
KW_INDEX="$CACHE_DIR/vendor-keywords.txt"
mkdir -p "$CACHE_DIR" 2>/dev/null || exit 0

extract() {
  printf '%s' "$payload" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
    | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"$//"
}

prompt="$(extract prompt)"
session_id="$(extract session_id)"
[ -z "$prompt" ] && exit 0
[ "${#prompt}" -lt 8 ] && exit 0

# Per-session throttle, millisecond resolution. Skip if last run <500ms ago.
throttle_file="$CACHE_DIR/throttle.${session_id:-default}"
now_ms=$(date +%s%3N)
last_ms=$(cat "$throttle_file" 2>/dev/null || echo 0)
if [ $((now_ms - last_ms)) -lt 500 ]; then exit 0; fi
printf '%s' "$now_ms" > "$throttle_file"

# ─── Vendor-keyword index ─────────────────────────────────────────────────
# Build (or refresh) a set of vendor/tool keywords. A keyword is the last
# segment of a skill's category/name path, lowercased, length 4+. So
# "deployment/coolify" → "coolify". This drops noise like "deploy" or
# "send" since those aren't actual skill names.
need_rebuild=0
if [ ! -f "$KW_INDEX" ]; then
  need_rebuild=1
elif [ -f "$CATALOG" ]; then
  cat_mtime=$(stat -c '%Y' "$CATALOG" 2>/dev/null || echo 0)
  idx_mtime=$(stat -c '%Y' "$KW_INDEX" 2>/dev/null || echo 0)
  [ "$cat_mtime" -gt "$idx_mtime" ] && need_rebuild=1
fi
if [ "$need_rebuild" -eq 1 ] && [ -f "$CATALOG" ] && command -v jq >/dev/null 2>&1; then
  # Build keyword index from:
  #   1. Full skill name (length >=4)              "coolify"
  #   2. Each hyphen-prefix segment (length >=4)    "higgsfield" from "higgsfield-generate"
  #   3. The category name (length >=4)             "hostinger" from "hostinger/dns"
  # This catches prompts that mention the vendor/platform by its category
  # (e.g. "hostinger dns") even when the skill name doesn't carry the brand.
  jq -r '
    .installed[] |
    [
      ((.name // "") | ascii_downcase),
      ((.category // "") | ascii_downcase)
    ] +
    ((.name // "") | ascii_downcase | split("-") | . as $parts |
     [range(1; length) | $parts[0:.] | join("-")]) |
    .[] |
    select(length >= 4)
  ' "$CATALOG" 2>/dev/null \
    | sort -u > "$KW_INDEX.tmp" && mv "$KW_INDEX.tmp" "$KW_INDEX"
fi
[ ! -s "$KW_INDEX" ] && exit 0

# ─── Prompt tokenization + intersection ───────────────────────────────────
# Lowercase + tokenize on non-word chars + filter to length >=4. Then
# intersect with the index. fgrep is plenty fast for this scale (~300 names).
prompt_tokens=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]' \
  | tr -c 'a-z0-9_-' '\n' \
  | awk 'length($0) >= 4 && length($0) <= 30' \
  | sort -u)
[ -z "$prompt_tokens" ] && exit 0

# Intersection: keywords present in BOTH the prompt AND the vendor index.
matched_keywords=$(grep -Fxf "$KW_INDEX" <<< "$prompt_tokens" 2>/dev/null | head -3)
[ -z "$matched_keywords" ] && exit 0

# ─── Run smart-lookup against each matched keyword ────────────────────────
[ ! -x "$LOOKUP" ] && exit 0

declare -A seen_skills
hits=()
while IFS= read -r kw; do
  [ -z "$kw" ] && continue
  [ "${#hits[@]}" -ge 3 ] && break
  kw_lc="${kw,,}"
  while IFS=$'\t' read -r cat_name path score desc mcp_status; do
    [ -z "$cat_name" ] && continue
    # Drop the smart-loader self-reference — it matches almost every vendor
    # keyword because its description lists examples.
    [ "$cat_name" = "meta/smart-loader" ] && continue
    score_int="${score:-0}"
    if [ "$score_int" -lt 80 ]; then
      # Below 80, only accept if the keyword exactly matches the category.
      # Catches hostinger/dns, hostinger/vps when prompt says "hostinger" —
      # the skill names don't contain "hostinger" but the category does.
      [ "$score_int" -lt 60 ] && continue
      category="${cat_name%%/*}"
      [ "${category,,}" != "$kw_lc" ] && continue
    fi
    [ -n "${seen_skills[$cat_name]:-}" ] && continue
    seen_skills[$cat_name]=1
    short_desc=$(printf '%s' "$desc" | cut -c1-70)
    mcp_note=""
    case "$mcp_status" in
      missing:*)
        mcp_note=" (needs MCP: ${mcp_status#missing:})"
        ;;
    esac
    hits+=("$cat_name|$short_desc|$mcp_note")
  done < <(bash "$LOOKUP" --exclude-loaded --no-fuzzy --limit 3 "$kw" 2>/dev/null)
done <<< "$matched_keywords"

[ "${#hits[@]}" -eq 0 ] && exit 0

printf '💡 Available skills (not in active profile):\n'
for hit in "${hits[@]}"; do
  IFS='|' read -r cat_name short_desc mcp_note <<< "$hit"
  printf '   - %s%s\n' "$cat_name" "$mcp_note"
  [ -n "$short_desc" ] && printf '     %s\n' "$short_desc"
done
printf '   Use meta/smart-loader to read the SKILL.md from disk.\n'

exit 0
