import { useEffect, useRef, useState } from "react";

import { accept, generate, pollJob, type JobResp, type Variant, type BBox } from "../api/client";
import { newClip, useEDL, type Clip } from "../stores/edl";

type GenerationTarget = Pick<
  Clip,
  "id" | "projectId" | "sourceStart" | "sourceEnd" | "volume"
>;

type UseGenerationSessionArgs = {
  clip: Clip | null;
  bbox: BBox | null;
  previewFrameTs: number | null;
};

export function useGenerationSession({
  clip,
  bbox,
  previewFrameTs,
}: UseGenerationSessionArgs) {
  const { dispatch } = useEDL();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const generationTargetRef = useRef<GenerationTarget | null>(null);

  const canGenerate =
    !!clip &&
    clip.kind === "source" &&
    !!clip.projectId &&
    !!prompt.trim() &&
    !busy;

  function clearSession({ keepPrompt = true }: { keepPrompt?: boolean } = {}) {
    setVariants([]);
    setStatus("");
    setErr(null);
    setAcceptingIdx(null);
    jobIdRef.current = null;
    generationTargetRef.current = null;
    if (!keepPrompt) setPrompt("");
  }

  useEffect(() => {
    clearSession();
  }, [clip?.id]);

  async function run(): Promise<boolean> {
    if (!canGenerate || !clip || !clip.projectId) return false;
    setBusy(true);
    setErr(null);
    setStatus("queued");
    setVariants([]);
    setAcceptingIdx(null);
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
      await accept(jobIdRef.current, idx);
      const variant = variants[idx];
      const duration = target.sourceEnd - target.sourceStart;
      const replacement = newClip({
        url: variant.url,
        sourceStart: 0,
        sourceEnd: duration,
        mediaDuration: duration,
        kind: "generated",
        label: prompt.trim().slice(0, 28) || "ai edit",
        projectId: target.projectId,
        generatedFromClipId: target.id,
        volume: target.volume,
      });
      dispatch({ type: "replace", id: target.id, with: replacement });
      setPrompt("");
      clearSession({ keepPrompt: false });
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
    run,
    acceptVariant,
    clearSession,
  };
}
