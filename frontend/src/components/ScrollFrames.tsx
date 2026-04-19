import { useEffect, useRef, useState } from 'react'

const TOTAL_FRAMES = 151
const FRAME_PATH = '/frames/frame_'

// start from last frame, scroll backwards to ~1/3
const START_FRAME = TOTAL_FRAMES
const END_FRAME = Math.round(TOTAL_FRAMES / 3)

// lerp for smooth frame transitions
const LERP_SPEED = 0.06 // lower = smoother/slower (0.03-0.1 range)

function preloadFrames(): Promise<HTMLImageElement[]> {
  const promises: Promise<HTMLImageElement>[] = []
  for (let i = 1; i <= TOTAL_FRAMES; i++) {
    const src = `${FRAME_PATH}${String(i).padStart(3, '0')}.jpg`
    promises.push(
      new Promise((resolve) => {
        const img = new Image()
        img.src = src
        img.onload = () => resolve(img)
        img.onerror = () => resolve(img)
      })
    )
  }
  return Promise.all(promises)
}

interface ScrollFramesProps {
  children?: React.ReactNode
  className?: string
  dimOpacity?: number
}

export default function ScrollFrames({
  children,
  className = '',
  dimOpacity = 0.3,
}: ScrollFramesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const framesRef = useRef<HTMLImageElement[]>([])
  const currentFrameRef = useRef(START_FRAME - 1)
  const rafRef = useRef<number>(0)
  const [loaded, setLoaded] = useState(false)
  const [scrollOpacity, setScrollOpacity] = useState(1)

  useEffect(() => {
    preloadFrames().then(frames => {
      framesRef.current = frames
      setLoaded(true)
      drawFrame(START_FRAME - 1) // start on last frame
    })
  }, [])

  function drawFrame(index: number) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const frames = framesRef.current
    if (!canvas || !ctx || !frames.length) return

    const clamped = Math.max(0, Math.min(index, frames.length - 1))
    const frame = frames[clamped]
    if (!frame?.naturalWidth) return

    // match canvas to viewport for full-bleed background
    const dpr = window.devicePixelRatio || 1
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // cover-fit the frame into the canvas
    const scale = Math.max(
      window.innerWidth / frame.naturalWidth,
      window.innerHeight / frame.naturalHeight,
    )
    const w = frame.naturalWidth * scale
    const h = frame.naturalHeight * scale
    const x = (window.innerWidth - w) / 2
    const y = (window.innerHeight - h) / 2

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    ctx.drawImage(frame, x, y, w, h)
  }

  useEffect(() => {
    if (!loaded) return

    let targetFrame = START_FRAME - 1
    let currentSmooth = START_FRAME - 1
    let running = true

    // gentle ambient motion when not scrolling
    let lastScrollTime = Date.now()
    let ambientOffset = 0

    function onScroll() {
      lastScrollTime = Date.now()

      const scrollTop = window.scrollY
      // compress: full frame sequence plays within first 30% of page scroll
      const scrollRange = (document.documentElement.scrollHeight - window.innerHeight) * 0.3
      const progress = Math.max(0, Math.min(1, scrollTop / scrollRange))

      // reverse: start at last frame, go backwards to 1/3
      const frameRange = START_FRAME - END_FRAME
      targetFrame = START_FRAME - 1 - progress * frameRange + ambientOffset

      // nonlinear fade: sharp exponential dropoff once you start scrolling
      // hits near-zero by ~40% of first viewport scroll
      // stay full brightness through hero, fade once thesis is fully on screen
      // thesis starts at ~100vh, so start fading at ~1.5vh, fully black by ~2vh
      const fadeStart = window.innerHeight * 0.5
      const fadeEnd = window.innerHeight * 1.0
      const fade = scrollTop < fadeStart ? 1 : scrollTop > fadeEnd ? 0 : 1 - ((scrollTop - fadeStart) / (fadeEnd - fadeStart))
      setScrollOpacity(fade)
    }

    function onResize() {
      drawFrame(Math.round(currentSmooth))
    }

    // smooth animation loop — lerps between current and target frame
    function animate(time = performance.now()) {
      if (!running) return

      // keep the background subtly alive when the user pauses.
      const idleTime = Date.now() - lastScrollTime
      if (idleTime > 250) {
        ambientOffset = Math.sin(time * 0.00045) * 6
        const scrollTop = window.scrollY
        const scrollRange = (document.documentElement.scrollHeight - window.innerHeight) * 0.3
        const progress = Math.max(0, Math.min(1, scrollTop / scrollRange))
        const frameRange = START_FRAME - END_FRAME
        targetFrame = START_FRAME - 1 - progress * frameRange + ambientOffset
      }

      // lerp toward target
      currentSmooth += (targetFrame - currentSmooth) * LERP_SPEED
      const rounded = Math.round(Math.max(0, Math.min(TOTAL_FRAMES - 1, currentSmooth)))

      if (rounded !== currentFrameRef.current) {
        currentFrameRef.current = rounded
        drawFrame(rounded)
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    onScroll()
    animate()

    return () => {
      running = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(rafRef.current)
    }
  }, [loaded])

  return (
    <div className={`relative ${className}`}>
      {/* background canvas — fixed, covers viewport, fades with scroll */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full z-0"
        style={{
          opacity: loaded ? dimOpacity * scrollOpacity : 0,
        }}
      />

      {/* vignette overlay */}
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        style={{
          opacity: scrollOpacity,
          background: `
            radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,1) 100%),
            linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 15%, transparent 85%, rgba(0,0,0,0.9) 100%)
          `,
        }}
      />

      {/* content renders on top */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}
