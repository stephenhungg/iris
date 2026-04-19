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
import { getTimeline, upload } from "../api/client";
import { Icon } from "../components/Icon";
import "../styles/global.css";
import "./studio.css";

export type StudioInitialProject = {
  projectId: string;
  videoUrl: string;
  duration: number;
  fps: number;
  label?: string;
};

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
  const rootRef = useRef<HTMLDivElement>(null);

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
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!initialProject) return;
    hydratedRef.current = true;

    const sourceAsset: MediaAsset = newMediaAsset({
      url: initialProject.videoUrl,
      duration: initialProject.duration,
      fps: initialProject.fps,
      projectId: initialProject.projectId,
      label: initialProject.label || initialProject.projectId.slice(0, 8),
      kind: "source",
    });

    let cancelled = false;
    (async () => {
      try {
        const tl = await getTimeline(initialProject.projectId);
        if (cancelled) return;
        // segments are timestamps into either the original video (source=
        // "original", sub-range is start_ts..end_ts inside the full file)
        // or a standalone generated clip (source="generated", the variant
        // file holds exactly that span, so its sub-range is 0..span).
        const clips: Clip[] = tl.segments.map((seg) => {
          const span = Math.max(0.01, seg.end_ts - seg.start_ts);
          if (seg.source === "generated") {
            return {
              id: crypto.randomUUID(),
              kind: "generated" as const,
              url: seg.url,
              sourceStart: 0,
              sourceEnd: span,
              mediaDuration: span,
              volume: seg.audio ? 1 : 0,
              projectId: initialProject.projectId,
            };
          }
          return {
            id: crypto.randomUUID(),
            kind: "source" as const,
            url: seg.url,
            sourceStart: seg.start_ts,
            sourceEnd: seg.end_ts,
            mediaDuration: initialProject.duration,
            volume: seg.audio ? 1 : 0,
            projectId: initialProject.projectId,
            sourceAssetId: sourceAsset.id,
            label: sourceAsset.label,
          };
        });
        dispatch({ type: "hydrate", sources: [sourceAsset], clips });
      } catch {
        if (cancelled) return;
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        dispatch({ type: "set_playing", playing: !state.playing });
      } else if (e.key === "s" || (e.key === "b" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        dispatch({ type: "split_at_playhead" });
      } else if ((e.key === "Backspace" || e.key === "Delete") && state.selectedId) {
        e.preventDefault();
        dispatch({ type: "remove", id: state.selectedId });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.playing, state.selectedId, dispatch]);

  const hasSources = state.sources.length > 0;
  const projectLabel = state.sources[0]?.projectId.slice(0, 8);

  return (
    <main className={`studio ${mode === 'vibe' ? 'studio--vibe' : ''}`} ref={rootRef}>
      <TopBar onExit={onExit} onLibrary={onLibrary} projectLabel={projectLabel} mode={mode} onToggleMode={() => setMode(m => m === 'vibe' ? 'pro' : 'vibe')} />

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
          <Inspector />
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
}: {
  onExit: () => void;
  onLibrary?: () => void;
  projectLabel?: string;
  mode: 'vibe' | 'pro';
  onToggleMode: () => void;
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
        <TopMenuItem label="File" />
        <TopMenuItem label="Edit" />
        <TopMenuItem label="View" />
        <TopMenuItem label="Help" />
      </div>

      <div className="topbar__center">
        <span className="mono topbar__proj">
          {projectLabel ? `reel · ${projectLabel}` : "untitled reel"}
        </span>
      </div>

      <div className="topbar__right">
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
        <button className="topbar__ghost" title="keyboard shortcuts">
          <Icon name="keyboard" size={14} />
          <span>Shortcuts</span>
        </button>
        <button className="cta topbar__export" disabled>
          Export
        </button>
      </div>
    </header>
  );
}

function TopMenuItem({ label }: { label: string }) {
  return <button className="topbar__menu">{label}</button>;
}
