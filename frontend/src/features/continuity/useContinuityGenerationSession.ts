import { useEffect, useRef, useState } from "react";

import {
  accept,
  generate,
  pollJob,
  streamJobEvents,
  type AcceptResp,
  type BBox,
  type JobResp,
  type Variant,
} from "../../api/client";
import type { GenerationLogEntry } from "../../hooks/useGenerationSession";
import { newClip, useEDL, type Clip } from "../../stores/edl";

type GenerationTarget = Pick<
  Clip,
  "id" | "projectId" | "sourceStart" | "sourceEnd" | "volume"
>;

type AcceptedVariantPayload = {
  acceptResponse: AcceptResp;
  prompt: string;
  sourceVariantUrl: string;
  projectId: string;
};

type UseContinuityGenerationSessionArgs = {
  clip: Clip | null;
  bbox: BBox | null;
  previewFrameTs: number | null;
  onAccepted?: (payload: AcceptedVariantPayload) => void | Promise<void>;
};

export function useContinuityGenerationSession({
  clip,
  bbox,
  previewFrameTs,
  onAccepted,
}: UseContinuityGenerationSessionArgs) {
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

  function closeStream() {
    streamCtlRef.current?.abort();
    streamCtlRef.current = null;
  }

  const canGenerate =
    !!clip &&
    clip.kind === "source" &&
    !!clip.projectId &&
    !!prompt.trim() &&
    !busy;

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

  async function run() {
    if (!canGenerate || !clip || !clip.projectId) return;
    closeStream();
    setBusy(true);
    setErr(null);
    setStatus("queued");
    setVariants([]);
    setAcceptingIdx(null);
    setLogs([]);
    generationTargetRef.current = {
      id: clip.id,
      projectId: clip.projectId,
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
      volume: clip.volume,
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
      streamCtlRef.current = streamJobEvents(job_id, {
        onEvent: (event) => {
          setLogs((prev) => [
            ...prev,
            { ...event, id: `${event.ts}-${prev.length}` },
          ]);
        },
        onError: (e) => {
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
    } catch (error) {
      setErr(String(error));
      generationTargetRef.current = null;
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function acceptVariant(idx: number) {
    const target = generationTargetRef.current;
    if (!target || !target.projectId || !jobIdRef.current) return;

    const variant = variants[idx];
    if (!variant?.url) return;

    setAcceptingIdx(idx);
    try {
      const accepted = await accept(jobIdRef.current, idx);
      const duration = target.sourceEnd - target.sourceStart;
      const trimmedPrompt = prompt.trim();
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
      dispatch({ type: "replace", id: target.id, with: replacement });
      setPrompt("");
      clearSession({ keepPrompt: false });

      if (onAccepted) {
        void Promise.resolve(
          onAccepted({
            acceptResponse: accepted,
            prompt: trimmedPrompt,
            sourceVariantUrl: variant.url!,
            projectId: target.projectId,
          }),
        ).catch(() => {});
      }
    } catch (error) {
      setErr(String(error));
      setAcceptingIdx(null);
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
