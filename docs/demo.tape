# vhs tape — cue demo: install → optimizer → real claude launch
# Regenerate:  vhs docs/demo.tape   →   docs/assets/demo.gif

Output docs/assets/demo.gif

Set Shell           "bash"
Set FontFamily      "JetBrainsMono Nerd Font Mono"
Set FontSize        18
Set Width           1400
Set Height          820
Set Padding         28
Set Margin          0
Set MarginFill      "#0f0f1a"
Set BorderRadius    14
Set Theme           "Catppuccin Mocha"
Set TypingSpeed     45ms
Set PlaybackSpeed   1.0
Set LoopOffset      90%

# ── Hidden setup ──────────────────────────────────────────────
# PATH ordering matters:
#   1. ~/.local/bin       → contains the `claude` shim
#   2. ~/.nvm/.../bin     → contains the REAL claude binary (so shim can find & exec it)
#   3. ~/Documents/cue/bin → the `cue` CLI we want to demo
Hide
# Strip any cue/claude session env that leaks in from the parent process
# (otherwise the shim's recursion guard fires immediately and CLAUDE_CONFIG_DIR is wrong)
Type `unset CUE_LAUNCHING CLAUDE_CONFIG_DIR CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_EFFORT AI_AGENT CODEX_HOME` Enter
Type `export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v22.22.0/bin:$HOME/Documents/cue/bin:$PATH"` Enter
Type `export CUE_DISABLE_KITTY_IMAGES=1` Enter
Type `export PS1="\[\033[38;5;213m\]➜\[\033[0m\] \[\033[38;5;111m\]demo\[\033[0m\] "` Enter
Type "mkdir -p /tmp/cue-demo && cd /tmp/cue-demo && rm -f .cue-profile" Enter
Type "clear" Enter
Show
Sleep 700ms

# ── 1. INSTALL ────────────────────────────────────────────────
Type "# 1. install" Enter
Sleep 400ms
Type "npm install -g cue-ai" Enter
Sleep 800ms
# Fake success line so the install reads as "done"
Hide
Type `printf "\033[1A\033[2K\033[90m+ cue-ai@0.3.0\033[0m\n\033[90madded 4 packages in 1.8s\033[0m\n"` Enter
Type "clear" Enter
Show
Sleep 400ms
Type "# (installed)" Enter
Sleep 800ms
Type "clear" Enter
Sleep 300ms

# ── 2. OPTIMIZER ──────────────────────────────────────────────
Type "# 2. audit what each profile loads" Enter
Sleep 500ms
Type "cue optimizer readme-writer" Enter
Sleep 5s

Type "clear" Enter
Sleep 300ms

# ── 3. CLAUDE LAUNCHES ────────────────────────────────────────
Type "# 3. type claude — picker appears, profile loads" Enter
Sleep 500ms
Type "claude" Enter
Sleep 2.8s

# Arrow down to readme-writer (alphabetical, ~14 down from "full")
Down@110ms 14
Sleep 800ms
Enter
# Watch Claude Code boot with only this profile's loadout
Sleep 6s

# ── exit cleanly ──────────────────────────────────────────────
Ctrl+c
Sleep 400ms
Ctrl+c
Sleep 800ms
