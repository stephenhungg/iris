import { Fragment, type ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import './FloatingToolbar.css'

type NavItem = {
  id: string
  label: string
  icon: ReactNode
}

function IrisToolbarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" />
      <circle cx="12" cy="12" r="2.35" stroke="currentColor" />
      <path d="M12 3.2c4.05 0 7.93 3 8.74 7.2H16.6c-.34-2.7-1.63-4.92-4.6-5.62Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      <path d="M20.8 12c0 4.05-3 7.93-7.2 8.74V16.6c2.7-.34 4.92-1.63 5.62-4.6Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      <path d="M12 20.8c-4.05 0-7.93-3-8.74-7.2h4.14c.34 2.7 1.63 4.92 4.6 5.62Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      <path d="M3.2 12c0-4.05 3-7.93 7.2-8.74V7.4c-2.7.34-4.92 1.63-5.62 4.6Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  )
}

function AboutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.75h7.4l3.85 3.93v12.57H7z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M14.4 3.75v3.9h3.85" stroke="currentColor" strokeLinejoin="round" />
      <path d="M9.45 11.1h5.3M9.45 14.1h5.3M9.45 17.1h3.8" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function FeaturesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6.1" y="6.1" width="3.2" height="3.2" rx="0.65" stroke="currentColor" />
      <rect x="14.7" y="6.1" width="3.2" height="3.2" rx="0.65" stroke="currentColor" />
      <rect x="6.1" y="14.7" width="3.2" height="3.2" rx="0.65" stroke="currentColor" />
      <rect x="14.7" y="14.7" width="3.2" height="3.2" rx="0.65" stroke="currentColor" />
      <path d="M9.3 7.7h5.4M9.3 16.3h5.4M7.7 9.3v5.4M16.3 9.3v5.4" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function RewriteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5.1 6.2h3.35l1.62 2.05h1.87l1.55-2.05h3.4l.95 3.35H4.15z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M4.95 9.55h14.1v8.25H4.95z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8.1 12.45 10 14l3.1-3.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.3 12.35h1.7M15.3 14.65h1.7" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.2" stroke="currentColor" />
      <path d="M7.2 4.8v14.4M16.8 4.8v14.4" stroke="currentColor" />
      <path d="M4.8 8.15h2.4M4.8 12h2.4M4.8 15.85h2.4M16.8 8.15h2.4M16.8 12h2.4M16.8 15.85h2.4" stroke="currentColor" strokeLinecap="round" />
      <path d="m10.1 9.1 4.35 2.9-4.35 2.9z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  )
}

const items: NavItem[] = [
  { id: 'top', label: 'Landing', icon: <IrisToolbarIcon /> },
  { id: 'about', label: 'About', icon: <AboutIcon /> },
  { id: 'features', label: 'Features', icon: <FeaturesIcon /> },
  { id: 'rewrite', label: 'Rewrite', icon: <VideoIcon /> },
]

export default function FloatingToolbar() {
  const [activeId, setActiveId] = useState('top')
  const [indicator, setIndicator] = useState({ left: 8, width: 58 })
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const updateActive = () => {
      if (window.scrollY < window.innerHeight * 0.35) {
        setActiveId('top')
        return
      }

      const ids = ['about', 'features', 'rewrite']
      const viewportAnchor = window.innerHeight * 0.42
      let closest = ids[0]
      let distance = Number.POSITIVE_INFINITY

      ids.forEach((id) => {
        const el = document.getElementById(id)
        if (!el) return
        const rect = el.getBoundingClientRect()
        const center = rect.top + rect.height * 0.35
        const delta = Math.abs(center - viewportAnchor)
        if (delta < distance) {
          distance = delta
          closest = id
        }
      })

      setActiveId(closest)
    }

    updateActive()
    window.addEventListener('scroll', updateActive, { passive: true })
    window.addEventListener('resize', updateActive)
    return () => {
      window.removeEventListener('scroll', updateActive)
      window.removeEventListener('resize', updateActive)
    }
  }, [])

  useLayoutEffect(() => {
    const target = itemRefs.current[activeId]
    const toolbar = toolbarRef.current
    if (!target || !toolbar) return
    const toolbarRect = toolbar.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const targetCenter = targetRect.left - toolbarRect.left + targetRect.width / 2
    setIndicator({
      left: targetCenter - targetRect.width / 2,
      width: targetRect.width,
    })
  }, [activeId])

  useEffect(() => {
    const onResize = () => {
      const target = itemRefs.current[activeId]
      const toolbar = toolbarRef.current
      if (!target || !toolbar) return
      const toolbarRect = toolbar.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const targetCenter = targetRect.left - toolbarRect.left + targetRect.width / 2
      setIndicator({
        left: targetCenter - targetRect.width / 2,
        width: targetRect.width,
      })
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeId])

  const scrollToSection = (id: string) => {
    if (id === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const section = document.getElementById(id)
    if (!section) return
    const absoluteTop = window.scrollY + section.getBoundingClientRect().top - 88
    window.scrollTo({ top: Math.max(0, absoluteTop), behavior: 'smooth' })
  }

  return (
    <motion.div
      data-intro="nav"
      className="floating-toolbar-wrap"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className="floating-toolbar-ambient" />

      <div ref={toolbarRef} className="floating-toolbar" data-theme="dark">
        <motion.div
          className="floating-toolbar-indicator"
          animate={{ left: indicator.left, width: indicator.width }}
          transition={{ duration: 0.55, ease: [0.34, 1.2, 0.64, 1] }}
        >
          <div className="floating-toolbar-indicator-glow" />
          <div className="floating-toolbar-indicator-clip">
            <div className="floating-toolbar-indicator-ring" />
          </div>
          <div className="floating-toolbar-indicator-inner" />
        </motion.div>

        {items.map((item, index) => (
          <Fragment key={item.id}>
          <button
            ref={(node) => { itemRefs.current[item.id] = node }}
            className="floating-toolbar-button"
            data-active={activeId === item.id}
            type="button"
            onClick={() => scrollToSection(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            {item.icon}
          </button>
          {index < items.length - 1 ? <div className="floating-toolbar-divider" /> : null}
          </Fragment>
        ))}

      </div>
    </motion.div>
  )
}
