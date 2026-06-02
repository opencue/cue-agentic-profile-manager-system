import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

import { fetcher, postJson } from "../lib/fetcher";
import type { ProfileRow, OptimizeAction, PreviewResponse, SaveResponse } from "../lib/fetcher";
import { SEED_BUCKETS } from "../data/seed-buckets";
import { OfflineCTA } from "../components/OfflineCTA";
import { SourcePicker } from "../components/merge/SourcePicker";
import { OptimizePanel } from "../components/merge/OptimizePanel";
import { MergePreview } from "../components/merge/MergePreview";
import { SaveBar } from "../components/merge/SaveBar";

export function MergeStudio() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetName, setTargetName] = useState("");
  const [mode, setMode] = useState<"static" | "alias">("static");
  const [actions, setActions] = useState<Set<OptimizeAction>>(new Set());
  const [budget, setBudget] = useState(60);

  const profilesQ = useQuery({
    queryKey: ["profiles-full"],
    queryFn: () => fetcher<ProfileRow[]>("/profiles/full"),
  });
  const profiles = useMemo(() => profilesQ.data ?? [], [profilesQ.data]);
  const existing = useMemo(() => new Set(profiles.map((p) => p.name)), [profiles]);

  // Names that conflict with the current selection (symmetric): used to grey
  // out rows the user shouldn't combine (e.g. medusa-vite vs medusa-next).
  const conflictNames = useMemo(() => {
    const out = new Set<string>();
    for (const p of profiles) {
      if (selected.has(p.name)) for (const c of p.conflicts) out.add(c);
      if (p.conflicts.some((c) => selected.has(c))) out.add(p.name);
    }
    for (const s of selected) out.delete(s); // never grey an already-picked row
    return out;
  }, [profiles, selected]);

  const names = useMemo(() => [...selected], [selected]);
  const actionList = useMemo(() => [...actions], [actions]);

  const previewQ = useQuery({
    queryKey: ["merge-preview", names.sort().join("+"), actionList.sort().join(","), budget, targetName],
    queryFn: () => postJson<PreviewResponse>("/merge/preview", {
      names, name: targetName || undefined, actions: actionList, budget,
    }),
    enabled: selected.size >= 2,
    placeholderData: (prev) => prev,
  });

  const saveM = useMutation({
    mutationFn: (force: boolean) => postJson<SaveResponse>("/merge/save", {
      names, name: targetName, mode, actions: actionList, budget, force,
    }),
  });

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    saveM.reset();
  }

  function loadBucket(idx: number) {
    const b = SEED_BUCKETS[idx]!;
    setSelected(new Set(b.members.filter((m) => existing.has(m))));
    setTargetName(b.name);
    setActions(new Set(["dedupe", "router"]));
    setMode("static");
    saveM.reset();
  }

  function toggleAction(a: OptimizeAction) {
    setActions((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  }

  if (profilesQ.isLoading) {
    return <div className="empty">Loading profiles…</div>;
  }
  if (profilesQ.isError) {
    const msg = (profilesQ.error as Error).message;
    // Unreachable server → same friendly CTA as the dashboard route, not a raw error.
    if (msg.startsWith("dashboard-server-unreachable")) {
      return <OfflineCTA message={msg} />;
    }
    return <div className="empty">Couldn't load profiles: {msg}</div>;
  }

  const yaml = previewQ.data ? previewQ.data.yaml[mode] : "";

  return (
    <div className="merge-studio">
      <div className="merge-buckets">
        <span className="card-title" style={{ marginRight: 8 }}>Seed the 8</span>
        {SEED_BUCKETS.map((b, i) => (
          <button key={b.name} className="bucket-chip" onClick={() => loadBucket(i)}
            title={b.blurb}>
            {b.icon} {b.name}
          </button>
        ))}
      </div>

      <div className="merge-layout">
        <div className="merge-col">
          <SourcePicker
            profiles={profiles}
            selected={selected}
            conflictNames={conflictNames}
            onToggle={toggle}
          />
        </div>

        <div className="merge-col">
          <OptimizePanel
            actions={actions}
            budget={budget}
            onToggle={toggleAction}
            onBudget={setBudget}
          />
          <MergePreview
            preview={previewQ.data?.preview ?? null}
            yaml={yaml}
            mode={mode}
            loading={previewQ.isFetching}
            empty={selected.size < 2}
          />
          <SaveBar
            targetName={targetName}
            mode={mode}
            disabled={selected.size < 2 || !previewQ.data}
            onName={setTargetName}
            onMode={setMode}
            onSave={(force) => saveM.mutate(force)}
            saving={saveM.isPending}
            result={saveM.data ?? null}
            error={saveM.isError ? (saveM.error as Error).message : null}
          />
        </div>
      </div>
    </div>
  );
}
