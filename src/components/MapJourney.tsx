import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as turf from '@turf/turf'
import type { LoadedData, SnappedPoint } from '../types'
import './MapJourney.css'

interface Props {
  data: LoadedData
}

const FIXED_ZOOM = 11
const POI_WINDOW_KM = 5 // km either side of a POI to show its panel
const BASE_PX_PER_KM = 600

/**
 * Build normalised scroll breakpoints [0..1] for each snapped POI.
 * Each segment (A→B, B→C, etc.) gets equal scroll distance,
 * making dwell time constant between points regardless of km gap.
 */
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

  const [activePoiIndex, setActivePoiIndex] = useState<number | null>(null)
  const [panelVisible, setPanelVisible] = useState(false)
  const [scrollHintVisible, setScrollHintVisible] = useState(true)

  const { pathFeature, snappedPoints, style } = data

  const pathLine = useMemo(
    () => turf.lineString(pathFeature.geometry.coordinates),
    [pathFeature],
  )

  const poiScrollNorms = useMemo(
    () => buildPoiScrollNorms(snappedPoints),
    [snappedPoints],
  )

  // Total scrollable distance in px (excluding viewport height)
  const scrollRangePx = useMemo(() => {
    const nSegments = Math.max(snappedPoints.length - 1, 1)
    return nSegments * BASE_PX_PER_KM + BASE_PX_PER_KM * 0.5
  }, [snappedPoints])

  const scrollContentHeight = scrollRangePx + window.innerHeight

  /** Map a normalised scroll position [0..1] → km along path */
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

  /** Map km along path → [lng, lat] */
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

    map.easeTo({ center, zoom: FIXED_ZOOM, duration: 100, easing: (t) => t })

    // Hide scroll hint on first scroll
    if (scrollTop > 10) setScrollHintVisible(false)

    // Find active POI within ±POI_WINDOW_KM
    let newActive: number | null = null
    for (let i = 0; i < snappedPoints.length; i++) {
      if (Math.abs(km - snappedPoints[i].distanceAlongPath) <= POI_WINDOW_KM) {
        newActive = i
        break
      }
    }

    setActivePoiIndex(newActive)
    setPanelVisible(newActive !== null)
  }, [snappedPoints, scrollRangePx, scrollNormToKm, kmToLngLat])

  // Initialise map
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialCenter: [number, number] =
      snappedPoints.length > 0 ? snappedPoints[0].snappedCoord : [12.2, 65.5]

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: style as maplibregl.StyleSpecification,
      center: initialCenter,
      zoom: FIXED_ZOOM,
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
          properties: { name: sp.props.name },
        })),
      }
      map.addSource('journey-pois', { type: 'geojson', data: poisGeoJSON })
      map.addLayer({
        id: 'journey-pois-halo',
        type: 'circle',
        source: 'journey-pois',
        paint: {
          'circle-radius': 12,
          'circle-color': '#f0abfc',
          'circle-opacity': 0.18,
        },
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

  const activePoi: SnappedPoint | null =
    activePoiIndex !== null ? snappedPoints[activePoiIndex] : null

  return (
    <div className="journey-root">
      <div className="map-container" ref={mapContainerRef} />

      <header className="journey-header">
        <h1 className="journey-heading">
          <span className="journey-heading-kuril">Kuril</span>
          <span className="journey-heading-geo">Geospatial</span>
        </h1>
      </header>

      <aside className={`poi-panel ${panelVisible ? 'poi-panel--visible' : ''}`}>
        {activePoi && (
          <>
            <div className="poi-panel-label">{activePoi.props.name}</div>
            <p className="poi-panel-description">{activePoi.props.description}</p>
            <div className="poi-panel-km">
              {activePoi.distanceAlongPath.toFixed(1)} km along route
            </div>
          </>
        )}
      </aside>

      {/* Transparent scroll capture layer */}
      <div className="scroll-overlay" ref={scrollerRef}>
        <div className="scroll-content" style={{ height: `${scrollContentHeight}px` }} />
      </div>

      <div className={`scroll-hint ${scrollHintVisible ? '' : 'scroll-hint--hidden'}`} aria-hidden="true">
        <span>Scroll to explore</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>
    </div>
  )
}
