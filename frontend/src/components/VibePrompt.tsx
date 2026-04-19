import { useEffect, useState } from 'react';
import { useEDL, clipAtTime, sourceTimeFor, type Clip } from '../stores/edl';
import { useGenerationSession } from '../hooks/useGenerationSession';
import { GenerationReveal } from '../features/reveal/GenerationReveal';

const HINT_DISMISS_KEY = 'iris.vibe.hintDismissed';

export function VibePrompt() {
  const { state } = useEDL();
  const [lockedContext, setLockedContext] = useState<{
    clip: Clip;
    previewFrameTs: number | null;
  } | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(HINT_DISMISS_KEY) === '1';
  });

  function dismissHint() {
    setHintDismissed(true);
    try {
      window.sessionStorage.setItem(HINT_DISMISS_KEY, '1');
    } catch {
      // sessionStorage can throw in private mode; fine to ignore
    }
  }

  // get the clip at current playhead
  const hit = clipAtTime(state.clips, state.playhead);
  const clip = hit?.clip ?? null;
  const previewFrameTs =
    hit && clip
      ? sourceTimeFor(hit.clip, hit.offsetInClip)
      : clip
        ? (clip.sourceStart + clip.sourceEnd) / 2
        : null;

  const activeClip = lockedContext?.clip ?? clip;
  const activePreviewFrameTs = lockedContext?.previewFrameTs ?? previewFrameTs;
  const session = useGenerationSession({
    clip: activeClip,
    bbox: state.bbox,
    previewFrameTs: activePreviewFrameTs,
  });
  const activeSession =
    session.busy || session.variants.length > 0 || session.acceptingIdx != null;

  useEffect(() => {
    if (!activeSession) {
      setLockedContext(null);
    }
  }, [activeSession]);

  async function runReveal() {
    if (!clip || clip.kind !== 'source' || !clip.projectId) return false;
    setLockedContext({ clip, previewFrameTs });
    return session.run();
  }

  async function acceptReveal(idx: number) {
    const accepted = await session.acceptVariant(idx);
    if (accepted) {
      setLockedContext(null);
    }
    return accepted;
  }

  function clearReveal() {
    setLockedContext(null);
    session.clearSession();
  }

  if (!activeClip || activeClip.kind !== 'source' || !activeClip.projectId) {
    if (hintDismissed) return null;
    return (
      <div className="reveal-host reveal-host--floating">
        <div className="reveal reveal--floating">
          <button
            type="button"
            className="reveal__dismiss mono"
            aria-label="dismiss vibe mode hint"
            title="dismiss hint"
            onClick={dismissHint}
          >
            ×
          </button>
          <div className="reveal__composer">
            <div className="reveal__heading">
              <div>
                <p className="reveal__eyebrow mono">vibe mode</p>
                <h3 className="reveal__title">park on a source clip to start an ai pass</h3>
              </div>
            </div>
            <div className="reveal__context">
              <div className="reveal__context-pill">
                <span className="reveal__context-k mono">hint</span>
                <span className="reveal__context-v">
                  pause playback on the moment you want, then write the change you want to see
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reveal-host reveal-host--floating">
      <GenerationReveal
        clip={activeClip}
        bbox={state.bbox}
        entity={state.identified}
        identifying={state.identifying}
        layout="floating"
        session={{
          ...session,
          run: runReveal,
          acceptVariant: acceptReveal,
          clearSession: clearReveal,
        }}
      />
    </div>
  );
}
