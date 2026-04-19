import { useState, useRef, type ReactNode } from "react";
import { accept, generate, pollJob, type JobResp, type Variant } from "../api/client";
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
  const bbox = state.bbox;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // variant shelf state
  const [variants, setVariants] = useState<Variant[]>([]);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const canGenerate =
    !!selected &&
    selected.kind === "source" &&
    !!selected.projectId &&
    !!prompt.trim() &&
    !busy;

  const showShelf = variants.length > 0 && !busy;

  async function run() {
    if (!canGenerate || !selected || !selected.projectId) return;
    setBusy(true);
    setErr(null);
    setStatus("queued");
    setVariants([]);
    setPickedIdx(null);
    setPreviewIdx(null);
    try {
      const { job_id } = await generate({
        project_id: selected.projectId,
        start_ts: selected.sourceStart,
        end_ts: selected.sourceEnd,
        bbox: bbox ?? { x: 0, y: 0, w: 1, h: 1 },
        prompt: prompt.trim(),
        reference_frame_ts: (selected.sourceStart + selected.sourceEnd) / 2,
      });
      jobIdRef.current = job_id;
      const final: JobResp = await pollJob(job_id, (j) => setStatus(j.status));
      if (final.status !== "done" || !final.variants.length) {
        throw new Error(final.error || "generation failed");
      }
      // show variants — don't auto-accept
      setVariants(final.variants);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function acceptVariant(idx: number) {
    if (!selected || !selected.projectId || !jobIdRef.current) return;
    setPickedIdx(idx);
    try {
      try { await accept(jobIdRef.current, idx); } catch { /* url already usable */ }
      const v = variants[idx];
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
      setVariants([]);
      setPickedIdx(null);
      setPreviewIdx(null);
      jobIdRef.current = null;
    } catch (e) {
      setErr(String(e));
      setPickedIdx(null);
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
        rows={4}
        placeholder="e.g. make the jacket deep cherry red, warm cinematic grade"
        disabled={busy || showShelf}
      />

      {!showShelf && (
        <button
          className="cta pane__cta"
          onClick={run}
          disabled={!canGenerate}
        >
          {busy ? `Generating · ${status}` : "Generate"}
        </button>
      )}

      {/* ── variant shelf ── */}
      {showShelf && (
        <div className="variant-shelf">
          <FieldHead label="Variants" hint="pick one to apply" />
          <div className="variant-shelf__grid">
            {variants.map((v, i) => (
              <button
                key={i}
                className={`variant-card ${previewIdx === i ? 'variant-card--preview' : ''} ${pickedIdx === i ? 'variant-card--picked' : ''}`}
                onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
              >
                <div className="variant-card__label mono">
                  <span className="variant-card__letter">{String.fromCharCode(65 + i)}</span>
                  {v.visual_coherence != null && (
                    <span className="variant-card__score">{v.visual_coherence}/10</span>
                  )}
                </div>
                <video
                  className="variant-card__video"
                  src={v.url}
                  muted
                  loop
                  playsInline
                  autoPlay={previewIdx === i}
                  onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLVideoElement; el.pause(); el.currentTime = 0; }}
                />
                <div className="variant-card__desc mono">{v.description}</div>
              </button>
            ))}
          </div>

          {previewIdx != null && (
            <button
              className="cta pane__cta variant-shelf__accept"
              onClick={() => acceptVariant(previewIdx)}
              disabled={pickedIdx != null}
            >
              {pickedIdx != null ? 'Applying…' : `Apply variant ${String.fromCharCode(65 + previewIdx)}`}
            </button>
          )}

          <button
            className="variant-shelf__dismiss mono"
            onClick={() => { setVariants([]); setPickedIdx(null); setPreviewIdx(null); }}
          >
            dismiss · try a different prompt
          </button>
        </div>
      )}

      <div className="pane__meta">
        <Row k="target"    v={selected.label ?? "source"} />
        <Row k="range"     v={`${selected.sourceStart.toFixed(2)}s → ${selected.sourceEnd.toFixed(2)}s`} />
        <Row k="duration"  v={`${duration(selected).toFixed(2)}s`} />
        {bbox && (
          <div className="row">
            <span className="label row__k">region</span>
            <span className="mono row__v" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {describeBbox(bbox)}
              <button
                className="bbox-clear mono"
                onClick={() => dispatch({ type: "set_bbox", bbox: null })}
                title="clear region selection"
                style={{
                  background: "none",
                  border: "1px solid var(--c-border, #444)",
                  borderRadius: 3,
                  color: "var(--c-muted, #888)",
                  fontSize: 10,
                  padding: "1px 5px",
                  cursor: "pointer",
                  lineHeight: 1.4,
                }}
              >
                clear
              </button>
            </span>
          </div>
        )}
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

// ─── helpers ────────────────────────────────────────────────────────

function describeBbox(b: { x: number; y: number; w: number; h: number }): string {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const vertical = cy < 0.33 ? "top" : cy > 0.66 ? "bottom" : "center";
  const horizontal = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "center";
  const position =
    vertical === "center" && horizontal === "center"
      ? "center"
      : vertical === "center"
        ? horizontal
        : horizontal === "center"
          ? vertical
          : `${vertical}-${horizontal}`;
  const wPct = Math.round(b.w * 100);
  const hPct = Math.round(b.h * 100);
  return `${position} ${wPct}\u00D7${hPct}%`;
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
