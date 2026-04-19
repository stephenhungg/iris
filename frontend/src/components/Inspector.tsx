import { useEffect, useState, type ReactNode } from "react";
import { clipAtTime, duration, sourceTimeFor, useEDL, type Clip } from "../stores/edl";
import { Icon, type IconName } from "./Icon";
import { AgentChat } from "./AgentChat";
import { ContinuityPanel } from "../features/continuity/ContinuityPanel";
import type { ContinuityDashboardController } from "../features/continuity/useContinuityDashboard";
import { GenerationReveal } from "../features/reveal/GenerationReveal";
import { useGenerationSession } from "../hooks/useGenerationSession";
import "./inspector.css";

type Tab = "ai" | "continuity" | "basic" | "info" | "agent";

export function Inspector({
  mode = "pro",
  continuity,
  projectId,
  showAiTab = mode === "pro",
}: {
  mode?: "vibe" | "pro";
  continuity: ContinuityDashboardController;
  projectId: string | null;
  showAiTab?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("ai");
  const { state } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;

  useEffect(() => {
    if (!showAiTab && tab === "ai") {
      setTab("continuity");
    }
  }, [showAiTab, tab]);

  return (
    <div className="insp">
      <nav className="insp__tabs">
        {showAiTab && (
          <InspTab active={tab === "ai"} onClick={() => setTab("ai")} icon="sparkles" label="AI" />
        )}
        <InspTab active={tab === "continuity"} onClick={() => setTab("continuity")} icon="select" label="Flow" />
        <InspTab active={tab === "basic"} onClick={() => setTab("basic")} icon="sliders" label="Basic" />
        <InspTab active={tab === "info"} onClick={() => setTab("info")} icon="info" label="Info" />
        <InspTab active={tab === "agent"} onClick={() => setTab("agent")} icon="keyboard" label="Agent" />
      </nav>

      <div className="insp__body">
        {showAiTab && tab === "ai" && <AiTab continuity={continuity} />}
        {tab === "continuity" && <ContinuityTab continuity={continuity} />}
        {tab === "basic" && <BasicTab />}
        {tab === "info" && <InfoTab continuity={continuity} />}
        {tab === "agent" && <AgentChat projectId={projectId} />}
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

function AiTab({
  continuity,
}: {
  continuity: ContinuityDashboardController;
}) {
  const { state, dispatch } = useEDL();
  const [lockedContext, setLockedContext] = useState<{
    clip: Clip;
    previewFrameTs: number | null;
  } | null>(null);
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;
  const bbox = state.bbox;

  // Entity identification + SAM mask fetch lives in Preview — this tab just
  // reflects whatever's currently in the EDL.
  const entity = state.identified;
  const identifying = state.identifying;
  const activeHit = clipAtTime(state.clips, state.playhead);
  const previewFrameTs =
    activeHit && selected && activeHit.clip.id === selected.id
      ? sourceTimeFor(activeHit.clip, activeHit.offsetInClip)
      : selected
        ? (selected.sourceStart + selected.sourceEnd) / 2
        : null;
  const activeClip = lockedContext?.clip ?? selected;
  const activePreviewFrameTs = lockedContext?.previewFrameTs ?? previewFrameTs;

  const {
    prompt,
    setPrompt,
    busy,
    status,
    variants,
    err,
    setErr,
    acceptingIdx,
    canGenerate,
    logs,
    run,
    acceptVariant,
    clearSession,
  } = useGenerationSession({
    clip: activeClip,
    bbox,
    previewFrameTs: activePreviewFrameTs,
    onAccepted: async ({ acceptResponse, prompt, sourceVariantUrl }) => {
      await continuity.beginAcceptedEdit({
        prompt,
        sourceVariantUrl,
        segmentId: acceptResponse.segment_id,
        entityJobId: acceptResponse.entity_job_id,
      });
    },
  });
  const activeSession = busy || variants.length > 0 || acceptingIdx != null;

  useEffect(() => {
    if (!activeSession) {
      setLockedContext(null);
    }
  }, [activeSession]);

  async function runReveal() {
    if (!selected || selected.kind !== "source" || !selected.projectId) return false;
    setLockedContext({ clip: selected, previewFrameTs });
    await run();
    return true;
  }

  async function acceptReveal(idx: number) {
    return acceptVariant(idx);
  }

  function clearReveal() {
    setLockedContext(null);
    clearSession();
  }

  if (!activeClip) {
    return <Hint>Select a clip on the timeline to edit it with a prompt.</Hint>;
  }
  if (activeClip.kind !== "source") {
    return (
      <Hint>
        AI runs on source clips. Delete this generated clip and reprompt the original range.
      </Hint>
    );
  }

  return (
    <section className="pane">
      <div className="reveal-host reveal-host--panel">
        <GenerationReveal
          clip={activeClip}
          bbox={bbox}
          entity={entity}
          identifying={identifying}
          layout="panel"
          session={{
            prompt,
            setPrompt,
            busy,
            status,
            variants,
            err,
            setErr,
            acceptingIdx,
            canGenerate,
            logs,
            run: runReveal,
            acceptVariant: acceptReveal,
            clearSession: clearReveal,
          }}
          onClearRegion={() => dispatch({ type: "set_bbox", bbox: null })}
        />
      </div>

      <ContinuityPanel continuity={continuity} />
    </section>
  );
}

function ContinuityTab({
  continuity,
}: {
  continuity: ContinuityDashboardController;
}) {
  return (
    <section className="pane">
      <ContinuityPanel continuity={continuity} />
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

function InfoTab({
  continuity,
}: {
  continuity: ContinuityDashboardController;
}) {
  const { state } = useEDL();
  const selected = state.clips.find((c) => c.id === state.selectedId) ?? null;
  if (state.sources.length === 0) return <Hint>Import a clip to get started.</Hint>;
  return (
    <section className="pane">
      <FieldHead label="Library" />
      <div className="pane__meta">
        <Row k="sources"    v={String(state.sources.length)} />
        <Row k="clip count" v={String(state.clips.length)} />
        <Row k="entities"   v={String(continuity.projectEntityCount)} />
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
