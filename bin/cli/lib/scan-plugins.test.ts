import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanPlugins } from "./scan-plugins";

let root: string;
let pluginsRoot: string;
let configPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "soul-scan-plugins-"));
  pluginsRoot = join(root, "plugins");
  configPath = join(root, "claude.json");
  await mkdir(pluginsRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanPlugins", () => {
  test("discovers enabled direct plugins and skill descriptions", async () => {
    await writeConfig(["alpha"]);
    await makePlugin(join(pluginsRoot, "alpha"), {
      name: "alpha",
      version: "1.2.3",
      skills: [
        {
          slug: "build",
          name: "build",
          description: "Build the project.",
        },
      ],
    });

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      name: "alpha",
      id: "alpha",
      version: "1.2.3",
      status: "Enabled",
      skills: [{ name: "build", description: "Build the project." }],
    });
  });

  test("flags missing and installed-only plugins", async () => {
    await writeConfig({ alpha: true, missing: true, beta: false });
    await makePlugin(join(pluginsRoot, "alpha"), { name: "alpha" });
    await makePlugin(join(pluginsRoot, "beta"), { name: "beta" });
    await makePlugin(join(pluginsRoot, "gamma"), { name: "gamma" });

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });
    const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));

    expect(byName.get("alpha")?.status).toBe("Enabled");
    expect(byName.get("missing")?.status).toBe("Broken");
    expect(byName.get("missing")?.diagnostics?.[0]?.code).toBe("PLUGIN_DIR_MISSING");
    expect(byName.get("beta")?.status).toBe("Disabled");
    expect(byName.get("gamma")?.status).toBe("Disabled");
  });

  test("locates marketplace plugins by <name>@<marketplace>", async () => {
    await writeConfig({ "frontend-design@claude-plugins-official": true });
    const pluginDir = join(
      pluginsRoot,
      "marketplaces",
      "claude-plugins-official",
      "plugins",
      "frontend-design",
    );
    await makePlugin(pluginDir, {
      name: "frontend-design",
      skills: [
        {
          slug: "frontend-design",
          name: "frontend-design",
          description: "Frontend design skill.",
        },
      ],
    });

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      name: "frontend-design",
      id: "frontend-design@claude-plugins-official",
      marketplace: "claude-plugins-official",
      status: "Enabled",
      skills: [{ name: "frontend-design", description: "Frontend design skill." }],
    });
  });

  test("uses plugin manifest skills path when it points outside ./skills", async () => {
    await writeConfig({ "claude-mem@thedotmack": true });
    const marketplace = join(pluginsRoot, "marketplaces", "thedotmack");
    const pluginDir = join(marketplace, "plugin");
    await makePlugin(pluginDir, {
      name: "claude-mem",
      skillsPath: "./plugin-skills",
      skills: [
        {
          slug: "mem-search",
          name: "mem-search",
          description: "Search memory.",
        },
      ],
    });

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });

    expect(plugins[0]).toMatchObject({
      name: "claude-mem",
      id: "claude-mem@thedotmack",
      status: "Enabled",
      skills: [{ name: "mem-search", description: "Search memory." }],
    });
  });

  test("returns a diagnostic plugin when the Claude config is malformed", async () => {
    await writeFile(configPath, "{not-json", "utf8");

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      name: "claude-config",
      status: "Broken",
      skills: [],
    });
    expect(plugins[0]?.diagnostics?.[0]?.code).toBe("CLAUDE_CONFIG_MALFORMED");
  });

  test("treats a missing explicit Claude config as an isolated empty scan", async () => {
    await makePlugin(join(pluginsRoot, "installed"), {
      name: "installed",
      skills: [
        {
          slug: "skill",
          name: "skill",
          description: "Host fixture skill.",
        },
      ],
    });

    const plugins = await scanPlugins({ claudeConfigPath: configPath, pluginsRoot });

    expect(plugins).toEqual([]);
  });
});

async function writeConfig(enabledPlugins: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify({ enabledPlugins }, null, 2), "utf8");
}

async function makePlugin(
  pluginDir: string,
  opts: {
    name: string;
    version?: string;
    skillsPath?: string;
    skills?: Array<{ slug: string; name: string; description: string }>;
  },
): Promise<void> {
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: opts.name,
      version: opts.version,
      skills: opts.skillsPath,
    }),
    "utf8",
  );

  const skillsPath = join(pluginDir, opts.skillsPath ?? "skills");
  for (const skill of opts.skills ?? []) {
    const skillDir = join(skillsPath, skill.slug);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n`,
      "utf8",
    );
  }
}
