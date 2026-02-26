import { useEffect, useState } from 'react'
import type { Feature, LineString, FeatureCollection } from 'geojson'
import * as turf from '@turf/turf'
import type { LoadedData, NarrativeData, SnappedPoint } from '../types'
import './LoadingScreen.css'

interface Props {
  onLoaded: (data: LoadedData) => void
}

export default function LoadingScreen({ onLoaded }: Props) {
  const [status, setStatus]     = useState('Initialising...')
  const [progress, setProgress] = useState(0)
  const [error, setError]       = useState<string | null>(null)
  const [fontReady, setFontReady] = useState(false)

  // Show title only after Pixelify Sans has loaded so it doesn't flash in
  // with a fallback font.
  useEffect(() => {
    const timer = setTimeout(() => setFontReady(true), 2500) // hard fallback
    document.fonts
      .load("700 1em 'Pixelify Sans'")
      .then(() => {
        clearTimeout(timer)
        setFontReady(true)
      })
      .catch(() => {
        clearTimeout(timer)
        setFontReady(true)
      })
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        setStatus('Loading map style...')
        setProgress(10)

        const base = import.meta.env.BASE_URL
        const [styleRes, pathRes, pointsRes, narrativeRes] = await Promise.all([
          fetch(`${base}composite.json`),
          fetch(`${base}ship_track.geojson`),
          fetch(`${base}labelled_points.geojson`),
          fetch(`${base}narrative.json`),
        ])

        if (!styleRes.ok || !pathRes.ok || !pointsRes.ok || !narrativeRes.ok) {
          throw new Error('Failed to fetch one or more data files')
        }

        setProgress(40)
        setStatus('Parsing spatial data...')

        const [style, pathGeoJSON, labelledPointsGeoJSON, narrativeRaw] = await Promise.all([
          styleRes.json(),
          pathRes.json() as Promise<FeatureCollection>,
          pointsRes.json() as Promise<FeatureCollection>,
          narrativeRes.json() as Promise<NarrativeData>,
        ])

        setProgress(60)
        setStatus('Building narrative index...')

        type NarrativeLookup = {
          sectionName: string
          contentsName: string
          subsectionName: string
          subsectionContentsName: string
          text: string
          image: string | null
        }
        const narrativeLookup = new Map<number, NarrativeLookup>()
        for (const section of narrativeRaw.sections) {
          const raw = section as unknown as Record<string, unknown>
          const contentsName = raw['contents-name'] as string ?? section.name
          for (const sub of section.subsections) {
            const subRaw = sub as unknown as Record<string, unknown>
            const subsectionContentsName = subRaw['contents-name'] as string ?? sub.name
            narrativeLookup.set(sub.number, {
              sectionName: section.name,
              contentsName,
              subsectionName: sub.name,
              subsectionContentsName,
              text: sub.text,
              image: sub.image,
            })
          }
        }

        setProgress(70)
        setStatus('Calculating path geometry...')

        const pathFeature  = pathGeoJSON.features[0] as Feature<LineString>
        const pathLine     = turf.lineString(pathFeature.geometry.coordinates)
        const totalDistance = turf.length(pathLine, { units: 'kilometers' })

        setProgress(85)
        setStatus('Snapping points to path...')

        const snappedPoints: SnappedPoint[] = labelledPointsGeoJSON.features.map((feat) => {
          const rawId = (feat.properties as Record<string, unknown>)['id'] as number
          const pt    = feat.geometry as { type: string; coordinates: [number, number] }
          const turfPt = turf.point(pt.coordinates)

          const snapped        = turf.nearestPointOnLine(pathLine, turfPt, { units: 'kilometers' })
          const snappedCoord   = snapped.geometry.coordinates as [number, number]
          const distanceAlongPath = snapped.properties.location ?? 0

          const narrative = narrativeLookup.get(rawId)

          return {
            narrativeId: rawId,
            sectionName: narrative?.sectionName ?? '',
            contentsName: narrative?.contentsName ?? '',
            subsectionName: narrative?.subsectionName ?? '',
            subsectionContentsName: narrative?.subsectionContentsName ?? '',
            text: narrative?.text ?? '',
            image: narrative?.image ?? null,
            snappedCoord,
            distanceAlongPath,
          }
        })

        snappedPoints.sort((a, b) => a.distanceAlongPath - b.distanceAlongPath)

        setProgress(100)
        setStatus('Ready')

        await new Promise((r) => setTimeout(r, 400))

        onLoaded({
          pathFeature,
          pathGeoJSON: pathGeoJSON as FeatureCollection,
          snappedPoints,
          totalDistance,
          style,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    load()
  }, [onLoaded])

  return (
    <div className="loading-screen">
      <div className="loading-content">
        <img
          className="loading-logo"
          src={`${import.meta.env.BASE_URL}kuril_logo_basic.svg`}
          alt=""
          aria-hidden="true"
        />
        <h1 className={`loading-title${fontReady ? ' loading-title--visible' : ''}`}>
          Kuril Geospatial
        </h1>
        {error ? (
          <div className="loading-error">
            <span className="loading-error-icon">⚠</span>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <div className="loading-bar-track">
              <div className="loading-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="loading-status">{status}</p>
          </>
        )}
      </div>
      <div className="loading-grid" aria-hidden="true" />
    </div>
  )
}
