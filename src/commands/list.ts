/**
 * `cue list` — show all available profiles with their icon, name, and description.
 *
 * Renders a "✨ Featured" section first (curated in `profiles/_featured.yaml`)
 * followed by "All profiles" with the rest. If no `_featured.yaml` exists,
 * falls back to a single flat list.
 */

import { resolve } from "node:path";
import { listFeaturedProfiles, listProfiles, loadProfile } from "../lib/profile-loader";
import { detectKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";

export async function run(_args: string[]): Promise<number> {
  const names = await listProfiles();
  if (names.length === 0) {
    process.stderr.write("No profiles found in profiles/\n");
    return 1;
  }

  const featuredRaw = await listFeaturedProfiles();
  const known = new Set(names);
  const featured = featuredRaw.filter((n) => known.has(n));
  const featuredSet = new Set(featured);
  const rest = names.filter((n) => !featuredSet.has(n));

  const kitty = await detectKittyTerminal();
  const profilesRoot = resolve(new URL(import.meta.url).pathname, "..", "..", "..", "profiles");

  const maxNameLen = Math.max(...names.map((n) => n.length));
  let nextImageId = 1;

  const renderRow = async (name: string) => {
    let icon = "  ";
    let description = "";
    try {
      const p = await loadProfile(name);
      if (kitty && p.iconImage && nextImageId <= 255) {
        const imgPath = resolve(profilesRoot, name, p.iconImage);
        const id = nextImageId++;
        transmitKittyImage(imgPath, id, 2, 1);
        icon = kittyPlaceholderLabel(id, 2, 1);
      } else {
        icon = p.icon ?? "  ";
      }
      description = p.description;
    } catch { /* best-effort */ }
    const namePadded = name.padEnd(maxNameLen);
    process.stdout.write(`${icon}  ${namePadded}  ${description}\n`);
  };

  if (featured.length > 0) {
    process.stdout.write("✨ Featured\n");
    for (const name of featured) await renderRow(name);
    process.stdout.write("\nAll profiles\n");
    for (const name of rest) await renderRow(name);
  } else {
    for (const name of names) await renderRow(name);
  }
  return 0;
}
