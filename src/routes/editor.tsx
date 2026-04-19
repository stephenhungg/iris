import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Studio } from '../pages/Studio';

function EditorLoader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const i = setInterval(() => {
      setProgress(p => {
        if (p >= 100) { clearInterval(i); setTimeout(onDone, 300); return 100; }
        return Math.min(p + (p < 40 ? 4 : p < 75 ? 3 : 2), 100);
      });
    }, 25);
    return () => clearInterval(i);
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
      }}
    >
      <motion.span
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontFamily: 'var(--font-display, Georgia)',
          fontStyle: 'italic',
          fontSize: '24px',
          background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)',
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'shimmer 4s ease-in-out infinite',
        }}
      >
        iris.
      </motion.span>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
      >
        <div style={{
          width: '160px',
          height: '1px',
          background: 'rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <motion.div
            style={{
              position: 'absolute',
              inset: 0,
              right: 'auto',
              width: `${progress}%`,
              background: 'rgba(255,255,255,0.3)',
            }}
          />
        </div>
        <span style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '10px',
          color: 'rgba(255,255,255,0.2)',
          letterSpacing: '0.15em',
        }}>
          loading editor
        </span>
      </motion.div>
    </motion.div>
  );
}

export function EditorRoute() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  return (
    <>
      <AnimatePresence mode="wait">
        {!ready && <EditorLoader onDone={() => setReady(true)} />}
      </AnimatePresence>

      {ready && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Studio
            onExit={() => navigate('/')}
            onLibrary={() => navigate('/projects')}
            initialProject={
              projectId
                ? { projectId, videoUrl: '', duration: 0, fps: 24 }
                : undefined
            }
          />
        </motion.div>
      )}
    </>
  );
}
