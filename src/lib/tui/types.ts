/**
 * Shared TUI types. The renderer consumes TuiState; the app loop produces it.
 */

export type Pane = "profiles" | "skills" | "preview";

/** Which list the middle pane shows. Chosen by `cue tui [--mcp|--cli]`. */
export type TuiMode = "skills" | "mcps" | "clis";

export interface ProfileRow {
  name: string;
  icon: string;
  description: string;
  /** Absolute path to the profile's iconImage (logo), when one exists and is on disk. */
  iconImagePath?: string;
  /** Stable kitty image id (1..255) assigned to image-bearing rows. */
  imageId?: number;
}

export type SkillKind = "local" | "npx" | "mcp" | "cli" | "plugin";

export interface SkillRow {
  id: string;
  kind: SkillKind;
  /** Absolute path to SKILL.md, when known. Used to load preview on demand. */
  skillMdPath?: string;
  /**
   * Where the skill comes from: "builtin" = inherited from the core baseline
   * (managed by `cue builtin`); "profile" = added by the active profile itself.
   * Drives the dot color in the skills pane.
   */
  origin?: "builtin" | "profile";
  /**
   * Pre-rendered preview body for non-skill rows (MCPs, CLIs) that have no
   * SKILL.md. When set, the preview pane shows this verbatim.
   */
  previewBody?: string;
  /**
   * For `kind: "plugin"` rows, the source plugin id (e.g. `claude-mem@thedotmack`).
   * Drives a per-plugin dot color so skills group visibly by their plugin.
   */
  pluginId?: string;
}

export interface ActiveProfile {
  name: string;
  source: "flag" | "pin-file" | "repo-default" | "global-default" | "selection";
  skillCount: number;
  mcpCount: number;
  pluginCount: number;
}

export interface Preview {
  title: string;
  body: string;
}

export interface TuiState {
  profiles: ProfileRow[];
  active: ActiveProfile | null;
  /** Skills of the profile under the profile cursor (not necessarily the active one). */
  skills: SkillRow[];
  profileCursor: number;
  skillCursor: number;
  previewScroll: number;
  preview: Preview | null;
  focus: Pane;
  error: string | null;
  /** True when the terminal can render kitty graphics; profile rows then paint logos. */
  kitty?: boolean;
  /** Which list the middle pane shows. Defaults to "skills" when unset. */
  mode?: TuiMode;
  /** Column-width adjustments (cols) from keyboard resize (< / >), relative to
   * the auto-computed layout. Clamped in paneRects so panes keep a min width. */
  profileWidthDelta?: number;
  skillWidthDelta?: number;
}
