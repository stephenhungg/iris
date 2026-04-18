import { useEffect, useState } from "react";
import { EDLProvider, useEDL, newClip } from "../stores/edl";
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

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const res = await upload(file);
      const clip = newClip({
        url: res.video_url,
        sourceStart: 0,
        sourceEnd: res.duration,
        kind: "source",
        projectId: res.project_id,
        label: file.name.replace(/\.[^.]+$/, ""),
      });
      dispatch({
        type: "load_project",
        project: {
          projectId: res.project_id,
          sourceUrl: res.video_url,
          sourceDuration: res.duration,
          fps: res.fps,
        },
        initialClip: clip,
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

  const hasProject = !!state.project;

  return (
    <main className="studio">
      <TopBar onExit={onExit} projectLabel={state.project?.projectId.slice(0, 8)} />

      <section className="studio__body">
        <aside className="studio__left">
          <Library onUpload={handleFile} uploading={uploading} />
        </aside>

        <section className="studio__center">
          {hasProject ? (
            <Preview />
          ) : (
            <UploadDrop onFile={handleFile} busy={uploading} />
          )}
        </section>

        <aside className="studio__right">
          <Inspector />
        </aside>
      </section>

      <section className="studio__bottom">
        <Timeline />
      </section>
    </main>
  );
}

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
