import { useEffect, useRef, useState } from "react";
import { BBoxCanvas } from "../components/BBoxCanvas";
import type {
  BBox,
  JobResp,
  TimelineResp,
  UploadResp,
  Variant,
} from "../api/client";
import {
  accept,
  generate,
  getTimeline,
  pollJob,
  upload,
} from "../api/client";
import "./editor.css";

type Phase = "empty" | "loaded" | "generating" | "reviewing" | "accepted";

export function Editor({ onExit }: { onExit: () => void }) {
  const [project, setProject] = useState<UploadResp | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [err, setErr] = useState<string | null>(null);

  const [currentTs, setCurrentTs] = useState(0);
  const [startTs, setStartTs] = useState(0);
  const [endTs, setEndTs] = useState(0);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [prompt, setPrompt] = useState("");

  const [job, setJob] = useState<JobResp | null>(null);
  const [timeline, setTimeline] = useState<TimelineResp | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [videoBox, setVideoBox] = useState({ w: 640, h: 360 });

  // recompute the overlay size whenever the video reports its intrinsic ratio
  // or the container resizes
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const recalc = () => {
      const w = el.clientWidth;
      const v = videoRef.current;
      if (v && v.videoWidth && v.videoHeight) {
        setVideoBox({ w, h: (w * v.videoHeight) / v.videoWidth });
      } else {
        setVideoBox({ w, h: w * (9 / 16) });
      }
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project]);

  async function handleUpload(file: File) {
    setErr(null);
    try {
      const p = await upload(file);
      setProject(p);
      setPhase("loaded");
      setStartTs(0);
      setEndTs(Math.min(4, p.duration));
      setBbox(null);
      setPrompt("");
      setJob(null);
      const tl = await getTimeline(p.project_id);
      setTimeline(tl);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function handleGenerate() {
    if (!project || !bbox || !prompt.trim()) return;
    setErr(null);
    setPhase("generating");
    try {
      const { job_id } = await generate({
        project_id: project.project_id,
        start_ts: startTs,
        end_ts: endTs,
        bbox,
        prompt: prompt.trim(),
        reference_frame_ts: (startTs + endTs) / 2,
      });
      await pollJob(job_id, (j) => setJob(j));
      setPhase("reviewing");
    } catch (e) {
      setErr(String(e));
      setPhase("loaded");
    }
  }

  async function handleAccept(idx: number) {
    if (!job || !project) return;
    try {
      await accept(job.job_id, idx);
      const tl = await getTimeline(project.project_id);
      setTimeline(tl);
      setPhase("accepted");
      setJob(null);
      setBbox(null);
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <main className="ed">
      <header className="ed__bar">
        <button className="ed__brand" onClick={onExit}>
          <span className="ed__brand-dot" />
          <span className="mono">iris</span>
        </button>
        <span className="label">
          {project ? `reel · ${project.project_id.slice(0, 8)}` : "no reel loaded"}
        </span>
        <span className="label">
          {project ? `${project.duration.toFixed(1)}s · ${project.fps.toFixed(0)}fps` : ""}
        </span>
      </header>

      {err && (
        <div className="ed__err mono">
          <span>error</span>
          <span>{err}</span>
          <button onClick={() => setErr(null)}>dismiss</button>
        </div>
      )}

      {!project ? (
        <UploadDrop onFile={handleUpload} />
      ) : (
        <div className="ed__grid">
          {/* left: player + overlay */}
          <section className="ed__stage">
            <div className="ed__stage-head">
              <span className="label">monitor</span>
              <span className="label">
                {fmt(currentTs)} / {fmt(project.duration)}
              </span>
            </div>
            <div ref={wrapRef} className="ed__video-wrap">
              <video
                ref={videoRef}
                src={project.video_url}
                className="ed__video"
                controls
                onTimeUpdate={(e) => setCurrentTs(e.currentTarget.currentTime)}
              />
              {(phase === "loaded" || phase === "generating") && (
                <BBoxCanvas
                  width={videoBox.w}
                  height={videoBox.h}
                  value={bbox}
                  onChange={setBbox}
                />
              )}
              {phase === "generating" && (
                <div className="ed__scan">
                  <span className="label">generating · veo 3.1</span>
                </div>
              )}
            </div>

            <Timeline tl={timeline} currentTs={currentTs} />
          </section>

          {/* right: controls */}
          <aside className="ed__panel">
            {phase !== "reviewing" && phase !== "accepted" && (
              <>
                <Block title="Window">
                  <div className="ed__window">
                    <Field
                      label="in"
                      value={startTs}
                      min={0}
                      max={Math.max(0, endTs - 0.5)}
                      onChange={setStartTs}
                    />
                    <Field
                      label="out"
                      value={endTs}
                      min={startTs + 0.5}
                      max={project.duration}
                      onChange={setEndTs}
                    />
                  </div>
                  <div className="ed__window-hint label">
                    {(endTs - startTs).toFixed(1)}s segment · veo clip minimum 4s
                  </div>
                </Block>

                <Block title="Region">
                  <p className="ed__hint">
                    {bbox && bbox.w > 0.005
                      ? "Box locked. Draw again to replace."
                      : "Drag across the monitor to frame the subject."}
                  </p>
                  {bbox && bbox.w > 0.005 && (
                    <button
                      className="ed__chip"
                      onClick={() => setBbox(null)}
                    >
                      clear region
                    </button>
                  )}
                </Block>

                <Block title="Prompt">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="what changes? e.g. make the jacket deep cherry red, warm cinematic grade"
                    rows={3}
                  />
                </Block>

                <button
                  className="cta ed__generate"
                  onClick={handleGenerate}
                  disabled={
                    !bbox ||
                    bbox.w < 0.01 ||
                    !prompt.trim() ||
                    phase === "generating"
                  }
                >
                  {phase === "generating" ? "Generating…" : "Generate 3 variants"}
                </button>
              </>
            )}

            {phase === "generating" && job && (
              <VariantShelf job={job} onAccept={handleAccept} />
            )}

            {phase === "reviewing" && job && (
              <VariantShelf job={job} onAccept={handleAccept} />
            )}

            {phase === "accepted" && (
              <Block title="Applied">
                <p className="ed__hint">
                  Variant stitched into timeline. Entity search is running
                  in the background.
                </p>
                <button
                  className="cta ghost"
                  onClick={() => setPhase("loaded")}
                >
                  Next edit
                </button>
              </Block>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}

// ─── small pieces ─────────────────────────────────────────────────────

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="block">
      <h4 className="block__title label">{title}</h4>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        type="number"
        step={0.1}
        value={value.toFixed(2)}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value)))}
      />
    </label>
  );
}

function VariantShelf({
  job,
  onAccept,
}: {
  job: JobResp;
  onAccept: (i: number) => void;
}) {
  const slots: (Variant | null)[] = [0, 1, 2].map((i) => job.variants[i] ?? null);
  return (
    <Block title={`Variants · ${job.status}`}>
      <div className="shelf">
        {slots.map((v, i) => (
          <VariantCard key={i} index={i} v={v} onAccept={() => onAccept(i)} />
        ))}
      </div>
    </Block>
  );
}

function VariantCard({
  index,
  v,
  onAccept,
}: {
  index: number;
  v: Variant | null;
  onAccept: () => void;
}) {
  return (
    <article className={`card ${v ? "card--ready" : "card--pending"}`}>
      <header className="card__head">
        <span className="mono">v{String(index + 1).padStart(2, "0")}</span>
        {v ? (
          <span className="mono card__score">
            {v.visual_coherence ?? "–"}·{v.prompt_adherence ?? "–"}
          </span>
        ) : (
          <span className="mono">developing…</span>
        )}
      </header>
      <div className="card__body">
        {v ? (
          <video src={v.url} muted loop autoPlay playsInline />
        ) : (
          <div className="card__ghost">
            <div className="card__bar" />
          </div>
        )}
      </div>
      <footer className="card__foot">
        <p className="card__desc">
          {v ? v.description || "—" : "awaiting frames"}
        </p>
        <button
          className="card__accept"
          disabled={!v}
          onClick={onAccept}
        >
          accept
        </button>
      </footer>
    </article>
  );
}

function Timeline({ tl, currentTs }: { tl: TimelineResp | null; currentTs: number }) {
  if (!tl) return null;
  const dur = tl.duration || 1;
  return (
    <div className="tl">
      <div className="tl__head">
        <span className="label">timeline</span>
        <span className="label">{tl.segments.length} segments</span>
      </div>
      <div className="tl__track">
        {tl.segments.map((s, i) => (
          <div
            key={i}
            className={`tl__seg tl__seg--${s.source}`}
            style={{
              left: `${(s.start_ts / dur) * 100}%`,
              width: `${((s.end_ts - s.start_ts) / dur) * 100}%`,
            }}
            title={`${s.source} ${s.start_ts.toFixed(1)}–${s.end_ts.toFixed(1)}`}
          />
        ))}
        <div
          className="tl__head-line"
          style={{ left: `${(currentTs / dur) * 100}%` }}
        />
      </div>
      <div className="tl__ticks">
        {Array.from({ length: Math.ceil(dur) + 1 }, (_, i) => (
          <span key={i} style={{ left: `${(i / dur) * 100}%` }} className="mono">
            {i}
          </span>
        ))}
      </div>
    </div>
  );
}

function UploadDrop({ onFile }: { onFile: (f: File) => void }) {
  const inRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`drop ${dragging ? "drop--hot" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      onClick={() => inRef.current?.click()}
    >
      <div className="drop__reticle">
        <span className="mono">push record</span>
        <strong className="drop__big">drop a clip</strong>
        <span className="label">mp4 · mov · ≤ 2 minutes</span>
      </div>
      <input
        ref={inRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}
