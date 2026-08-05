"""Scrape the FSU crime log into a clean DataFrame."""
from __future__ import annotations

import pandas as pd

CRIME_LOG_URL = "https://police.fsu.edu/crime-log"

# Map the source table's real headers (normalized to lowercase) to clean keys.
# The source uses these columns: Agency, Report Number, Crime Type, Crime Date,
# Report Date, Location, Disposition.
HEADER_MAP = {
    "agency": "agency",
    "report number": "report_number",
    "crime type": "crime_type",
    "crime date": "crime_date",
    "report date": "report_date",
    "location": "location",
    "disposition": "disposition",
}

DATE_COLUMNS = ("crime_date", "report_date")


def _clean_headers(df: pd.DataFrame) -> pd.DataFrame:
    renamed = {}
    for col in df.columns:
        key = str(col).strip().lower()
        if key in HEADER_MAP:
            renamed[col] = HEADER_MAP[key]
    df = df.rename(columns=renamed)
    missing = [v for v in HEADER_MAP.values() if v not in df.columns]
    if missing:
        raise ValueError(
            f"Crime log table missing expected columns {missing}; "
            f"got {list(df.columns)}"
        )
    return df[list(HEADER_MAP.values())]


def _parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    for col in DATE_COLUMNS:
        parsed = pd.to_datetime(df[col], errors="coerce")
        # ISO 8601; leave un-parseable values blank rather than "NaT".
        df[col] = parsed.dt.strftime("%Y-%m-%dT%H:%M:%S").where(parsed.notna(), "")
    return df


def scrape(url: str = CRIME_LOG_URL) -> pd.DataFrame:
    """Fetch the live crime log and return a normalized DataFrame."""
    tables = pd.read_html(url)
    if not tables:
        raise ValueError(f"No tables found at {url}")
    df = _clean_headers(tables[0])
    df = df.apply(lambda s: s.astype(str).str.strip() if s.dtype == object else s)
    df = _parse_dates(df)
    df = df[df["report_number"].astype(bool) & (df["report_number"] != "nan")]
    return df.reset_index(drop=True)


if __name__ == "__main__":
    out = scrape()
    print(f"Scraped {len(out)} rows")
    print(out.head().to_string())
