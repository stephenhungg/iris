import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react'
import MetallicPaint from './components/MetallicPaint'
import Noise from './components/Noise'
import ScrollFrames from './components/ScrollFrames'
import { Studio } from './pages/Studio'

const IRIS_SVG = '/iris-logo.svg'

// palmer exact animation configs
const SPRING = {
  bouncy: { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1 },
  badge: { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1.5 },
}
const TWEEN = {
  fast: { type: 'tween' as const, duration: 0.4, ease: [0.82, 0.08, 0.29, 1] as const },
}
const STAGGER = 0.08

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
  useEffect(() => {
    const i = setInterval(() => {
      setProgress(p => { if (p >= 100) { clearInterval(i); setTimeout(onComplete, 400); return 100 } return Math.min(p + (p < 60 ? 3 : p < 85 ? 2 : 1), 100) })
    }, 30); return () => clearInterval(i)
  }, [onComplete])
  return (
    <motion.div exit={{ opacity: 0 }} transition={TWEEN.fast}
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

// ── pill nav ────────────────────────────────────────────────────────

function PillNav({ onStudio }: { onStudio: () => void }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const fn = () => setShow(window.scrollY > window.innerHeight * 0.8)
    window.addEventListener('scroll', fn, { passive: true }); return () => window.removeEventListener('scroll', fn)
  }, [])
  return (
    <AnimatePresence>
      {show && (
        <motion.nav initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} transition={SPRING.bouncy}
          style={{ position: 'fixed', bottom: '24px', left: 0, right: 0, marginLeft: 'auto', marginRight: 'auto', width: 'fit-content', zIndex: 50, display: 'flex', alignItems: 'center', gap: '24px', padding: '10px 12px 10px 24px', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {['product', 'editor', 'about'].map(l => (
            <a key={l} href={`#${l}`} style={{ color: 'rgba(255,255,255,0.4)', textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}>{l}</a>
          ))}
          <button onClick={onStudio} style={{ padding: '8px 20px', background: '#fff', color: '#000', border: 'none', borderRadius: '9999px', fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')} onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>open studio</button>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}

// ── hero ─────────────────────────────────────────────────────────────

function Hero({ onStudio }: { onStudio: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0])
  const y = useTransform(scrollYProgress, [0, 0.5], [0, -100])

  return (
    <section ref={ref} style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 64px', overflow: 'hidden' }}>
      {/* scattered preview images */}
      <motion.img src="/frames/frame_045.jpg" alt="" initial={{ opacity: 0 }} whileInView={{ opacity: 0.4 }} viewport={{ once: true }}
        transition={{ ...SPRING.badge, delay: 0.3 }}
        style={{ position: 'absolute', top: '12%', right: '8%', width: '200px', height: '130px', objectFit: 'cover', rotate: '2deg', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 1 }} />
      <motion.img src="/frames/frame_080.jpg" alt="" initial={{ opacity: 0 }} whileInView={{ opacity: 0.4 }} viewport={{ once: true }}
        transition={{ ...SPRING.badge, delay: 0.5 }}
        style={{ position: 'absolute', top: '58%', left: '3%', width: '160px', height: '100px', objectFit: 'cover', rotate: '-3deg', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 1 }} />
      <motion.img src="/frames/frame_120.jpg" alt="" initial={{ opacity: 0 }} whileInView={{ opacity: 0.4 }} viewport={{ once: true }}
        transition={{ ...SPRING.badge, delay: 0.7 }}
        style={{ position: 'absolute', top: '40%', right: '4%', width: '180px', height: '120px', objectFit: 'cover', rotate: '1deg', border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none', zIndex: 1 }} />

      <motion.div style={{ opacity, y }}>
        {/* top bar */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={SPRING.badge}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '80px', height: '80px' }}>
              <MetallicPaint imageSrc={IRIS_SVG} seed={42} scale={4} patternSharpness={1} noiseScale={0.5} speed={0.2} liquid={0.8} brightness={2.2} contrast={0.5} refraction={0.015} blur={0.012} chromaticSpread={2} fresnel={1.2} waveAmplitude={1} distortion={0.8} contour={0.25} lightColor="#ffffff" darkColor="#000000" tintColor="#c0c0c0" />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>iris®</span>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
              {['v0.1', '2026', 'cal hacks'].map((tag, i) => (
                <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.12)' }}>{tag}</span>
              ))}
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', textAlign: 'right', lineHeight: 1.6 }}>
            ai-powered video editor<br />speak your edits into existence
          </div>
        </motion.div>

        {/* massive title */}
        <motion.h1 initial={{ opacity: 0, y: -90 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.bouncy}
          style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(100px, 18vw, 240px)', lineHeight: 0.85, letterSpacing: '-0.04em', color: '#fff', marginBottom: '48px' }}>
          <span style={{ background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 8s ease-in-out infinite', filter: 'drop-shadow(0 0 80px rgba(255,255,255,0.08))' }}>iris</span>
          <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.4em', verticalAlign: 'super', marginLeft: '8px' }}>™</span>
        </motion.h1>

        {/* bottom row */}
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING.badge, delay: 0.2 }}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '40px', alignItems: 'end' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', lineHeight: 1.7, color: 'rgba(255,255,255,0.4)', maxWidth: '320px' }}>
            point at a moment in your video, describe what should change, and watch reality rewrite itself.
          </p>
          <div>
            <button onClick={onStudio} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '16px 40px', border: 'none', width: 'fit-content', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', color: '#000', fontWeight: 600, letterSpacing: '0.1em', cursor: 'pointer', animation: 'shimmer 6s ease-in-out infinite', transition: 'box-shadow 0.3s' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 40px rgba(255,255,255,0.12)')} onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>open studio</button>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.15)', lineHeight: 2, textAlign: 'right' }}>
            <div>prompt-driven editing</div><div>causal entity tracking</div><div>powered by gemini + veo</div>
          </div>
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.6 }}
        style={{ position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.12)', letterSpacing: '0.2em' }}>scroll</span>
        <motion.div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.12)' }} animate={{ scaleY: [1, 0.4, 1] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }} />
      </motion.div>
    </section>
  )
}

// ── marquee ─────────────────────────────────────────────────────────

function Marquee() {
  const text = 'scrub · select · prompt · transform · '.repeat(10)
  return (
    <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={SPRING.badge}
      style={{ overflow: 'hidden', whiteSpace: 'nowrap', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '24px 0' }}>
      <motion.div animate={{ x: [0, -3000] }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'inline-block', fontFamily: 'var(--font-display)', fontSize: 'clamp(60px, 8vw, 100px)', fontWeight: 300, letterSpacing: '-0.02em', color: 'transparent', WebkitTextStroke: '1px rgba(255,255,255,0.1)' }}>{text}</motion.div>
    </motion.div>
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
    <section style={{ padding: '200px 64px 160px', maxWidth: '1200px', margin: '0 auto' }}>
      <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={SPRING.badge}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '40px' }}>001 / about</motion.div>

      <motion.h2 initial={{ opacity: 0, y: -90 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-100px' }} transition={SPRING.bouncy}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(48px, 8vw, 128px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '80px' }}>
        generation<br /><span style={{ fontStyle: 'italic', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 8s ease-in-out infinite' }}>is the edit.</span>
      </motion.h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '120px' }}>
        <div>
          <motion.p initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={SPRING.badge}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', lineHeight: 1.8, color: 'rgba(255,255,255,0.35)', marginBottom: '32px' }}>
            runway generates video from nothing. premiere edits footage frame by frame. neither lets you point at a specific moment and say "make this different."
          </motion.p>
          <motion.p initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ ...SPRING.badge, delay: 0.1 }}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', lineHeight: 1.8, color: 'rgba(255,255,255,0.35)', marginBottom: '48px' }}>
            iris merges both into one action. scrub to a frame, draw a box, describe the change. the ai generates multiple interpretations. you pick one. it replaces that segment in your timeline.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ ...SPRING.badge, delay: 0.2 }}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '24px' }}>
            {[{ val: '3', label: 'variants per edit' }, { val: '<40s', label: 'generation time' }, { val: '∞', label: 'iterations' }].map((s, i) => (
              <div key={i}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', marginBottom: '4px' }}>{s.val}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {STEPS.map((s, i) => (
            <motion.div key={s.num} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
              transition={{ ...SPRING.bouncy, delay: i * STAGGER }}
              style={{ padding: '28px 0', cursor: 'default', borderBottom: '1px solid rgba(255,255,255,0.06)', transition: 'all 0.3s' }}
              onMouseEnter={e => { e.currentTarget.style.paddingLeft = '16px'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)' }}
              onMouseLeave={e => { e.currentTarget.style.paddingLeft = '0'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '20px', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', minWidth: '20px' }}>{s.num}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em' }}>{s.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, paddingLeft: '40px' }}>{s.desc}</div>
            </motion.div>
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
      <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={SPRING.badge}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.2em', marginBottom: '40px' }}>002 / capabilities</motion.div>

      <motion.h2 initial={{ opacity: 0, y: -90 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={SPRING.bouncy}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(40px, 6vw, 96px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '80px' }}>
        blending <span style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.4)' }}>intelligence</span><br />with intention.
      </motion.h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
        {[
          { title: 'causal editing', desc: 'change something once. iris finds every other frame where that entity appears and offers a continuity pack of consistent replacements.', label: 'entity tracking' },
          { title: 'creative director', desc: 'describe a vibe. gemini interprets your intent into structured edit plans with tone, color grading, and spatial awareness.', label: 'gemini ai' },
          { title: 'before / after', desc: 'the transformation is the product. wipe between original and generated variants instantly. the reveal is the magic trick.', label: 'comparison' },
          { title: 'voice narration', desc: "elevenlabs generates cinematic voiceover for your reveals. the transformation doesn't just look different. it sounds different.", label: 'elevenlabs' },
        ].map((f, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ ...SPRING.bouncy, delay: i * STAGGER }}
            style={{ padding: '48px 40px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)', transition: 'all 0.3s', cursor: 'default', transform: 'translateY(0)', boxShadow: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderTopColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,255,255,0.03)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderTopColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.boxShadow = 'none' }}>
            <div style={{ width: '100%', height: '120px', background: `url(${FEATURE_FRAMES[i]}) center/cover`, opacity: 0.15, marginBottom: '16px', borderRadius: '2px' }} />
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', marginBottom: '16px' }}>{f.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 300, color: '#fff', letterSpacing: '-0.02em', marginBottom: '12px' }}>{f.title}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: '13px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.7 }}>{f.desc}</div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

// ── tech strip ──────────────────────────────────────────────────────

function TechStrip() {
  return (
    <motion.section initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={SPRING.badge}
      style={{ padding: '80px 64px', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'center', gap: '64px', alignItems: 'center' }}>
      {['gemini 2.5 pro', 'veo 3.1', 'elevenlabs', 'sam2', 'vultr gpu'].map((t, i) => (
        <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em', transition: 'color 0.3s', cursor: 'default' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.15)')}>{t}</span>
      ))}
    </motion.section>
  )
}

// ── cta ─────────────────────────────────────────────────────────────

function CTA({ onStudio }: { onStudio: () => void }) {
  return (
    <section style={{ padding: '200px 64px', textAlign: 'center' }}>
      <motion.h2 initial={{ opacity: 0, y: -90 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={SPRING.bouncy}
        style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 'clamp(48px, 8vw, 128px)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#fff', marginBottom: '32px' }}>
        rewrite <span style={{ fontStyle: 'italic' }}>reality.</span>
      </motion.h2>
      <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ ...SPRING.badge, delay: 0.1 }}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.1em', marginBottom: '48px' }}>
        start editing with prompts, not tools.
      </motion.p>
      <motion.button onClick={onStudio} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        transition={{ ...SPRING.badge, delay: 0.2 }}
        whileHover={{ scale: 1.03, transition: TWEEN.fast }} whileTap={{ scale: 0.97, transition: TWEEN.fast }}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', padding: '18px 56px', border: 'none', background: '#fff', color: '#000', fontWeight: 600, letterSpacing: '0.1em', cursor: 'pointer', transition: 'box-shadow 0.3s' }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 60px rgba(255,255,255,0.15)')} onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>open studio</motion.button>
    </section>
  )
}

// ── footer ──────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer style={{ padding: '40px 64px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: '16px', background: 'linear-gradient(135deg, #707070, #B0B0B0, #E0E0E0, #B0B0B0, #707070)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>iris®</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'rgba(255,255,255,0.15)', letterSpacing: '0.15em' }}>© 2026 · built at cal hacks</span>
    </footer>
  )
}

// ── app ─────────────────────────────────────────────────────────────

export default function App() {
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'landing' | 'studio'>('landing')
  if (view === 'studio') return <Studio onExit={() => setView('landing')} />

  return (
    <div style={{ background: '#000', minHeight: '100vh', color: '#fff', textTransform: 'lowercase' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none', opacity: 0.035 }}>
        <Noise patternSize={256} patternScaleX={1} patternScaleY={1} patternRefreshInterval={2} patternAlpha={15} />
      </div>
      <AnimatePresence mode="wait">
        {!loaded && <Loader onComplete={() => setLoaded(true)} />}
      </AnimatePresence>
      {loaded && (
        <ScrollFrames dimOpacity={0.4}>
          <PillNav onStudio={() => setView('studio')} />
          <Hero onStudio={() => setView('studio')} />
          <Marquee />
          <Thesis />
          <Features />
          <TechStrip />
          <CTA onStudio={() => setView('studio')} />
          <Footer />
        </ScrollFrames>
      )}
    </div>
  )
}
