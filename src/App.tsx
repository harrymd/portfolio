import { useState } from 'react'
import LoadingScreen from './components/LoadingScreen'
import MapJourney from './components/MapJourney'
import type { LoadedData } from './types'

export default function App() {
  const [loadedData, setLoadedData] = useState<LoadedData | null>(null)

  return (
    <>
      {!loadedData && <LoadingScreen onLoaded={setLoadedData} />}
      {loadedData && <MapJourney data={loadedData} />}
    </>
  )
}
