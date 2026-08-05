"""Shared filesystem locations for the pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = ROOT / "data"
DOCS_DATA_DIR = ROOT / "docs" / "data"

# Version-controlled master dataset (full history) and the geocode cache.
MASTER_CSV = DATA_DIR / "crime_data.csv"
GEOCODE_CACHE = DATA_DIR / "geocode_cache.json"

# Single artifact the static site fetches.
CRIMES_JSON = DOCS_DATA_DIR / "crimes.json"

# Canonical column order for the master dataset.
COLUMNS = [
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
