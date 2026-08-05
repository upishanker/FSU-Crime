"""FSU crime-log data pipeline.

Scrapes the FSU crime log, accumulates history (deduped by report number),
geocodes new addresses via Nominatim (cached), and emits ``docs/data/crimes.json``
for the static frontend.
"""
