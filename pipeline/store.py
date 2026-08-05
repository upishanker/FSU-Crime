"""Accumulate scraped rows into the version-controlled master dataset.

The FSU source only exposes a rolling ~60-day window, so daily runs must *merge*
new scrapes into history rather than overwrite it.

A single report number can list several charges (one source row per crime type),
so rows are deduped on the composite identity ``IDENTITY_KEY`` rather than on
report number alone. When the same charge reappears in a later scrape (e.g. its
disposition changed from "Open/Pending" to "Cleared by Arrest") the newest row
wins, updating the disposition in place.
"""
from __future__ import annotations

import pandas as pd

from . import paths
from .textclean import fix_mojibake

DATE_COLUMNS = ("crime_date", "report_date")
TEXT_COLUMNS = ("crime_type", "location", "disposition", "agency")

# What uniquely identifies one charge. Disposition and coordinates are excluded
# so an updated disposition replaces the prior row instead of adding a new one.
IDENTITY_KEY = ["report_number", "crime_type", "crime_date", "location"]


def load_master() -> pd.DataFrame:
    if paths.MASTER_CSV.exists():
        df = pd.read_csv(paths.MASTER_CSV, dtype=str).fillna("")
    else:
        df = pd.DataFrame(columns=paths.COLUMNS)
    # Guarantee all canonical columns exist.
    for col in paths.COLUMNS:
        if col not in df.columns:
            df[col] = ""
    return df[paths.COLUMNS]


def merge(master: pd.DataFrame, scraped: pd.DataFrame) -> pd.DataFrame:
    """Union master + scraped, deduped on IDENTITY_KEY (scraped wins on conflict)."""
    scraped = scraped.copy()
    for col in paths.COLUMNS:
        if col not in scraped.columns:
            scraped[col] = ""
    scraped = scraped[paths.COLUMNS].astype(str)

    # Reuse coordinates already known for a location so a fresh scrape (which has
    # no lat/lon yet) doesn't force a re-geocode of an address we've seen before.
    coords = {}
    for _, row in master.iterrows():
        loc = row["location"]
        if loc and row["latitude"] and row["longitude"]:
            coords.setdefault(loc, (row["latitude"], row["longitude"]))
    for idx, row in scraped.iterrows():
        if not row["latitude"] and row["location"] in coords:
            scraped.at[idx, "latitude"], scraped.at[idx, "longitude"] = coords[row["location"]]

    # scraped rows are "newer" -> keep last on duplicate identity.
    combined = pd.concat([master, scraped], ignore_index=True)
    combined = _clean(combined)
    combined = combined.drop_duplicates(subset=IDENTITY_KEY, keep="last")
    # Deterministic order (newest first, stable tiebreakers) so re-runs with no
    # new data yield byte-identical output and clean git diffs.
    combined = combined.sort_values(
        ["crime_date", "report_number", "crime_type"],
        ascending=[False, False, True],
        na_position="last",
        kind="mergesort",
    )
    return combined.reset_index(drop=True)


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize dates to ISO 8601 and repair mojibake, uniformly across sources.

    Runs before dedup so legacy (M/D/YYYY) and freshly scraped (ISO) rows share
    an identical key format.
    """
    df = df.copy()
    for col in TEXT_COLUMNS:
        if col in df.columns:
            df[col] = df[col].map(fix_mojibake)
    for col in DATE_COLUMNS:
        parsed = pd.to_datetime(df[col], errors="coerce", format="mixed")
        df[col] = parsed.dt.strftime("%Y-%m-%dT%H:%M:%S").where(parsed.notna(), "")
    return df


def save_master(df: pd.DataFrame) -> None:
    paths.DATA_DIR.mkdir(parents=True, exist_ok=True)
    df[paths.COLUMNS].to_csv(paths.MASTER_CSV, index=False)
