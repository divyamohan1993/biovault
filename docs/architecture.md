# Architecture

BioVault is a two-tier system:

1. **Browser tier** — handles all sensitive computation: face descriptor extraction, blink-based liveness, voice feature extraction, keystroke timing, and the WebAuthn ceremony.
2. **Cloud Run tier** — a stateless FastAPI service that compares feature vectors against in-memory templates and runs the WebAuthn server-side ceremony. No persistence.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Browser (untrusted)                                                       │
│  ─────────────────────────────────────────────────────────────────────     │
│   • face-api.js (TinyFaceDetector + landmark68 + recognition)              │
│     ↳ 128-D L2-normalised descriptor                                       │
│   • Web Audio API → custom radix-2 FFT + Mel filterbank                    │
│     ↳ 18-D voice feature vector                                            │
│   • KeyboardEvent timestamps                                               │
│     ↳ (2N-1)-D dwell+flight vector                                         │
│   • W3C WebAuthn navigator.credentials.{create, get}                       │
│     ↳ challenge-bound, origin-bound proof                                  │
└────────────────────────────────────────────────────────────────────────────┘
                                   │  TLS 1.3 · JSON · x-correlation-id
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Cloud Run · asia-east1 · min=0  (FastAPI / Pydantic v2 / NumPy / py_webauthn)
│  ─────────────────────────────────────────────────────────────────────     │
│   middleware: correlation IDs · HSTS · Permissions-Policy · gzip           │
│                                                                            │
│   /api/users        → EphemeralStore (RLock-guarded)                       │
│   /api/face/*       → cosine + Euclidean against enrolled 128-D            │
│   /api/voice/*      → z-score cosine similarity                            │
│   /api/keystroke/*  → Manhattan distance, normalised                       │
│   /api/passkey/*    → py_webauthn (challenge stash + verify)               │
│   /api/risk/score   → weighted fusion + decision band                      │
│   /api/events       → ring-buffered audit log                              │
│                                                                            │
│   structured JSON logs → Cloud Logging                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Why this shape

- **Browser does ML, server does math.** Avoids shipping CUDA wheels or sending PII over the wire. The server's per-request CPU is microseconds of NumPy on an 18-D or 128-D vector.
- **Stateless API.** Lets Cloud Run scale-to-zero without coordinating session state. In-memory store is rebuilt on first request after a cold start.
- **Single container image.** Dockerfile pins Python 3.12 slim, installs NumPy/FastAPI, copies the static SPA, runs uvicorn. No build step on the front-end.
- **One source of truth for the report.** `scripts/build_report.py` generates the same `.docx` you can download from `/report.docx` using `python-docx`.

## Data lifecycle

| Stage | Storage | Lifetime |
|-------|---------|----------|
| Capture | RAM (browser) | Single function call |
| In-flight | TLS request body | Milliseconds |
| At rest | Python dict in container RAM | ≤ 30 minutes (TTL) |
| After scale-to-zero | None | — |

## Failure modes

| Mode | Behaviour |
|------|-----------|
| Camera denied | UI surfaces actionable message; no API call made. |
| Mic denied | Same as above. |
| WebAuthn unsupported | Passkey factor is omitted; risk fusion proceeds with the available factors. |
| Network blip during verify | Toast shown, correlation ID preserved, retry available. |
| Cold-start mid-session | Templates evicted; user re-enrolls (UX clearly indicates this is expected for the demo). |

## Scaling beyond MVP

| Concern | MVP | Production path |
|---------|-----|-----------------|
| Template store | In-memory dict | Postgres + pgvector + KMS envelope encryption |
| Challenges | In-memory dict | Redis with TTL |
| Rate limiting | None | Cloud Armor / per-IP token bucket |
| Audit log | In-memory ring buffer | Pub/Sub → BigQuery; immutable append |
| Auth | Public demo | OIDC for user login on top of biometric trust |
