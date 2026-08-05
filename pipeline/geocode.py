"""Geocode crime locations via Nominatim (OpenStreetMap), with a persistent cache.

Only addresses not already in the cache are looked up, so daily runs make just a
handful of requests. Nominatim is free/keyless but requires a descriptive
User-Agent and a max of 1 request/second.
"""
from __future__ import annotations

import json

import pandas as pd
from geopy.extra.rate_limiter import RateLimiter
from geopy.geocoders import Nominatim

from . import paths

USER_AGENT = "fsu-crime-map/1.0 (https://github.com/upishanker/fsu-crime)"

# Bare building names / intersections geocode far better with a city+state suffix.
CITY_SUFFIX = ", Tallahassee, FL"


def load_cache() -> dict[str, list[float | None]]:
    if paths.GEOCODE_CACHE.exists():
        with open(paths.GEOCODE_CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    paths.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(paths.GEOCODE_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=0, sort_keys=True)


def _query_for(location: str) -> str:
    loc = location.strip()
    if "tallahassee" in loc.lower() or ", fl" in loc.lower():
        return loc
    return loc + CITY_SUFFIX


def geocode(df: pd.DataFrame, cache: dict | None = None) -> tuple[pd.DataFrame, dict]:
    """Fill latitude/longitude for every row, geocoding only uncached locations."""
    cache = load_cache() if cache is None else cache
    geolocator = Nominatim(user_agent=USER_AGENT, timeout=10)
    lookup = RateLimiter(geolocator.geocode, min_delay_seconds=1.1, max_retries=2)

    df = df.copy()
    for idx, row in df.iterrows():
        # Trust coordinates already present on the row (e.g. migrated Google data).
        if row.get("latitude") and row.get("longitude"):
            continue
        location = str(row["location"]).strip()
        if not location:
            continue
        if location not in cache:
            try:
                result = lookup(_query_for(location))
                # Cache a definite result OR a confirmed "not found" ([None, None]).
                cache[location] = (
                    [result.latitude, result.longitude] if result else [None, None]
                )
                print(f"Geocoded: {location} -> {cache[location]}")
            except Exception as exc:  # transient (network/timeout) -> retry next run
                print(f"Error geocoding {location!r}: {exc}")
                continue  # leave uncached and this row's coords empty for now
        lat, lon = cache[location]
        df.at[idx, "latitude"] = "" if lat is None else str(lat)
        df.at[idx, "longitude"] = "" if lon is None else str(lon)

    return df, cache
