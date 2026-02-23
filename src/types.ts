import type { Feature, LineString, FeatureCollection } from 'geojson'

export interface NarrativeSubsection {
  number: number
  name: string
  text: string
  image: string | null
}

export interface NarrativeSection {
  number: number
  name: string
  subsections: NarrativeSubsection[]
}

export interface NarrativeData {
  sections: NarrativeSection[]
}

export interface SnappedPoint {
  narrativeId: number           // the 'id' from labelled_points.geojson
  sectionName: string           // parent section name from narrative
  subsectionName: string        // subsection name from narrative
  text: string                  // subsection body text (may contain HTML)
  image: string | null          // filename in /gallery/, or null
  snappedCoord: [number, number]
  distanceAlongPath: number     // km from start
}

export interface LoadedData {
  pathFeature: Feature<LineString>
  pathGeoJSON: FeatureCollection
  snappedPoints: SnappedPoint[]
  totalDistance: number
  style: object
}
