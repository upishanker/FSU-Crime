"""Pipeline entrypoint: scrape -> merge history -> geocode -> emit site JSON.

Run with ``python -m pipeline.build``. Idempotent: re-running with no new
incidents produces no changes and makes no geocoding requests.
"""
from __future__ import annotations

import json

import pandas as pd

from . import geocode, paths, scrape, store

# Fields exposed to the frontend (order preserved in the JSON objects).
JSON_FIELDS = [
    "report_number",
    "agency",
    "crime_type",
    "crime_date",
    "report_date",
    "location",
    "disposition",
    "latitude",
    "longitude",
]


def _to_records(df: pd.DataFrame) -> list[dict]:
    records = []
    for _, row in df.iterrows():
        rec = {f: (row[f] if row[f] != "" else None) for f in JSON_FIELDS}
        for coord in ("latitude", "longitude"):
            if rec[coord] is not None:
                try:
                    rec[coord] = float(rec[coord])
                except (TypeError, ValueError):
                    rec[coord] = None
        records.append(rec)
    return records


def write_json(df: pd.DataFrame) -> int:
    paths.DOCS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    mapped = df[df["latitude"].astype(bool) & df["longitude"].astype(bool)]
    records = _to_records(mapped)
    payload = {
        "generated_at": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(records),
        "total_records": int(len(df)),
        "crimes": records,
    }
    with open(paths.CRIMES_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
    return len(records)


def main() -> None:
    print("Scraping FSU crime log...")
    scraped = scrape.scrape()
    print(f"  {len(scraped)} rows from source")

    master = store.load_master()
    print(f"  {len(master)} rows in existing master")

    merged = store.merge(master, scraped)
    print(f"  {len(merged)} rows after merge (deduped by charge identity)")

    print("Geocoding new locations via Nominatim...")
    merged, cache = geocode.geocode(merged)

    store.save_master(merged)
    geocode.save_cache(cache)
    mapped = write_json(merged)

    print(
        f"Done. Master: {len(merged)} rows, {mapped} mapped -> "
        f"{paths.CRIMES_JSON.relative_to(paths.ROOT)}"
    )


if __name__ == "__main__":
    main()
