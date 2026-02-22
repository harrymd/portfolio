import type { Feature, LineString, FeatureCollection } from 'geojson'

export interface LabelledPointProps {
  fid: number
  name: string
  description: string
}

export interface SnappedPoint {
  props: LabelledPointProps
  snappedCoord: [number, number] // [lng, lat]
  distanceAlongPath: number // km from start
}

export interface LoadedData {
  pathFeature: Feature<LineString>
  pathGeoJSON: FeatureCollection
  labelledPointsGeoJSON: FeatureCollection
  snappedPoints: SnappedPoint[]
  totalDistance: number // km
  style: object
}
