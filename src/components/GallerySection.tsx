import { useEffect, useState } from 'react'
import './GallerySection.css'

interface GalleryEntry {
  id: string
  image_file: string
  title: string
  description: string
  tools: string[]
}

function GalleryCard({ entry }: { entry: GalleryEntry }) {
  return (
    <div className="gallery-card">
      <h3 className="gallery-card-title">{entry.title}</h3>
      <div
        className="gallery-card-desc"
        dangerouslySetInnerHTML={{ __html: entry.description }}
      />
      <div className="gallery-card-tools">
        {entry.tools.map((tool) => (
          <span key={tool} className="gallery-pill">
            {tool}
          </span>
        ))}
      </div>
      <img
        className="gallery-card-img"
        src={`/gallery/${entry.image_file}`}
        alt={entry.title}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
    </div>
  )
}

export default function GallerySection() {
  const [entries, setEntries] = useState<GalleryEntry[]>([])

  useEffect(() => {
    fetch('/gallery_content.json')
      .then((r) => r.json())
      .then(setEntries)
      .catch(console.error)
  }, [])

  // Split into two interleaved columns so early items appear near the top of both
  const leftCol  = entries.filter((_, i) => i % 2 === 0)
  const rightCol = entries.filter((_, i) => i % 2 === 1)

  return (
    <section className="gallery-section">
      <div className="gallery-inner">

        {/* ── Selected Work ──────────────────────────────── */}
        <h2 className="gallery-heading">Selected Work</h2>
        <div className="gallery-grid">
          <div className="gallery-col">
            {leftCol.map((entry) => (
              <GalleryCard key={entry.id} entry={entry} />
            ))}
          </div>
          <div className="gallery-col">
            {rightCol.map((entry) => (
              <GalleryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>

        {/* ── Pricing ────────────────────────────────────── */}
        <div className="gallery-extra-section">
          <h2 className="gallery-heading">Pricing</h2>
          <p className="gallery-filler-text">the pricing section</p>
        </div>

        {/* ── Contact ────────────────────────────────────── */}
        <div className="gallery-extra-section">
          <h2 className="gallery-heading">Contact</h2>
          <p className="gallery-filler-text">This is the contact section</p>
        </div>

      </div>
    </section>
  )
}
