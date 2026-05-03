"""Voice matcher.

The browser captures a passphrase recording, computes a feature vector
(spectral centroid, rolloff, ZCR, energy, plus 13 mel-band log-energies),
averaged over voiced frames. Server compares enrolled vs probe with cosine
similarity on z-score-normalized vectors.
"""
from __future__ import annotations
import numpy as np


VOICE_VECTOR_DIM = 18  # 5 globals + 13 mel-band log energies
VOICE_SCORE_THRESHOLD = 0.5


def _validate(vec: list[float]) -> np.ndarray:
    if not isinstance(vec, list) or len(vec) != VOICE_VECTOR_DIM:
        raise ValueError(f"voice vector must be {VOICE_VECTOR_DIM}-D")
    arr = np.asarray(vec, dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        raise ValueError("voice vector contains non-finite values")
    return arr


def _zscore(arr: np.ndarray) -> np.ndarray:
    mu = arr.mean()
    sd = arr.std() + 1e-9
    return (arr - mu) / sd


def compare_voice(enrolled: list[float], probe: list[float]) -> dict:
    a = _zscore(_validate(enrolled))
    b = _zscore(_validate(probe))
    cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    # cos in [-1,1] -> map to [0,1]
    score = max(0.0, min(1.0, (cos + 1.0) / 2.0))
    return {
        "cosine_similarity": round(cos, 4),
        "score": round(score, 4),
        "passed": score >= VOICE_SCORE_THRESHOLD,
        "threshold": VOICE_SCORE_THRESHOLD,
    }
