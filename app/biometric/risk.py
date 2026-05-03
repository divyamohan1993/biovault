"""Adaptive risk scoring.

Combines per-modality scores into an aggregate trust score (0..1) with
weights, then maps trust to a risk band and a recommended action.

Action ladder:
  trust >= 0.85 : ALLOW
  0.65 <= trust < 0.85 : STEP_UP (add another factor)
  trust < 0.65  : DENY
"""
from __future__ import annotations
from typing import Iterable


WEIGHTS = {
    "face": 0.35,
    "voice": 0.20,
    "keystroke": 0.15,
    "passkey": 0.30,
}

ALLOW = "ALLOW"
STEP_UP = "STEP_UP"
DENY = "DENY"


def _band(trust: float) -> str:
    if trust >= 0.85:
        return ALLOW
    if trust >= 0.65:
        return STEP_UP
    return DENY


def compute_risk(scores: dict[str, float], passed: dict[str, bool] | None = None) -> dict:
    """Aggregate available modality scores. Missing modalities are skipped.

    Args:
        scores: e.g. {"face": 0.91, "voice": 0.78}
        passed: optional booleans per modality; a hard fail caps trust at 0.5
    """
    passed = passed or {}
    contributing = {k: v for k, v in scores.items() if k in WEIGHTS and v is not None}
    if not contributing:
        return {"trust": 0.0, "risk": 1.0, "action": DENY, "reasons": ["no_factors"], "factors": {}}
    total_w = sum(WEIGHTS[k] for k in contributing)
    weighted = sum(WEIGHTS[k] * float(v) for k, v in contributing.items()) / total_w
    reasons: list[str] = []
    if any(passed.get(k) is False for k in contributing):
        weighted = min(weighted, 0.5)
        reasons.append("modality_failed")
    if len(contributing) == 1:
        reasons.append("single_factor")
        weighted *= 0.9
    trust = max(0.0, min(1.0, weighted))
    band = _band(trust)
    return {
        "trust": round(trust, 4),
        "risk": round(1.0 - trust, 4),
        "action": band,
        "reasons": reasons,
        "factors": {k: round(float(v), 4) for k, v in contributing.items()},
    }
