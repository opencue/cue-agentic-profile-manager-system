/**
 * Types for the soul profile system. Mirror of profiles/schema.json.
 *
 * Consumed by bin/cli/* via:
 *   import type { Profile, NpxSkillRef, MCPRef, SkillRef } from "../../profiles/_types";
 */

export type AgentKind = "claude-code" | "codex";

export type MCPRef = string;

export type SkillRef = string;

export interface NpxSkillRef {
  repo: string;
  pin?: string;
  skills: SkillRef[];
}

export interface ProfileSkills {
  local?: SkillRef[];
  npx?: NpxSkillRef[];
  plugins?: string[];
}

export interface Profile {
  name: string;
  description: string;
  agents?: AgentKind[];
  inherits?: string;
  skills?: ProfileSkills;
  mcps?: MCPRef[];
  env?: Record<string, string>;
}

export interface ResolvedProfile extends Profile {
  agents: AgentKind[];
  skills: Required<ProfileSkills>;
  mcps: MCPRef[];
  env: Record<string, string>;
  inheritanceChain: string[];
}

export interface LinkPlan {
  source: string;
  target: string;
  origin: "local" | "npx" | "plugin";
}

export class ProfileError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export class ProfileNotFound extends ProfileError {
  constructor(name: string) {
    super("PROFILE_NOT_FOUND", `Profile "${name}" not found in profiles/`);
  }
}

export class SchemaViolation extends ProfileError {
  constructor(name: string, public errors: unknown[]) {
    super("SCHEMA_VIOLATION", `Profile "${name}" failed schema validation`);
  }
}

export class InheritanceCycle extends ProfileError {
  constructor(public chain: string[]) {
    super("INHERITANCE_CYCLE", `Inheritance cycle: ${chain.join(" -> ")}`);
  }
}

export class InheritanceDepthExceeded extends ProfileError {
  constructor(public chain: string[]) {
    super(
      "INHERITANCE_DEPTH",
      `Inheritance depth > 3 (chain: ${chain.join(" -> ")})`,
    );
  }
}
