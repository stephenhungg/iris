import { useState, type ReactNode } from "react";
import { accept, generate, pollJob, type JobResp } from "../api/client";
import { duration, newClip, useEDL } from "../stores/edl";
import { Icon, type IconName } from "./Icon";
import "./inspector.css";

type Tab = "ai" | "basic" | "info";

export function Inspector() {
  const [tab, setTab] = useState<Tab>("ai");
  const { state } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;

  return (
    <div className="insp">
      <nav className="insp__tabs">
        <InspTab active={tab === "ai"} onClick={() => setTab("ai")} icon="sparkles" label="AI" />
        <InspTab active={tab === "basic"} onClick={() => setTab("basic")} icon="sliders" label="Basic" />
        <InspTab active={tab === "info"} onClick={() => setTab("info")} icon="info" label="Info" />
      </nav>

      <div className="insp__body">
        {tab === "ai" && <AiTab />}
        {tab === "basic" && <BasicTab />}
        {tab === "info" && <InfoTab />}
      </div>

      {selected && (
        <footer className="insp__foot mono">
          <span className={`chip chip--${selected.kind}`}>{selected.kind}</span>
          <span>{selected.label ?? "untitled"}</span>
          <span className="insp__foot-dur">{duration(selected).toFixed(2)}s</span>
        </footer>
      )}
    </div>
  );
}

function InspTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconName;
  label: string;
}) {
  return (
    <button className={`insp__tab ${active ? "insp__tab--on" : ""}`} onClick={onClick}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

// ─── AI tab ──────────────────────────────────────────────────────────

function AiTab() {
  const { state, dispatch } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canGenerate =
    !!selected &&
    selected.kind === "source" &&
    !!selected.projectId &&
    !!prompt.trim() &&
    !busy;

  async function run() {
    if (!canGenerate || !selected || !selected.projectId) return;
    setBusy(true);
    setErr(null);
    setStatus("queued");
    try {
      const { job_id } = await generate({
        project_id: selected.projectId,
        start_ts: selected.sourceStart,
        end_ts: selected.sourceEnd,
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        prompt: prompt.trim(),
        reference_frame_ts: (selected.sourceStart + selected.sourceEnd) / 2,
      });
      const final: JobResp = await pollJob(job_id, (j) => setStatus(j.status));
      if (final.status !== "done" || !final.variants[0]?.url) {
        throw new Error(final.error || "generation failed");
      }
      try {
        await accept(job_id, 0);
      } catch {
        /* variant url already usable */
      }
      const v = final.variants[0];
      const genDur = selected.sourceEnd - selected.sourceStart;
      const replacement = newClip({
        url: v.url,
        sourceStart: 0,
        sourceEnd: genDur,
        mediaDuration: genDur,
        kind: "generated",
        label: prompt.trim().slice(0, 28) || "ai edit",
        projectId: selected.projectId,
        generatedFromClipId: selected.id,
        volume: selected.volume,
      });
      dispatch({ type: "replace", id: selected.id, with: replacement });
      setPrompt("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  if (!selected) {
    return <Hint>Select a clip on the timeline to edit it with a prompt.</Hint>;
  }
  if (selected.kind !== "source") {
    return (
      <Hint>
        AI runs on source clips. Delete this generated clip and reprompt the original range.
      </Hint>
    );
  }

  return (
    <section className="pane">
      <FieldHead label="Prompt" hint="describe the change" />
      <textarea
        className="pane__prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="e.g. make the jacket deep cherry red, warm cinematic grade"
        disabled={busy}
      />

      <button
        className="cta pane__cta"
        onClick={run}
        disabled={!canGenerate}
      >
        {busy ? `Generating · ${status}` : "Generate"}
      </button>

      <div className="pane__meta">
        <Row k="target"    v={selected.label ?? "source"} />
        <Row k="range"     v={`${selected.sourceStart.toFixed(2)}s → ${selected.sourceEnd.toFixed(2)}s`} />
        <Row k="duration"  v={`${duration(selected).toFixed(2)}s`} />
      </div>

      {err && (
        <div className="pane__err mono">
          {err}
          <button onClick={() => setErr(null)} title="dismiss"><Icon name="close" size={11} /></button>
        </div>
      )}
    </section>
  );
}

// ─── Basic tab (volume etc.) ─────────────────────────────────────────

function BasicTab() {
  const { state, dispatch } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;
  if (!selected) return <Hint>Nothing selected.</Hint>;

  return (
    <section className="pane">
      <FieldHead label="Volume" hint="per-clip gain · 0–100" />
      <div className="slider-row">
        <Icon name={selected.volume === 0 ? "volume-mute" : "volume"} size={14} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={selected.volume}
          onChange={(e) =>
            dispatch({ type: "set_volume", id: selected.id, v: +e.target.value })
          }
        />
        <span className="mono slider-row__val">
          {Math.round(selected.volume * 100)}
        </span>
      </div>

      <FieldHead label="Shortcuts" hint="keyboard" />
      <dl className="keys">
        <dt className="mono">space</dt><dd>play / pause</dd>
        <dt className="mono">s</dt><dd>split at playhead</dd>
        <dt className="mono">⌫</dt><dd>delete selected</dd>
        <dt className="mono">drag edge</dt><dd>trim clip</dd>
        <dt className="mono">click clip</dt><dd>select</dd>
      </dl>
    </section>
  );
}

// ─── Info tab ────────────────────────────────────────────────────────

function InfoTab() {
  const { state } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;
  if (state.sources.length === 0) return <Hint>Import a clip to get started.</Hint>;
  return (
    <section className="pane">
      <FieldHead label="Library" />
      <div className="pane__meta">
        <Row k="sources"    v={String(state.sources.length)} />
        <Row k="clip count" v={String(state.clips.length)} />
      </div>

      {selected && (
        <>
          <FieldHead label="Selected clip" />
          <div className="pane__meta">
            <Row k="kind"   v={selected.kind} />
            <Row k="label"  v={selected.label ?? ""} />
            <Row k="in"     v={`${selected.sourceStart.toFixed(3)}s`} />
            <Row k="out"    v={`${selected.sourceEnd.toFixed(3)}s`} />
            <Row k="dur"    v={`${duration(selected).toFixed(3)}s`} />
            <Row k="source" v={`${selected.mediaDuration.toFixed(2)}s (max)`} />
          </div>
        </>
      )}
    </section>
  );
}

// ─── bits ────────────────────────────────────────────────────────────

function Hint({ children }: { children: ReactNode }) {
  return <p className="insp__hint">{children}</p>;
}

function FieldHead({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="fhead">
      <span className="label">{label}</span>
      {hint && <span className="fhead__hint">{hint}</span>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="label row__k">{k}</span>
      <span className="mono row__v" title={v}>{v}</span>
    </div>
  );
}
