import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";

interface GapsData {
  profile: string;
  windowDays: number;
  promptsScanned: number;
  rows: { id: string; name: string; matchedPrompts: number; recordedHits: number; gap: number; sampleTriggers: string[] }[];
}

export function TriggerGaps() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["trigger-gaps"],
    queryFn: () => fetcher<GapsData>("/trigger-gaps"),
  });

  if (isLoading) return <Card><div className="empty">Loading…</div></Card>;
  if (error) {
    const msg = (error as Error).message;
    if (msg === "telemetry-disabled") {
      return <Card><Header /><div className="empty">Enable telemetry to compare prompts against trigger phrases.</div></Card>;
    }
    if (msg === "no-profile") return null;
    return <Card><div className="empty">{msg}</div></Card>;
  }
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <Card>
        <Header />
        <div className="empty">
          {data.promptsScanned === 0
            ? "No prompts in transcripts yet."
            : "Healthy routing — every triggered phrase fired a skill."}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Header />
      <table className="table">
        <thead>
          <tr><th>Skill</th><th className="num">Matched</th><th className="num">Hits</th><th className="num">Gap</th></tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 8).map((r) => (
            <tr key={r.id}>
              <td>
                <div className="mono">{r.name}</div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {r.sampleTriggers.slice(0, 2).map((t) => `"${t}"`).join(", ")}
                </div>
              </td>
              <td className="num">{r.matchedPrompts}</td>
              <td className="num dim">{r.recordedHits}</td>
              <td className="num" style={{ color: "var(--red)" }}>{r.gap}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
        Scanned {data.promptsScanned.toLocaleString()} prompt{data.promptsScanned === 1 ? "" : "s"} over {data.windowDays}d.
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="card">{children}</section>; }
function Header() {
  return (
    <div className="card-header">
      <span className="card-title">Trigger gaps</span>
      <code className="card-cta">cue trigger-gaps</code>
    </div>
  );
}
