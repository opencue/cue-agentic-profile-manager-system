import { useState } from "react";
import type { SaveResponse } from "../../lib/fetcher";

interface Props {
  targetName: string;
  mode: "static" | "alias";
  disabled: boolean;
  onName: (s: string) => void;
  onMode: (m: "static" | "alias") => void;
  onSave: (force: boolean) => void;
  saving: boolean;
  result: SaveResponse | null;
  error: string | null;
}

const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** Name + static/alias toggle + Save. Surfaces the written path and a diff. */
export function SaveBar({ targetName, mode, disabled, onName, onMode, onSave, saving, result, error }: Props) {
  const [showDiff, setShowDiff] = useState(false);
  const nameOk = NAME_RE.test(targetName);
  const exists = error?.includes("already exists");

  return (
    <section className="card">
      <div className="card-header"><span className="card-title">Save</span></div>

      <div className="save-row">
        <input
          className="name-input"
          placeholder="profile name (kebab-case)"
          value={targetName}
          onChange={(e) => onName(e.target.value.trim())}
        />
        <div className="mode-toggle">
          <label className={mode === "static" ? "on" : ""}>
            <input type="radio" name="mode" checked={mode === "static"} onChange={() => onMode("static")} />
            static
          </label>
          <label className={mode === "alias" ? "on" : ""}>
            <input type="radio" name="mode" checked={mode === "alias"} onChange={() => onMode("alias")} />
            live alias
          </label>
        </div>
      </div>
      <p className="dim" style={{ fontSize: 11, margin: "6px 0 12px" }}>
        {mode === "static"
          ? "Flattened snapshot — hand-tunable, drifts from sources until re-merged."
          : "Thin inherits:[…] — auto-syncs when sources change, not hand-tunable."}
      </p>

      <div className="save-row">
        <button
          className="btn-primary"
          disabled={disabled || !nameOk || saving}
          onClick={() => onSave(false)}
        >
          {saving ? "Saving…" : `Save ${mode} profile`}
        </button>
        {exists && (
          <button className="btn-warn" disabled={saving} onClick={() => onSave(true)}>
            Overwrite
          </button>
        )}
      </div>
      {targetName && !nameOk && (
        <p className="conflict-warn" style={{ marginTop: 10 }}>Name must be lowercase kebab-case.</p>
      )}

      {error && !exists && <p className="conflict-warn" style={{ marginTop: 10 }}>{error}</p>}
      {exists && <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>Profile exists — Overwrite to replace it.</p>}

      {result && (
        <div className="save-ok">
          ✓ wrote <code>{result.path}</code> {result.created ? "(new)" : "(overwritten)"}
          {result.previousYaml && (
            <button className="card-cta" style={{ marginLeft: 10 }} onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? "hide diff" : "show diff"}
            </button>
          )}
          {showDiff && result.previousYaml && (
            <div className="diff-grid">
              <div><div className="dim" style={{ fontSize: 11 }}>before</div><pre className="yaml-block">{result.previousYaml}</pre></div>
              <div><div className="dim" style={{ fontSize: 11 }}>after</div><pre className="yaml-block">{result.yaml}</pre></div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
