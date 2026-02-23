import { useEffect, useState } from 'react'
import * as turf from '@turf/turf'
import type { Feature, LineString, FeatureCollection } from 'geojson'
import type { LoadedData, NarrativeData, SnappedPoint } from '../types'
import './LoadingScreen.css'

interface Props {
  onLoaded: (data: LoadedData) => void
}

export default function LoadingScreen({ onLoaded }: Props) {
  const [status, setStatus] = useState('Initialising...')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        setStatus('Loading map style...')
        setProgress(10)

        const [styleRes, pathRes, pointsRes, narrativeRes] = await Promise.all([
          fetch('/composite.json'),
          fetch('/ship_track.geojson'),
          fetch('/labelled_points.geojson'),
          fetch('/narrative.json'),
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

        // Flat lookup: subsection.number → { sectionName, subsectionName, text, image }
        type NarrativeLookup = {
          sectionName: string
          subsectionName: string
          text: string
          image: string | null
        }
        const narrativeLookup = new Map<number, NarrativeLookup>()
        for (const section of narrativeRaw.sections) {
          for (const sub of section.subsections) {
            narrativeLookup.set(sub.number, {
              sectionName: section.name,
              subsectionName: sub.name,
              text: sub.text,
              image: sub.image,
            })
          }
        }

        setProgress(70)
        setStatus('Calculating path geometry...')

        const pathFeature = pathGeoJSON.features[0] as Feature<LineString>
        const pathLine = turf.lineString(pathFeature.geometry.coordinates)
        const totalDistance = turf.length(pathLine, { units: 'kilometers' })

        setProgress(85)
        setStatus('Snapping points to path...')

        const snappedPoints: SnappedPoint[] = labelledPointsGeoJSON.features.map((feat) => {
          const rawId = (feat.properties as Record<string, unknown>)['id'] as number
          const pt = feat.geometry as { type: string; coordinates: [number, number] }
          const turfPt = turf.point(pt.coordinates)

          const snapped = turf.nearestPointOnLine(pathLine, turfPt, { units: 'kilometers' })
          const snappedCoord = snapped.geometry.coordinates as [number, number]
          const distanceAlongPath = snapped.properties.location ?? 0

          // Look up narrative content by id (direct match on subsection.number)
          const narrative = narrativeLookup.get(rawId)

          return {
            narrativeId: rawId,
            sectionName: narrative?.sectionName ?? '',
            subsectionName: narrative?.subsectionName ?? '',
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
        <div className="loading-title">
          <span className="loading-title-kuril">Kuril</span>
          <span className="loading-title-geo">Geospatial</span>
        </div>
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
