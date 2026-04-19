import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { generate, pollJob, accept, type Variant, type JobResp } from '../api/client';
import { duration, newClip, useEDL, clipAtTime } from '../stores/edl';

export function VibePrompt() {
  const { state, dispatch } = useEDL();
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [variants, setVariants] = useState<Variant[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // get the clip at current playhead
  const hit = clipAtTime(state.clips, state.playhead);
  const clip = hit?.clip ?? null;
  const canGenerate = !!clip && clip.kind === 'source' && !!clip.projectId && !!prompt.trim() && !busy;

  async function run() {
    if (!canGenerate || !clip || !clip.projectId) return;
    setBusy(true);
    setErr(null);
    setStatus('queued');
    setVariants([]);
    try {
      const { job_id } = await generate({
        project_id: clip.projectId,
        start_ts: clip.sourceStart,
        end_ts: clip.sourceEnd,
        bbox: state.bbox ?? { x: 0, y: 0, w: 1, h: 1 },
        prompt: prompt.trim(),
        reference_frame_ts: (clip.sourceStart + clip.sourceEnd) / 2,
      });
      jobIdRef.current = job_id;
      const final: JobResp = await pollJob(job_id, (j) => setStatus(j.status));
      if (final.status !== 'done' || !final.variants.length) {
        throw new Error(final.error || 'generation failed');
      }
      setVariants(final.variants);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  async function pickVariant(idx: number) {
    if (!clip || !clip.projectId || !jobIdRef.current) return;
    try {
      try { await accept(jobIdRef.current, idx); } catch {}
      const v = variants[idx];
      const genDur = clip.sourceEnd - clip.sourceStart;
      const replacement = newClip({
        url: v.url,
        sourceStart: 0,
        sourceEnd: genDur,
        mediaDuration: genDur,
        kind: 'generated',
        label: prompt.trim().slice(0, 28) || 'ai edit',
        projectId: clip.projectId,
        generatedFromClipId: clip.id,
        volume: clip.volume,
      });
      dispatch({ type: 'replace', id: clip.id, with: replacement });
      setPrompt('');
      setVariants([]);
      jobIdRef.current = null;
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px',
      width: 'min(600px, 90vw)',
    }}>
      {/* variant cards */}
      <AnimatePresence>
        {variants.length > 0 && !busy && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            style={{
              display: 'flex',
              gap: '8px',
              width: '100%',
            }}
          >
            {variants.map((v, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                onClick={() => pickVariant(i)}
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.8)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  color: '#fff',
                  textAlign: 'left',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
                  e.currentTarget.style.transform = 'translateY(-4px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <video
                  src={v.url}
                  muted loop playsInline
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: '4px', marginBottom: '6px' }}
                  onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play()}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLVideoElement; el.pause(); el.currentTime = 0; }}
                />
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px', color: 'rgba(255,255,255,0.5)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{String.fromCharCode(65 + i)}</span>
                  <span>{v.description?.slice(0, 30)}</span>
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* error */}
      {err && (
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', color: '#ef4444', background: 'rgba(0,0,0,0.8)', padding: '8px 16px', borderRadius: '8px' }}>
          {err}
        </div>
      )}

      {/* prompt bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '9999px',
        padding: '6px 6px 6px 20px',
      }}>
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canGenerate) run(); }}
          placeholder={clip ? 'describe the change...' : 'select a clip first'}
          disabled={busy || !clip}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#fff',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '13px',
            letterSpacing: '0.02em',
          }}
        />
        <button
          onClick={run}
          disabled={!canGenerate}
          style={{
            padding: '10px 24px',
            borderRadius: '9999px',
            border: 'none',
            background: canGenerate ? '#fff' : 'rgba(255,255,255,0.1)',
            color: canGenerate ? '#000' : 'rgba(255,255,255,0.3)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
          }}
        >
          {busy ? status || 'generating...' : 'generate'}
        </button>
      </div>

      {/* hint text */}
      {!clip && state.clips.length > 0 && (
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
          pause the video and click a moment to select it
        </span>
      )}
    </div>
  );
}
