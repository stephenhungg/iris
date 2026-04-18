import { useEffect, useRef, type ReactNode } from "react";
import { clipAtTime, duration, sourceTimeFor, totalDuration, useEDL } from "../stores/edl";
import { Icon } from "./Icon";
import "./preview.css";

/**
 * Preview monitor. Single <video> element; swaps src + seeks whenever the
 * playhead crosses a clip boundary. Transport controls below. The stage
 * letterboxes the video within a 16:9 frame so the aspect feels stable
 * across clip swaps.
 */
export function Preview() {
  const { state, dispatch } = useEDL();
  const videoRef = useRef<HTMLVideoElement>(null);
  const currentClipIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const hit = clipAtTime(state.clips, state.playhead);
  const activeClip = hit?.clip ?? null;
  const total = totalDuration(state.clips);

  // mirror active clip into <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !activeClip) return;

    const want = sourceTimeFor(activeClip, hit!.offsetInClip);
    const clipChanged = currentClipIdRef.current !== activeClip.id;

    if (clipChanged) {
      currentClipIdRef.current = activeClip.id;
      v.src = activeClip.url;
      v.volume = activeClip.volume;
      const onLoaded = () => {
        v.currentTime = want;
        if (state.playing) v.play().catch(() => {});
        v.removeEventListener("loadedmetadata", onLoaded);
      };
      v.addEventListener("loadedmetadata", onLoaded);
      return;
    }

    v.volume = activeClip.volume;
    if (Math.abs(v.currentTime - want) > 0.25) {
      v.currentTime = want;
    }
  }, [activeClip?.id, activeClip?.url, activeClip?.volume, hit?.offsetInClip, state.playing, activeClip]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (state.playing) v.play().catch(() => dispatch({ type: "set_playing", playing: false }));
    else v.pause();
  }, [state.playing, dispatch]);

  // rAF loop while playing — advance timeline playhead, jump clips at boundaries
  useEffect(() => {
    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || !state.playing) return;

      const hit2 = clipAtTime(state.clips, state.playhead);
      if (!hit2) return;
      const { clip, startInTimeline } = hit2;
      const offsetInClip = v.currentTime - clip.sourceStart;
      const newTimeline = startInTimeline + offsetInClip;

      if (offsetInClip >= duration(clip) - 0.02) {
        const next = state.clips[hit2.index + 1];
        if (next) {
          dispatch({ type: "set_playhead", t: startInTimeline + duration(clip) });
        } else {
          dispatch({ type: "set_playing", playing: false });
          dispatch({ type: "set_playhead", t: totalDuration(state.clips) });
        }
        return;
      }

      dispatch({ type: "set_playhead", t: newTimeline });
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [state.playing, state.clips, state.playhead, dispatch]);

  return (
    <div className="pv">
      <div className="pv__stage">
        {activeClip ? (
          <video ref={videoRef} className="pv__video" playsInline />
        ) : (
          <div className="pv__placeholder mono">no clip</div>
        )}
      </div>

      <div className="pv__bar">
        <span className="mono pv__tc">
          {fmt(state.playhead)}
          <span className="pv__sep"> / </span>
          <span className="pv__total">{fmt(total)}</span>
        </span>

        <Transport />

        <div className="pv__aspect mono">16 : 9</div>
      </div>
    </div>
  );
}

function Transport() {
  const { state, dispatch } = useEDL();
  const total = totalDuration(state.clips);
  const step = 1 / 24;

  return (
    <div className="tp">
      <IconBtn title="jump to start" onClick={() => dispatch({ type: "set_playhead", t: 0 })}>
        <Icon name="skip-back" size={14} />
      </IconBtn>
      <IconBtn title="back 1 frame" onClick={() => dispatch({ type: "set_playhead", t: state.playhead - step })}>
        <Icon name="step-back" size={14} />
      </IconBtn>
      <button
        className="tp__play"
        onClick={() => dispatch({ type: "set_playing", playing: !state.playing })}
        title={state.playing ? "pause (space)" : "play (space)"}
      >
        <Icon name={state.playing ? "pause" : "play"} size={16} />
      </button>
      <IconBtn title="forward 1 frame" onClick={() => dispatch({ type: "set_playhead", t: state.playhead + step })}>
        <Icon name="step-fwd" size={14} />
      </IconBtn>
      <IconBtn title="jump to end" onClick={() => dispatch({ type: "set_playhead", t: total })}>
        <Icon name="skip-fwd" size={14} />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="tp__btn" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
