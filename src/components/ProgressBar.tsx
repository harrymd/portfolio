import { useEffect, useState } from 'react'
import './ProgressBar.css'

// ─── Speed control ────────────────────────────────────────────────────────────
// Duration (ms) per section crossed when clicking a contents item.
// Total scroll time = CLICK_SCROLL_MS × |target section − current section|.
// Increase this value to slow down navigation further.
const CLICK_SCROLL_MS = 5000

export interface ProgressBarItem {
  id: string
  label: string
  scrollPx: number
  elementId?: string   // gallery items: scroll-to by DOM measurement
}

interface Props {
  items: ProgressBarItem[]
  scrollerRef: React.RefObject<HTMLDivElement | null>
  inGallery: boolean
}

function smoothScrollTo(el: HTMLElement, targetPx: number, duration: number) {
  const start = el.scrollTop
  const dist  = targetPx - start
  const t0    = performance.now()
  const tick  = (now: number) => {
    const t    = Math.min((now - t0) / duration, 1)
    const ease = 1 - (1 - t) ** 3
    el.scrollTop = start + dist * ease
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export default function ProgressBar({ items, scrollerRef, inGallery }: Props) {
  const [open,       setOpen]       = useState(false)   // collapsed by default
  const [scrollTop,  setScrollTop]  = useState(0)
  const [atBottom,   setAtBottom]   = useState(false)
  const [galleryPxs, setGalleryPxs] = useState<Record<string, number>>({})

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handler = () => {
      setScrollTop(el.scrollTop)
      // True when the user has scrolled to (or past) the very bottom
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 5)
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [scrollerRef])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const pxs: Record<string, number> = {}
      for (const item of items) {
        if (!item.elementId) continue
        const target = document.getElementById(item.elementId)
        if (target) {
          pxs[item.elementId] =
            target.getBoundingClientRect().top +
            el.scrollTop -
            el.getBoundingClientRect().top
        }
      }
      setGalleryPxs(pxs)
    }
    const t = setTimeout(measure, 400)
    return () => clearTimeout(t)
  }, [items, scrollerRef])

  const effectivePx = (item: ProgressBarItem): number =>
    item.elementId ? (galleryPxs[item.elementId] ?? Infinity) : item.scrollPx

  // If at the very bottom of the page, force the last item active
  const activeIndex = atBottom
    ? items.length - 1
    : items.reduce((best, item, i) => (scrollTop >= effectivePx(item) ? i : best), 0)

  const handleClick = (item: ProgressBarItem, idx: number) => {
    const el = scrollerRef.current
    if (!el) return
    let targetPx: number
    if (item.elementId) {
      if (galleryPxs[item.elementId] !== undefined) {
        targetPx = galleryPxs[item.elementId]
      } else {
        const t = document.getElementById(item.elementId)
        targetPx = t
          ? t.getBoundingClientRect().top + el.scrollTop - el.getBoundingClientRect().top
          : el.scrollTop
      }
    } else {
      targetPx = item.scrollPx
    }
    const sections = Math.max(Math.abs(idx - activeIndex), 1)
    smoothScrollTo(el, targetPx, sections * CLICK_SCROLL_MS)
  }

  return (
    <nav
      className={[
        'progress-bar',
        open ? 'progress-bar--open' : 'progress-bar--closed',
        inGallery ? 'progress-bar--gallery' : '',
      ].filter(Boolean).join(' ')}
      aria-label="Contents"
    >
      {/* Clickable title strip — toggles open/closed */}
      <div
        className="pb-title-strip"
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? 'Collapse contents' : 'Expand contents'}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(o => !o)}
      >
        <span className="pb-title">Contents</span>
        <span className="pb-chevron" aria-hidden="true">{open ? '‹' : '›'}</span>
      </div>

      {/* Nav items, evenly spaced — hidden when collapsed */}
      <div className="pb-items">
        <div className="pb-track" aria-hidden="true" />
        {items.map((item, idx) => {
          const isActive = idx === activeIndex
          const isPassed = !isActive && scrollTop >= effectivePx(item)
          return (
            <div
              key={item.id}
              className={[
                'pb-item',
                isActive ? 'pb-item--active' : '',
                isPassed ? 'pb-item--passed' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleClick(item, idx)}
              title={item.label}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleClick(item, idx)}
            >
              <div className="pb-dot" />
              <span className="pb-label">{item.label}</span>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
