import { useEffect, useState } from 'react'
import * as turf from '@turf/turf'
import type { Feature, LineString, FeatureCollection } from 'geojson'
import type { LoadedData, LabelledPointProps, SnappedPoint } from '../types'
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
        const [styleRes, pathRes, pointsRes] = await Promise.all([
          fetch('/composite.json'),
          fetch('/hais_2025-03-21--24.geojson'),
          fetch('/labelled_points.geojson'),
        ])

        if (!styleRes.ok || !pathRes.ok || !pointsRes.ok) {
          throw new Error('Failed to fetch one or more data files')
        }

        setProgress(40)
        setStatus('Parsing spatial data...')

        const [style, pathGeoJSON, labelledPointsGeoJSON] = await Promise.all([
          styleRes.json(),
          pathRes.json() as Promise<FeatureCollection>,
          pointsRes.json() as Promise<FeatureCollection>,
        ])

        setProgress(65)
        setStatus('Calculating path geometry...')

        const pathFeature = pathGeoJSON.features[0] as Feature<LineString>
        const pathLine = turf.lineString(pathFeature.geometry.coordinates)
        const totalDistance = turf.length(pathLine, { units: 'kilometers' })

        setProgress(80)
        setStatus('Snapping points to path...')

        // For each labelled point, find the closest point on the path
        const snappedPoints: SnappedPoint[] = labelledPointsGeoJSON.features.map((feat) => {
          const props = feat.properties as LabelledPointProps
          const pt = feat.geometry as { type: string; coordinates: [number, number] }
          const turfPt = turf.point(pt.coordinates)

          // Find closest point on the line
          const snapped = turf.nearestPointOnLine(pathLine, turfPt, { units: 'kilometers' })
          const snappedCoord = snapped.geometry.coordinates as [number, number]

          // Distance along path to this snapped point
          const distanceAlongPath = snapped.properties.location ?? 0

          return { props, snappedCoord, distanceAlongPath }
        })

        // Sort by distance along path
        snappedPoints.sort((a, b) => a.distanceAlongPath - b.distanceAlongPath)

        setProgress(100)
        setStatus('Ready')

        // Small delay so the 100% flash is visible
        await new Promise((r) => setTimeout(r, 400))

        onLoaded({
          pathFeature,
          pathGeoJSON: pathGeoJSON as FeatureCollection,
          labelledPointsGeoJSON,
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
              <div
                className="loading-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="loading-status">{status}</p>
          </>
        )}
      </div>
      <div className="loading-grid" aria-hidden="true" />
    </div>
  )
}
