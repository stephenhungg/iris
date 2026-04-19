import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { listProjects, type ProjectListItem } from '../api/client'
import { useAuth } from '../lib/useAuth'
import './projects.css'

// palmer spring — matches the landing page
const SPRING_BOUNCY = { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1 }
const SPRING_BADGE = { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1.5 }

export function Projects({
  onExit,
  onOpen,
  onNew,
}: {
  onExit: () => void
  onOpen: (projectId: string) => void
  onNew: () => void
}) {
  const { user } = useAuth()
  const [items, setItems] = useState<ProjectListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listProjects()
      .then((r) => { if (alive) setItems(r) })
      .catch((e) => { if (alive) setErr(String(e?.message || e)) })
    return () => { alive = false }
  }, [])

  const display = user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email?.split('@')[0]
    || 'guest'

  return (
    <div className="projects-page">
      {/* sticky top bar */}
      <header className="projects-topbar">
        <button className="projects-back" onClick={onExit}>
          <span className="arrow">←</span>
          <span>back to landing</span>
        </button>
        <div className="projects-user">
          signed in as <strong>{String(display).toLowerCase()}</strong>
        </div>
      </header>

      {/* hero header */}
      <motion.section
        className="projects-header"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_BADGE}
      >
        <div className="projects-sectionnum">002 / library</div>
        <h1 className="projects-title">
          your <span className="chrome">reels</span>
        </h1>
        <div className="projects-subhead">
          <p>
            every reel you've cut lives here. pick one up where you left off,
            or start a fresh edit — iris remembers nothing you didn't teach it.
          </p>
          <div className="projects-count">
            {items === null ? '—' : String(items.length).padStart(3, '0')} reels
          </div>
        </div>
      </motion.section>

      {/* body */}
      <AnimatePresence mode="wait">
        {items === null && !err && (
          <motion.div
            key="loading"
            className="projects-spinner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="dot" />
            <span>loading library</span>
          </motion.div>
        )}

        {err && (
          <motion.div
            key="error"
            className="projects-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <h3>couldn't load library</h3>
            <div style={{ color: 'rgba(255,100,100,0.7)' }}>{err}</div>
          </motion.div>
        )}

        {items !== null && !err && (
          <motion.section
            key="grid"
            className="projects-grid"
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
            }}
          >
            {/* "new reel" tile always first */}
            <motion.button
              className="proj-new"
              onClick={onNew}
              variants={{
                hidden: { opacity: 0, y: 24 },
                show: { opacity: 1, y: 0, transition: SPRING_BOUNCY },
              }}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
            >
              <div className="proj-new__plus">+</div>
              <div>new reel</div>
            </motion.button>

            {items.map((p, i) => (
              <ProjectCard
                key={p.project_id}
                project={p}
                index={i}
                onOpen={() => onOpen(p.project_id)}
              />
            ))}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── card ──────────────────────────────────────────────────────────

function ProjectCard({
  project,
  index,
  onOpen,
}: {
  project: ProjectListItem
  index: number
  onOpen: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)

  function handleEnter() {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    v.play().catch(() => {})
  }
  function handleLeave() {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = 0
  }

  const created = formatRelative(project.created_at)
  const idShort = project.project_id.slice(0, 8)
  const dur = formatDuration(project.duration)
  const res = `${project.width}×${project.height}`

  return (
    <motion.div
      className="proj-card"
      onClick={onOpen}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      variants={{
        hidden: { opacity: 0, y: 24 },
        show: { opacity: 1, y: 0, transition: SPRING_BOUNCY },
      }}
      whileHover={{ y: -3 }}
      transition={SPRING_BOUNCY}
    >
      <video
        ref={videoRef}
        className="proj-card__video"
        src={project.video_url}
        preload="metadata"
        muted
        loop
        playsInline
        // nudge to just after 0 so the browser actually renders a
        // poster frame from the video (otherwise we just see black
        // with preload=metadata on some browsers).
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.currentTime === 0) v.currentTime = 0.05
        }}
        onSeeked={() => setReady(true)}
        onLoadedData={() => setReady(true)}
        style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.4s ease' }}
      />
      {!ready && <div className="proj-card__poster" />}

      <div className="proj-card__glow" />
      <div className="proj-card__scrim" />

      <div className="proj-card__corner">
        reel · {String(index + 1).padStart(3, '0')}
      </div>

      <div className="proj-card__meta">
        <div>
          <div className="proj-card__id">{idShort}</div>
          <div className="proj-card__created">{created}</div>
        </div>
        <div className="proj-card__stats">
          <span>{dur}</span>
          <span>{res} · {Math.round(project.fps)}fps</span>
        </div>
      </div>
    </motion.div>
  )
}

// ─── formatters ────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return ''
    const diff = Date.now() - then
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day}d ago`
    const wk = Math.floor(day / 7)
    if (wk < 5) return `${wk}w ago`
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: '2-digit',
    }).toLowerCase()
  } catch { return '' }
}
