/**
 * `soul scan`
 *
 * Runs the available scanner modules (A10/A11 when present) plus a local
 * fallback scanner, then prints a domain-grouped tree.
 */
import {
  bucketSkills,
  formatScanTree,
  scanInstalledSkills,
} from "../lib/profile-generator";

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }

  const json = args.includes("--json");
  const scan = await scanInstalledSkills();
  const assignments = bucketSkills(scan.skills);

  if (json) {
    process.stdout.write(
      JSON.stringify({ assignments, diagnostics: scan.diagnostics }, null, 2) +
        "\n",
    );
  } else {
    process.stdout.write(formatScanTree(assignments) + "\n");
    if (scan.diagnostics.length > 0) {
      process.stdout.write("\nDiagnostics:\n");
      for (const diagnostic of scan.diagnostics) {
        process.stdout.write(`  - ${diagnostic}\n`);
      }
    }
  }

  return 0;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: soul scan [--json]",
      "",
      "Discovers local skills, npx-installed skills, and Claude Code plugin",
      "skills, then groups them by inferred domain.",
      "",
      "Flags:",
      "  --json    Print machine-readable assignments and diagnostics",
      "  --help    Show this help",
      "",
    ].join("\n"),
  );
}
