"""Face matcher.

The browser uses face-api.js (TinyFaceDetector + FaceLandmark68 + FaceRecognition)
which produces a 128-D L2-normalized descriptor per face. Matching is cosine
similarity; with normalized vectors that equals 1 - 0.5 * ||a-b||^2.
"""
from __future__ import annotations
import math
import numpy as np


FACE_DESCRIPTOR_DIM = 128
# face-api.js docs recommend ~0.6 Euclidean distance threshold on normalized
# descriptors. We map to cosine sim and then to a 0..1 score.
FACE_DISTANCE_THRESHOLD = 0.55
FACE_DISTANCE_MAX = 1.10  # beyond this we score ~0


def _validate(vec: list[float]) -> np.ndarray:
    if not isinstance(vec, list) or len(vec) != FACE_DESCRIPTOR_DIM:
        raise ValueError(f"face descriptor must be a list of {FACE_DESCRIPTOR_DIM} floats")
    arr = np.asarray(vec, dtype=np.float64)
    if not np.all(np.isfinite(arr)):
        raise ValueError("face descriptor contains non-finite values")
    return arr


def normalize(vec: list[float]) -> list[float]:
    arr = _validate(vec)
    n = np.linalg.norm(arr)
    if n < 1e-9:
        raise ValueError("face descriptor has near-zero norm")
    return (arr / n).tolist()


def compare_face(enrolled: list[float], probe: list[float]) -> dict:
    """Return match details: euclidean distance, cosine sim, score, decision.

    Score is in [0,1]; decision = score >= 0.5 (i.e., distance below threshold).
    """
    a = _validate(enrolled)
    b = _validate(probe)
    a /= max(np.linalg.norm(a), 1e-9)
    b /= max(np.linalg.norm(b), 1e-9)
    distance = float(np.linalg.norm(a - b))
    cosine = float(np.dot(a, b))
    # Map distance to a calibrated 0..1 score where threshold == 0.5.
    if distance >= FACE_DISTANCE_MAX:
        score = 0.0
    elif distance <= 0.0:
        score = 1.0
    elif distance <= FACE_DISTANCE_THRESHOLD:
        # below threshold: linearly between 0.5 and 1.0
        score = 0.5 + 0.5 * (1.0 - distance / FACE_DISTANCE_THRESHOLD)
    else:
        # above threshold: linearly between 0.5 and 0.0
        span = FACE_DISTANCE_MAX - FACE_DISTANCE_THRESHOLD
        score = 0.5 * max(0.0, 1.0 - (distance - FACE_DISTANCE_THRESHOLD) / span)
    return {
        "distance": round(distance, 4),
        "cosine_similarity": round(cosine, 4),
        "score": round(score, 4),
        "passed": distance <= FACE_DISTANCE_THRESHOLD,
        "threshold": FACE_DISTANCE_THRESHOLD,
    }
