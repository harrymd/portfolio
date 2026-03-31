import { useEffect, useState } from 'react'
import './ProgressBar.css'

export interface ProgressBarItem {
  id: string
  label: string
  scrollPx: number
  elementId?: string  // gallery items: scroll-to by DOM measurement
  parentId?: string   // subsection items: id of parent section item
}

interface Props {
  items: ProgressBarItem[]
  scrollerRef: React.RefObject<HTMLDivElement | null>
  inGallery: boolean
  onNavigate: (scrollPx: number) => void
  onOpenChange?: (open: boolean) => void
}

export default function ProgressBar({ items, scrollerRef, inGallery, onNavigate, onOpenChange }: Props) {
  const [open,             setOpen]             = useState(false)
  const [scrollTop,        setScrollTop]        = useState(0)
  const [atBottom,         setAtBottom]         = useState(false)
  const [galleryPxs,       setGalleryPxs]       = useState<Record<string, number>>({})
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handler = () => {
      setScrollTop(el.scrollTop)
      setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 5)
    }
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

  // +1px epsilon compensates for browsers truncating el.scrollTop to integer pixels.
  // Without it, navigating to a float scrollPx (e.g. 15234.6) lands at 15234,
  // and 15234 >= 15234.6 is false — the item and its section fail their checks.
  const ST = scrollTop + 1

  // Active section: last section header (no parentId, no elementId) whose scrollPx has been passed
  const sectionHeaders = items.filter(i => !i.parentId && !i.elementId)
  const activeSectionId = sectionHeaders.reduce(
    (best, item) => (ST >= item.scrollPx ? item.id : best),
    sectionHeaders[0]?.id ?? '',
  )

  // Sections that have at least one subsection
  const sectionsWithSubs = new Set(items.filter(i => i.parentId).map(i => i.parentId!))

  // Auto-expand the active section (and collapse others) when scroll position changes
  useEffect(() => {
    if (activeSectionId && sectionsWithSubs.has(activeSectionId)) {
      setExpandedSections(new Set([activeSectionId]))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId])

  // Visible items: section headers + gallery items always; subsections only when parent is expanded
  const visibleItems = items.filter(item => !item.parentId || expandedSections.has(item.parentId))

  // Active index within visible items.
  // atBottom only forces last-item when in gallery; during the journey it can
  // fire transiently on navigation jumps before scrollHeight settles, which
  // would incorrectly highlight the last subsection.
  const activeIndex = atBottom && inGallery
    ? visibleItems.length - 1
    : visibleItems.reduce((best, item, i) => (ST >= effectivePx(item) ? i : best), 0)

  const handleClick = (item: ProgressBarItem) => {
    // Section with subsections: toggle expand/collapse (at most one open), don't navigate
    if (!item.parentId && !item.elementId && sectionsWithSubs.has(item.id)) {
      setExpandedSections(prev => prev.has(item.id) ? new Set() : new Set([item.id]))
      return
    }
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
    onNavigate(targetPx)
    // On mobile: auto-close so the map/info box is restored
    if (window.innerWidth < 768) {
      setOpen(false)
      onOpenChange?.(false)
    }
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
        onClick={() => { const next = !open; setOpen(next); onOpenChange?.(next) }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        title={open ? 'Collapse contents' : 'Expand contents'}
        onKeyDown={(e) => { if (e.key === 'Enter') { const next = !open; setOpen(next); onOpenChange?.(next) } }}
      >
        <span className="pb-title">Contents</span>
        <span className="pb-chevron" aria-hidden="true">{open ? '‹' : '›'}</span>
      </div>

      {/* Nav items — section headers always, subsections only for active section */}
      <div className="pb-items">
        <div className="pb-track" aria-hidden="true" />
        {visibleItems.map((item, idx) => {
          const isActive = idx === activeIndex
          const isPassed = !isActive && ST >= effectivePx(item)
          return (
            <div
              key={item.id}
              className={[
                'pb-item',
                item.parentId ? 'pb-item--sub' : '',
                isActive ? 'pb-item--active' : '',
                isPassed  ? 'pb-item--passed' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleClick(item)}
              title={item.label}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleClick(item)}
            >
              <div className="pb-dot" />
              <span className="pb-label">{item.label}</span>
              {!item.parentId && !item.elementId && sectionsWithSubs.has(item.id) && (
                <span className={`pb-arrow${expandedSections.has(item.id) ? ' pb-arrow--open' : ''}`} aria-hidden="true">▾</span>
              )}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
