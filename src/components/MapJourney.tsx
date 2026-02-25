import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import * as turf from '@turf/turf'

// Register the pmtiles:// protocol handler once at module load time
const pmtilesProtocol = new Protocol()
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile.bind(pmtilesProtocol))

import type { LoadedData, SnappedPoint } from '../types'
import AttributionWidget from './AttributionWidget'
import GallerySection from './GallerySection'
import ProgressBar, { type ProgressBarItem } from './ProgressBar'
import './MapJourney.css'

interface Props {
  data: LoadedData
}

const FIXED_ZOOM        = 10
const FIXED_BEARING     = 220
const POI_WINDOW_KM     = 10
const BASE_PX_PER_KM    = 100   // halved → 2× faster scroll
const SLOW_FACTOR       = 2     // 2× px/km near POIs
const MOBILE_BREAKPOINT = 768
const ARROW_SCROLL_PX   = 750
const GALLERY_FADE_PX   = 2000 

// ─────────────────────────────────────────────────────────────────────────────
// Scroll mapping: piecewise linear with SLOW_FACTOR dwell near each POI
// ─────────────────────────────────────────────────────────────────────────────
interface ScrollMapping {
  kmSamples: number[]
  pxCumulative: number[]
  totalPx: number
}

function buildScrollMapping(snappedPoints: SnappedPoint[]): ScrollMapping {
  if (snappedPoints.length === 0) return { kmSamples: [], pxCumulative: [], totalPx: 0 }

  const startKm  = snappedPoints[0].distanceAlongPath
  const endKm    = snappedPoints[snappedPoints.length - 1].distanceAlongPath
  const STEP_KM  = 0.2

  const numSteps        = Math.max(Math.ceil((endKm - startKm) / STEP_KM), 1)
  const kmSamples: number[]    = []
  const pxCumulative: number[] = []
  let cumPx = 0

  for (let i = 0; i <= numSteps; i++) {
    const km = startKm + Math.min(i * STEP_KM, endKm - startKm)
    kmSamples.push(km)
    pxCumulative.push(cumPx)

    if (i < numSteps) {
      const nextKm = startKm + Math.min((i + 1) * STEP_KM, endKm - startKm)
      const midKm  = (km + nextKm) / 2
      const segKm  = nextKm - km

      let inSlowZone = false
      for (const sp of snappedPoints) {
        if (Math.abs(midKm - sp.distanceAlongPath) <= POI_WINDOW_KM) {
          inSlowZone = true
          break
        }
      }
      cumPx += segKm * BASE_PX_PER_KM * (inSlowZone ? SLOW_FACTOR : 1)
    }
  }

  const totalPx = cumPx + BASE_PX_PER_KM * 0.5
  return { kmSamples, pxCumulative, totalPx }
}

function scrollPxToKm(px: number, mapping: ScrollMapping): number {
  const { kmSamples, pxCumulative } = mapping
  if (kmSamples.length === 0) return 0
  if (px <= 0) return kmSamples[0]
  const lastPx = pxCumulative[pxCumulative.length - 1]
  if (px >= lastPx) return kmSamples[kmSamples.length - 1]

  let lo = 0
  let hi = pxCumulative.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (pxCumulative[mid] <= px) lo = mid
    else hi = mid
  }
  const t = (px - pxCumulative[lo]) / (pxCumulative[hi] - pxCumulative[lo])
  return kmSamples[lo] + t * (kmSamples[hi] - kmSamples[lo])
}

function kmToPx(targetKm: number, mapping: ScrollMapping): number {
  const { kmSamples, pxCumulative } = mapping
  if (kmSamples.length === 0) return 0
  if (targetKm <= kmSamples[0]) return pxCumulative[0]
  const last = kmSamples.length - 1
  if (targetKm >= kmSamples[last]) return pxCumulative[last]
  let lo = 0, hi = last
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (kmSamples[mid] <= targetKm) lo = mid
    else hi = mid
  }
  const t = (targetKm - kmSamples[lo]) / (kmSamples[hi] - kmSamples[lo])
  return pxCumulative[lo] + t * (pxCumulative[hi] - pxCumulative[lo])
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas icon builders
// ─────────────────────────────────────────────────────────────────────────────

/** Small rightward-pointing arrow placed along the path line. */
function makePathArrow(): { width: number; height: number; data: Uint8Array } {
  const size = 16
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cy = size / 2
  ctx.globalAlpha = 0.85
  ctx.fillStyle = '#e03030'
  ctx.beginPath()
  ctx.moveTo(size - 2, cy)
  ctx.lineTo(2, 2)
  ctx.lineTo(Math.round(size * 0.4), cy)
  ctx.lineTo(2, size - 2)
  ctx.closePath()
  ctx.fill()
  return { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer) }
}

/**
 * Upward-pointing (north = 0°) arrow for the live position cursor.
 * MapLibre rotates it via icon-rotate: ['get', 'bearing'].
 */
function makeCursorArrow(): { width: number; height: number; data: Uint8Array } {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2

  ctx.shadowColor = 'rgba(224,48,48,0.6)'
  ctx.shadowBlur = 5
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(cx, 2)
  ctx.lineTo(size - 5, size - 4)
  ctx.lineTo(cx, Math.round(size * 0.62))
  ctx.lineTo(5, size - 4)
  ctx.closePath()
  ctx.fill()

  ctx.shadowBlur = 0
  ctx.strokeStyle = '#e03030'
  ctx.lineWidth = 1.5
  ctx.stroke()

  return { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function MapJourney({ data }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef          = useRef<maplibregl.Map | null>(null)
  const scrollerRef     = useRef<HTMLDivElement>(null)
  const rafRef          = useRef<number | null>(null)
  const detailTimerRef  = useRef<number | null>(null)
  const idleTimerRef    = useRef<number | null>(null)

  const [mapReady, setMapReady]             = useState(false)
  const [activePoiIndex, setActivePoiIndex] = useState<number | null>(null)
  const [currentSectionName, setCurrentSectionName] = useState<string>('')
  const [sectionVisible, setSectionVisible] = useState(false)
  const [scrollHintVisible, setScrollHintVisible] = useState(true)
  const [inGallery, setInGallery]           = useState(false)

  // Cross-fade states
  const [displayedPoi, setDisplayedPoi]   = useState<SnappedPoint | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  const { pathFeature, snappedPoints, style } = data

  const pathLine = useMemo(
    () => turf.lineString(pathFeature.geometry.coordinates),
    [pathFeature],
  )

  // POIs shown on map and eligible for panel activation (exclude first and last)
  const innerPoints = useMemo(
    () => (snappedPoints.length > 2 ? snappedPoints.slice(1, -1) : snappedPoints),
    [snappedPoints],
  )

  // Per-section km ranges: [firstPoi.dist − POI_WINDOW_KM … lastPoi.dist + POI_WINDOW_KM]
  // The section header is visible anywhere inside this range.
  const sectionRanges = useMemo(() => {
    const ranges: { sectionName: string; minKm: number; maxKm: number }[] = []
    for (const sp of innerPoints) {
      if (!sp.sectionName) continue
      const last = ranges[ranges.length - 1]
      if (last && last.sectionName === sp.sectionName) {
        last.maxKm = sp.distanceAlongPath + POI_WINDOW_KM
      } else {
        ranges.push({
          sectionName: sp.sectionName,
          minKm: sp.distanceAlongPath - POI_WINDOW_KM,
          maxKm: sp.distanceAlongPath + POI_WINDOW_KM,
        })
      }
    }
    return ranges
  }, [innerPoints])

  const scrollMapping = useMemo(() => buildScrollMapping(snappedPoints), [snappedPoints])

  const progressItems = useMemo((): ProgressBarItem[] => {
    const items: ProgressBarItem[] = []
    const seenSections = new Set<string>()
    for (const sp of innerPoints) {
      if (!sp.sectionName) continue
      const isFirst = !seenSections.has(sp.sectionName)
      if (isFirst) seenSections.add(sp.sectionName)
      items.push({
        id: `poi-${sp.narrativeId}`,
        isLarge: isFirst,
        label: sp.sectionName,
        scrollPx: kmToPx(sp.distanceAlongPath, scrollMapping),
      })
    }
    items.push({ id: 'pricing', isLarge: true, label: 'Pricing',
      scrollPx: scrollMapping.totalPx, elementId: 'gallery-pricing' })
    items.push({ id: 'contact', isLarge: true, label: 'Contact',
      scrollPx: scrollMapping.totalPx, elementId: 'gallery-contact' })
    return items
  }, [innerPoints, scrollMapping])

  const kmToLngLat = useCallback(
    (km: number): [number, number] => {
      const pt = turf.along(pathLine, km, { units: 'kilometers' })
      return pt.geometry.coordinates as [number, number]
    },
    [pathLine],
  )

  const getBearingAtKm = useCallback(
    (km: number): number => {
      const delta = 0.5
      const km1 = Math.max(0, km - delta)
      const km2 = Math.min(data.totalDistance, km + delta)
      const p1  = turf.along(pathLine, km1, { units: 'kilometers' })
      const p2  = turf.along(pathLine, km2, { units: 'kilometers' })
      return turf.bearing(p1, p2)
    },
    [pathLine, data.totalDistance],
  )

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    const map      = mapRef.current
    if (!scroller || !map) return

    const scrollTop     = scroller.scrollTop
    const scrollRangePx = scrollMapping.totalPx
    const galleryThreshold = Math.max(0, scrollRangePx - GALLERY_FADE_PX)
    setInGallery(scrollTop >= galleryThreshold)

    const clampedPx = Math.min(scrollTop, scrollRangePx)
    const km        = scrollPxToKm(clampedPx, scrollMapping)
    const center    = kmToLngLat(km)

    const isMobile = window.innerWidth < MOBILE_BREAKPOINT
    const offset: [number, number] = isMobile ? [0, -window.innerHeight / 4] : [0, 0]

    map.easeTo({ center, zoom: FIXED_ZOOM, bearing: FIXED_BEARING, duration: 100, easing: (t) => t, offset })

    const bearing = getBearingAtKm(km)
    const cursorSource = map.getSource('journey-cursor') as maplibregl.GeoJSONSource | undefined
    if (cursorSource) {
      cursorSource.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        properties: { bearing },
      })
    }

    if (scrollTop > 10) setScrollHintVisible(false)

    // Active POI: first innerPoint within ±POI_WINDOW_KM
    const firstIdx = snappedPoints.length > 2 ? 1 : 0
    const lastIdx  = snappedPoints.length > 2 ? snappedPoints.length - 2 : snappedPoints.length - 1
    let newActive: number | null = null
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (Math.abs(km - snappedPoints[i].distanceAlongPath) <= POI_WINDOW_KM) {
        newActive = i
        break
      }
    }

    // Section header visibility: true while km is inside any section's full range
    let newSectionVisible = false
    let newSectionName    = ''
    for (const range of sectionRanges) {
      if (km >= range.minKm && km <= range.maxKm) {
        newSectionVisible = true
        newSectionName    = range.sectionName
        break
      }
    }

    setActivePoiIndex(newActive)
    setSectionVisible(newSectionVisible)
    setCurrentSectionName(newSectionName)
  }, [snappedPoints, sectionRanges, scrollMapping, kmToLngLat, getBearingAtKm])

  // Cross-fade subsection detail when active POI changes
  const activePoi: SnappedPoint | null =
    activePoiIndex !== null ? snappedPoints[activePoiIndex] : null

  useEffect(() => {
    if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current)

    if (!activePoi) {
      setDetailVisible(false)
      return
    }

    if (!displayedPoi || activePoi.narrativeId !== displayedPoi.narrativeId) {
      setDetailVisible(false)
      detailTimerRef.current = window.setTimeout(() => {
        setDisplayedPoi(activePoi)
        setDetailVisible(true)
      }, 280)
    } else {
      setDetailVisible(true)
    }
  }, [activePoi]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise map once
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialCenter: [number, number] =
      snappedPoints.length > 0 ? snappedPoints[0].snappedCoord : [14.0, 67.9]

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: initialCenter,
      zoom: FIXED_ZOOM,
      bearing: FIXED_BEARING,
      interactive: false,
      attributionControl: false,
    })

    mapRef.current = map

    // Fallback: show map after 8 s even if idle never fires (e.g. PMTiles 403)
    idleTimerRef.current = window.setTimeout(() => setMapReady(true), 8000)

    map.on('load', () => {
      // Compute initial cursor bearing at the journey start
      const startKm  = snappedPoints[0]?.distanceAlongPath ?? 0
      const bKm2     = Math.min(data.totalDistance, startKm + 0.5)
      const bPt1     = turf.along(pathLine, startKm, { units: 'kilometers' })
      const bPt2     = turf.along(pathLine, bKm2,    { units: 'kilometers' })
      const initBearing = turf.bearing(bPt1, bPt2)

      // Register custom icon sprites
      map.addImage('path-arrow',   makePathArrow())
      map.addImage('cursor-arrow', makeCursorArrow())

      // ── Path ──────────────────────────────────────────────
      map.addSource('journey-path', { type: 'geojson', data: data.pathGeoJSON })

      map.addLayer({
        id: 'journey-path-bg',
        type: 'line',
        source: 'journey-path',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#b01a1a', 'line-width': 8, 'line-opacity': 0.18 },
      })
      map.addLayer({
        id: 'journey-path-line',
        type: 'line',
        source: 'journey-path',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e03030', 'line-width': 2, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'journey-path-arrows',
        type: 'symbol',
        source: 'journey-path',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 110,
          'icon-image': 'path-arrow',
          'icon-size': 1,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
      })

      // ── POI markers (inner points only) ───────────────────
      const poisGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: innerPoints.map((sp) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: sp.snappedCoord },
          properties: { name: sp.subsectionName },
        })),
      }
      map.addSource('journey-pois', { type: 'geojson', data: poisGeoJSON })
      map.addLayer({
        id: 'journey-pois-halo',
        type: 'circle',
        source: 'journey-pois',
        paint: { 'circle-radius': 12, 'circle-color': '#e03030', 'circle-opacity': 0.15 },
      })
      map.addLayer({
        id: 'journey-pois-dot',
        type: 'circle',
        source: 'journey-pois',
        paint: {
          'circle-radius': 4,
          'circle-color': '#f05a5a',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0b0f14',
          'circle-opacity': 1,
        },
      })

      // ── Cursor ────────────────────────────────────────────
      map.addSource('journey-cursor', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: initialCenter },
          properties: { bearing: initBearing },
        },
      })
      map.addLayer({
        id: 'journey-cursor-ring',
        type: 'circle',
        source: 'journey-cursor',
        paint: {
          'circle-radius': 16,
          'circle-color': 'transparent',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#e03030',
          'circle-stroke-opacity': 0.4,
        },
      })
      map.addLayer({
        id: 'journey-cursor-arrow',
        type: 'symbol',
        source: 'journey-cursor',
        layout: {
          'icon-image': 'cursor-arrow',
          'icon-size': 0.85,
          'icon-rotation-alignment': 'map',
          'icon-rotate': ['get', 'bearing'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })

      // Reveal the map once all tiles (including PMTiles) are rendered
      map.once('idle', () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        setMapReady(true)
      })
    })

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Wire scroll listener
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(handleScroll)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [handleScroll])

  // Arrow-key scroll support
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const scroller = scrollerRef.current
      if (!scroller) return
      const delta = e.key === 'ArrowDown' ? ARROW_SCROLL_PX : -ARROW_SCROLL_PX
      scroller.scrollBy({ top: delta, behavior: 'smooth' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Panel outer box: visible while km is inside a section's range, or during fade
  const panelVisible = sectionVisible || detailVisible

  return (
    <div className="journey-root">
      {/* Dark overlay that fades out once the map+PMTiles tiles have rendered */}
      <div
        className="map-loading-overlay"
        style={{ opacity: mapReady ? 0 : 1, pointerEvents: mapReady ? 'none' : 'auto' }}
        aria-hidden="true"
      />

      <div className="map-container" ref={mapContainerRef} />

      <ProgressBar
        items={progressItems}
        mapTotalPx={scrollMapping.totalPx}
        scrollerRef={scrollerRef}
        inGallery={inGallery}
      />

      <header className={`journey-header${inGallery ? ' journey-header--hidden' : ''}`}>
        <h1 className="journey-heading">Kuril Geospatial</h1>
        <div className="journey-contact">
          Contact Harry:<br />
          <a href="mailto:projects@HKuril.com">projects@HKuril.com</a>
        </div>
      </header>

      {/* POI panel */}
      <aside className={`poi-panel${panelVisible && !inGallery ? ' poi-panel--visible' : ''}`}>
        <div className="poi-panel-section">{currentSectionName}</div>
        <div className={`poi-panel-detail${detailVisible ? ' poi-panel-detail--visible' : ''}`}>
          {displayedPoi && displayedPoi.subsectionName && (
            <>
              <div className="poi-panel-label">{displayedPoi.subsectionName}</div>
              <p
                className="poi-panel-description"
                dangerouslySetInnerHTML={{ __html: displayedPoi.text }}
              />
              {displayedPoi.image && (
                <img
                  key={displayedPoi.image}
                  className="poi-panel-image"
                  src={`/gallery/${displayedPoi.image}`}
                  alt={displayedPoi.subsectionName}
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              )}
            </>
          )}
        </div>
      </aside>

      <AttributionWidget hidden={inGallery} />

      {/* Scroll capture overlay: journey spacer + gallery */}
      <div className="scroll-overlay" ref={scrollerRef}>
        <div style={{ height: `${scrollMapping.totalPx}px` }} />
        <GallerySection />
      </div>

      <div
        className={`scroll-hint${scrollHintVisible ? '' : ' scroll-hint--hidden'}`}
        aria-hidden="true"
      >
        <span>Scroll down to explore</span>
        <span className="scroll-hint-sub">or use ↓ arrow key</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>
    </div>
  )
}
