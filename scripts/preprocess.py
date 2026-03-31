#!/usr/bin/env python3
"""
preprocess.py — generate a static SEO page from narrative.json and gallery_content.json.

Run from the project root:
    python scripts/preprocess.py

Outputs:
    public/static_content.html  — a fully readable HTML page with all journey and
                                   gallery text, discoverable by search-engine crawlers
                                   without JavaScript execution.

The React app continues to work as before for users.  This file exists purely for
crawlers that don't execute JS, and can be linked from index.html or a sitemap.
"""

import json
import html
import pathlib
import textwrap

ROOT = pathlib.Path(__file__).parent.parent
PUBLIC = ROOT / "public"


def load(name: str):
    with open(PUBLIC / name, encoding="utf-8") as f:
        return json.load(f)


def tag(name: str, content: str, attrs: dict = None, *, raw: bool = False) -> str:
    """Wrap content in an HTML tag.  Set raw=True to skip HTML-escaping the content."""
    attr_str = ""
    if attrs:
        attr_str = " " + " ".join(
            f'{k}="{html.escape(str(v))}"' for k, v in attrs.items()
        )
    body = content if raw else html.escape(content)
    return f"<{name}{attr_str}>{body}</{name}>"


def build_narrative_section(narrative: dict) -> str:
    parts = []
    parts.append(tag("h2", "About Kuril Geospatial"))
    for section in narrative["sections"]:
        parts.append(tag("h3", section["name"]))
        for sub in section["subsections"]:
            parts.append(tag("h4", sub["name"]))
            # The text may contain inline HTML links — keep them as-is
            parts.append(f"<p>{sub['text']}</p>")
    return "\n".join(parts)


def build_gallery_section(gallery: list) -> str:
    parts = []
    parts.append(tag("h2", "Selected Work"))
    for entry in gallery:
        parts.append(tag("h3", entry["title"], {"id": f"gallery-card-{entry['id']}"}))
        # description may contain HTML links
        parts.append(f"<p>{entry['description']}</p>")
        tools = ", ".join(entry.get("tools", []))
        if tools:
            parts.append(tag("p", f"Tools: {tools}"))
    return "\n".join(parts)


def build_page(narrative_html: str, gallery_html: str) -> str:
    return textwrap.dedent(f"""\
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Kuril Geospatial — services, clients, and selected work</title>
          <meta name="description"
                content="Kuril Geospatial offers interactive maps, data science, cartography, and custom geospatial pipelines. View past clients and selected work." />
          <style>
            body {{
              font-family: sans-serif;
              max-width: 860px;
              margin: 2rem auto;
              padding: 0 1.5rem;
              line-height: 1.65;
              color: #1a1a2e;
            }}
            h1 {{ font-size: 2rem; margin-bottom: 0.25rem; }}
            h2 {{ font-size: 1.5rem; margin-top: 2.5rem; border-bottom: 1px solid #ccc; padding-bottom: 0.4rem; }}
            h3 {{ font-size: 1.15rem; margin-top: 1.5rem; color: #c01818; }}
            h4 {{ font-size: 1rem; margin-top: 1rem; font-style: italic; }}
            p  {{ margin-top: 0.5rem; }}
            a  {{ color: #c01818; }}
            .back {{ margin-bottom: 1.5rem; font-size: 0.9rem; }}
          </style>
        </head>
        <body>
          <p class="back"><a href="./index.html">← Back to the interactive map</a></p>
          <h1>Kuril Geospatial</h1>
          <p>Freelancing and consultancy for maps and data.
             Contact Harry at <a href="mailto:projects@HKuril.com">projects@HKuril.com</a>.</p>

          <section id="services-and-clients">
        {textwrap.indent(narrative_html, "    ")}
          </section>

          <section id="selected-work">
        {textwrap.indent(gallery_html, "    ")}
          </section>
        </body>
        </html>
    """)


def main():
    narrative = load("narrative.json")
    gallery   = load("gallery_content.json")

    narrative_html = build_narrative_section(narrative)
    gallery_html   = build_gallery_section(gallery)
    page           = build_page(narrative_html, gallery_html)

    out = PUBLIC / "static_content.html"
    out.write_text(page, encoding="utf-8")
    print(f"Written: {out}")


if __name__ == "__main__":
    main()
