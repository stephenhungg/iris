/**
 * EDL — edit decision list. The timeline is an ordered list of clips.
 * Each clip references a source URL plus a sub-range (sourceStart..sourceEnd).
 *
 * timeline-time of clip[i] starts at sum(duration of 0..i-1). duration(clip)
 * = sourceEnd - sourceStart.
 *
 * the store is pure — operations take state and return new state. no side
 * effects. mutations happen via a reducer, exposed through a context hook.
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

// ─── types ────────────────────────────────────────────────────────────

export type Clip = {
  id: string;
  kind: "source" | "generated";
  url: string;
  /** seconds into the source URL where this clip begins */
  sourceStart: number;
  /** seconds into the source URL where this clip ends */
  sourceEnd: number;
  /** 0..1 */
  volume: number;
  label?: string;
  /** optional project/job trail for generated clips */
  projectId?: string;
  generatedFromClipId?: string;
};

export type Project = {
  projectId: string;
  sourceUrl: string;
  sourceDuration: number;
  fps: number;
};

export type State = {
  project: Project | null;
  clips: Clip[];
  selectedId: string | null;
  /** timeline-time in seconds (read/written by preview + timeline) */
  playhead: number;
  playing: boolean;
};

export const initialState: State = {
  project: null,
  clips: [],
  selectedId: null,
  playhead: 0,
  playing: false,
};

// ─── helpers ──────────────────────────────────────────────────────────

export const duration = (c: Clip) => Math.max(0, c.sourceEnd - c.sourceStart);

export const totalDuration = (clips: Clip[]) =>
  clips.reduce((s, c) => s + duration(c), 0);

/** returns { clip, offsetInClip, indexInList, clipStartInTimeline } or null */
export function clipAtTime(clips: Clip[], t: number) {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const d = duration(clips[i]);
    if (t < acc + d || i === clips.length - 1) {
      return {
        clip: clips[i],
        index: i,
        offsetInClip: Math.max(0, Math.min(d, t - acc)),
        startInTimeline: acc,
      };
    }
    acc += d;
  }
  return null;
}

/** the absolute source-time for a timeline-time, if playing a specific clip */
export const sourceTimeFor = (c: Clip, offsetInClip: number) =>
  c.sourceStart + Math.max(0, Math.min(duration(c), offsetInClip));

// ─── actions ──────────────────────────────────────────────────────────

export type Action =
  | { type: "load_project"; project: Project; initialClip: Clip }
  | { type: "select"; id: string | null }
  | { type: "set_playhead"; t: number }
  | { type: "set_playing"; playing: boolean }
  | { type: "trim"; id: string; side: "in" | "out"; sourceTs: number }
  | { type: "split_at_playhead" }
  | { type: "remove"; id: string }
  | { type: "set_volume"; id: string; v: number }
  | { type: "reorder"; from: number; to: number }
  | { type: "replace"; id: string; with: Clip };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "load_project":
      return {
        ...state,
        project: a.project,
        clips: [a.initialClip],
        selectedId: a.initialClip.id,
        playhead: 0,
        playing: false,
      };

    case "select":
      return { ...state, selectedId: a.id };

    case "set_playhead":
      return {
        ...state,
        playhead: Math.max(0, Math.min(totalDuration(state.clips), a.t)),
      };

    case "set_playing":
      return { ...state, playing: a.playing };

    case "trim": {
      const clips = state.clips.map((c) => {
        if (c.id !== a.id) return c;
        // guardrails: keep at least 0.1s and stay inside the source span
        const MIN = 0.1;
        if (a.side === "in") {
          const newStart = Math.max(0, Math.min(c.sourceEnd - MIN, a.sourceTs));
          return { ...c, sourceStart: newStart };
        }
        const newEnd = Math.max(c.sourceStart + MIN, a.sourceTs);
        return { ...c, sourceEnd: newEnd };
      });
      return { ...state, clips };
    }

    case "split_at_playhead": {
      const hit = clipAtTime(state.clips, state.playhead);
      if (!hit) return state;
      const { clip, index, offsetInClip } = hit;
      // don't split at the very edges
      if (offsetInClip < 0.05 || offsetInClip > duration(clip) - 0.05) return state;

      const splitAtSourceTs = sourceTimeFor(clip, offsetInClip);
      const left: Clip = { ...clip, sourceEnd: splitAtSourceTs };
      const right: Clip = {
        ...clip,
        id: cryptoUid(),
        sourceStart: splitAtSourceTs,
      };
      const clips = [
        ...state.clips.slice(0, index),
        left,
        right,
        ...state.clips.slice(index + 1),
      ];
      return { ...state, clips, selectedId: right.id };
    }

    case "remove": {
      if (state.clips.length <= 1) return state;
      const idx = state.clips.findIndex((c) => c.id === a.id);
      if (idx < 0) return state;
      const clips = state.clips.filter((c) => c.id !== a.id);
      return {
        ...state,
        clips,
        selectedId: clips[Math.min(idx, clips.length - 1)]?.id ?? null,
      };
    }

    case "set_volume": {
      const clips = state.clips.map((c) =>
        c.id === a.id ? { ...c, volume: Math.max(0, Math.min(1, a.v)) } : c,
      );
      return { ...state, clips };
    }

    case "reorder": {
      if (a.from === a.to) return state;
      const clips = [...state.clips];
      const [moved] = clips.splice(a.from, 1);
      clips.splice(a.to, 0, moved);
      return { ...state, clips };
    }

    case "replace": {
      const clips = state.clips.map((c) => (c.id === a.id ? a.with : c));
      return { ...state, clips, selectedId: a.with.id };
    }
  }
}

function cryptoUid() {
  return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
}

// ─── context ──────────────────────────────────────────────────────────

const StoreCtx = createContext<{
  state: State;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function EDLProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useEDL() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useEDL must be inside EDLProvider");
  return ctx;
}

// ─── factories ────────────────────────────────────────────────────────

export function newClip(partial: Partial<Clip> & Pick<Clip, "url" | "sourceStart" | "sourceEnd">): Clip {
  return {
    id: cryptoUid(),
    kind: "source",
    volume: 1,
    ...partial,
  };
}
