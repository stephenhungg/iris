/**
 * EDL — edit decision list. The timeline is an ordered list of clips.
 * Each clip references a source URL plus a sub-range (sourceStart..sourceEnd).
 *
 * timeline-time of clip[i] starts at sum(duration of 0..i-1). duration(clip)
 * = sourceEnd - sourceStart.
 *
 * The store is pure — operations take state and return new state. No side
 * effects. Mutations happen via a reducer, exposed through a context hook.
 *
 * ┌─────────────────────────┬────────────────────────────────────────────┐
 * │ state.sources (library) │ uploaded/generated media that sits in the  │
 * │                         │ side panel until the user adds it.         │
 * ├─────────────────────────┼────────────────────────────────────────────┤
 * │ state.clips (timeline)  │ ordered list of clip segments that play.   │
 * │                         │ each clip points back at a source via url. │
 * └─────────────────────────┴────────────────────────────────────────────┘
 */
import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";

// ─── types ────────────────────────────────────────────────────────────

/** A piece of media sitting in the library waiting to be used. */
export type MediaAsset = {
  id: string;
  url: string;
  /** full duration of the underlying file (seconds) */
  duration: number;
  fps: number;
  /** backend project id for /api/generate calls */
  projectId: string;
  label: string;
  kind: "source" | "generated";
};

export type Clip = {
  id: string;
  kind: "source" | "generated";
  url: string;
  /** seconds into the source URL where this clip begins */
  sourceStart: number;
  /** seconds into the source URL where this clip ends */
  sourceEnd: number;
  /**
   * Full duration of the underlying source file. Upper bound for sourceEnd
   * when trimming — you can't stretch a clip past what the file contains.
   */
  mediaDuration: number;
  /** 0..1 */
  volume: number;
  label?: string;
  /** optional project/job trail for generated clips */
  projectId?: string;
  generatedFromClipId?: string;
  /** library asset this clip was cut from (so removing all clips doesn't
   *  purge the source from the library) */
  sourceAssetId?: string;
};

export type BBox = { x: number; y: number; w: number; h: number };

export type State = {
  /** library pool — imported + generated media, not on the timeline yet */
  sources: MediaAsset[];
  /** ordered sequence on the timeline */
  clips: Clip[];
  selectedId: string | null;
  /** timeline-time in seconds (read/written by preview + timeline) */
  playhead: number;
  playing: boolean;
  /** bounding box selection for AI generation (normalized 0-1) */
  bbox: BBox | null;
};

export const initialState: State = {
  sources: [],
  clips: [],
  selectedId: null,
  playhead: 0,
  playing: false,
  bbox: null,
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
  | { type: "add_source"; asset: MediaAsset }
  | { type: "remove_source"; assetId: string }
  | { type: "add_to_timeline"; assetId: string }
  | { type: "select"; id: string | null }
  | { type: "set_playhead"; t: number }
  | { type: "set_playing"; playing: boolean }
  | { type: "trim"; id: string; side: "in" | "out"; sourceTs: number }
  | { type: "split_at_playhead" }
  | { type: "remove"; id: string }
  | { type: "set_volume"; id: string; v: number }
  | { type: "reorder"; from: number; to: number }
  | { type: "replace"; id: string; with: Clip }
  | { type: "set_bbox"; bbox: BBox | null }
  | { type: "hydrate"; sources: MediaAsset[]; clips: Clip[] };

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "hydrate": {
      // wholesale replace library + timeline. used when reopening a saved
      // reel so we rebuild the EDL from the backend's segment rows
      // instead of starting from a blank canvas.
      return {
        ...state,
        sources: a.sources,
        clips: a.clips,
        selectedId: null,
        playhead: 0,
        playing: false,
      };
    }

    case "add_source": {
      if (state.sources.some((s) => s.id === a.asset.id)) return state;
      return { ...state, sources: [...state.sources, a.asset] };
    }

    case "remove_source": {
      return {
        ...state,
        sources: state.sources.filter((s) => s.id !== a.assetId),
      };
    }

    case "add_to_timeline": {
      const asset = state.sources.find((s) => s.id === a.assetId);
      if (!asset) return state;
      const clip = clipFromAsset(asset);
      const clips = [...state.clips, clip];
      return { ...state, clips, selectedId: clip.id };
    }

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
        // keep at least 0.1s and stay inside the source file span — users
        // can't stretch a clip past what the file actually contains.
        const MIN = 0.1;
        const maxEnd = c.mediaDuration > 0 ? c.mediaDuration : c.sourceEnd;
        if (a.side === "in") {
          const newStart = Math.max(0, Math.min(c.sourceEnd - MIN, a.sourceTs));
          return { ...c, sourceStart: newStart };
        }
        const newEnd = Math.max(
          c.sourceStart + MIN,
          Math.min(maxEnd, a.sourceTs),
        );
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
      const idx = state.clips.findIndex((c) => c.id === a.id);
      if (idx < 0) return state;
      const clips = state.clips.filter((c) => c.id !== a.id);
      return {
        ...state,
        clips,
        selectedId:
          clips.length === 0
            ? null
            : clips[Math.min(idx, clips.length - 1)]?.id ?? null,
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
      return { ...state, clips, selectedId: a.with.id, bbox: null };
    }
    case "set_bbox":
      return { ...state, bbox: a.bbox };
  }
}

function cryptoUid() {
  return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
}

// ─── context ──────────────────────────────────────────────────────────

const StoreCtx = createContext<{
  state: State;
  dispatch: Dispatch<Action>;
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

export function newMediaAsset(partial: Omit<MediaAsset, "id">): MediaAsset {
  return { id: cryptoUid(), ...partial };
}

/** Build a timeline clip that plays a library asset in full. */
export function clipFromAsset(asset: MediaAsset): Clip {
  return {
    id: cryptoUid(),
    kind: asset.kind,
    url: asset.url,
    sourceStart: 0,
    sourceEnd: asset.duration,
    mediaDuration: asset.duration,
    volume: 1,
    label: asset.label,
    projectId: asset.projectId,
    sourceAssetId: asset.id,
  };
}

/** Backwards-compat factory for callers that build a clip directly. */
export function newClip(
  partial: Partial<Clip> &
    Pick<Clip, "url" | "sourceStart" | "sourceEnd"> & {
      mediaDuration?: number;
    },
): Clip {
  return {
    id: cryptoUid(),
    kind: "source",
    volume: 1,
    mediaDuration: partial.mediaDuration ?? partial.sourceEnd,
    ...partial,
  };
}
