/**
 * `cue list` — show all available profiles with their icon, name, and description.
 */

import { resolve } from "node:path";
import { listProfiles, loadProfile } from "../lib/profile-loader";
import { detectKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";

export async function run(_args: string[]): Promise<number> {
  const names = await listProfiles();
  if (names.length === 0) {
    process.stderr.write("No profiles found in profiles/\n");
    return 1;
  }

  const kitty = await detectKittyTerminal();
  const profilesRoot = resolve(new URL(import.meta.url).pathname, "..", "..", "..", "profiles");

  const maxNameLen = Math.max(...names.map((n) => n.length));
  let nextImageId = 1;

  for (const name of names) {
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
  }
  return 0;
}
