import { useEffect, useState } from 'react'
import './GallerySection.css'

interface GalleryEntry {
  id: string
  image_file: string
  title: string
  description: string
  tools: string[]
}

export default function GallerySection() {
  const [entries, setEntries] = useState<GalleryEntry[]>([])

  useEffect(() => {
    fetch('/gallery_content.json')
      .then((r) => r.json())
      .then(setEntries)
      .catch(console.error)
  }, [])

  return (
    <section className="gallery-section">
      <div className="gallery-inner">
        <h2 className="gallery-heading">Selected Work</h2>
        <div className="gallery-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="gallery-card">
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
          ))}
        </div>
      </div>
    </section>
  )
}
