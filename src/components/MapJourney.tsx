import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as turf from '@turf/turf'
import type { LoadedData, SnappedPoint } from '../types'
import AttributionWidget from './AttributionWidget'
import './MapJourney.css'

interface Props {
  data: LoadedData
}

const FIXED_ZOOM = 10
const FIXED_BEARING = 220
const POI_WINDOW_KM = 10
const BASE_PX_PER_KM = 600
const MOBILE_BREAKPOINT = 768

function buildPoiScrollNorms(snappedPoints: SnappedPoint[]): number[] {
  if (snappedPoints.length === 0) return []
  const cumulative: number[] = [0]
  for (let i = 1; i < snappedPoints.length; i++) {
    cumulative.push(cumulative[i - 1] + BASE_PX_PER_KM)
  }
  const tail = BASE_PX_PER_KM * 0.5
  const total = cumulative[cumulative.length - 1] + tail
  return cumulative.map((v) => v / total)
}

export default function MapJourney({ data }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const detailTimerRef = useRef<number | null>(null)

  const [activePoiIndex, setActivePoiIndex] = useState<number | null>(null)
  const [currentSectionName, setCurrentSectionName] = useState<string>('')
  const [scrollHintVisible, setScrollHintVisible] = useState(true)

  // Separate "displayed" POI from "active" POI so we can cross-fade content
  const [displayedPoi, setDisplayedPoi] = useState<SnappedPoint | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  const { pathFeature, snappedPoints, style } = data

  const pathLine = useMemo(
    () => turf.lineString(pathFeature.geometry.coordinates),
    [pathFeature],
  )

  const poiScrollNorms = useMemo(() => buildPoiScrollNorms(snappedPoints), [snappedPoints])

  const scrollRangePx = useMemo(() => {
    const nSegments = Math.max(snappedPoints.length - 1, 1)
    return nSegments * BASE_PX_PER_KM + BASE_PX_PER_KM * 0.5
  }, [snappedPoints])

  const scrollContentHeight = scrollRangePx + window.innerHeight

  const scrollNormToKm = useCallback(
    (norm: number): number => {
      if (snappedPoints.length === 0) return 0
      if (norm <= 0) return snappedPoints[0].distanceAlongPath
      if (norm >= 1) return snappedPoints[snappedPoints.length - 1].distanceAlongPath
      for (let i = 0; i < poiScrollNorms.length - 1; i++) {
        const t0 = poiScrollNorms[i]
        const t1 = poiScrollNorms[i + 1]
        if (norm >= t0 && norm <= t1) {
          const segT = (norm - t0) / (t1 - t0)
          const km0 = snappedPoints[i].distanceAlongPath
          const km1 = snappedPoints[i + 1].distanceAlongPath
          return km0 + segT * (km1 - km0)
        }
      }
      return snappedPoints[snappedPoints.length - 1].distanceAlongPath
    },
    [snappedPoints, poiScrollNorms],
  )

  const kmToLngLat = useCallback(
    (km: number): [number, number] => {
      const pt = turf.along(pathLine, km, { units: 'kilometers' })
      return pt.geometry.coordinates as [number, number]
    },
    [pathLine],
  )

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    const map = mapRef.current
    if (!scroller || !map) return

    const scrollTop = scroller.scrollTop
    const norm = Math.min(1, Math.max(0, scrollTop / scrollRangePx))
    const km = scrollNormToKm(norm)
    const center = kmToLngLat(km)

    // Mobile: shift target up to 25% from top; desktop: centred.
    // offset[1] = desired_y - H/2; desired_y = 0.25*H → offset[1] = -0.25*H
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT
    const offset: [number, number] = isMobile ? [0, -window.innerHeight / 4] : [0, 0]

    map.easeTo({ center, zoom: FIXED_ZOOM, bearing: FIXED_BEARING, duration: 100, easing: (t) => t, offset })

    // Update the live cursor position directly on the map source (no React re-render needed)
    const cursorSource = map.getSource('journey-cursor') as maplibregl.GeoJSONSource | undefined
    if (cursorSource) {
      cursorSource.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: center },
        properties: {},
      })
    }

    if (scrollTop > 10) setScrollHintVisible(false)

    // Active subsection: within ±POI_WINDOW_KM of a snapped point
    let newActive: number | null = null
    for (let i = 0; i < snappedPoints.length; i++) {
      if (Math.abs(km - snappedPoints[i].distanceAlongPath) <= POI_WINDOW_KM) {
        newActive = i
        break
      }
    }

    // Current section: section of the last point we've passed (or are within POI_WINDOW_KM ahead of)
    let newSectionName = ''
    for (let i = snappedPoints.length - 1; i >= 0; i--) {
      if (snappedPoints[i].distanceAlongPath <= km + POI_WINDOW_KM) {
        newSectionName = snappedPoints[i].sectionName
        break
      }
    }

    setActivePoiIndex(newActive)
    setCurrentSectionName(newSectionName)
  }, [snappedPoints, scrollRangePx, scrollNormToKm, kmToLngLat])

  // Cross-fade the subsection detail when activePoi changes
  const activePoi: SnappedPoint | null =
    activePoiIndex !== null ? snappedPoints[activePoiIndex] : null

  useEffect(() => {
    if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current)

    if (!activePoi) {
      // Fade out detail; keep displayedPoi so content doesn't vanish mid-fade
      setDetailVisible(false)
      return
    }

    if (!displayedPoi || activePoi.narrativeId !== displayedPoi.narrativeId) {
      // Different subsection: fade out → swap content → fade in
      setDetailVisible(false)
      detailTimerRef.current = window.setTimeout(() => {
        setDisplayedPoi(activePoi)
        setDetailVisible(true)
      }, 280)
    } else {
      // Same subsection, just ensure it's visible
      setDetailVisible(true)
    }
  }, [activePoi]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise map
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

    map.on('load', () => {
      // Path line
      map.addSource('journey-path', { type: 'geojson', data: data.pathGeoJSON })
      map.addLayer({
        id: 'journey-path-bg',
        type: 'line',
        source: 'journey-path',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0ea5e9', 'line-width': 6, 'line-opacity': 0.18 },
      })
      map.addLayer({
        id: 'journey-path-line',
        type: 'line',
        source: 'journey-path',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-opacity': 0.9 },
      })

      // Snapped POI markers
      const poisGeoJSON: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: snappedPoints.map((sp) => ({
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
        paint: { 'circle-radius': 12, 'circle-color': '#f0abfc', 'circle-opacity': 0.18 },
      })
      map.addLayer({
        id: 'journey-pois-dot',
        type: 'circle',
        source: 'journey-pois',
        paint: {
          'circle-radius': 5,
          'circle-color': '#f0abfc',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0b0f14',
          'circle-opacity': 1,
        },
      })

      // Live cursor: current position along track
      map.addSource('journey-cursor', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: initialCenter },
          properties: {},
        },
      })
      // Outer glow ring
      map.addLayer({
        id: 'journey-cursor-ring',
        type: 'circle',
        source: 'journey-cursor',
        paint: {
          'circle-radius': 14,
          'circle-color': 'transparent',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#7dd3fc',
          'circle-stroke-opacity': 0.5,
        },
      })
      // Inner filled circle
      map.addLayer({
        id: 'journey-cursor-dot',
        type: 'circle',
        source: 'journey-cursor',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#7dd3fc',
          'circle-opacity': 1,
        },
      })
    })

    return () => {
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

  const panelVisible = currentSectionName !== ''

  return (
    <div className="journey-root">
      <div className="map-container" ref={mapContainerRef} />

      <header className="journey-header">
        <h1 className="journey-heading">
          <span className="journey-heading-kuril">Kuril</span>
          <span className="journey-heading-geo">Geospatial</span>
        </h1>
      </header>

      {/* POI panel */}
      <aside className={`poi-panel ${panelVisible ? 'poi-panel--visible' : ''}`}>
        <div className="poi-panel-section">{currentSectionName}</div>
        <div className={`poi-panel-detail ${detailVisible ? 'poi-panel-detail--visible' : ''}`}>
          {displayedPoi && displayedPoi.subsectionName && (
            <>
              <div className="poi-panel-label">{displayedPoi.subsectionName}</div>
              <p
                className="poi-panel-description"
                dangerouslySetInnerHTML={{ __html: displayedPoi.text }}
              />
              {displayedPoi.image && (
                <img
                  className="poi-panel-image"
                  src={`/gallery/${displayedPoi.image}`}
                  alt={displayedPoi.subsectionName}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              )}
            </>
          )}
        </div>
      </aside>

      <AttributionWidget />

      {/* Scroll capture overlay */}
      <div className="scroll-overlay" ref={scrollerRef}>
        <div className="scroll-content" style={{ height: `${scrollContentHeight}px` }} />
      </div>

      <div
        className={`scroll-hint ${scrollHintVisible ? '' : 'scroll-hint--hidden'}`}
        aria-hidden="true"
      >
        <span>Scroll to explore</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>
    </div>
  )
}
