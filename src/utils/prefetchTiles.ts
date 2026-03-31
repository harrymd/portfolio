import { PMTiles } from 'pmtiles'

const MANIFEST_URL         = import.meta.env.BASE_URL + 'tile_manifest.json'
const TILEJSON_URL         = 'https://tiles.openfreemap.org/planet'
const TERRARIUM_TEMPLATE   = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'
const PMTILES_HTTP_URL     = 'https://hrmd-portfolio.s3.eu-west-2.amazonaws.com/norway_buffer_zones.pmtiles'

const TAG = '[tile-prefetch]'

interface TileManifest {
  zoom: number
  tiles: [number, number][]
  count: number
}

// requestIdleCallback with 50ms setTimeout fallback (old Safari)
const scheduleIdle: (cb: IdleRequestCallback) => void =
  typeof requestIdleCallback !== 'undefined'
    ? (cb) => requestIdleCallback(cb)
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 50, didTimeout: false }), 50)

function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}

/**
 * Run a list of async tasks one-at-a-time during browser idle periods.
 * Yields back to the browser whenever timeRemaining drops below 4 ms.
 */
function runIdleQueue(
  tasks: (() => Promise<void>)[],
  label: string,
  cancelled: () => boolean,
  onDone: () => void,
): void {
  const total = tasks.length
  if (total === 0) { onDone(); return }

  const logStep = Math.max(1, Math.floor(total / 4))
  let i = 0

  console.log(`${TAG} ${label}: queuing ${total} tiles`)

  function step(deadline: IdleDeadline) {
    if (cancelled()) {
      console.log(`${TAG} ${label}: cancelled at ${i}/${total}`)
      return
    }

    while (i < total && deadline.timeRemaining() > 4) {
      const task = tasks[i++]
      task()  // fire-and-forget — errors already swallowed inside each task

      if (i % logStep === 0 || i === total) {
        console.log(`${TAG} ${label}: ${i}/${total}`)
      }
    }

    if (i < total) {
      scheduleIdle(step)
    } else {
      onDone()
    }
  }

  scheduleIdle(step)
}

export async function prefetchTiles(cancelled: () => boolean): Promise<void> {
  console.log(`${TAG} starting — fetching manifest and TileJSON …`)

  // ── 1. Load manifest + current openfreemap tile URL in parallel ───────────
  let manifest: TileManifest
  let vectorTemplate: string

  try {
    const [manifestRes, tileJsonRes] = await Promise.all([
      fetch(MANIFEST_URL),
      fetch(TILEJSON_URL),
    ])

    if (!manifestRes.ok) throw new Error(`manifest ${manifestRes.status}`)
    if (!tileJsonRes.ok) throw new Error(`tilejson ${tileJsonRes.status}`)

    manifest = await manifestRes.json() as TileManifest
    const tileJson = await tileJsonRes.json() as { tiles: string[] }
    vectorTemplate = tileJson.tiles[0]

    console.log(`${TAG} manifest: ${manifest.count} tiles at z${manifest.zoom}`)
    console.log(`${TAG} vector source: ${vectorTemplate}`)
  } catch (err) {
    console.warn(`${TAG} setup failed, aborting:`, err)
    return
  }

  if (cancelled()) return

  const { zoom, tiles } = manifest

  // ── 2. Build task lists ───────────────────────────────────────────────────

  const terrariumTasks = tiles.map(([x, y]) => async () => {
    try {
      await fetch(fillTemplate(TERRARIUM_TEMPLATE, zoom, x, y), {
        priority: 'low',
      } as RequestInit)
    } catch (_) { /* ignore — offline or CORS */ }
  })

  const vectorTasks = tiles.map(([x, y]) => async () => {
    try {
      await fetch(fillTemplate(vectorTemplate, zoom, x, y), {
        priority: 'low',
      } as RequestInit)
    } catch (_) { /* ignore */ }
  })

  // PMTiles: getZxy fetches the right byte range and warms the pmtiles cache.
  // A separate PMTiles instance shares the same underlying HTTP URL so
  // responses land in the browser HTTP cache (if S3 Cache-Control allows it).
  const pmtiles = new PMTiles(PMTILES_HTTP_URL)
  const pmtilesTasks = tiles.map(([x, y]) => async () => {
    try { await pmtiles.getZxy(zoom, x, y) } catch (_) { /* tile absent or offline */ }
  })

  // ── 3. Run all three queues concurrently (each yields on its own) ─────────
  let doneCount = 0
  function onSourceDone() {
    if (++doneCount === 3) console.log(`${TAG} all sources complete ✓`)
  }

  runIdleQueue(terrariumTasks,  'terrarium',    cancelled, onSourceDone)
  runIdleQueue(vectorTasks,     'openmaptiles', cancelled, onSourceDone)
  runIdleQueue(pmtilesTasks,    'ocean_buffers', cancelled, onSourceDone)
}
