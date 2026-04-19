import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import MetallicPaint from './components/MetallicPaint'
import SplitText from './components/SplitText'
import Noise from './components/Noise'
import ScrollFrames from './components/ScrollFrames'
import { Studio } from './pages/Studio'
import { useAuth } from './lib/useAuth'

// iris SVG path — aperture/iris shape
const IRIS_SVG = '/iris-logo.svg'

const ASCII_IRIS = `                               ....
                           ,;;'''';;,                    ,;;;;,
                 ,        ;;'      \`;;,               .,;;;'   ;
              ,;;;       ;;          \`;;,';;;,.     ,%;;'     '
            ,;;,;;       ;;         ,;\`;;;, \`;::.  %%;'
           ;;;,;;;       \`'       ,;;; ;;,;;, \`::,%%;'
           ;;;,;;;,          .,%%%%%'% ;;;;,;;   %;;;
 ,%,.      \`;;;,;;;,    .,%%%%%%%%%'%; ;;;;;,;;  %;;;
;,\`%%%%%%%%%%\`;;,;;'%%%%%%%%%%%%%'%%'  \`;;;;;,;, %;;;
;;;,\`%%%%%%%%%%%,; ..\`%%%%%%%%;'%%%'    \`;;;;,;; %%;;
 \`;;;;;,\`%%%%%,;;/, .. \`"""'',%%%%%      \`;;;;;; %%;;,
    \`;;;;;;;,;;/////,.    ,;%%%%%%%        \`;;;;,\`%%;;
           ;;;/%%%%,%///;;;';%%%%%%,          \`;;;%%;;,
          ;;;/%%%,%%%%%/;;;';;'%%%%%,             \`%%;;
         .;;/%%,%%%%%//;;'  ;;;'%%%%%,             %%;;,
         ;;//%,%%%%//;;;'   \`;;;;'%%%%             \`%;;;
         ;;//%,%//;;;;'      \`;;;;'%%%              %;;;,
         \`;\;//,/;;;'          \`;;;'%%'              \`%;;;
           \`;;;;'               \`;\`%'                \`;;;;
                                  '      .,,,.        \`;;;;
                                      ,;;;;;;;;;;,     \`;;;;
                                     ;;;'    ;;;,;;,    \`;;;;
                                     ;;;      ;;;;,;;.   \`;;;;
                                      \`;;      ;;;;;,;;   ;;;;
                                        \`'      \`;;;;,;;  ;;;;
                                                   \`;;,;, ;;;;
                                                      ;;, ;;;;
                                                        ';;;;;
                                                         ;;;;;
                                                        .;;;;'
                                                       .;;;;'
                                                      ;;;;;'
                                                     ,;;;;'`

const SCRAMBLE_CHARS = '.·:;+*%#@'

function AsciiScramble({ text }: { text: string }) {
  const [display, setDisplay] = useState('')
  const frameRef = useRef<number>(0)

  useEffect(() => {
    const lines = text.split('\n')
    const rows = lines.length
    const cols = Math.max(...lines.map(l => l.length))

    const target: string[][] = lines.map(line => {
      const padded = line.padEnd(cols, ' ')
      return padded.split('')
    })

    // find which cells actually have content (not spaces)
    const contentCells: [number, number][] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (target[r][c] !== ' ') contentCells.push([r, c])
      }
    }

    // start: only content positions get sparse random chars, rest stays empty
    // but scatter them — each content char starts at a random nearby position
    interface Particle { tr: number; tc: number; sr: number; sc: number; ch: string }
    const particles: Particle[] = contentCells.map(([r, c]) => ({
      tr: r, tc: c, // target position
      sr: r + Math.round((Math.random() - 0.5) * 12), // scattered start position
      sc: c + Math.round((Math.random() - 0.5) * 20),
      ch: SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
    }))

    const totalTicks = 60
    let tick = 0

    function render() {
      const progress = tick / totalTicks // 0 to 1

      // build empty grid
      const grid: string[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ' ')
      )

      for (const p of particles) {
        // lerp from scattered position to target
        const r = Math.round(p.sr + (p.tr - p.sr) * progress)
        const c = Math.round(p.sc + (p.tc - p.sc) * progress)

        // clamp to grid bounds
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue

        if (progress > 0.7) {
          // final phase: show real character
          grid[r][c] = target[p.tr][p.tc]
        } else {
          // scramble phase: random char, occasionally flicker to real
          grid[r][c] = Math.random() < progress * 0.3
            ? target[p.tr][p.tc]
            : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        }
      }

      setDisplay(grid.map(row => row.join('')).join('\n'))

      tick++
      if (tick <= totalTicks) {
        frameRef.current = requestAnimationFrame(render)
      } else {
        setDisplay(text)
      }
    }

    // brief pause then start
    const timeout = setTimeout(() => {
      frameRef.current = requestAnimationFrame(render)
    }, 200)

    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(frameRef.current)
    }
  }, [text])

  return (
    <pre className="font-mono text-[4px] sm:text-[5px] md:text-[6px] leading-[1.1] text-white/70 select-none whitespace-pre">
      {display}
    </pre>
  )
}

function Loader({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setTimeout(onComplete, 400)
          return 100
        }
        const increment = prev < 60 ? 3 : prev < 85 ? 2 : 1
        return Math.min(prev + increment, 100)
      })
    }, 30)
    return () => clearInterval(interval)
  }, [onComplete])

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-8"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ascii iris flower — scrambles then resolves */}
      <AsciiScramble text={ASCII_IRIS} />

      {/* progress */}
      <div className="w-[120px] flex flex-col items-center gap-3">
        <div className="w-full h-[1px] bg-white/10 relative overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-white/30"
            style={{ width: `${progress}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>
        <motion.span
          className="font-mono text-[10px] text-white/20 tracking-[0.2em]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {progress}%
        </motion.span>
      </div>
    </motion.div>
  )
}

function Navbar({ onEnter }: { onEnter: () => void }) {
  return (
    <motion.nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/[0.06]"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}
    >
      <span
        className="font-display italic text-[18px]"
        style={{
          background: 'linear-gradient(135deg, #808080, #C0C0C0, #E8E8E8, #C0C0C0, #808080)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        iris
      </span>

      <div className="flex items-center gap-6 font-mono text-[12px]">
        {['product', 'editor', 'about'].map(link => (
          <a
            key={link}
            href={`#${link}`}
            className="text-white/50 hover:text-white transition-colors duration-200"
          >
            {link}
          </a>
        ))}
        <AuthPill />
        <button
          onClick={onEnter}
          className="px-5 py-2 border border-white/15 text-white/80 hover:border-white/30 hover:text-white transition-all duration-200 tracking-[0.05em] cursor-pointer"
        >
          open studio
        </button>
      </div>
    </motion.nav>
  )
}

// ── auth pill ────────────────────────────────────────────────────────
// sits in the navbar. "sign in with google" when anon, avatar + menu when
// authed. keeps state light so it fits the landing aesthetic.
function AuthPill() {
  const { status, user, signInWithGoogle, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  if (status === 'loading') {
    return (
      <span className="text-white/20 text-[11px] tracking-[0.15em]">· · ·</span>
    )
  }

  if (status === 'anon') {
    return (
      <button
        onClick={signInWithGoogle}
        className="group flex items-center gap-2 px-4 py-2 border border-white/15 text-white/70 hover:border-white/35 hover:text-white transition-all duration-200 tracking-[0.05em] cursor-pointer"
      >
        <GoogleGlyph />
        <span>sign in</span>
      </button>
    )
  }

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email ||
    'signed in'
  const avatar = user?.user_metadata?.avatar_url as string | undefined
  const initial = displayName.trim().charAt(0).toUpperCase() || 'i'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex items-center gap-2 pl-1 pr-3 py-1 border border-white/15 hover:border-white/35 transition-all duration-200 cursor-pointer"
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
        ) : (
          <span className="w-6 h-6 grid place-items-center text-[11px] bg-white/5 text-white/80">
            {initial}
          </span>
        )}
        <span className="text-white/70 text-[11px] tracking-[0.08em] max-w-[140px] truncate">
          {displayName.toLowerCase()}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 min-w-[180px] bg-black/90 border border-white/[0.08] backdrop-blur-md text-[11px] font-mono py-1">
          <div className="px-3 py-2 text-white/40 border-b border-white/[0.06] truncate">
            {user?.email}
          </div>
          <button
            onMouseDown={e => { e.preventDefault(); signOut() }}
            className="block w-full text-left px-3 py-2 text-white/70 hover:bg-white/[0.04] hover:text-white transition-colors cursor-pointer"
          >
            sign out
          </button>
        </div>
      )}
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="w-[14px] h-[14px]" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  )
}

function Hero({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-12">
      {/* logo + title side by side, offset left */}
      <div className="flex items-center gap-8 mr-auto ml-[8vw]">
        {/* metallic paint iris logo */}
        <motion.div
          className="w-[220px] h-[220px] shrink-0"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <MetallicPaint
            imageSrc={IRIS_SVG}
            seed={42}
            scale={4}
            patternSharpness={1}
            noiseScale={0.5}
            speed={0.2}
            liquid={0.8}
            brightness={2.2}
            contrast={0.5}
            refraction={0.015}
            blur={0.012}
            chromaticSpread={2}
            fresnel={1.2}
            waveAmplitude={1}
            distortion={0.8}
            contour={0.25}
            lightColor="#ffffff"
            darkColor="#000000"
            tintColor="#c0c0c0"
          />
        </motion.div>

        {/* text block */}
        <div className="flex flex-col gap-5">
          {/* title — thin, wide tracking */}
          <motion.h1
            className="font-display text-[clamp(72px,12vw,160px)] leading-[0.85] font-light"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{
              letterSpacing: '0.35em',
              background: 'linear-gradient(135deg, #808080, #C0C0C0, #E8E8E8, #C0C0C0, #808080)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'shimmer 8s ease-in-out infinite',
            }}
          >
            iris
          </motion.h1>

          {/* subtitle */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            <SplitText
              text="speak your edits into existence"
              className="font-mono text-[12px] text-white/40 tracking-[0.2em]"
              delay={40}
              from={{ opacity: 0, y: 8 }}
              to={{ opacity: 1, y: 0 }}
              threshold={0.1}
              onLetterAnimationComplete={undefined}
            />
          </motion.div>

          {/* cta */}
          <motion.button
            onClick={onEnter}
            className="font-mono text-[11px] px-6 py-2.5 border border-white/15 text-white/60 tracking-[0.1em] hover:border-white/40 hover:text-white transition-all duration-300 w-fit cursor-pointer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            open studio ↗
          </motion.button>
        </div>
      </div>

      {/* scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.6 }}
      >
        <span className="font-mono text-[10px] text-white/20 tracking-[0.2em]">scroll</span>
        <motion.div
          className="w-[1px] h-6 bg-white/20"
          animate={{ scaleY: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>
    </section>
  )
}

export default function App() {
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'landing' | 'studio'>('landing')

  // studio takes the whole screen — render it alone, no landing chrome.
  if (view === 'studio') {
    return <Studio onExit={() => setView('landing')} />
  }

  return (
    <div className="bg-black min-h-screen text-white lowercase">
      {/* noise grain overlay */}
      <div className="fixed inset-0 z-[90] pointer-events-none opacity-[0.04]">
        <Noise
          patternSize={256}
          patternScaleX={1}
          patternScaleY={1}
          patternRefreshInterval={2}
          patternAlpha={15}
        />
      </div>

      {/* loading screen */}
      <AnimatePresence mode="wait">
        {!loaded && <Loader onComplete={() => setLoaded(true)} />}
      </AnimatePresence>

      {/* main content */}
      {loaded && (
        <ScrollFrames dimOpacity={0.45}>
          <Navbar onEnter={() => setView('studio')} />
          <Hero onEnter={() => setView('studio')} />

          {/* more page height so scroll drives the background frames */}
          <section className="h-[200vh] flex items-end justify-center pb-[50vh]">
            <p className="font-mono text-[12px] text-white/20 tracking-[0.15em]">
              more sections coming
            </p>
          </section>
        </ScrollFrames>
      )}
    </div>
  )
}
