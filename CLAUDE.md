# Kuril Geospatial — portfolio site

Freelance GIS/data science portfolio for Harry (projects@HKuril.com). Deployed to GitHub Pages.

## Stack

Vite + React + TypeScript. MapLibre GL JS renders a WebGL map. PMTiles serves vector tiles via HTTP range requests. Turf.js handles spatial maths. `gh-pages` deploys `dist/` to GitHub Pages.

## Commands

```bash
npm run dev       # dev server at localhost:5173
npm run build     # prebuild (preprocess.py + generate_tile_manifest.py) then tsc + vite build
npm run deploy    # build + push dist/ to gh-pages branch
```

## Key files

| Path | Purpose |
|---|---|
| `src/components/MapJourney.tsx` | Main component — scroll-driven map journey + gallery |
| `src/components/MapJourney.css` | Layout for map, panels, mobile overrides |
| `src/components/ProgressBar.tsx` | Contents nav sidebar/strip |
| `src/components/ProgressBar.css` | Contents nav styles |
| `src/components/GallerySection.tsx` | Static "Selected work" + pricing + contact section |
| `src/components/LoadingScreen.tsx` | Loads all data files, shows progress bar |
| `public/composite.json` | MapLibre style — references PMTiles tile source |
| `public/ship_track.geojson` | Route LineString |
| `public/labelled_points.geojson` | POI points with integer `id` — snapped to route at load |
| `public/narrative.json` | Text/images for each POI, keyed by `id` |
| `public/gallery_content.json` | Gallery cards (title, description, tools, image) |
| `scripts/preprocess.py` | Generates `public/static_content.html` for SEO crawlers |
| `scripts/generate_tile_manifest.py` | Generates `public/tile_manifest.json` — z10 tile XYZ list for prefetcher |
| `public/tile_manifest.json` | Pre-computed tile list (376 tiles, z10, ±1 buffer) — generated at build time |
| `src/utils/prefetchTiles.ts` | Idle-time tile prefetcher; triggered after map ready |

`narrative.json` and `gallery_content.json` are fetched at runtime (not static imports) because they're loaded alongside the geospatial files in `LoadingScreen.tsx`. They must stay in `public/`.

## Architecture notes

**Scroll-driven map**: an invisible `scroll-overlay` div captures scroll events. `scrollTop` maps piecewise-linearly to km along the route via `ScrollMapping`. Each km maps to a lat/lon via `kmToLngLat`.

**Gallery transition**: the last `GALLERY_FADE_PX = 2000` px of scroll space is the fade zone into the static gallery section. `inGallery` state and `inGalleryRef` (for stale-closure event handlers) track this.

**POI panels**: `activePoi` tracks scroll position; `displayedPoi` is what's rendered (cross-fades on change with a 280ms delay). `welcomeMode` shows the opening screen before the first port.

**Navigation animation**: `navigateToPoi` runs a rAF loop. `navAnimatingRef` suppresses POI activation during travel. `handleScrollRef` always holds the latest `handleScroll` and is called explicitly at animation end to guarantee POI activation.

**ProgressBar**: section items with subsections toggle expand/collapse (at most one open); clicking navigates only for leaf items. Active section auto-expands on scroll.

**Tile prefetcher**: after `mapReady`, `prefetchTiles()` runs three `requestIdleCallback` queues (one per tile source: terrarium raster, openmaptiles vector, ocean_buffers PMTiles). Each tile is fetched with `priority: 'low'` and yields back to the browser whenever `deadline.timeRemaining() < 4ms`. The tile list is pre-computed at build time (`tile_manifest.json`); the openfreemap URL is fetched live from their TileJSON to handle version changes.

## Key constants (MapJourney.tsx)

```ts
FIXED_ZOOM              = 10    // desktop zoom — PMTiles available at zoom ≥ 9
FIXED_ZOOM_MOB          = 9     // mobile zoom — fewer tiles, smoother navigation
NAV_ANIM_DURATION       = 3600  // ms minimum for port-to-port animation
MAX_SPEED_PX_PER_MS     = 1.5   // caps animation speed for long hops (desktop)
MAX_SPEED_PX_PER_MS_MOB = 0.75  // slower cap on mobile to allow tiles to load
GALLERY_FADE_PX         = 2000  // scroll px of fade-in zone before gallery
MIN_OVERLAY_MS          = 1500  // minimum loading screen display time
```

## Mobile layout constants (CSS)

Header: `3.75rem`. Contents button top: `4.5rem`. Contents strip height: `1.9rem`. Panel top: `7.15rem`. Panel bottom: `3.75rem` (clears map attribution).
