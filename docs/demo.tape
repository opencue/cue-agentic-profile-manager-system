# vhs tape — cue 30-second demo
# Generate with:  vhs docs/demo.tape
# Outputs to:     docs/assets/demo.gif
#
# Install vhs:    https://github.com/charmbracelet/vhs

Output docs/assets/demo.gif

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms
Set PlaybackSpeed 1.0

# Setup — pretend we're a fresh user in a fresh shell
Hide
Type "clear" Enter
Show

Sleep 600ms

# 1. Install
Type "npm install -g cue-ai" Sleep 400ms Enter
Sleep 2.5s

# 2. See what's available
Type "cue list" Sleep 400ms Enter
Sleep 3s

# 3. Pin a profile to the current repo
Type "cd ~/projects/q4-launch && echo marketing > .cue-profile" Sleep 400ms Enter
Sleep 1.5s

# 4. See it from cue's POV
Type "cue current" Sleep 400ms Enter
Sleep 2s

# 5. Audit every loadout
Type "cue optimizer" Sleep 400ms Enter
Sleep 4s

# 6. Launch Claude Code — boots into the marketing loadout automatically
Type "claude" Sleep 400ms Enter
Sleep 3s
