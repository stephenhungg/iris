import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  EDLProvider,
  newMediaAsset,
  useEDL,
  type Clip,
  type MediaAsset,
} from "../stores/edl";
import { Preview } from "../components/Preview";
import { Inspector } from "../components/Inspector";
import { Timeline } from "../components/Timeline";
import { Library } from "../components/Library";
import { UploadDrop } from "../components/UploadDrop";
import { VibePrompt } from "../components/VibePrompt";
import { exportVideo, getTimeline, pollExport, upload, type TimelineSegment } from "../api/client";
import { Icon } from "../components/Icon";
import { ContinuityStatusBadge } from "../features/continuity/ContinuityStatusBadge";
import {
  useContinuityDashboard,
  type ContinuityDashboardController,
} from "../features/continuity/useContinuityDashboard";
import { EditorChecklist } from "../features/onboarding/EditorChecklist";
import "../styles/global.css";
import "./studio.css";

export type StudioInitialProject = {
  projectId: string;
  videoUrl: string;
  duration: number;
  fps: number;
  label?: string;
};

function buildSourceAsset(
  project: StudioInitialProject,
  sourceUrl = project.videoUrl,
): MediaAsset {
  return newMediaAsset({
    url: sourceUrl,
    duration: project.duration,
    fps: project.fps,
    projectId: project.projectId,
    label: project.label || project.projectId.slice(0, 8),
    kind: "source",
  });
}

function buildTimelineClip(
  segment: TimelineSegment,
  project: StudioInitialProject,
  sourceAsset: MediaAsset,
): Clip {
  const span = Math.max(0.01, segment.end_ts - segment.start_ts);
  if (segment.source === "generated") {
    return {
      id: crypto.randomUUID(),
      kind: "generated",
      url: segment.url,
      sourceStart: 0,
      sourceEnd: span,
      mediaDuration: span,
      volume: segment.audio ? 1 : 0,
      projectId: project.projectId,
      label: "ai edit",
    };
  }
  return {
    id: crypto.randomUUID(),
    kind: "source",
    url: segment.url,
    sourceStart: segment.start_ts,
    sourceEnd: segment.end_ts,
    mediaDuration: project.duration,
    volume: segment.audio ? 1 : 0,
    projectId: project.projectId,
    sourceAssetId: sourceAsset.id,
    label: sourceAsset.label,
  };
}

function buildGeneratedAssets(project: StudioInitialProject, segments: TimelineSegment[]) {
  const assets: MediaAsset[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (segment.source !== "generated" || seen.has(segment.url)) continue;
    seen.add(segment.url);
    const span = Math.max(0.01, segment.end_ts - segment.start_ts);
    assets.push(newMediaAsset({
      url: segment.url,
      duration: span,
      fps: project.fps,
      projectId: project.projectId,
      label: `ai edit ${assets.length + 1}`,
      kind: "generated",
    }));
  }
  return assets;
}

export function Studio({
  onExit,
  onLibrary,
  initialProject,
}: {
  onExit: () => void;
  onLibrary?: () => void;
  initialProject?: StudioInitialProject;
}) {
  return (
    <EDLProvider>
      <StudioInner
        onExit={onExit}
        onLibrary={onLibrary}
        initialProject={initialProject}
      />
    </EDLProvider>
  );
}

function StudioInner({
  onExit,
  onLibrary,
  initialProject,
}: {
  onExit: () => void;
  onLibrary?: () => void;
  initialProject?: StudioInitialProject;
}) {
  const { state, dispatch } = useEDL();
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<'vibe' | 'pro'>('vibe');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [hydratingProject, setHydratingProject] = useState(Boolean(initialProject));
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // lock body scroll when studio is mounted
  useEffect(() => {
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
      document.documentElement.style.overflow = '';
    };
  }, []);

  // hydrate an existing project once, if one was passed in. we fetch the
  // saved segment rows from the backend and rebuild the EDL so resuming
  // gives you back your splits and accepted AI variants exactly as you
  // left them. falls back to a single full-length clip if the timeline
  // fetch fails (e.g. offline, brand-new project with no segments yet).
  const hydratedProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialProject) return;
    if (hydratedProjectIdRef.current === initialProject.projectId) return;
    hydratedProjectIdRef.current = initialProject.projectId;
    setHydratingProject(true);

    let cancelled = false;
    (async () => {
      try {
        const tl = await getTimeline(initialProject.projectId);
        if (cancelled) return;
        const sourceUrl =
          tl.segments.find((seg) => seg.source === "original")?.url
          ?? initialProject.videoUrl;
        const sourceAsset = buildSourceAsset(initialProject, sourceUrl);
        const clips: Clip[] = tl.segments.length > 0
          ? tl.segments.map((seg) => buildTimelineClip(seg, initialProject, sourceAsset))
          : [{
              id: crypto.randomUUID(),
              kind: "source",
              url: sourceAsset.url,
              sourceStart: 0,
              sourceEnd: sourceAsset.duration,
              mediaDuration: sourceAsset.duration,
              volume: 1,
              projectId: sourceAsset.projectId,
              sourceAssetId: sourceAsset.id,
              label: sourceAsset.label,
            }];
        dispatch({
          type: "hydrate",
          sources: [sourceAsset, ...buildGeneratedAssets(initialProject, tl.segments)],
          clips,
        });
      } catch {
        if (cancelled) return;
        const sourceAsset = buildSourceAsset(initialProject);
        // no timeline (new project, network hiccup) — fall back to one
        // full-length clip pointing at the source video.
        const fallback: Clip = {
          id: crypto.randomUUID(),
          kind: "source",
          url: sourceAsset.url,
          sourceStart: 0,
          sourceEnd: sourceAsset.duration,
          mediaDuration: sourceAsset.duration,
          volume: 1,
          projectId: sourceAsset.projectId,
          sourceAssetId: sourceAsset.id,
          label: sourceAsset.label,
        };
        dispatch({ type: "hydrate", sources: [sourceAsset], clips: [fallback] });
      } finally {
        if (!cancelled) setHydratingProject(false);
      }
    })();

    return () => { cancelled = true; };
  }, [initialProject, dispatch]);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const res = await upload(file);
      // Drop imported media into the library pool. The user chooses when
      // it lands on the timeline via the plus button in the Library.
      dispatch({
        type: "add_source",
        asset: newMediaAsset({
          url: res.video_url,
          duration: res.duration,
          fps: res.fps,
          projectId: res.project_id,
          label: file.name.replace(/\.[^.]+$/, ""),
          kind: "source",
        }),
      });
    } catch (e) {
      alert(`upload failed: ${e}`);
    } finally {
      setUploading(false);
    }
  }

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          dispatch({ type: 'set_playing', playing: !state.playing });
          break;
        case 's':
        case 'b':
          if (!e.metaKey && !e.ctrlKey) {
            dispatch({ type: 'split_at_playhead' });
          }
          break;
        case 'Backspace':
        case 'Delete':
          if (state.selectedId) dispatch({ type: 'remove', id: state.selectedId });
          break;
        case 'z':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) {
              dispatch({ type: 'redo' });
            } else {
              dispatch({ type: 'undo' });
            }
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.playing, state.selectedId, dispatch]);

  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  const handleExport = useCallback(async () => {
    const projectId =
      initialProject?.projectId
      ?? state.sources.find((asset) => asset.kind === "source")?.projectId
      ?? state.sources[0]?.projectId;
    if (!projectId || state.clips.length === 0) return;
    const popup = window.open("", "_blank");
    if (popup) popup.opener = null;
    setExporting(true);
    setExportStatus("queued");
    try {
      const { export_job_id } = await exportVideo(projectId);
      const res = await pollExport(export_job_id, (job) => {
        setExportStatus(job.status);
      });
      if (res.status !== "done" || !res.export_url) {
        throw new Error(res.error || "export finished without a download url");
      }
      if (popup) {
        popup.location.replace(res.export_url);
      } else {
        window.open(res.export_url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      if (popup) popup.close();
      alert(`Export failed: ${err}`);
    } finally {
      setExporting(false);
      setExportStatus("");
    }
  }, [initialProject?.projectId, state.sources, state.clips.length]);

  const hasSources = state.sources.length > 0;
  const continuityProjectId =
    initialProject?.projectId
    ?? state.sources.find((asset) => asset.kind === "source")?.projectId
    ?? state.sources[0]?.projectId
    ?? null;
  const continuity = useContinuityDashboard(continuityProjectId);
  const projectLabel =
    initialProject?.label
    ?? initialProject?.projectId.slice(0, 8)
    ?? state.sources[0]?.projectId.slice(0, 8);
  const hasAcceptedEdit = state.clips.some((clip) => clip.kind === "generated");
  const continuityComplete =
    continuity.propagationCounts.total > 0 &&
    continuity.propagationCounts.applied === continuity.propagationCounts.total;
  const exportLabel =
    exporting
      ? exportStatus === "processing"
        ? "Rendering…"
        : "Queueing…"
      : "Export";

  return (
    <main className={`studio ${mode === 'vibe' ? 'studio--vibe' : ''}`} ref={rootRef}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
      <TopBar
        onExit={onExit}
        onLibrary={onLibrary}
        projectLabel={projectLabel}
        mode={mode}
        onToggleMode={() => setMode(m => m === 'vibe' ? 'pro' : 'vibe')}
        onImport={() => fileInputRef.current?.click()}
        onShowShortcuts={() => setShowShortcuts(true)}
        onExport={handleExport}
        exporting={exporting}
        exportLabel={exportLabel}
        canExport={state.clips.length > 0}
        continuity={continuity}
      />

      {showShortcuts && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowShortcuts(false)}
        >
          <div
            style={{
              background: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: '28px 36px',
              minWidth: 320,
              maxWidth: 420,
              color: 'rgba(255,255,255,0.85)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 13,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 18px', fontSize: 15, letterSpacing: '0.06em', color: '#fff' }}>
              Keyboard Shortcuts
            </h3>
            {([
              ['Space', 'Play / Pause'],
              ['S', 'Split at playhead'],
              ['Delete / Backspace', 'Remove selected clip'],
              ['\u2318 Z', 'Undo'],
              ['\u2318 Shift Z', 'Redo'],
            ] as const).map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>{desc}</span>
                <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>{key}</kbd>
              </div>
            ))}
            <p style={{ marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
              Press Escape or click outside to close
            </p>
          </div>
        </div>
      )}

      <section className="studio__body">
        <aside className="studio__left">
          <Library onUpload={handleFile} uploading={uploading} />
        </aside>

        <Splitter
          orientation="vertical"
          cssVar="--left-w"
          rootRef={rootRef}
          min={180}
          max={480}
          anchor="left"
        />

        <section className="studio__center">
          {hasSources ? (
            <>
              <Preview />
              {mode === 'vibe' && <VibePrompt />}
            </>
          ) : hydratingProject ? (
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                height: '100%',
                color: 'rgba(255,255,255,0.55)',
                fontFamily: 'var(--font-mono, monospace)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontSize: 11,
              }}
            >
              reopening reel…
            </div>
          ) : (
            <UploadDrop onFile={handleFile} busy={uploading} />
          )}
        </section>

        <Splitter
          orientation="vertical"
          cssVar="--right-w"
          rootRef={rootRef}
          min={220}
          max={520}
          anchor="right"
        />

        <aside className="studio__right">
          <div style={{ padding: "12px 12px 0" }}>
            <EditorChecklist
              projectId={continuityProjectId}
              hasSources={hasSources}
              hasSelection={Boolean(state.selectedId)}
              hasBbox={Boolean(state.bbox)}
              hasAcceptedEdit={hasAcceptedEdit}
              hasContinuityPack={continuity.hasPropagatableAppearances}
              continuityComplete={continuityComplete}
              onImport={() => fileInputRef.current?.click()}
            />
          </div>
          <Inspector mode={mode} continuity={continuity} />
        </aside>
      </section>

      <Splitter
        orientation="horizontal"
        cssVar="--tl-h"
        rootRef={rootRef}
        min={140}
        max={520}
        anchor="bottom"
      />

      <section className="studio__bottom">
        <Timeline />
      </section>
    </main>
  );
}

// ─── splitter ─────────────────────────────────────────────────────────
//
// a thin draggable divider that writes a CSS variable on the studio root.
// `anchor` tells us which direction grows when the cursor moves toward the
// origin:
//   - "left"   → dragging right makes the left panel bigger
//   - "right"  → dragging left  makes the right panel bigger
//   - "bottom" → dragging up    makes the bottom panel (timeline) bigger

function Splitter({
  orientation,
  cssVar,
  rootRef,
  min,
  max,
  anchor,
}: {
  orientation: "vertical" | "horizontal";
  cssVar: string;
  rootRef: RefObject<HTMLDivElement | null>;
  min: number;
  max: number;
  anchor: "left" | "right" | "bottom";
}) {
  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const cs = getComputedStyle(root);
      const startValue = parseFloat(cs.getPropertyValue(cssVar)) || 0;
      const startPos = orientation === "vertical" ? e.clientX : e.clientY;

      document.body.style.userSelect = "none";
      document.body.style.cursor =
        orientation === "vertical" ? "col-resize" : "row-resize";

      const onMove = (ev: PointerEvent) => {
        const pos = orientation === "vertical" ? ev.clientX : ev.clientY;
        let delta = pos - startPos;
        // flip delta when the panel grows in the opposite direction of the drag
        if (anchor === "right" || anchor === "bottom") delta = -delta;
        const next = Math.max(min, Math.min(max, startValue + delta));
        root.style.setProperty(cssVar, `${next}px`);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [orientation, cssVar, rootRef, min, max, anchor],
  );

  return (
    <div
      className={`splitter splitter--${orientation}`}
      onPointerDown={onDown}
      role="separator"
      aria-orientation={orientation}
    />
  );
}

// ─── top bar ──────────────────────────────────────────────────────────

function TopBar({
  onExit,
  onLibrary,
  projectLabel,
  mode,
  onToggleMode,
  onImport,
  onShowShortcuts,
  onExport,
  exporting,
  exportLabel,
  canExport,
  continuity,
}: {
  onExit: () => void;
  onLibrary?: () => void;
  projectLabel?: string;
  mode: 'vibe' | 'pro';
  onToggleMode: () => void;
  onImport?: () => void;
  onShowShortcuts?: () => void;
  onExport?: () => void;
  exporting?: boolean;
  exportLabel?: string;
  canExport?: boolean;
  continuity: ContinuityDashboardController;
}) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <button className="topbar__brand" onClick={onExit} title="back to landing">
          <span className="topbar__mark" aria-hidden />
          <span className="topbar__word">iris</span>
        </button>
        <span className="topbar__divider" />
        {onLibrary && (
          <>
            <button
              className="topbar__menu"
              onClick={onLibrary}
              title="back to my reels"
              style={{ letterSpacing: '0.08em' }}
            >
              ← my reels
            </button>
            <span className="topbar__divider" />
          </>
        )}
        <TopMenuItem label="File" onClick={onImport} title="import clip" />
        <TopMenuItem label="Edit" />
        <TopMenuItem label="View" onClick={onToggleMode} title={`switch to ${mode === 'vibe' ? 'pro' : 'vibe'} mode`} />
        <TopMenuItem label="Help" onClick={onShowShortcuts} title="keyboard shortcuts" />
      </div>

      <div className="topbar__center">
        <span className="mono topbar__proj">
          {projectLabel ? `reel · ${projectLabel}` : "untitled reel"}
        </span>
      </div>

      <div className="topbar__right">
        <ContinuityStatusBadge continuity={continuity} />
        <button
          onClick={onToggleMode}
          style={{
            padding: '4px 12px',
            borderRadius: '9999px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: mode === 'vibe' ? 'rgba(255,255,255,0.1)' : 'transparent',
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '10px',
            letterSpacing: '0.1em',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {mode}
        </button>
        <button className="topbar__ghost" title="keyboard shortcuts" onClick={onShowShortcuts}>
          <Icon name="keyboard" size={14} />
          <span>Shortcuts</span>
        </button>
        <button
          className="cta topbar__export"
          disabled={!canExport || exporting}
          onClick={onExport}
        >
          {exportLabel || (exporting ? "Exporting…" : "Export")}
        </button>
      </div>
    </header>
  );
}

function TopMenuItem({ label, onClick, title }: { label: string; onClick?: () => void; title?: string }) {
  return <button className="topbar__menu" onClick={onClick} title={title}>{label}</button>;
}
