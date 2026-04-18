import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { EDLProvider, newMediaAsset, useEDL } from "../stores/edl";
import { Preview } from "../components/Preview";
import { Inspector } from "../components/Inspector";
import { Timeline } from "../components/Timeline";
import { Library } from "../components/Library";
import { UploadDrop } from "../components/UploadDrop";
import { upload } from "../api/client";
import { Icon } from "../components/Icon";
import "./studio.css";

export function Studio({ onExit }: { onExit: () => void }) {
  return (
    <EDLProvider>
      <StudioInner onExit={onExit} />
    </EDLProvider>
  );
}

function StudioInner({ onExit }: { onExit: () => void }) {
  const { state, dispatch } = useEDL();
  const [uploading, setUploading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <main className="studio" ref={rootRef}>
      <TopBar onExit={onExit} projectLabel={projectLabel} />

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
            <Preview />
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
  projectLabel,
}: {
  onExit: () => void;
  projectLabel?: string;
}) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <button className="topbar__brand" onClick={onExit} title="back to landing">
          <span className="topbar__mark" aria-hidden />
          <span className="topbar__word">iris</span>
        </button>
        <span className="topbar__divider" />
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
