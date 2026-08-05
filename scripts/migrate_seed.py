"""One-off: seed data/crime_data.csv + data/geocode_cache.json from the legacy
crime_data_geocoded.csv so existing (Google) coordinates are reused and never
re-geocoded. Safe to re-run; it only fills gaps.

    python -m scripts.migrate_seed
"""
from __future__ import annotations

import json

import pandas as pd

from pipeline import geocode, paths, store

LEGACY_CSV = paths.ROOT / "crime_data_geocoded.csv"


def main() -> None:
    legacy = pd.read_csv(LEGACY_CSV, dtype=str).fillna("")
    # Legacy columns already match our clean names except no "agency".
    if "agency" not in legacy.columns:
        legacy["agency"] = "FSUPD"
    for col in paths.COLUMNS:
        if col not in legacy.columns:
            legacy[col] = ""
    legacy = legacy[paths.COLUMNS]

    master = store.load_master()
    merged = store.merge(master, legacy)
    store.save_master(merged)

    # Seed geocode cache from every row that already has coordinates.
    cache = geocode.load_cache()
    seeded = 0
    for _, row in merged.iterrows():
        loc = str(row["location"]).strip()
        if loc and row["latitude"] and row["longitude"] and loc not in cache:
            cache[loc] = [float(row["latitude"]), float(row["longitude"])]
            seeded += 1
    geocode.save_cache(cache)

    print(f"Master seeded: {len(merged)} rows -> {paths.MASTER_CSV}")
    print(f"Geocode cache seeded: {seeded} new / {len(cache)} total -> {paths.GEOCODE_CACHE}")


if __name__ == "__main__":
    main()
