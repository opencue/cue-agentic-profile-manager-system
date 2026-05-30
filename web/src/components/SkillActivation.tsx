import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";
import { fmtRelative } from "../lib/format";

interface ReportData {
  profile: string;
  windowDays: number;
  rows: { id: string; hits: number; lastUsed: string | null; zombie: boolean }[];
}

export function SkillActivation() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["skill-report"],
    queryFn: () => fetcher<ReportData>("/skill-report"),
  });

  if (isLoading) {
    return <Card><div className="empty">Loading skill report…</div></Card>;
  }
  if (error) {
    const msg = (error as Error).message;
    if (msg === "telemetry-disabled") {
      return (
        <Card>
          <Header title={`Skill activation`} cta="cue skill-report" />
          <div className="empty">
            Enable telemetry to see which skills actually fire.
            <br /><code>cue telemetry enable</code>
          </div>
        </Card>
      );
    }
    if (msg === "no-profile") return null;
    return <Card><div className="empty">{msg}</div></Card>;
  }
  if (!data) return null;

  const active = data.rows.filter((r) => !r.zombie).slice(0, 5);
  const zombies = data.rows.filter((r) => r.zombie);
  // Rough token estimate: 2400 bytes per skill at 4 chars/token.
  const estTokens = (zombies.length * 2400) / 4;

  return (
    <Card>
      <Header title={`Skill activation · ${data.windowDays}d`} cta={`cue skill-report --profile ${data.profile}`} />
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div>
          <div className="stat-num" style={{ color: "var(--green)" }}>{data.rows.length - zombies.length}</div>
          <div className="stat-label">Active</div>
        </div>
        <div>
          <div className="stat-num" style={{ color: "var(--red)" }}>{zombies.length}</div>
          <div className="stat-label">Zombie</div>
        </div>
        <div>
          <div className="stat-num">~{Math.round(estTokens).toLocaleString()}</div>
          <div className="stat-label">Tokens to reclaim</div>
        </div>
      </div>

      {active.length > 0 ? (
        <table className="table">
          <thead>
            <tr><th>Top active skills</th><th className="num">Hits</th><th className="num">Last</th></tr>
          </thead>
          <tbody>
            {active.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td className="num">{r.hits}</td>
                <td className="num dim">{fmtRelative(r.lastUsed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">No active skills in this window. Worth running a few sessions then re-checking.</div>
      )}

      {zombies.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12 }}>
          <span className="dim">Drop dead weight:</span>{" "}
          <code className="card-cta">cue prune --dead --profile {data.profile}</code>
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="card">{children}</section>; }
function Header({ title, cta }: { title: string; cta: string }) {
  return (
    <div className="card-header">
      <span className="card-title">{title}</span>
      <code className="card-cta">{cta}</code>
    </div>
  );
}
