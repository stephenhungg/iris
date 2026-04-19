import { useEffect, useRef, useState } from "react";

import {
  accept,
  generate,
  pollJob,
  streamJobEvents,
  type AcceptResp,
  type JobResp,
  type JobStreamEvent,
  type Variant,
  type BBox,
} from "../api/client";
import { newClip, useEDL, type Clip } from "../stores/edl";

type GenerationTarget = Pick<
  Clip,
  "id" | "projectId" | "sourceStart" | "sourceEnd" | "volume"
> & {
  sourceClipStart: number;
  sourceClipEnd: number;
};

type UseGenerationSessionArgs = {
  clip: Clip | null;
  sourceClip?: Clip | null;
  bbox: BBox | null;
  previewFrameTs: number | null;
  onAccepted?: (payload: AcceptedVariantPayload) => void | Promise<void>;
};

export type GenerationLogEntry = JobStreamEvent & { id: string };
export type AcceptedVariantPayload = {
  acceptResponse: AcceptResp;
  prompt: string;
  sourceVariantUrl: string;
  projectId: string;
};

export function useGenerationSession({
  clip,
  sourceClip,
  bbox,
  previewFrameTs,
  onAccepted,
}: UseGenerationSessionArgs) {
  const { dispatch } = useEDL();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null);
  const [logs, setLogs] = useState<GenerationLogEntry[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const generationTargetRef = useRef<GenerationTarget | null>(null);
  const streamCtlRef = useRef<AbortController | null>(null);

  const canGenerate =
    !!clip &&
    clip.kind === "source" &&
    !!clip.projectId &&
    !!prompt.trim() &&
    !busy;

  function closeStream() {
    streamCtlRef.current?.abort();
    streamCtlRef.current = null;
  }

  function clearSession({ keepPrompt = true }: { keepPrompt?: boolean } = {}) {
    closeStream();
    setVariants([]);
    setStatus("");
    setErr(null);
    setAcceptingIdx(null);
    setLogs([]);
    jobIdRef.current = null;
    generationTargetRef.current = null;
    if (!keepPrompt) setPrompt("");
  }

  useEffect(() => {
    clearSession();
  }, [clip?.id]);

  useEffect(() => {
    return () => closeStream();
  }, []);

  async function run(): Promise<boolean> {
    if (!canGenerate || !clip || !clip.projectId) return false;
    const baseClip = sourceClip ?? clip;
    closeStream();
    setBusy(true);
    setErr(null);
    setStatus("queued");
    setVariants([]);
    setAcceptingIdx(null);
    setLogs([]);
    generationTargetRef.current = {
      id: baseClip.id,
      projectId: clip.projectId,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      volume: baseClip.volume,
      sourceClipStart: baseClip.sourceStart,
      sourceClipEnd: baseClip.sourceEnd,
    };
    try {
      const { job_id } = await generate({
        project_id: clip.projectId,
        start_ts: clip.sourceStart,
        end_ts: clip.sourceEnd,
        bbox: bbox ?? { x: 0, y: 0, w: 1, h: 1 },
        prompt: prompt.trim(),
        reference_frame_ts: previewFrameTs ?? (clip.sourceStart + clip.sourceEnd) / 2,
      });
      jobIdRef.current = job_id;

      // open the SSE console stream in parallel with the poll loop.
      // the stream carries thought-process events; the poll resolves when
      // the job flips to done/error so we can still drive variants state.
      streamCtlRef.current = streamJobEvents(job_id, {
        onEvent: (event) => {
          setLogs((prev) => [
            ...prev,
            { ...event, id: `${event.ts}-${prev.length}` },
          ]);
        },
        onError: (e) => {
          // stream failure is non-fatal — the poll loop still drives state.
          setLogs((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              ts: Date.now() / 1000,
              stage: "stream_error",
              msg: `event stream dropped: ${String(e)}`,
            },
          ]);
        },
      });

      const final: JobResp = await pollJob(job_id, (job) => setStatus(job.status));
      if (final.status !== "done" || !final.variants.length) {
        throw new Error(final.error || "generation failed");
      }
      setVariants(final.variants);
      return true;
    } catch (e) {
      setErr(String(e));
      generationTargetRef.current = null;
      return false;
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function acceptVariant(idx: number): Promise<boolean> {
    const target = generationTargetRef.current;
    if (!target || !target.projectId || !jobIdRef.current) return false;
    setAcceptingIdx(idx);
    try {
      const variant = variants[idx];
      if (!variant?.url) throw new Error("variant has no url");
      const accepted = await accept(jobIdRef.current, idx);
      const trimmedPrompt = prompt.trim();
      const duration = target.sourceEnd - target.sourceStart;
      const replacement = newClip({
        url: variant.url,
        sourceStart: 0,
        sourceEnd: duration,
        mediaDuration: duration,
        kind: "generated",
        label: trimmedPrompt.slice(0, 28) || "ai edit",
        projectId: target.projectId,
        generatedFromClipId: target.id,
        volume: target.volume,
      });
      const replacesWholeClip =
        Math.abs(target.sourceStart - target.sourceClipStart) < 1e-3 &&
        Math.abs(target.sourceEnd - target.sourceClipEnd) < 1e-3;
      if (replacesWholeClip) {
        dispatch({ type: "replace", id: target.id, with: replacement });
      } else {
        dispatch({
          type: "replace_range",
          id: target.id,
          start: target.sourceStart,
          end: target.sourceEnd,
          with: replacement,
        });
      }
      setPrompt("");
      clearSession({ keepPrompt: false });
      if (onAccepted) {
        void Promise.resolve(
          onAccepted({
            acceptResponse: accepted,
            prompt: trimmedPrompt,
            sourceVariantUrl: variant.url,
            projectId: target.projectId,
          }),
        ).catch(() => {});
      }
      return true;
    } catch (e) {
      setErr(String(e));
      setAcceptingIdx(null);
      return false;
    }
  }

  return {
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
  };
}
