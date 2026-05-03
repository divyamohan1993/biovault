"""Ephemeral in-memory store for enrolled biometric templates and sessions.

Per MVP/MLP spec: nothing is persisted. Templates evict on TTL or restart.
"""
from __future__ import annotations
import time
import threading
import secrets
from dataclasses import dataclass, field
from typing import Optional


TEMPLATE_TTL_SECONDS = 30 * 60   # 30 min for enrollment lifetime
CHALLENGE_TTL_SECONDS = 5 * 60   # 5 min for any one-shot challenge


@dataclass
class FaceTemplate:
    descriptor: list[float]            # 128-d float vector (face-api.js)
    liveness_passed: bool = False
    enrolled_at: float = field(default_factory=time.time)


@dataclass
class VoiceTemplate:
    feature_vector: list[float]        # MFCC stats / spectral features
    enrolled_at: float = field(default_factory=time.time)


@dataclass
class KeystrokeTemplate:
    passphrase: str
    timing_vector: list[float]         # mean dwell+flight per key, normalized
    enrolled_at: float = field(default_factory=time.time)


@dataclass
class PasskeyCredential:
    credential_id: bytes
    public_key: bytes
    sign_count: int = 0
    enrolled_at: float = field(default_factory=time.time)


@dataclass
class UserRecord:
    user_id: str
    label: str
    face: Optional[FaceTemplate] = None
    voice: Optional[VoiceTemplate] = None
    keystroke: Optional[KeystrokeTemplate] = None
    passkey: Optional[PasskeyCredential] = None
    created_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.last_seen_at = time.time()


class EphemeralStore:
    """Thread-safe in-memory user + challenge store with TTL eviction."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._users: dict[str, UserRecord] = {}
        self._challenges: dict[str, tuple[bytes, float]] = {}
        self._verification_log: list[dict] = []   # capped, for live "SIEM" page
        self._log_cap = 500

    # ---- users ----
    def create_user(self, label: str) -> UserRecord:
        with self._lock:
            user_id = secrets.token_urlsafe(9)
            rec = UserRecord(user_id=user_id, label=label.strip()[:60] or "anon")
            self._users[user_id] = rec
            return rec

    def get_user(self, user_id: str) -> Optional[UserRecord]:
        with self._lock:
            self._evict_expired()
            return self._users.get(user_id)

    def list_users(self) -> list[UserRecord]:
        with self._lock:
            self._evict_expired()
            return sorted(self._users.values(), key=lambda u: -u.created_at)

    def delete_user(self, user_id: str) -> bool:
        with self._lock:
            return self._users.pop(user_id, None) is not None

    # ---- WebAuthn challenges ----
    def stash_challenge(self, scope: str, challenge: bytes) -> None:
        with self._lock:
            self._challenges[scope] = (challenge, time.time())

    def consume_challenge(self, scope: str) -> Optional[bytes]:
        with self._lock:
            entry = self._challenges.pop(scope, None)
            if entry is None:
                return None
            challenge, ts = entry
            if time.time() - ts > CHALLENGE_TTL_SECONDS:
                return None
            return challenge

    # ---- audit log ----
    def log_event(self, event: dict) -> None:
        with self._lock:
            event = {**event, "ts": time.time()}
            self._verification_log.append(event)
            if len(self._verification_log) > self._log_cap:
                self._verification_log = self._verification_log[-self._log_cap :]

    def recent_events(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return list(self._verification_log[-limit:])[::-1]

    # ---- maintenance ----
    def _evict_expired(self) -> None:
        cutoff = time.time() - TEMPLATE_TTL_SECONDS
        stale = [uid for uid, u in self._users.items() if u.last_seen_at < cutoff]
        for uid in stale:
            self._users.pop(uid, None)

    def stats(self) -> dict:
        with self._lock:
            self._evict_expired()
            return {
                "users": len(self._users),
                "events": len(self._verification_log),
                "uptime_sec": int(time.time() - _BOOT_TS),
            }


_BOOT_TS = time.time()
store = EphemeralStore()
