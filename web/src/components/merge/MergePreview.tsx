import type { MergePreview as Preview } from "../../lib/fetcher";

interface Props {
  preview: Preview | null;
  yaml: string;
  mode: "static" | "alias";
  loading: boolean;
  empty: boolean;
}

/** Read-out of the merged result: counts, conflicts, dropped, skills, YAML. */
export function MergePreview({ preview, yaml, mode, loading, empty }: Props) {
  if (empty) {
    return (
      <section className="card">
        <div className="card-header"><span className="card-title">Preview</span></div>
        <div className="empty">Pick <code>2+</code> source profiles to preview the merge.</div>
      </section>
    );
  }
  if (!preview) {
    return (
      <section className="card">
        <div className="card-header"><span className="card-title">Preview</span></div>
        <div className="empty">{loading ? "Merging…" : "No preview yet."}</div>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-header">
        <span className="card-title">Preview {loading && <span className="dim">· updating…</span>}</span>
        <span className="card-cta">~{Math.round(preview.estTokens / 1000)}k tok</span>
      </div>

      <div className="stat-grid" style={{ marginBottom: 14 }}>
        <div><div className="stat-num">{preview.skills.length}</div><div className="stat-label">skills</div></div>
        <div><div className="stat-num">{preview.mcps.length}</div><div className="stat-label">mcps</div></div>
        <div><div className="stat-num">{preview.plugins.length}</div><div className="stat-label">plugins</div></div>
        <div><div className="stat-num">{preview.dropped.length}</div><div className="stat-label">dropped</div></div>
      </div>

      {preview.appliedOptimizations.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          optimize: {preview.appliedOptimizations.join(", ")}
        </p>
      )}

      {preview.profileConflicts.length > 0 && (
        <div className="conflict-warn">
          ⚠ Mutually-exclusive sources: {preview.profileConflicts.map((c) => `${c.a} vs ${c.b}`).join(", ")} — pick one.
        </div>
      )}
      {preview.skillConflicts.length > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          {preview.skillConflicts.length} skill-directive conflict(s) flagged
        </p>
      )}

      <details style={{ marginTop: 8 }}>
        <summary className="dim" style={{ cursor: "pointer", fontSize: 12 }}>
          {preview.skills.length} skills
        </summary>
        <div className="skill-chips">
          {preview.skills.map((s) => <span key={s} className="skill-chip">{s}</span>)}
        </div>
      </details>

      <div className="dim" style={{ fontSize: 11, margin: "12px 0 4px", textTransform: "uppercase", letterSpacing: "0.6px" }}>
        profiles/{preview.name}/profile.yaml · {mode}
      </div>
      <pre className="yaml-block">{yaml}</pre>
    </section>
  );
}
