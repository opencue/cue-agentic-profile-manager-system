/**
 * Shared "dashboard server not running" state. Rendered by both the dashboard
 * route and the Merge Studio so an unreachable server reads the same on every
 * tab instead of a raw "Couldn't load profiles" error.
 */
export function OfflineCTA({ message }: { message: string }) {
  return (
    <div className="offline-cta">
      <div className="offline-title">
        <span className="offline-dot" />
        Dashboard server not running
      </div>
      <p>
        The app is up but can't reach the cue dashboard server on{" "}
        <code>127.0.0.1:7891</code>.
      </p>
      <p className="dim" style={{ fontSize: 12 }}>
        Proxy returned: <code>{message}</code>
      </p>
      <p className="muted" style={{ marginTop: 18, marginBottom: 0 }}>
        Start it in another terminal:
      </p>
      <pre>cd &lt;cue-repo&gt; && bun src/index.ts dashboard --no-open</pre>
      <p className="dim" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
        Or build once and skip Vite: <code>cd web && npm run build</code>, then{" "}
        <code>bun src/index.ts dashboard</code> serves <code>web/dist/</code>.
      </p>
    </div>
  );
}
