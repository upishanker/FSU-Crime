# FSU Crime Log Map

An interactive, **daily-updated** map of incidents from the
[FSU Police Department crime log](https://police.fsu.edu/crime-log).

**Live site:** https://upishanker.github.io/fsu-crime/

- 🗺️ Clustered incident map (Leaflet) with garnet/gold FSU theming and dark/light modes
- 🔎 Filter by category, disposition, and date range, plus free-text search
- 📋 Sortable, paginated incident table
- 📊 Stats dashboard — incidents by category, disposition breakdown, monthly trend
- 🤖 Refreshes automatically every day via GitHub Actions (no server, no API keys)

## How it works

The FSU crime log only exposes a rolling ~60-day window, so a daily pipeline
**accumulates history** instead of overwriting it.

```
scrape → merge into master (dedupe by charge identity) → geocode new addresses (cached) → docs/data/crimes.json → static site
```

| Piece | Location |
|-------|----------|
| Data pipeline | `pipeline/` (`scrape` → `store` → `geocode` → `build`) |
| Master dataset (full history) | `data/crime_data.csv` |
| Geocode cache (Nominatim/OSM) | `data/geocode_cache.json` |
| Site data artifact | `docs/data/crimes.json` |
| Static front-end | `docs/{index.html,styles.css,app.js}` |
| Daily automation | `.github/workflows/update.yml` |

## Run the pipeline locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m pipeline.build          # scrape, merge, geocode, write docs/data/crimes.json
python -m http.server -d docs     # then open http://localhost:8000
```

Re-running `pipeline.build` is idempotent: with no new incidents it makes no
changes and no geocoding requests.

> Geocoding uses the free OpenStreetMap **Nominatim** service (max 1 req/sec,
> only for addresses not already cached). The original Google-geocoded data was
> migrated into the cache via `python -m scripts.migrate_seed`.
