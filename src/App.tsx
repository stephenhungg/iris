import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react'
import gsap from 'gsap'
import Lenis from 'lenis'
import MetallicPaint from './components/MetallicPaint'
import Noise from './components/Noise'
import ScrollFrames from './components/ScrollFrames'
import { useAuth } from './lib/useAuth'
import { listProjects, type ProjectListItem } from './api/client'

const IRIS_SVG = '/iris-logo.svg'

// motion design system (lottiefiles + framerlabs + palmer)
//
// archetype: PREMIUM — elegant, minimal, luxury
// signature easing: cubic-bezier(0.4, 0, 0.2, 1) — 80% of animations
// enter > exit rule: entrances 30-50% longer than exits
// three layers: primary + secondary + ambient
// never opacity-only for important state changes
//
const EASE = {
  // industry standards
  premium: [0.4, 0, 0.2, 1] as const,       // material design 3 — default
  emphasized: [0.05, 0.7, 0.1, 1] as const,  // MD3 — entrances, attention
  accelerate: [0.3, 0, 1, 1] as const,       // MD3 — exits, dismissals
  // framerlabs
  popUp: [0, 0, 0.39, 2.99] as const,        // natural overshoot, no elastic
  settle: [0.25, 0.46, 0.45, 0.94] as const, // smooth settle
  // palmer
  sharp: [0.82, 0.08, 0.29, 1] as const,
}

// duration palette (premium archetype: 350-600ms)
const DUR = {
  micro: 0.1,     // tooltip, feedback
  quick: 0.18,    // button press, toggle
  standard: 0.35, // card enter, icon
  slow: 0.5,      // modal, page transition
  dramatic: 0.8,  // hero reveal
}

// stagger budget: dramatic 100-200ms, total under 600ms
const STAGGER = {
  micro: 0.03,    // list items
  standard: 0.07, // cards, panels
  dramatic: 0.15, // hero sections
}

const SPRING = {
  magnetic: { type: 'spring' as const, stiffness: 1000, damping: 100 },
}

// ── loader ──────────────────────────────────────────────────────────

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

const SCRAMBLE = '.·:;+*%#@'

function AsciiScramble({ text }: { text: string }) {
  const [display, setDisplay] = useState('')
  const f = useRef<number>(0)
  useEffect(() => {
    const lines = text.split('\n'), rows = lines.length, cols = Math.max(...lines.map(l => l.length))
    const target = lines.map(l => l.padEnd(cols, ' ').split(''))
    const content: [number, number][] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (target[r][c] !== ' ') content.push([r, c])
    const pts = content.map(([r, c]) => ({ tr: r, tc: c, sr: r + Math.round((Math.random() - .5) * 12), sc: c + Math.round((Math.random() - .5) * 20) }))
    let tick = 0; const total = 60
    function render() {
      const p = tick / total
      const grid = Array.from({ length: rows }, () => Array(cols).fill(' '))
      for (const pt of pts) {
        const r = Math.round(pt.sr + (pt.tr - pt.sr) * p), c = Math.round(pt.sc + (pt.tc - pt.sc) * p)
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue
        grid[r][c] = p > .7 ? target[pt.tr][pt.tc] : Math.random() < p * .3 ? target[pt.tr][pt.tc] : SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]
      }
      setDisplay(grid.map(r => r.join('')).join('\n'))
      tick++; if (tick <= total) f.current = requestAnimationFrame(render); else setDisplay(text)
    }
    const t = setTimeout(() => { f.current = requestAnimationFrame(render) }, 200)
    return () => { clearTimeout(t); cancelAnimationFrame(f.current) }
  }, [text])
  return <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '5px', lineHeight: 1.1, color: 'rgba(255,255,255,0.7)', userSelect: 'none', whiteSpace: 'pre' }}>{display}</pre>
}

function Loader({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0)

  // scroll lock during loader (framerlabs pattern)
  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.scrollTo(0, 0)
    return () => { document.body.style.overflow = orig }
  }, [])

  useEffect(() => {
    const i = setInterval(() => {
      setProgress(p => { if (p >= 100) { clearInterval(i); setTimeout(onComplete, 400); return 100 } return Math.min(p + (p < 60 ? 3 : p < 85 ? 2 : 1), 100) })
    }, 30); return () => clearInterval(i)
  }, [onComplete])
  return (
    <motion.div exit={{ opacity: 0 }} transition={{ duration: DUR.standard, ease: EASE.accelerate }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '32px' }}>
      <AsciiScramble text={ASCII_IRIS} />
      <div style={{ width: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, right: 'auto', width: `${progress}%`, background: 'rgba(255,255,255,0.3)' }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em' }}>{progress}%</span>
      </div>
    </motion.div>
  )
}

// ── magnetic wrapper (framerlabs pattern) ────────────────────────────

function Magnetic({ children, intensity = 0.3 }: { children: React.ReactNode; intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    setPos({ x: (e.clientX - cx) * intensity, y: (e.clientY - cy) * intensity })
  }

  const handleLeave = () => setPos({ x: 0, y: 0 })

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: 'spring', stiffness: 1000, damping: 100 }}
      style={{ display: 'inline-block' }}
    >
      {children}
    </motion.div>
  )
}

// ── pill nav ────────────────────────────────────────────────────────

function PillNav({ onStudio }: { onStudio: () => void }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    setShow(true) // always visible
    const fn = () => setShow(true)
    window.addEventListener('scroll', fn, { passive: true }); return () => window.removeEventListener('scroll', fn)
  }, [])
  return (
    <AnimatePresence>
      {show && (
        <motion.nav data-intro="nav" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={{ duration: DUR.slow, ease: EASE.premium }}
          style={{ position: 'fixed', bottom: '24px', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', width: 'fit-content', zIndex: 50, display: 'flex', alignItems: 'center', gap: '24px', padding: '10px 12px 10px 24px', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {['product', 'editor', 'about'].map(l => (
            <a key={l} href={`#${l}`} style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}>{l}</a>
          ))}
          <AuthChip />
          <Magnetic intensity={0.25}>
            <button onClick={onStudio} style={{ padding: '8px 20px', background: '#fff', color: '#000', border: 'none', borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', cursor: 'pointer', transition: 'transform 0.2s' }}>open studio</button>
          </Magnetic>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}

// ── auth chip ────────────────────────────────────────────────────────
// compact sign-in / signed-in indicator. sits in the pill nav + hero top bar.

function GoogleGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden style={{ display: 'block' }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.4 0-9.9-3.4-11.3-8.1l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41.8 35.8 44 30.3 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  )
}

function AuthChip() {
  const { status, user, signInWithGoogle, signOut } = useAuth()
  const [hover, setHover] = useState(false)

  if (status === 'loading') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.3)', animation: 'pulse 1.4s ease-in-out infinite' }} />
        loading
      </span>
    )
  }

  if (status === 'anon') {
    return (
      <button onClick={signInWithGoogle}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 14px', background: 'transparent', color: hover ? '#fff' : 'rgba(255,255,255,0.55)', border: '1px solid ' + (hover ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)'), borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', cursor: 'pointer', transition: 'all 0.2s' }}>
        <GoogleGlyph />
        sign in
      </button>
    )
  }

  const name = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0]?.toLowerCase()
    || user?.email?.split('@')[0]?.toLowerCase()
    || 'you'
  const truncated = name.length > 14 ? name.slice(0, 14) + '…' : name

  return (
    <button onClick={signOut}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title="sign out"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px 6px 6px', background: 'rgba(255,255,255,0.06)', color: hover ? '#fff' : 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', cursor: 'pointer', transition: 'all 0.2s' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg, #707070, #E0E0E0)', color: '#000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' }}>
        {name[0]}
      </span>
      {hover ? 'sign out' : truncated}
    </button>
  )
}

// ── hero ─────────────────────────────────────────────────────────────

function Hero({ onStudio }: { onStudio: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0])
  const y = useTransform(scrollYProgress, [0, 0.5], [0, -100])

  return (
    <section ref={ref} style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 64px', overflow: 'hidden', willChange: 'transform' }}>
      {/* scattered preview images — controlled by GSAP intro timeline */}
      <img data-intro="hero-images" src="/frames/frame_045.jpg" alt=""
        style={{ position: 'absolute', top: '12%', right: '8%', width: '200px', height: '130px', objectFit: 'cover', transform: 'rotate(2deg)', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 0, opacity: 0 }} />
      <img data-intro="hero-images" src="/frames/frame_080.jpg" alt=""
        style={{ position: 'absolute', top: '58%', left: '3%', width: '160px', height: '100px', objectFit: 'cover', transform: 'rotate(-3deg)', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 0, opacity: 0 }} />
      <img data-intro="hero-images" src="/frames/frame_120.jpg" alt=""
        style={{ position: 'absolute', top: '40%', right: '4%', width: '180px', height: '120px', objectFit: 'cover', transform: 'rotate(1deg)', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 0, opacity: 0 }} />

      <motion.div style={{ opacity, y }}>
        {/* top bar — chrome, hidden initially */}
        <div data-intro="chrome"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px', opacity: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>iris®</span>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
              {['v0.1', '2026', 'cal hacks'].map((tag, i) => (
                <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.12)' }}>{tag}</span>
              ))}
            </div>
          </div>
          <div data-intro="chrome" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', textAlign: 'right', lineHeight: 1.6, opacity: 0 }}>
            ai-powered video editor<br />speak your edits into existence
          </div>
        </div>

        {/* title — centered on screen during intro, settles into layout after */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', width: '100%', marginBottom: '48px' }}>
          {/* metallic paint logo — appears after title reveal */}
          <div data-intro="metallic"
            style={{ width: 'clamp(80px, 12vw, 200px)', height: 'clamp(80px, 12vw, 200px)', flexShrink: 0, opacity: 0, marginRight: 'clamp(16px, 3vw, 40px)', willChange: 'transform', transform: 'translateZ(0)', backfaceVisibility: 'hidden' }}>
            <MetallicPaint imageSrc={IRIS_SVG} seed={42} scale={4} patternSharpness={1} noiseScale={0.5} speed={0.2} liquid={0.8} brightness={2.2} contrast={0.5} refraction={0.015} blur={0.012} chromaticSpread={2} fresnel={1.2} waveAmplitude={1} distortion={0.8} contour={0.25} lightColor="#ffffff" darkColor="#000000" tintColor="#c0c0c0" />
          </div>

          {/* dual-layer text for wipe reveal */}
          <div style={{ position: 'relative' }}>
            <h1 data-intro="logo-dark"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 200, fontSize: 'clamp(80px, 12vw, 200px)', lineHeight: 0.85, letterSpacing: '0.25em', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 8s ease-in-out infinite', filter: 'drop-shadow(0 0 60px rgba(255,255,255,0.08))' }}>
              iris.
            </h1>
          </div>
        </div>

        {/* bottom row */}
        <div data-intro="chrome"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '40px', alignItems: 'end', opacity: 0 }}>
          <div style={{ maxWidth: '320px' }}>
            <p data-intro="subtext" style={{ fontFamily: 'var(--font-body)', fontSize: '14px', lineHeight: 1.7, color: 'rgba(255,255,255,0.4)', opacity: 0, marginBottom: '6px' }}>
              point at a moment.
            </p>
            <p data-intro="subtext" style={{ fontFamily: 'var(--font-body)', fontSize: '14px', lineHeight: 1.7, color: 'rgba(255,255,255,0.4)', opacity: 0, marginBottom: '6px' }}>
              say what changes.
            </p>
            <p data-intro="subtext" style={{ fontFamily: 'var(--font-body)', fontSize: '14px', lineHeight: 1.7, color: 'rgba(255,255,255,0.4)', opacity: 0 }}>
              reality rewrites itself.
            </p>
          </div>
          <div>
            <Magnetic intensity={0.2}>
              <button onClick={onStudio} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '16px 40px', border: 'none', width: 'fit-content', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', color: '#000', fontWeight: 600, letterSpacing: '0.1em', cursor: 'pointer', animation: 'shimmer 6s ease-in-out infinite', transition: 'box-shadow 0.3s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 40px rgba(255,255,255,0.12)')} onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>open studio</button>
            </Magnetic>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.15)', lineHeight: 2, textAlign: 'right' }}>
            <div>prompt-driven editing</div><div>causal entity tracking</div><div>powered by gemini + veo</div>
          </div>
        </div>
      </motion.div>

      <div data-intro="chrome" style={{ position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.12)', letterSpacing: '0.2em' }}>scroll</span>
        <motion.div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.12)' }} animate={{ scaleY: [1, 0.4, 1] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }} />
      </div>
    </section>
  )
}

// ── scroll reveal ──────────────────────────────────────────────────
// scroll-linked opacity+y, replaces whileInView to eliminate lenis/IO flicker

function ScrollReveal({ children, y: yOffset = 30, className, style, as: Tag = 'div', delay = 0 }: {
  children: React.ReactNode
  y?: number
  className?: string
  style?: React.CSSProperties
  as?: 'div' | 'section' | 'p' | 'h2'
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end 80%'],  // animate as element crosses bottom 20% of viewport
  })

  // map scroll progress to opacity and y — with optional delay (shifts the active range)
  const clampedProgress = useTransform(scrollYProgress, [delay, Math.min(delay + 0.6, 1)], [0, 1], { clamp: true })
  const opacity = useTransform(clampedProgress, [0, 1], [0, 1])
  const yVal = useTransform(clampedProgress, [0, 1], [yOffset, 0])

  const MotionTag = motion[Tag] as typeof motion.div

  return (
    <MotionTag ref={ref} className={className} style={{ ...style, opacity, y: yVal }}>
      {children}
    </MotionTag>
  )
}

// ── marquee ─────────────────────────────────────────────────────────

function Marquee() {
  const text = 'scrub · select · prompt · transform · '.repeat(10)
  return (
    <ScrollReveal y={0}
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '24px 0' }}>
      <motion.div animate={{ x: [0, -3000] }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'inline-block', fontFamily: 'var(--font-display)', fontSize: 'clamp(60px, 8vw, 100px)', fontWeight: 300, letterSpacing: '-0.02em', color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.1)' }}>{text}</motion.div>
    </ScrollReveal>
  )
}

// ── thesis ──────────────────────────────────────────────────────────

const STEPS = [
  { num: '01', label: 'scrub', desc: 'navigate your timeline to find the exact moment you want to change' },
  { num: '02', label: 'select', desc: 'draw a bounding box around the region of interest in the frame' },
  { num: '03', label: 'prompt', desc: 'describe the transformation in natural language' },
  { num: '04', label: 'transform', desc: 'ai generates variants. pick one. reality rewrites itself.' },
]

function Thesis() {
  return (
    <section style={{ position: 'relative', padding: '200px 64px 160px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* decorative section number */}
      <div style={{ position: 'absolute', top: '80px', right: '0', fontFamily: 'var(--font-display)', fontSize: '300px', fontWeight: 300, color: '#fff', opacity: 0.03, lineHeight: 1, pointerEvents: 'none', userSelect: 'none' }}>01</div>

      {/* scattered images — low target opacity, so just use inline style fade */}
      <img src="/frames/frame_040.jpg" alt=""
        style={{ position: 'absolute', top: '10%', right: '6%', width: '240px', height: '160px', objectFit: 'cover', rotate: '-1deg', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 1, opacity: 0.25 }} />
      <img src="/frames/frame_110.jpg" alt=""
        style={{ position: 'absolute', bottom: '12%', left: '2%', width: '200px', height: '140px', objectFit: 'cover', rotate: '2deg', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 1, opacity: 0.2 }} />

      <ScrollReveal y={0}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '40px' }}>© iris — 001 / about</ScrollReveal>

      <ScrollReveal as="h2" y={-40}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(48px, 8vw, 128px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '0' }}>
        generation<br /><span style={{ fontStyle: 'italic', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 8s ease-in-out infinite' }}>is the edit.</span>
      </ScrollReveal>

      {/* divider line */}
      <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)', margin: '40px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '120px' }}>
        <div>
          <ScrollReveal as="p"
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', lineHeight: 1.8, color: 'rgba(255,255,255,0.35)', marginBottom: '32px' }}>
            runway generates video from nothing. premiere edits footage frame by frame. neither lets you point at a specific moment and say "make this different."
          </ScrollReveal>
          <ScrollReveal as="p" delay={0.1}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', lineHeight: 1.8, color: 'rgba(255,255,255,0.35)', marginBottom: '48px' }}>
            iris merges both into one action. scrub to a frame, draw a box, describe the change. the ai generates multiple interpretations. you pick one. it replaces that segment in your timeline.
          </ScrollReveal>
          <ScrollReveal y={0} delay={0.2}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' }}>
            {[{ val: '3×', label: 'variants per edit' }, { val: '40s', label: 'to transform' }, { val: '∞', label: 'iterations' }].map((s, i) => (
              <div key={i} style={{ cursor: 'default', transition: 'transform 0.3s, text-shadow 0.3s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; const valEl = e.currentTarget.querySelector('[data-stat-val]') as HTMLElement | null; if (valEl) { valEl.style.color = '#fff'; valEl.style.textShadow = '0 0 40px rgba(255,255,255,0.15)' } }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; const valEl = e.currentTarget.querySelector('[data-stat-val]') as HTMLElement | null; if (valEl) { valEl.style.color = '#fff'; valEl.style.textShadow = 'none' } }}>
                <div data-stat-val="" style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', marginBottom: '4px', transition: 'color 0.3s, text-shadow 0.3s' }}>{s.val}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>{s.label}</div>
              </div>
            ))}
          </ScrollReveal>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {STEPS.map((s, i) => (
            <ScrollReveal key={s.num} delay={i * 0.08}
              style={{ padding: '28px 0', cursor: 'default', borderBottom: '1px solid rgba(255,255,255,0.06)', transition: 'all 0.3s' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px', marginBottom: '8px' }}
                onMouseEnter={e => { const p = e.currentTarget.parentElement!; p.style.paddingLeft = '16px'; p.style.borderColor = 'rgba(255,255,255,0.15)'; const num = p.querySelector('[data-step-num]') as HTMLElement | null; if (num) num.style.color = 'rgba(255,255,255,0.5)' }}
                onMouseLeave={e => { const p = e.currentTarget.parentElement!; p.style.paddingLeft = '0'; p.style.borderColor = 'rgba(255,255,255,0.06)'; const num = p.querySelector('[data-step-num]') as HTMLElement | null; if (num) num.style.color = 'rgba(255,255,255,0.15)' }}>
                <span data-step-num="" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', minWidth: '20px', transition: 'color 0.3s' }}>{s.num}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em' }}>{s.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, paddingLeft: '40px' }}>{s.desc}</div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── features ────────────────────────────────────────────────────────

const FEATURE_FRAMES = ['/frames/frame_100.jpg', '/frames/frame_060.jpg', '/frames/frame_030.jpg', '/frames/frame_090.jpg']

function Features() {
  return (
    <section style={{ padding: '160px 64px', maxWidth: '1200px', margin: '0 auto' }}>
      <ScrollReveal y={0}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '40px' }}>© iris — 002 / capabilities</ScrollReveal>

      <ScrollReveal as="h2" y={-40}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(40px, 6vw, 96px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '80px' }}>
        blending <span style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>intelligence</span><br />with intention.
      </ScrollReveal>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
        {[
          { title: 'causal editing', desc: 'change something once. iris finds every other frame where that entity appears and offers a continuity pack of consistent replacements.', label: 'entity tracking' },
          { title: 'creative director', desc: 'describe a vibe. gemini interprets your intent into structured edit plans with tone, color grading, and spatial awareness.', label: 'gemini ai' },
          { title: 'before / after', desc: 'the transformation is the product. wipe between original and generated variants instantly. the reveal is the magic trick.', label: 'comparison' },
          { title: 'voice narration', desc: "elevenlabs generates cinematic voiceover for your reveals. the transformation doesn't just look different. it sounds different.", label: 'elevenlabs' },
        ].map((f, i) => (
          <ScrollReveal key={i} delay={i * 0.08}
            style={{ padding: '48px 40px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)', cursor: 'default', transition: 'background 0.3s, border-color 0.3s' }}
            className="feature-card">
            <div data-feature-img="" style={{ width: '100%', height: '120px', background: `url(${FEATURE_FRAMES[i]}) center/cover`, opacity: 0.15, marginBottom: '16px', borderRadius: '2px', transition: 'opacity 0.3s' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', marginBottom: '16px' }}>{f.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', marginBottom: '12px' }}>{f.title}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.7 }}>{f.desc}</div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  )
}

// ── social proof ───────────────────────────────────────────────────

const TESTIMONIALS = [
  {
    quote: 'the gap between "i want this different" and "this is different" has never been this small.',
    name: 'hackathon judge',
    role: 'cal hacks xi',
    code: 'T-01',
  },
  {
    quote: 'point, describe, done. everything else is just software catching up.',
    name: 'beta tester',
    role: 'filmmaker',
    code: 'T-02',
  },
  {
    quote: 'the wipe reveal is the product. the transformation is the magic trick.',
    name: 'early user',
    role: 'content creator',
    code: 'T-03',
  },
]

function SocialProof() {
  return (
    <section style={{ padding: '160px 64px', maxWidth: '1200px', margin: '0 auto' }}>
      <ScrollReveal y={0}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '64px' }}>© iris — 003 / signal</ScrollReveal>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {TESTIMONIALS.map((t, i) => (
          <ScrollReveal key={i} delay={i * 0.1}
            style={{ padding: '48px 0', paddingRight: i < 2 ? '40px' : '0', paddingLeft: i > 0 ? '40px' : '0', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '20px', lineHeight: 1.5, color: 'rgba(255,255,255,0.5)', marginBottom: '32px' }}>
              &ldquo;{t.quote}&rdquo;
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>{t.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>{t.role}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.08)', letterSpacing: '0.15em' }}>{t.code}</span>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  )
}

// ── tech strip ──────────────────────────────────────────────────────

const TECH = [
  { name: 'gemini 2.5 pro', role: 'intelligence', code: '01' },
  { name: 'veo 3.1',        role: 'generation',   code: '02' },
  { name: 'elevenlabs',     role: 'voice',         code: '03' },
  { name: 'sam2',           role: 'tracking',      code: '04' },
  { name: 'vultr gpu',      role: 'compute',       code: '05' },
]

function TechStrip() {
  return (
    <ScrollReveal as="section" y={0}
      style={{ padding: '80px 64px', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'center', gap: '0' }}>
      {TECH.map((t, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '0 40px', borderRight: i < TECH.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', cursor: 'default', transition: 'all 0.3s' }}
          onMouseEnter={e => { const name = e.currentTarget.querySelector('[data-tech-name]') as HTMLElement | null; if (name) name.style.color = 'rgba(255,255,255,0.7)' }}
          onMouseLeave={e => { const name = e.currentTarget.querySelector('[data-tech-name]') as HTMLElement | null; if (name) name.style.color = 'rgba(255,255,255,0.3)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.08)', letterSpacing: '0.15em' }}>{t.code}</span>
          <span data-tech-name="" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', transition: 'color 0.3s' }}>{t.name}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em' }}>{t.role}</span>
        </div>
      ))}
    </ScrollReveal>
  )
}

// ── cta ─────────────────────────────────────────────────────────────

function CTA({ onStudio }: { onStudio: () => void }) {
  return (
    <section style={{ padding: '200px 64px', textAlign: 'center' }}>
      <ScrollReveal y={0}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '64px' }}>© iris — 004 / rewrite</ScrollReveal>

      {/* decorative frame strip */}
      <ScrollReveal y={0}
        style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginBottom: '64px' }}>
        {['/frames/frame_020.jpg', '/frames/frame_070.jpg', '/frames/frame_130.jpg'].map((src, i) => (
          <img key={i} src={src} alt="" style={{ width: '300px', height: '180px', objectFit: 'cover', opacity: 0.2, border: '1px solid rgba(255,255,255,0.06)' }} />
        ))}
      </ScrollReveal>

      <ScrollReveal as="h2" y={-40}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(48px, 8vw, 128px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '32px' }}>
        rewrite <span style={{ fontStyle: 'italic' }}>reality.</span>
      </ScrollReveal>
      <ScrollReveal as="p" y={0} delay={0.1}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginBottom: '48px' }}>
        start editing with prompts, not tools.
      </ScrollReveal>
      <ScrollReveal delay={0.2}>
        <Magnetic intensity={0.2}>
          <button onClick={onStudio}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', padding: '18px 56px', border: 'none', background: '#fff', color: '#000', fontWeight: 600, letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.3s' }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 60px rgba(255,255,255,0.15)')} onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>open studio</button>
        </Magnetic>
      </ScrollReveal>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', marginTop: '20px' }}>
        no account required · free during beta
      </div>
    </section>
  )
}

// ── footer ──────────────────────────────────────────────────────────

function Footer() {
  const footerLinks: Record<string, string[]> = {
    product: ['editor', 'pricing', 'changelog'],
    resources: ['docs', 'api', 'github'],
    company: ['about', 'twitter', 'contact'],
  }

  return (
    <footer style={{ position: 'relative', padding: '120px 64px 60px', borderTop: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      {/* ghost watermark */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontFamily: 'var(--font-display)', fontSize: 'clamp(120px, 20vw, 300px)', fontWeight: 300, color: '#fff', opacity: 0.03, pointerEvents: 'none', userSelect: 'none', letterSpacing: '-0.03em' }}>iris</div>

      {/* closing philosophy */}
      <ScrollReveal as="p" y={0}
        style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 'clamp(20px, 3vw, 36px)', color: 'rgba(255,255,255,0.12)', lineHeight: 1.1, marginBottom: '64px' }}>
        the edit is the story.
      </ScrollReveal>

      {/* link grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', maxWidth: '480px', paddingBottom: '40px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '40px' }}>
        {Object.entries(footerLinks).map(([heading, links]) => (
          <div key={heading}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.15em', marginBottom: '12px' }}>{heading}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {links.map(link => (
                <a key={link} href="#" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.3)', textDecoration: 'none', transition: 'color 0.2s' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.6)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>{link}</a>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* bottom row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '16px', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>iris®</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.08)', letterSpacing: '0.15em' }}>© iris — fin</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em' }}>© 2026 · built at cal hacks</span>
      </div>
    </footer>
  )
}

// ── app ─────────────────────────────────────────────────────────────

function useIntroTimeline() {
  const runIntro = useCallback(() => {

    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } })

    // phase 1: ascii loader (handled by React state, not GSAP)
    // phase 2: hero reveal (GSAP takes over after loader completes)

    // simple fade in. everything at once. 1 second.
    gsap.set('[data-intro="logo-dark"]', { opacity: 0 })
    gsap.set('[data-intro="metallic"]', { opacity: 0 })
    gsap.set('[data-intro="chrome"]', { opacity: 0 })
    gsap.set('[data-intro="subtext"]', { opacity: 0 })
    gsap.set('[data-intro="hero-images"]', { opacity: 0 })
    gsap.set('[data-intro="nav"]', { opacity: 0 })

    // 1. iris text first
    tl.to('[data-intro="logo-dark"], [data-intro="metallic"]', {
      opacity: 1,
      duration: 0.8,
      ease: 'power2.out',
    })

    // 2. background images
    .to('[data-intro="hero-images"]', {
      opacity: 0.35,
      duration: 0.8,
      ease: 'power2.out',
    }, '-=0.3')

    // 3. text + chrome
    .to('[data-intro="chrome"], [data-intro="subtext"]', {
      opacity: 1,
      duration: 0.6,
      ease: 'power2.out',
    }, '-=0.3')

    // 4. nav last — slides up from below
    .to('[data-intro="nav"]', {
      opacity: 1,
      y: 0,
      duration: 0.8,
      ease: 'power2.out',
    }, '-=0.1')

  }, [])

  return runIntro
}

export default function App() {
  const [loaderDone, setLoaderDone] = useState(false)
  const runIntro = useIntroTimeline()
  const navigate = useNavigate()
  const { status } = useAuth()

  // weighted smooth scroll (framer-style inertia)
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.4,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 1.5,
      infinite: false,
    })
    function raf(time: number) { lenis.raf(time); requestAnimationFrame(raf) }
    requestAnimationFrame(raf)
    return () => lenis.destroy()
  }, [])

  useEffect(() => {
    if (!loaderDone) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { runIntro() })
    })
  }, [loaderDone, runIntro])

  const goStudio = useCallback(async () => {
    if (status !== 'authed') {
      navigate('/editor')
      return
    }
    try {
      const items: ProjectListItem[] = await listProjects()
      if (items.length === 0) {
        navigate('/editor')
      } else {
        navigate('/projects')
      }
    } catch {
      navigate('/editor')
    }
  }, [status, navigate])

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', textTransform: 'lowercase' }}>
      {/* ascii flower loader */}
      <AnimatePresence mode="wait">
        {!loaderDone && <Loader onComplete={() => setLoaderDone(true)} />}
      </AnimatePresence>

      {/* noise */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none', opacity: 0.035 }}>
        <Noise patternSize={256} patternScaleX={1} patternScaleY={1} patternRefreshInterval={2} patternAlpha={15} />
      </div>

      <ScrollFrames dimOpacity={0.4}>
        <PillNav onStudio={goStudio} />
        <Hero onStudio={goStudio} />
        <Marquee />
        <Thesis />
        <Features />
        <SocialProof />
        <TechStrip />
        <CTA onStudio={goStudio} />
        <Footer />
      </ScrollFrames>
    </div>
  )
}
