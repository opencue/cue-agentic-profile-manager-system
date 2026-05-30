import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";

interface ProfilePart {
  name: string;
  description: string;
  skills: number;
  mcps: number;
  plugins: number;
}

interface StatusData {
  profile: ProfilePart | null;
  /** Per-part breakdown when the active selector is a composite (a+b+c). Empty for single profiles. */
  parts: ProfilePart[];
  source: string;
  warnings: { code: string; message: string }[];
  gates: { ts: string; overall: "pass" | "fail" | "skip"; failed: string[] } | null;
  totalProfiles: number;
  totalSessions: number;
  telemetryEnabled: boolean;
}

export function ActiveProfile() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["status"],
    queryFn: () => fetcher<StatusData>("/status"),
  });

  if (isLoading) return <Card><div className="empty">Loading…</div></Card>;
  if (error) return <Card><div className="empty">{(error as Error).message}</div></Card>;
  if (!data?.profile) {
    return (
      <Card>
        <div className="empty">
          No profile pinned to this directory.
          <br />
          <code>cue init</code>
        </div>
      </Card>
    );
  }

  const dotClass =
    data.gates?.overall === "fail" ? "dot red" :
    data.warnings.length > 0       ? "dot yellow" :
                                     "dot green";
  const gateLabel =
    data.gates?.overall === "fail" ? `Gates ✗ ${data.gates.failed.length} failed` :
    data.gates?.overall === "pass" ? `Gates ✓ passed` :
    data.gates?.overall === "skip" ? `Gates · none declared` :
                                     `Gates · never run`;

  const isComposite = data.parts.length > 1;
  // Display title for composite: "a + b + c" reads better than "a+b+c".
  const titleName = isComposite
    ? data.parts.map((p) => p.name).join(" + ")
    : data.profile.name;

  return (
    <Card>
      <div className="card-header">
        <div className="row">
          <span className={dotClass} />
          <span className="card-title">
            {isComposite ? `Active profiles (${data.parts.length})` : "Active profile"}
          </span>
        </div>
        <code className="card-cta" title="Copy to clipboard">cue status</code>
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{titleName}</span>
        <span className="dim" style={{ marginLeft: 12, fontSize: 12 }}>
          via {data.source}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        {data.profile.description}
      </div>

      {isComposite && (
        <div style={{ marginBottom: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Profile</th>
                <th className="num">Skills</th>
                <th className="num">MCPs</th>
                <th className="num">Plugins</th>
              </tr>
            </thead>
            <tbody>
              {data.parts.map((part) => (
                <tr key={part.name}>
                  <td className="mono">{part.name}</td>
                  <td className="num">{part.skills}</td>
                  <td className="num">{part.mcps}</td>
                  <td className="num">{part.plugins}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            Per-part counts are pre-dedupe. The totals below reflect the merged composite.
          </div>
        </div>
      )}

      <div className="stat-grid">
        <Stat label={isComposite ? "Total skills" : "Skills"} value={data.profile.skills} />
        <Stat label={isComposite ? "Total MCPs" : "MCPs"} value={data.profile.mcps} />
        <Stat label="Plugins" value={data.profile.plugins} />
        <Stat label="Sessions" value={data.totalSessions} />
        <Stat label="Warnings" value={data.warnings.length} />
        <Stat label="" value={gateLabel} />
      </div>

      {!data.telemetryEnabled && (
        <div style={{ marginTop: 14, padding: 10, background: "var(--accent-soft)", borderRadius: 6, fontSize: 12 }}>
          📊 Telemetry is off — most cards will show empty.
          {" "}<code>cue telemetry enable</code>
        </div>
      )}

      {!isComposite && (
        <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
          Stack more profiles in this directory:{" "}
          <code className="card-cta">
            echo "{data.profile.name}+ecc+core" {">"} .cue-profile
          </code>
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="card">{children}</section>;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="stat-num">{value}</div>
      {label && <div className="stat-label">{label}</div>}
    </div>
  );
}
