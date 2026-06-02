/**
 * Top-of-dashboard metric row. One glance at the numbers that matter:
 * profile/session counts, the active profile's resource footprint, gate
 * health, warnings, and telemetry. Sourced from the single /status payload
 * the other cards already share (no extra round-trip).
 */
import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";

interface StatusData {
  profile: { name: string; skills: number; mcps: number; plugins: number } | null;
  warnings: { code: string; message: string }[];
  gates: { overall: "pass" | "fail" | "skip" } | null;
  totalProfiles: number;
  totalSessions: number;
  telemetryEnabled: boolean;
}

type Tile = { num: number | string; label: string; cls?: string; sub?: string };

export function StatsOverview() {
  const { data, isError } = useQuery({
    queryKey: ["status"],
    queryFn: () => fetcher<StatusData>("/status"),
  });

  // The dashboard cards below already render load/error/empty states; the
  // overview is a summary, so it simply hides until /status resolves.
  if (isError || !data) return null;

  const gate = data.gates?.overall;
  const warns = data.warnings.length;
  const tiles: Tile[] = [
    { num: data.totalProfiles, label: "Profiles" },
    { num: data.totalSessions, label: "Sessions" },
    { num: data.profile?.skills ?? 0, label: "Skills", cls: "accent" },
    { num: data.profile?.mcps ?? 0, label: "MCPs" },
    { num: data.profile?.plugins ?? 0, label: "Plugins" },
    {
      num: gate === "pass" ? "✓" : gate === "fail" ? "✗" : "·",
      label: "Gates",
      cls: gate === "pass" ? "green" : gate === "fail" ? "red" : "dim",
      sub: gate ?? "never run",
    },
    { num: warns, label: "Warnings", cls: warns > 0 ? "red" : "green" },
    {
      num: data.telemetryEnabled ? "on" : "off",
      label: "Telemetry",
      cls: data.telemetryEnabled ? "green" : "dim",
    },
  ];

  return (
    <div className="stats-overview">
      {tiles.map((t) => (
        <div className="stat-tile" key={t.label}>
          <span className={`tile-num ${t.cls ?? ""}`.trim()}>{t.num}</span>
          <span className="tile-label">{t.label}</span>
          {t.sub && <span className="tile-sub">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}
