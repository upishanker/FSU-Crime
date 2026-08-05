"""Repair mojibake (UTF-8 bytes mis-decoded as Latin-1) in scraped/legacy text.

Legacy rows contain sequences like ``personâ€™s`` which should read ``person's``.
Only strings showing tell-tale mojibake markers are round-tripped, so already
clean UTF-8 (including legitimate accented characters) is left untouched.
"""
from __future__ import annotations

_MARKERS = ("Ã", "â€", "Â", "�")


def _markers(s: str) -> int:
    return sum(s.count(m) for m in _MARKERS)


def fix_mojibake(value):
    if not isinstance(value, str) or not any(m in value for m in _MARKERS):
        return value
    # These sequences come from UTF-8 bytes mis-decoded as cp1252 (â€™, Ã©, ...);
    # reversing means re-encoding with the same codec, then decoding as UTF-8.
    for codec in ("cp1252", "latin-1"):
        try:
            repaired = value.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        # Accept only if the repair actually reduced mojibake markers.
        if _markers(repaired) < _markers(value):
            return repaired
    return value
