import { useEffect, useState } from 'react'
import './ProgressBar.css'

export interface ProgressBarItem {
  id: string
  isLarge: boolean
  label: string
  scrollPx: number
  elementId?: string   // gallery items: scroll-to by DOM measurement
}

interface Props {
  items: ProgressBarItem[]
  mapTotalPx: number
  scrollerRef: React.RefObject<HTMLDivElement | null>
  inGallery: boolean
}

function smoothScrollTo(el: HTMLElement, targetPx: number) {
  const start = el.scrollTop
  const dist  = targetPx - start
  const dur   = 450
  const t0    = performance.now()
  const tick  = (now: number) => {
    const t    = Math.min((now - t0) / dur, 1)
    const ease = 1 - (1 - t) ** 3          // ease-out cubic
    el.scrollTop = start + dist * ease
    if (t < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

export default function ProgressBar({ items, mapTotalPx, scrollerRef, inGallery }: Props) {
  const [scrollTop,  setScrollTop]  = useState(0)
  const [galleryPxs, setGalleryPxs] = useState<Record<string, number>>({})

  // Mirror the scroller's scroll position
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handler = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [scrollerRef])

  // Measure gallery element positions after initial render
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const pxs: Record<string, number> = {}
      for (const item of items) {
        if (!item.elementId) continue
        const target = document.getElementById(item.elementId)
        if (target) {
          // Position of element's top relative to scroll container's top
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

  // Effective scroll position for an item (gallery items use measured DOM position)
  const effectivePx = (item: ProgressBarItem): number =>
    item.elementId ? (galleryPxs[item.elementId] ?? Infinity) : item.scrollPx

  // Active item: last item whose effective scroll position <= current scrollTop
  const activeIndex = items.reduce(
    (best, item, i) => (scrollTop >= effectivePx(item) ? i : best),
    0,
  )

  const handleClick = (item: ProgressBarItem) => {
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
    smoothScrollTo(el, targetPx)
  }

  const galleryItems = items.filter(i => !!i.elementId)

  // Vertical position (0–100%) within the progress bar container
  const topPct = (item: ProgressBarItem): number => {
    if (item.elementId) {
      const gi = galleryItems.indexOf(item)
      return 87 + gi * 8   // Pricing at 87%, Contact at 95%
    }
    return (item.scrollPx / mapTotalPx) * 80
  }

  const fillPct = topPct(items[activeIndex] ?? items[0])

  return (
    <nav
      className={`progress-bar${inGallery ? ' progress-bar--gallery' : ''}`}
      aria-label="Journey progress"
    >
      {/* Vertical track */}
      <div className="pb-track">
        <div className="pb-track-fill" style={{ height: `${fillPct}%` }} />
      </div>

      {items.map((item, idx) => {
        const isActive = idx === activeIndex
        const isPassed = !isActive && scrollTop >= effectivePx(item)
        return (
          <div
            key={item.id}
            className={[
              'pb-item',
              item.isLarge ? 'pb-item--large' : 'pb-item--small',
              isActive  ? 'pb-item--active' : '',
              isPassed  ? 'pb-item--passed' : '',
            ].filter(Boolean).join(' ')}
            style={{ top: `${topPct(item)}%` }}
            onClick={() => handleClick(item)}
            title={item.label}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleClick(item)}
          >
            <div className="pb-dot" />
            {item.isLarge && <span className="pb-label">{item.label}</span>}
          </div>
        )
      })}
    </nav>
  )
}
