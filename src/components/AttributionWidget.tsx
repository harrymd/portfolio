import { useState } from 'react'
import './AttributionWidget.css'

interface Props {
  hidden?: boolean
}

export default function AttributionWidget({ hidden = false }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`attr-widget${hidden ? ' attr-widget--hidden' : ''}`}>
      <button
        className={`attr-toggle ${open ? 'attr-toggle--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Map information and credits"
        title="Map info"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="11" x2="12" y2="16" />
          <circle cx="12" cy="8" r="0.5" fill="currentColor" strokeWidth="1" />
        </svg>
        <span>map attributions</span>
      </button>

      <div className={`attr-panel ${open ? 'attr-panel--open' : ''}`} role="region" aria-label="Map credits">
        <ul className="attr-list">
          <li>
            <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer">
              MapLibre GL JS
            </a>
          </li>
          <li>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              © OpenStreetMap contributors
            </a>
          </li>
          <li>
            <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
              OpenFreeMap
            </a>
          </li>
          <li>
            <a href="https://www.mapzen.com/blog/elevation/" target="_blank" rel="noopener noreferrer">
              Mapzen Terrarium
            </a>
          </li>
        </ul>
      </div>
    </div>
  )
}
