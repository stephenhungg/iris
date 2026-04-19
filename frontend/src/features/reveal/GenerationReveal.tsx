import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  duration,
  type BBox,
  type Clip,
  type IdentifiedEntity,
} from "../../stores/edl";
import "./reveal.css";

type RevealLayout = "panel" | "floating";

type GenerationRevealProps = {
  clip: Clip;
  bbox: BBox | null;
  entity: IdentifiedEntity | null;
  identifying: boolean;
  layout: RevealLayout;
  session: RevealSession;
  onClearRegion?: () => void;
};

export type RevealSession = {
  prompt: string;
  setPrompt: (value: string) => void;
  busy: boolean;
  status: string;
  variants: Array<{
    url: string;
    description: string;
    visual_coherence: number | null;
    prompt_adherence: number | null;
  }>;
  err: string | null;
  setErr: (value: string | null) => void;
  acceptingIdx: number | null;
  canGenerate: boolean;
  run: () => Promise<boolean>;
  acceptVariant: (idx: number) => Promise<boolean>;
  clearSession: () => void;
};

export function GenerationReveal({
  clip,
  bbox,
  entity,
  identifying,
  layout,
  session,
  onClearRegion,
}: GenerationRevealProps) {
  const [activeVariantIdx, setActiveVariantIdx] = useState<number | null>(null);
  const {
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
  } = session;

  const hasVariants = variants.length > 0;
  const activeVariant =
    activeVariantIdx != null && activeVariantIdx < variants.length
      ? variants[activeVariantIdx]
      : null;
  const promptLocked = busy || hasVariants || acceptingIdx != null;
  const regionSummary = describeRegion(bbox);
  const subjectSummary = identifying
    ? "identifying subject..."
    : entity
      ? `${entity.description} · ${entity.category}`
      : bbox
        ? "region locked, waiting on subject read"
        : "whole frame";
  const phaseLabel = hasVariants
    ? "review and compare"
    : busy
      ? "building variants"
      : "describe the transformation";

  useEffect(() => {
    if (!hasVariants) {
      setActiveVariantIdx(null);
      return;
    }
    setActiveVariantIdx((current) =>
      current == null || current >= variants.length ? 0 : current,
    );
  }, [hasVariants, variants.length]);

  async function handleRun(): Promise<boolean> {
    if (!canGenerate) return false;
    return run();
  }

  async function handleAccept(idx: number) {
    const accepted = await acceptVariant(idx);
    if (accepted) {
      setActiveVariantIdx(null);
    }
  }

  function handleReset() {
    setActiveVariantIdx(null);
    clearSession();
  }

  return (
    <div className={`reveal reveal--${layout}`}>
      <div className="reveal__composer">
        <div className="reveal__heading">
          <div>
            <p className="reveal__eyebrow mono">{phaseLabel}</p>
            <h3 className="reveal__title">
              {hasVariants
                ? "pick the take that actually lands"
                : busy
                  ? "turning the note into something you can judge"
                  : "aim the edit before you spend the render"}
            </h3>
          </div>
          {busy && (
            <span className="reveal__status mono">{formatStatus(status)}</span>
          )}
        </div>

        <div className={`reveal__prompt-shell reveal__prompt-shell--${layout}`}>
          {layout === "panel" ? (
            <textarea
              className="reveal__prompt-input reveal__prompt-input--area"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              placeholder="e.g. make the jacket deep cherry red, keep the grade warm and cinematic"
              disabled={promptLocked}
            />
          ) : (
            <input
              className="reveal__prompt-input reveal__prompt-input--line"
              type="text"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canGenerate) {
                  void handleRun();
                }
              }}
              placeholder="describe the change..."
              disabled={promptLocked}
            />
          )}

          <button
            className="reveal__generate"
            onClick={() => void handleRun()}
            disabled={!canGenerate}
          >
            {busy ? `generating · ${formatStatus(status)}` : "generate variants"}
          </button>
        </div>

        <div className="reveal__context">
          <ContextPill k="target" v={clip.label ?? "selected range"} />
          <ContextPill k="duration" v={`${duration(clip).toFixed(2)}s clip`} />
          <ContextPill k="scope" v={regionSummary} />
          <ContextPill k="subject" v={subjectSummary} />
          {bbox && onClearRegion && (
            <button className="reveal__ghost reveal__ghost--small" onClick={onClearRegion}>
              clear region
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="reveal__error mono">
          <span>{err}</span>
          <button onClick={() => setErr(null)} aria-label="dismiss ai error">
            close
          </button>
        </div>
      )}

      {busy && (
        <div className="reveal__loading">
          <div className="reveal__loading-copy">
            <p className="reveal__loading-label mono">current prompt</p>
            <p className="reveal__loading-text">
              {prompt.trim() || "waiting for the edit note"}
            </p>
          </div>
          <div className="reveal__loading-steps">
            <div className="reveal__loading-step">
              <span className="reveal__loading-dot" />
              sampling candidate looks
            </div>
            <div className="reveal__loading-step">
              <span className="reveal__loading-dot" />
              keeping the timing pinned to the source cut
            </div>
            <div className="reveal__loading-step">
              <span className="reveal__loading-dot" />
              getting the review stage ready
            </div>
          </div>
        </div>
      )}

      {hasVariants && activeVariant && (
        <div className="reveal__review">
          <div className="reveal__review-head">
            <div>
              <p className="reveal__eyebrow mono">hero compare</p>
              <h4 className="reveal__review-title">
                {`variant ${variantLetter(activeVariantIdx ?? 0)}`}
              </h4>
            </div>
            <div className="reveal__scores mono">
              <ScoreBadge label="visual" value={activeVariant.visual_coherence} />
              <ScoreBadge label="prompt" value={activeVariant.prompt_adherence} />
            </div>
          </div>

          <div className={`reveal__compare reveal__compare--${layout}`}>
            <CompareCard
              tone="source"
              label="original"
              eyebrow="before"
              description="the untouched clip slice"
            >
              <SegmentVideo
                src={clip.url}
                start={clip.sourceStart}
                end={clip.sourceEnd}
                shouldPlay
              />
            </CompareCard>

            <CompareCard
              tone="variant"
              label={`variant ${variantLetter(activeVariantIdx ?? 0)}`}
              eyebrow="after"
              description={activeVariant.description || "generated option"}
            >
              <SegmentVideo
                src={activeVariant.url}
                start={0}
                end={duration(clip)}
                shouldPlay
              />
            </CompareCard>
          </div>

          <p className="reveal__review-copy">
            {activeVariant.description || prompt.trim() || "generated variant"}
          </p>

          <div className="reveal__actions">
            <button
              className="reveal__primary"
              onClick={() => void handleAccept(activeVariantIdx ?? 0)}
              disabled={acceptingIdx != null}
            >
              {acceptingIdx != null
                ? "applying variant..."
                : `apply variant ${variantLetter(activeVariantIdx ?? 0)}`}
            </button>
            <button className="reveal__ghost" onClick={handleReset}>
              different prompt
            </button>
          </div>

          <div className="reveal__variant-grid">
            {variants.map((variant, index) => {
              const selected = index === activeVariantIdx;
              const disabled = acceptingIdx != null && acceptingIdx !== index;
              return (
                <button
                  key={`${variant.url}-${index}`}
                  className={`reveal__variant-card ${selected ? "reveal__variant-card--active" : ""}`}
                  onClick={() => setActiveVariantIdx(index)}
                  disabled={acceptingIdx != null}
                  aria-pressed={selected}
                  style={{ opacity: disabled ? 0.5 : 1 }}
                >
                  <div className="reveal__variant-media">
                    <video
                      className="reveal__variant-video"
                      src={variant.url}
                      muted
                      loop
                      playsInline
                      autoPlay={selected}
                      onMouseEnter={(event) => {
                        const video = event.currentTarget;
                        void video.play().catch(() => {});
                      }}
                      onMouseLeave={(event) => {
                        const video = event.currentTarget;
                        video.pause();
                        video.currentTime = 0;
                      }}
                    />
                  </div>

                  <div className="reveal__variant-meta">
                    <div className="reveal__variant-topline mono">
                      <span>{`variant ${variantLetter(index)}`}</span>
                      <span>{scoreSummary(variant)}</span>
                    </div>
                    <p className="reveal__variant-copy">
                      {variant.description || "generated option"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ContextPill({ k, v }: { k: string; v: string }) {
  return (
    <div className="reveal__context-pill">
      <span className="reveal__context-k mono">{k}</span>
      <span className="reveal__context-v" title={v}>
        {v}
      </span>
    </div>
  );
}

function ScoreBadge({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  if (value == null) return null;
  return (
    <span className="reveal__score-badge">
      <span>{label}</span>
      <strong>{value}/10</strong>
    </span>
  );
}

function CompareCard({
  label,
  eyebrow,
  description,
  tone,
  children,
}: {
  label: string;
  eyebrow: string;
  description: string;
  tone: "source" | "variant";
  children: ReactNode;
}) {
  return (
    <article className={`reveal__compare-card reveal__compare-card--${tone}`}>
      <div className="reveal__compare-media">{children}</div>
      <div className="reveal__compare-copy">
        <div className="reveal__compare-head">
          <span className="reveal__compare-eyebrow mono">{eyebrow}</span>
          <h5>{label}</h5>
        </div>
        <p>{description}</p>
      </div>
    </article>
  );
}

function SegmentVideo({
  src,
  start,
  end,
  shouldPlay,
}: {
  src: string;
  start: number;
  end: number;
  shouldPlay: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const safeEnd = Math.max(start + 0.1, end);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    let frameId: number | null = null;

    const syncPlayback = () => {
      if (video.currentTime < start || video.currentTime >= safeEnd - 0.04) {
        video.currentTime = start;
      }
      if (shouldPlay) {
        frameId = requestAnimationFrame(syncPlayback);
      }
    };

    const primeVideo = () => {
      video.currentTime = start;
      if (shouldPlay) {
        void video.play().catch(() => {});
        frameId = requestAnimationFrame(syncPlayback);
      } else {
        video.pause();
      }
    };

    if (video.readyState >= 1) {
      primeVideo();
    } else {
      video.addEventListener("loadedmetadata", primeVideo);
    }

    return () => {
      video.pause();
      video.removeEventListener("loadedmetadata", primeVideo);
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [src, start, safeEnd, shouldPlay]);

  return (
    <video
      ref={ref}
      className="reveal__compare-video"
      src={src}
      muted
      playsInline
    />
  );
}

function formatStatus(status: string) {
  switch (status) {
    case "queued":
    case "pending":
      return "queued";
    case "processing":
      return "rendering";
    default:
      return status || "working";
  }
}

function variantLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function scoreSummary(variant: {
  visual_coherence: number | null;
  prompt_adherence: number | null;
}) {
  const visual = variant.visual_coherence != null ? `v ${variant.visual_coherence}` : null;
  const prompt = variant.prompt_adherence != null ? `p ${variant.prompt_adherence}` : null;
  return [visual, prompt].filter(Boolean).join(" · ") || "no scores";
}

function describeRegion(bbox: BBox | null) {
  if (!bbox) return "full frame";
  const wPct = Math.round(bbox.w * 100);
  const hPct = Math.round(bbox.h * 100);
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const vertical = cy < 0.33 ? "top" : cy > 0.66 ? "bottom" : "center";
  const horizontal = cx < 0.33 ? "left" : cx > 0.66 ? "right" : "center";
  const anchor =
    vertical === "center" && horizontal === "center"
      ? "center"
      : `${vertical} ${horizontal}`.trim();
  return `${anchor} · ${wPct}×${hPct}%`;
}
