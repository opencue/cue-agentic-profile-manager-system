import type { OptimizeAction } from "../../lib/fetcher";

interface Props {
  actions: Set<OptimizeAction>;
  budget: number;
  onToggle: (a: OptimizeAction) => void;
  onBudget: (n: number) => void;
}

const OPTS: { key: OptimizeAction; label: string; hint: string }[] = [
  { key: "prune", label: "Prune unused", hint: "Drop 0× skills (needs usage signal)" },
  { key: "dedupe", label: "Dedupe + conflicts", hint: "Collapse dupes, flag conflicts" },
  { key: "budget", label: "Budget cap", hint: "Keep top-N by usage" },
  { key: "router", label: "Surface router", hint: "Auto persona route-by-surface table" },
];

/** The four optimize toggles plus the budget number (shown when budget is on). */
export function OptimizePanel({ actions, budget, onToggle, onBudget }: Props) {
  return (
    <section className="card">
      <div className="card-header">
        <span className="card-title">Optimize</span>
      </div>
      <div className="opt-grid">
        {OPTS.map((o) => (
          <label key={o.key} className={`opt-toggle${actions.has(o.key) ? " on" : ""}`} title={o.hint}>
            <input type="checkbox" checked={actions.has(o.key)} onChange={() => onToggle(o.key)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {actions.has("budget") && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="dim" style={{ fontSize: 12 }}>Max skills</span>
          <input
            type="number"
            className="budget-input"
            min={1}
            value={budget}
            onChange={(e) => onBudget(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      )}
    </section>
  );
}
