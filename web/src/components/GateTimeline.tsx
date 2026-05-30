import { useQuery } from "@tanstack/react-query";
import { fetcher } from "../lib/fetcher";
import { fmtRelative } from "../lib/format";

interface GateRow {
  ts: string;
  profile: string;
  overall: "pass" | "fail" | "skip";
  results: { name: string; ok: boolean; exit: number; stderr: string }[];
}

export function GateTimeline() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["gates-all"],
    queryFn: () => fetcher<GateRow[]>("/gates?all=1"),
  });

  if (isLoading) return <Card><div className="empty">Loading…</div></Card>;
  if (error) return <Card><div className="empty">{(error as Error).message}</div></Card>;
  if (!data || data.length === 0) {
    return (
      <Card>
        <Header />
        <div className="empty">
          No gate runs recorded yet. Profiles that declare <code>qualityGates:</code> populate this on session end.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <Header />
      <table className="table">
        <thead>
          <tr><th></th><th>Profile</th><th className="num">Result</th><th className="num">When</th><th>Failed</th></tr>
        </thead>
        <tbody>
          {data.slice(0, 12).map((r, i) => (
            <tr key={i}>
              <td><span className={`dot ${r.overall === "pass" ? "green" : r.overall === "fail" ? "red" : "yellow"}`} /></td>
              <td className="mono">{r.profile}</td>
              <td className="num">
                {r.overall === "pass" ? `${r.results.length} ok` : r.overall === "fail"
                  ? `${r.results.filter((x) => !x.ok).length}/${r.results.length} fail`
                  : "skipped"}
              </td>
              <td className="num dim">{fmtRelative(r.ts)}</td>
              <td className="dim">
                {r.results.filter((x) => !x.ok).map((x) => x.name).slice(0, 2).join(", ") || "—"}
              </td>
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
      <span className="card-title">Quality gate runs</span>
      <code className="card-cta">cue gates status --all</code>
    </div>
  );
}
