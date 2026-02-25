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
        <div id="gallery-pricing" className="gallery-extra-section">
          <h2 className="gallery-heading">Pricing</h2>
          <p className="gallery-filler-text">
            The project cost is agreed upon before work starts. Please expect to pay a 25%
            deposit at the beginning.
          </p>

          <p className="gallery-subheading">Discounts for longer projects</p>
          <div className="gallery-table-wrap">
            <table className="gallery-table">
              <thead>
                <tr><th>Project length</th><th>Discount</th></tr>
              </thead>
              <tbody>
                <tr><td>1 week</td><td>5%</td></tr>
                <tr><td>2 weeks</td><td>10%</td></tr>
                <tr><td>4 weeks</td><td>15%</td></tr>
              </tbody>
            </table>
          </div>

          <p className="gallery-subheading">Rates</p>
          <div className="gallery-table-wrap">
            <table className="gallery-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Charity&nbsp;/ Non-profit&nbsp;/ Academic</th>
                  <th>Industry</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>Daily rate</td><td>£300</td><td>£500</td></tr>
                <tr><td>Hourly rate</td><td>£50</td><td>£80</td></tr>
              </tbody>
            </table>
          </div>

          <p className="gallery-filler-text">
            Prices in GBP (or local equivalent for US, EU, or other customers).
            Invoices provided.
          </p>
        </div>

        {/* ── Contact ────────────────────────────────────── */}
        <div id="gallery-contact" className="gallery-extra-section">
          <h2 className="gallery-heading">Contact</h2>
          <p className="gallery-filler-text">
            If my skills are a good fit for your project, please contact me at{' '}
            <a href="mailto:projects@HKuril.com">projects@HKuril.com</a>.
            {' '}We can have a no-obligation discussion by call or email.
          </p>
        </div>

      </div>
    </section>
  )
}
