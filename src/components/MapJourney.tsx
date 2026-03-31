import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import * as turf from '@turf/turf'

// Register the pmtiles:// protocol handler once at module load time
const pmtilesProtocol = new Protocol()
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile.bind(pmtilesProtocol))

import { prefetchTiles } from '../utils/prefetchTiles'
import type { LoadedData, SnappedPoint } from '../types'
import AttributionWidget from './AttributionWidget'
import GallerySection from './GallerySection'
import ProgressBar, { type ProgressBarItem } from './ProgressBar'
import './MapJourney.css'

interface Props {
  data: LoadedData
}

const FIXED_ZOOM     = 10   // desktop zoom — ocean_buffers PMTiles available at zoom ≥ 9
const FIXED_ZOOM_MOB = 9    // mobile zoom — fewer tiles per viewport, smoother navigation
const FIXED_BEARING     = 220
const POI_WINDOW_KM     = 10
const BASE_PX_PER_KM    = 100
const SLOW_FACTOR       = 2
const MOBILE_BREAKPOINT = 768
const GALLERY_FADE_PX   = 2000
const NAV_ANIM_DURATION       = 3600  // minimum ms for next/prev port animated scroll
const MAX_SPEED_PX_PER_MS     = 1.5   // cap: px per ms (extends duration for long hops)
const MAX_SPEED_PX_PER_MS_MOB = 0.75  // slower cap on mobile to allow tiles to load
const MIN_OVERLAY_MS     = 1500  // minimum ms the loading overlay stays visible

// ─────────────────────────────────────────────────────────────────────────────
// Scroll mapping: piecewise linear with SLOW_FACTOR dwell near each POI
// ─────────────────────────────────────────────────────────────────────────────
interface ScrollMapping {
  kmSamples: number[]
  pxCumulative: number[]
  totalPx: number
}

function buildScrollMapping(snappedPoints: SnappedPoint[], dwellPoints: SnappedPoint[], pxPerKm = BASE_PX_PER_KM): ScrollMapping {
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
      for (const sp of dwellPoints) {
        if (Math.abs(midKm - sp.distanceAlongPath) <= POI_WINDOW_KM) {
          inSlowZone = true
          break
        }
      }
      cumPx += segKm * pxPerKm * (inSlowZone ? SLOW_FACTOR : 1)
    }
  }

  const totalPx = cumPx + pxPerKm * 0.5
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
  const mapContainerRef    = useRef<HTMLDivElement>(null)
  const mapRef             = useRef<maplibregl.Map | null>(null)
  const scrollerRef        = useRef<HTMLDivElement>(null)
  const panelRef           = useRef<HTMLElement>(null)
  const rafRef             = useRef<number | null>(null)
  const navAnimRef         = useRef<number | null>(null)
  const navAnimatingRef    = useRef(false)   // true while next/prev animation is running
  const navDirectionRef    = useRef<1|-1>(1) // +1 forward, -1 backward (for cursor bearing)
  const handleScrollRef    = useRef<(() => void) | null>(null) // latest handleScroll for animation end
  const inGalleryRef       = useRef(false)   // mirror of inGallery state for event handlers
  const galleryThresholdRef = useRef(0)      // px where journey ends and gallery begins
  const touchStartYRef      = useRef(0)      // last touchstart clientY for direction detection
  const [progressBarOpen, setProgressBarOpen] = useState(false)
  const detailTimerRef     = useRef<number | null>(null)
  const idleTimerRef       = useRef<number | null>(null)
  const navTimerRef        = useRef<number | null>(null)

  const [mapReady, setMapReady]             = useState(false)
  const [activePoiIndex, setActivePoiIndex] = useState<number | null>(null)
  const [currentSectionName, setCurrentSectionName] = useState<string>('')
  const [sectionVisible, setSectionVisible] = useState(false)
  const [inGallery,        setInGallery]        = useState(false)
  const [pastSelectedWork, setPastSelectedWork] = useState(false)
  const [navFading, setNavFading]           = useState(false)
  const [contentsHintDismissed, setContentsHintDismissed] = useState(false)
  const [welcomeMode, setWelcomeMode]       = useState(true)

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

  const firstInnerIdx = snappedPoints.length > 2 ? 1 : 0
  const lastInnerIdx  = snappedPoints.length > 2 ? snappedPoints.length - 2 : snappedPoints.length - 1

  // Per-section km ranges for section header visibility
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

  const scrollMapping = useMemo(() => {
    const dwell = snappedPoints.length > 2 ? snappedPoints.slice(1, -1) : snappedPoints
    const pxPerKm = window.innerWidth < MOBILE_BREAKPOINT ? BASE_PX_PER_KM / 3 : BASE_PX_PER_KM
    return buildScrollMapping(snappedPoints, dwell, pxPerKm)
  }, [snappedPoints])

  const progressItems = useMemo((): ProgressBarItem[] => {
    const items: ProgressBarItem[] = []
    let currentSectionId = ''
    let lastSectionName  = ''
    for (const sp of innerPoints) {
      if (!sp.sectionName) continue
      if (sp.sectionName !== lastSectionName) {
        lastSectionName  = sp.sectionName
        currentSectionId = `section-${sp.narrativeId}`
        items.push({
          id: currentSectionId,
          label: sp.contentsName || sp.sectionName,
          scrollPx: kmToPx(sp.distanceAlongPath, scrollMapping),
        })
      }
      if (sp.subsectionName) {
        items.push({
          id: `sub-${sp.narrativeId}`,
          label: sp.subsectionContentsName || sp.subsectionName,
          scrollPx: kmToPx(sp.distanceAlongPath, scrollMapping),
          parentId: currentSectionId,
        })
      }
    }
    items.push({ id: 'gallery', label: 'Selected work',
      scrollPx: scrollMapping.totalPx, elementId: 'gallery-selected-work' })
    items.push({ id: 'pricing', label: 'Pricing',
      scrollPx: scrollMapping.totalPx, elementId: 'gallery-pricing' })
    items.push({ id: 'contact', label: 'Contact',
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

  // Fade-transition navigation used by ProgressBar and "More info" / gallery buttons
  const handleNavigate = useCallback((targetPx: number) => {
    const el = scrollerRef.current
    if (!el) return
    setWelcomeMode(false)
    if (navTimerRef.current !== null) clearTimeout(navTimerRef.current)
    setNavFading(true)
    navTimerRef.current = window.setTimeout(() => {
      el.scrollTop = targetPx
      setNavFading(false)
      navTimerRef.current = null
    }, 300)
  }, [])

  // Smooth animated scroll to a specific POI — map pans visibly during travel
  const navigateToPoi = useCallback((targetSnappedIndex: number) => {
    const target = snappedPoints[targetSnappedIndex]
    const scroller = scrollerRef.current
    if (!target || !scroller) return

    const targetPx = kmToPx(target.distanceAlongPath, scrollMapping)

    // Suppress scroll-driven POI activation while animating
    navAnimatingRef.current = true
    setActivePoiIndex(null)
    setSectionVisible(false)
    setCurrentSectionName('')
    setDetailVisible(false)

    if (navAnimRef.current !== null) {
      cancelAnimationFrame(navAnimRef.current)
      navAnimRef.current = null
    }

    const startPx  = scroller.scrollTop
    const delta    = targetPx - startPx
    navDirectionRef.current = delta >= 0 ? 1 : -1
    const duration  = Math.max(NAV_ANIM_DURATION, Math.abs(delta) / (window.innerWidth < 768 ? MAX_SPEED_PX_PER_MS_MOB : MAX_SPEED_PX_PER_MS))
    const startTime = performance.now()
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      scroller.scrollTop = startPx + delta * ease(t)
      if (t < 1) {
        navAnimRef.current = requestAnimationFrame(step)
      } else {
        navAnimRef.current = null
        navAnimatingRef.current = false   // allow POI activation again
        navDirectionRef.current = 1       // reset to forward once stopped
        handleScrollRef.current?.()       // guarantee POI activation fires
      }
    }
    navAnimRef.current = requestAnimationFrame(step)
  }, [snappedPoints, scrollMapping])

  // Animate scroll to gallery (used by "Next port" at the last POI — no fade, cursor travels the track)
  const navigateToGallery = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    navAnimatingRef.current = true
    setActivePoiIndex(null)
    setSectionVisible(false)
    setCurrentSectionName('')
    setDetailVisible(false)

    if (navAnimRef.current !== null) {
      cancelAnimationFrame(navAnimRef.current)
      navAnimRef.current = null
    }

    const startPx  = scroller.scrollTop
    const targetPx = scrollMapping.totalPx
    const delta    = targetPx - startPx
    navDirectionRef.current = 1  // always forward into gallery
    const duration  = Math.max(NAV_ANIM_DURATION, Math.abs(delta) / (window.innerWidth < 768 ? MAX_SPEED_PX_PER_MS_MOB : MAX_SPEED_PX_PER_MS))
    const startTime = performance.now()
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      scroller.scrollTop = startPx + delta * ease(t)
      if (t < 1) {
        navAnimRef.current = requestAnimationFrame(step)
      } else {
        navAnimRef.current = null
        navAnimatingRef.current = false
        handleScrollRef.current?.()  // guarantee gallery transition fires
      }
    }
    navAnimRef.current = requestAnimationFrame(step)
  }, [scrollMapping.totalPx])

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    const map      = mapRef.current
    if (!scroller || !map) return

    const scrollTop        = scroller.scrollTop
    const scrollRangePx    = scrollMapping.totalPx
    const galleryThreshold = Math.max(0, scrollRangePx - GALLERY_FADE_PX)
    galleryThresholdRef.current = galleryThreshold
    const newInGallery     = scrollTop >= galleryThreshold
    inGalleryRef.current   = newInGallery
    setInGallery(newInGallery)

    // Track whether user has scrolled past the 'Selected work' heading
    if (newInGallery) {
      const gwEl = document.getElementById('gallery-selected-work')
      const scrollerRect = scroller.getBoundingClientRect()
      setPastSelectedWork(gwEl ? gwEl.getBoundingClientRect().top < scrollerRect.top : false)
    } else {
      setPastSelectedWork(false)
    }

    const clampedPx = Math.min(scrollTop, scrollRangePx)
    const km        = scrollPxToKm(clampedPx, scrollMapping)
    const center    = kmToLngLat(km)

    map.easeTo({ center, zoom: (window.innerWidth < 768 ? FIXED_ZOOM_MOB : FIXED_ZOOM), bearing: FIXED_BEARING, duration: 100, easing: (t) => t })

    const rawBearing = getBearingAtKm(km)
    const bearing = navDirectionRef.current === -1 ? (rawBearing + 180) % 360 : rawBearing
    const cursorSource = map.getSource('journey-cursor') as maplibregl.GeoJSONSource | undefined
    if (cursorSource) {
      cursorSource.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        properties: { bearing },
      })
    }

    // POI and section activation — skipped during programmatic nav animation
    if (navAnimatingRef.current) return

    const firstIdx = firstInnerIdx
    const lastIdx  = lastInnerIdx
    let newActive: number | null = null
    for (let i = firstIdx; i <= lastIdx; i++) {
      if (Math.abs(km - snappedPoints[i].distanceAlongPath) <= POI_WINDOW_KM) {
        newActive = i
        break
      }
    }

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
  }, [snappedPoints, sectionRanges, scrollMapping, kmToLngLat, getBearingAtKm, firstInnerIdx, lastInnerIdx])

  // Cross-fade subsection detail when active POI changes
  const activePoi: SnappedPoint | null =
    activePoiIndex !== null ? snappedPoints[activePoiIndex] : null

  useEffect(() => {
    if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current)

    // Don't update panel content while nav animation is running
    if (navAnimatingRef.current) return

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

  // Keep inGalleryRef in sync (used inside passive event handlers)
  useEffect(() => { inGalleryRef.current = inGallery }, [inGallery])


  // Keep handleScrollRef current so animation-end callbacks can call it
  useEffect(() => { handleScrollRef.current = handleScroll }, [handleScroll])

  // Hash deep-link: when opened as a new tab via "More info", jump to the gallery card
  useEffect(() => {
    if (!mapReady) return
    const hash = window.location.hash
    if (!hash.startsWith('#gallery-card-')) return
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = scrollMapping.totalPx
    const t = window.setTimeout(() => {
      const card = document.getElementById(hash.slice(1))
      if (!card || !scrollerRef.current) return
      const scr = scrollerRef.current
      const offset = card.getBoundingClientRect().top + scr.scrollTop - scr.getBoundingClientRect().top
      scr.scrollTop = offset - 80
    }, 500)
    return () => clearTimeout(t)
  }, [mapReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-warm tile caches during browser idle time once the map is visible
  useEffect(() => {
    if (!mapReady) return
    let cancelled = false
    prefetchTiles(() => cancelled)
    return () => { cancelled = true }
  }, [mapReady])

  // Initialise map once
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialCenter: [number, number] =
      snappedPoints.length > 0 ? snappedPoints[0].snappedCoord : [14.0, 67.9]

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: initialCenter,
      zoom: (window.innerWidth < 768 ? FIXED_ZOOM_MOB : FIXED_ZOOM),
      bearing: FIXED_BEARING,
      interactive: false,
      attributionControl: false,
    })

    mapRef.current = map
    const mapInitTime = Date.now()
    idleTimerRef.current = window.setTimeout(() => setMapReady(true), 8000)

    map.on('load', () => {
      const startKm  = snappedPoints[0]?.distanceAlongPath ?? 0
      const bKm2     = Math.min(data.totalDistance, startKm + 0.5)
      const bPt1     = turf.along(pathLine, startKm, { units: 'kilometers' })
      const bPt2     = turf.along(pathLine, bKm2,    { units: 'kilometers' })
      const initBearing = turf.bearing(bPt1, bPt2)

      map.addImage('path-arrow',   makePathArrow())
      map.addImage('cursor-arrow', makeCursorArrow())

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

      map.once('idle', () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
        const elapsed   = Date.now() - mapInitTime
        const remaining = Math.max(0, MIN_OVERLAY_MS - elapsed)
        idleTimerRef.current = window.setTimeout(() => {
          setMapReady(true)
          idleTimerRef.current = null
        }, remaining)
      })
    })

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Wire scroll listener and block user-initiated scrolling during journey
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(handleScroll)
    }

    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY
    }

    // Block wheel/touch scroll in journey mode; also block upward scroll at gallery entry.
    // When in journey mode but near the gallery threshold, allow downward scroll so the
    // user can recover if they accidentally crossed the boundary.
    const blockScroll = (e: Event) => {
      const scr = scrollerRef.current
      if (!inGalleryRef.current) {
        // Allow downward scroll near gallery entry for recovery
        if (e.type === 'wheel') {
          const we = e as WheelEvent
          if (we.deltaY > 0 && scr && scr.scrollTop >= galleryThresholdRef.current - 300) return
        } else if (e.type === 'touchmove') {
          const currentY = (e as TouchEvent).touches[0].clientY
          if (currentY < touchStartYRef.current && scr && scr.scrollTop >= galleryThresholdRef.current - 300) return
        }
        e.preventDefault()
        return
      }
      // Gallery mode: block upward scroll that would re-enter the journey section
      if (scr && scr.scrollTop <= galleryThresholdRef.current + 150) {
        if (e.type === 'wheel' && (e as WheelEvent).deltaY < 0) {
          e.preventDefault()
        } else if (e.type === 'touchmove' &&
                   (e as TouchEvent).touches[0].clientY > touchStartYRef.current) {
          e.preventDefault()
        }
      }
    }

    scroller.addEventListener('scroll',     onScroll,     { passive: true })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('wheel',      blockScroll,  { passive: false })
    scroller.addEventListener('touchmove',  blockScroll,  { passive: false })

    return () => {
      scroller.removeEventListener('scroll',     onScroll)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('wheel',      blockScroll)
      scroller.removeEventListener('touchmove',  blockScroll)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (navAnimRef.current !== null) cancelAnimationFrame(navAnimRef.current)
    }
  }, [handleScroll])

  // ── Derived values ─────────────────────────────────────────────────────────

  const panelVisible = sectionVisible || detailVisible
  // Wide two-column layout whenever there is an image to show (desktop only via CSS)
  const panelWide = !welcomeMode && !!displayedPoi?.image

  const displayedPoiSnappedIdx = useMemo(() => {
    if (!displayedPoi) return -1
    return snappedPoints.findIndex((sp) => sp.narrativeId === displayedPoi.narrativeId)
  }, [displayedPoi, snappedPoints])

  const canGoPrev = displayedPoiSnappedIdx > firstInnerIdx
  // canGoNext includes lastInnerIdx — at last POI, "Next port" goes to gallery
  const canGoNext = displayedPoiSnappedIdx >= 0 && displayedPoiSnappedIdx <= lastInnerIdx

  const panelCurrentlyVisible = (welcomeMode || panelVisible) && !inGallery

  // Contents hint: show when user arrives at the second real POI (first gives time to read)
  const contentsHintVisible = !contentsHintDismissed && !welcomeMode &&
    displayedPoiSnappedIdx === firstInnerIdx + 1

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className={`journey-root${progressBarOpen ? ' journey-root--pb-open' : ''}`}>
      {/* Dark overlay fades out once map+PMTiles are rendered */}
      <div
        className="map-loading-overlay"
        style={{ opacity: mapReady ? 0 : 1, pointerEvents: mapReady ? 'none' : 'auto' }}
        aria-hidden="true"
      />

      {/* Full-screen overlay for ProgressBar fade-nav transition */}
      <div className={`nav-overlay${navFading ? ' nav-overlay--fading' : ''}`} aria-hidden="true" />

      <div className="map-container" ref={mapContainerRef} />

      <ProgressBar
        items={progressItems}
        scrollerRef={scrollerRef}
        inGallery={inGallery}
        onNavigate={handleNavigate}
        onOpenChange={setProgressBarOpen}
      />

      <header className={`journey-header${inGallery ? ' journey-header--hidden' : ''}`}>
        <h1 className="journey-heading">
          <span className="journey-k-wrap">
            <span className="journey-k-char">K</span>
            <img
              className="journey-k-logo"
              src={`${import.meta.env.BASE_URL}kuril_logo_basic.svg`}
              alt=""
              aria-hidden="true"
            />
          </span>uril Geospatial
        </h1>
        <div className="journey-contact">
          Contact Harry:<br />
          <a href="mailto:projects@HKuril.com">projects@HKuril.com</a>
        </div>
      </header>

      {/* POI panel — centred, with prev/next port navigation */}
      <aside
        ref={panelRef}
        className={[
          'poi-panel',
          panelCurrentlyVisible ? 'poi-panel--visible' : '',
          panelWide           ? 'poi-panel--wide'    : '',
        ].filter(Boolean).join(' ')}
      >
        {welcomeMode ? (
          /* Welcome screen shown before the first port */
          <div className="poi-panel-welcome">
            <div className="poi-panel-section">Does your project need&hellip;</div>
            <div className="poi-panel-label">Kuril Geospatial?</div>
            <p className="poi-panel-description">
              Click &lsquo;Next port&rsquo; to see what Kuril Geospatial can do for you.
            </p>
            <button
              className="poi-nav-btn poi-nav-btn--next"
              onClick={() => { setWelcomeMode(false); navigateToPoi(firstInnerIdx) }}
            >
              Next port <span className="poi-nav-arrow">↓</span>
            </button>
          </div>
        ) : (
          <>
            {canGoPrev && displayedPoi && (
              <button
                className="poi-nav-btn poi-nav-btn--prev"
                onClick={() => navigateToPoi(displayedPoiSnappedIdx - 1)}
                aria-label="Previous port"
              >
                <span className="poi-nav-arrow">↑</span>
                Previous port
              </button>
            )}
            <div className="poi-panel-section">{currentSectionName}</div>
            <div className={`poi-panel-detail${detailVisible ? ' poi-panel-detail--visible' : ''}`}>
              {displayedPoi && displayedPoi.subsectionName && (
                displayedPoi.image ? (
                  /* Two-column layout when an image is present */
                  <div className="poi-panel-cols">
                    <div className="poi-panel-col-text">
                      <div className="poi-panel-label">{displayedPoi.subsectionName}</div>
                      <p
                        className="poi-panel-description"
                        dangerouslySetInnerHTML={{ __html: displayedPoi.text }}
                      />
                      {displayedPoi.galleryId && (
                        <p className="poi-more-info-text">
                          <em>More info in 'Selected Work' section</em>
                        </p>
                      )}
                    </div>
                    <div className="poi-panel-col-image">
                      <img
                        key={displayedPoi.image}
                        className="poi-panel-image"
                        src={`${import.meta.env.BASE_URL}gallery/${displayedPoi.image}`}
                        alt={displayedPoi.subsectionName}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  /* Single-column layout when no image */
                  <>
                    <div className="poi-panel-label">{displayedPoi.subsectionName}</div>
                    <p
                      className="poi-panel-description"
                      dangerouslySetInnerHTML={{ __html: displayedPoi.text }}
                    />
                    {displayedPoi.galleryId && (
                      <p className="poi-more-info-text">
                        <em>More info in 'Selected Work' section</em>
                      </p>
                    )}
                  </>
                )
              )}
            </div>
            {canGoNext && displayedPoi && (
              <button
                className="poi-nav-btn poi-nav-btn--next"
                onClick={() => {
                  if (displayedPoiSnappedIdx === lastInnerIdx) {
                    navigateToGallery()
                  } else {
                    navigateToPoi(displayedPoiSnappedIdx + 1)
                  }
                }}
                aria-label="Next port"
              >
                Next port <span className="poi-nav-arrow">↓</span>
              </button>
            )}
          </>
        )}
      </aside>

      {/* "Previous port" button visible at the top of the gallery section, hides once past heading */}
      {inGallery && !pastSelectedWork && (
        <button
          className="gallery-prev-port-btn"
          onClick={() => navigateToPoi(lastInnerIdx)}
        >
          <span className="poi-nav-arrow">↑</span> Previous port
        </button>
      )}

      <AttributionWidget hidden={inGallery} />

      {/* Scroll capture overlay — spacer height drives programmatic navigation;
          user scroll is blocked by the wheel/touchmove handlers above */}
      <div className="scroll-overlay" ref={scrollerRef}>
        <div style={{ height: `${scrollMapping.totalPx}px` }} />
        <GallerySection />
      </div>

      <div
        className={`gallery-bottom-buffer${inGallery ? ' gallery-bottom-buffer--visible' : ''}`}
        aria-hidden="true"
      />

      {contentsHintVisible && (
        <div className="contents-hint" role="status">
          <span>&#8592; Skip to section</span>
          <button
            className="contents-hint-dismiss"
            onClick={() => setContentsHintDismissed(true)}
            aria-label="Dismiss hint"
          >×</button>
        </div>
      )}
    </div>
  )
}
