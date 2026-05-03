"""Keystroke dynamics matcher.

The browser captures dwell (key down -> key up) and flight (key up -> next
key down) times for each character of a fixed passphrase. We expect a vector
of length (2 * len(passphrase) - 1) milliseconds.

Verification uses Manhattan distance on z-score-normalized vectors,
calibrated so a perfect match scores 1.0 and very different timing scores 0.
"""
from __future__ import annotations
import numpy as np


KEYSTROKE_SCORE_THRESHOLD = 0.55


def expected_len(passphrase: str) -> int:
    n = len(passphrase)
    return max(2 * n - 1, 1)


def _validate(passphrase: str, vec: list[float]) -> np.ndarray:
    expected = expected_len(passphrase)
    if not isinstance(vec, list) or len(vec) != expected:
        raise ValueError(f"keystroke vector must have {expected} entries for passphrase len {len(passphrase)}")
    arr = np.asarray(vec, dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        raise ValueError("keystroke vector contains non-finite values")
    if np.any(arr < 0):
        raise ValueError("keystroke timings must be non-negative")
    return arr


def _normalize(arr: np.ndarray) -> np.ndarray:
    mu = arr.mean()
    sd = arr.std() + 1e-9
    return (arr - mu) / sd


def compare_keystroke(passphrase: str, enrolled: list[float], probe: list[float]) -> dict:
    a = _normalize(_validate(passphrase, enrolled))
    b = _normalize(_validate(passphrase, probe))
    manhattan = float(np.sum(np.abs(a - b)))
    # Empirically: same-typist Manhattan ~ 0..N*0.5; impostor ~ 1.5*N+
    n = len(a)
    norm = manhattan / max(n, 1)
    # Map norm distance to 0..1 score (0 dist -> 1.0, >=1.5 -> 0.0)
    score = max(0.0, min(1.0, 1.0 - norm / 1.5))
    return {
        "manhattan_distance": round(manhattan, 4),
        "normalized_distance": round(norm, 4),
        "score": round(score, 4),
        "passed": score >= KEYSTROKE_SCORE_THRESHOLD,
        "threshold": KEYSTROKE_SCORE_THRESHOLD,
    }
