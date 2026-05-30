import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";

interface PairsData {
  profile: string;
  partners: { name: string; count: number; affinity: number }[];
}

export function PairSuggestions() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pairs"],
    queryFn: () => fetcher<PairsData[]>("/pairs"),
  });

  if (isLoading) return <Card><div className="empty">Loading…</div></Card>;
  if (error) {
    const msg = (error as Error).message;
    if (msg === "telemetry-disabled") {
      return (
        <Card>
          <Header />
          <div className="empty">Enable telemetry to learn from your composite picks.<br /><code>cue telemetry enable</code></div>
        </Card>
      );
    }
    return <Card><div className="empty">{msg}</div></Card>;
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <Header />
        <div className="empty">
          No pair signal yet. Composites like <code>a+b+c</code> from the picker populate this.
        </div>
      </Card>
    );
  }

  // Flatten and rank the strongest partnerships globally.
  const rows = data
    .flatMap((d) => d.partners.map((p) => ({ profile: d.profile, partner: p.name, affinity: p.affinity, count: p.count })))
    .sort((a, b) => b.affinity - a.affinity || b.count - a.count)
    .slice(0, 8);

  return (
    <Card>
      <Header />
      <table className="table">
        <thead>
          <tr><th>Pair</th><th className="num">Affinity</th><th className="num">×</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="mono">{r.profile} <span className="dim">+</span> {r.partner}</td>
              <td className="num">{Math.round(r.affinity * 100)}%</td>
              <td className="num dim">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) { return <section className="card">{children}</section>; }
function Header() {
  return (
    <div className="card-header">
      <span className="card-title">Pair suggestions</span>
      <code className="card-cta">cue suggest-pairs</code>
    </div>
  );
}
