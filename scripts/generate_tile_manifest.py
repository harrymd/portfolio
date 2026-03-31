#!/usr/bin/env python3
"""
generate_tile_manifest.py — pre-compute all XYZ tile coordinates the ship
journey passes through at z10 (desktop) and z9 (mobile), plus a 1-tile
viewport buffer.

Outputs public/tile_manifest.json for the client-side idle tile prefetcher.

Run from the project root:
    python3 scripts/generate_tile_manifest.py
"""

import json
import math
import pathlib

ROOT   = pathlib.Path(__file__).parent.parent
PUBLIC = ROOT / "public"
BUFFER = 1  # extra tiles on each side


def lon_lat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    n = 2 ** zoom
    x = int((lon + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.asinh(math.tan(lat_rad)) / math.pi) / 2 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_for_zoom(coords: list[list[float]], zoom: int) -> list[list[int]]:
    tiles: set[tuple[int, int]] = set()
    for lon, lat in coords:
        cx, cy = lon_lat_to_tile(lon, lat, zoom)
        for dx in range(-BUFFER, BUFFER + 1):
            for dy in range(-BUFFER, BUFFER + 1):
                tiles.add((cx + dx, cy + dy))
    return sorted(tiles)


def main() -> None:
    with open(PUBLIC / "ship_track.geojson", encoding="utf-8") as f:
        geojson = json.load(f)

    coords: list[list[float]] = geojson["features"][0]["geometry"]["coordinates"]

    tiles_z10 = tiles_for_zoom(coords, 10)
    tiles_z9  = tiles_for_zoom(coords, 9)

    manifest = {
        "zoom":      10, "tiles":     tiles_z10, "count":     len(tiles_z10),
        "zoom_mob":  9,  "tiles_mob": tiles_z9,  "count_mob": len(tiles_z9),
    }

    out = PUBLIC / "tile_manifest.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, separators=(",", ":"))

    print(f"[tile-manifest] {len(tiles_z10)} tiles at z10, {len(tiles_z9)} at z9 (buffer={BUFFER}) → {out.name}")


if __name__ == "__main__":
    main()
