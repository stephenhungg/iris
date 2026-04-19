import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import MetallicPaint from './components/MetallicPaint'
import SplitText from './components/SplitText'
import Noise from './components/Noise'
import ScrollFrames from './components/ScrollFrames'
import { Studio } from './pages/Studio'

// iris SVG path
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

    const contentCells: [number, number][] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (target[r][c] !== ' ') contentCells.push([r, c])
      }
    }

    interface Particle { tr: number; tc: number; sr: number; sc: number; ch: string }
    const particles: Particle[] = contentCells.map(([r, c]) => ({
      tr: r, tc: c,
      sr: r + Math.round((Math.random() - 0.5) * 12),
      sc: c + Math.round((Math.random() - 0.5) * 20),
      ch: SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
    }))

    const totalTicks = 60
    let tick = 0

    function render() {
      const progress = tick / totalTicks

      const grid: string[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ' ')
      )

      for (const p of particles) {
        const r = Math.round(p.sr + (p.tr - p.sr) * progress)
        const c = Math.round(p.sc + (p.tc - p.sc) * progress)

        if (r < 0 || r >= rows || c < 0 || c >= cols) continue

        if (progress > 0.7) {
          grid[r][c] = target[p.tr][p.tc]
        } else {
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
      <AsciiScramble text={ASCII_IRIS} />

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

function PillNav({ onStudio }: { onStudio: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > window.innerHeight * 0.8)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            bottom: '24px',
            left: 0,
            right: 0,
            marginLeft: 'auto',
            marginRight: 'auto',
            width: 'fit-content',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            padding: '10px 12px 10px 20px',
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '9999px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
          }}
        >
          {['product', 'editor', 'about'].map(link => (
            <a
              key={link}
              href={`#${link}`}
              style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none', transition: 'color 0.2s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
            >
              {link}
            </a>
          ))}
          <button
            onClick={onStudio}
            style={{
              padding: '8px 20px',
              background: 'rgba(255,255,255,0.9)',
              color: '#000',
              border: 'none',
              borderRadius: '9999px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#fff')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.9)')}
          >
            open studio
          </button>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}

function Hero({ onStudio }: { onStudio: () => void }) {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-12">
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
          <motion.h1
            className="font-display text-[clamp(72px,12vw,160px)] leading-[0.85] font-light"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{
              letterSpacing: '0.35em',
              background: 'linear-gradient(135deg, #808080, #C0C0C0, #E8E8E8, #C0C0C0, #808080)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'shimmer 8s ease-in-out infinite',
              filter: 'drop-shadow(0 0 40px rgba(255,255,255,0.15)) drop-shadow(0 0 80px rgba(255,255,255,0.08))',
            }}
          >
            iris
          </motion.h1>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            <SplitText
              text="speak your edits into existence"
              className="font-mono text-[12px] text-white/40 tracking-[0.2em]"
              delay={40}
              animationFrom={{ opacity: 0, transform: 'translateY(8px)' }}
              animationTo={{ opacity: 1, transform: 'translateY(0)' }}
              threshold={0.1}
            />
          </motion.div>

          <motion.button
            onClick={onStudio}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              padding: '14px 36px',
              border: 'none',
              background: 'linear-gradient(135deg, #808080, #C0C0C0, #E8E8E8, #C0C0C0, #808080)',
              backgroundSize: '200% 100%',
              color: '#000',
              fontWeight: 600,
              letterSpacing: '0.12em',
              cursor: 'pointer',
              transition: 'all 0.3s',
              width: 'fit-content',
              animation: 'shimmer 6s ease-in-out infinite',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = '0 0 30px rgba(255,255,255,0.15)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            open studio
          </motion.button>
        </div>
      </div>

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

function Thesis() {
  return (
    <section
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '120px 48px',
        maxWidth: '900px',
        marginLeft: 'auto',
        marginRight: 'auto',
        gap: '48px',
      }}
    >
      <motion.h2
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(36px, 6vw, 64px)',
          fontWeight: 300,
          lineHeight: 1.1,
          color: '#fff',
        }}
      >
        every video tool makes you choose.{' '}
        <span style={{
          background: 'linear-gradient(135deg, #808080, #C0C0C0, #E8E8E8, #C0C0C0, #808080)',
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          animation: 'shimmer 8s ease-in-out infinite',
        }}>
          generate or edit.
        </span>
        {' '}never both.
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: '16px',
          lineHeight: 1.8,
          color: 'rgba(255,255,255,0.55)',
          maxWidth: '640px',
        }}
      >
        runway generates. premiere edits. neither lets you point at a moment
        in your video and say "change this." iris does. scrub to a frame,
        draw a box, describe what you want. generation is the edit.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div style={{ height: '1px', width: '40px', background: 'rgba(255,255,255,0.15)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'rgba(255,255,255,0.3)',
          letterSpacing: '0.2em',
        }}>
          the prompt is the tool. the timeline is the canvas.
        </span>
      </motion.div>
    </section>
  )
}

export default function App() {
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'landing' | 'studio'>('landing')

  if (view === 'studio') {
    return <Studio onExit={() => setView('landing')} />
  }

  return (
    <div className="bg-black min-h-screen text-white lowercase">
      <div className="fixed inset-0 z-[90] pointer-events-none opacity-[0.04]">
        <Noise
          patternSize={256}
          patternScaleX={1}
          patternScaleY={1}
          patternRefreshInterval={2}
          patternAlpha={15}
        />
      </div>

      <AnimatePresence mode="wait">
        {!loaded && <Loader onComplete={() => setLoaded(true)} />}
      </AnimatePresence>

      {loaded && (
        <ScrollFrames dimOpacity={0.45}>
          <PillNav onStudio={() => setView('studio')} />
          <Hero onStudio={() => setView('studio')} />
          <Thesis />
          <section style={{ height: '100vh' }} />
        </ScrollFrames>
      )}
    </div>
  )
}
