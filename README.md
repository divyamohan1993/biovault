# BioVault — Multi-Modal Biometric Security MVP

> Capstone project · B.Tech CSE — Cloud Computing · 2022–2026
> **Lakshika Tanwar** · GF202220476 · Shoolini University, Solan, H.P.

BioVault is a cloud-native, multi-modal biometric authentication system that fuses **face**, **voice**, **keystroke rhythm**, and a **WebAuthn passkey** into a single risk-adaptive trust score. All ML inference runs in the browser; the FastAPI backend is stateless, in-memory, and deployed to **Google Cloud Run** in `asia-east1` with `min-instances=0`.

## Live links

Production: **https://biovault.dmj.one**

| Path | What |
|------|------|
| [`/`](https://biovault.dmj.one/) | Live demo — enroll any subset of factors, then verify and watch the trust meter |
| [`/pitch`](https://biovault.dmj.one/pitch) | Arrow-key pitch deck (12 slides, `←` `→` `Home` `End` `F`) |
| [`/report`](https://biovault.dmj.one/report) | Capstone report (HTML, with TOC) |
| [`/report.docx`](https://biovault.dmj.one/report.docx) | Same report, downloadable Word version |
| [`/api/docs`](https://biovault.dmj.one/api/docs) | OpenAPI / Swagger UI |
| [`/health`](https://biovault.dmj.one/health) | Liveness + store stats |

## Why

Passwords are the weakest link in 81 % of breaches. Single-factor biometrics fall to spoofing. The fix is not a new factor — it's a way to combine several factors into a calibrated, contextual decision. BioVault demonstrates that this can ship on a free-tier serverless backend without ever sending raw biometric data over the wire.

## Architecture

```
Browser (untrusted)                       Cloud Run (asia-east1, min=0)
─ face-api.js  → 128-D descriptor         FastAPI / Pydantic v2 / NumPy
─ Web Audio    → 18-D voice features      ─ /api/face/{enroll,verify}
─ keystroke    → (2N-1)-D timing vector   ─ /api/voice/{enroll,verify}
─ WebAuthn     → passkey                  ─ /api/keystroke/{enroll,verify}
                                          ─ /api/passkey/{register,auth}
                  ─── HTTPS / JSON ──→    ─ /api/risk/score (weighted fusion)
                                          ─ /api/events     (audit ring buffer)
```

The server stores only:

- `float[128]` face descriptor (one-way embedding)
- `float[18]` voice feature vector (aggregate spectral statistics)
- `float[2N-1]` keystroke timing vector
- WebAuthn public key + sign counter

**Nothing is persisted.** Templates evict after 30 minutes or whenever the Cloud Run instance scales to zero.

## Decision policy

| Trust | Action |
|------:|--------|
| ≥ 0.85 | `ALLOW` |
| 0.65 – 0.85 | `STEP_UP` |
| < 0.65 | `DENY` |

Trust is a weighted average over present factors:

```
weights = { face: 0.35, passkey: 0.30, voice: 0.20, keystroke: 0.15 }
trust   = (Σ wᵢ · scoreᵢ / Σ wᵢ)  ×  0.9 if single factor  ×  cap 0.5 if any hard-fail
```

## Quick start

```bash
# Local
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
# open http://localhost:8080
```

```bash
# Cloud Run (one shot)
PROJECT=dmjone REGION=asia-east1 bash scripts/deploy.sh
```

```bash
# Build the Word report from source
python3 scripts/build_report.py
# writes app/static/BioVault-Capstone-Report.docx
```

## Project layout

```
app/
 main.py                  FastAPI routes, middleware, lifespan
 biometric/
   store.py               EphemeralStore, dataclasses, TTL
   face.py                Cosine + Euclidean comparison + scoring
   voice.py               Z-score cosine on 18-D vector
   keystroke.py           Manhattan distance comparator
   risk.py                Weighted fusion + decision band
 static/
   index.html             Live demo SPA
   pitch.html             Arrow-key pitch deck
   report.html            Capstone report
   css/{app,pitch,report}.css
   js/{app,api,face,voice,keystroke,passkey,pitch}.js
Dockerfile
requirements.txt
scripts/{deploy.sh, build_report.py}
.github/workflows/deploy.yml
```

## Security & privacy

- **In-browser ML.** Raw camera frames and raw audio never leave the device.
- **One-way embeddings.** Face vectors and voice features cannot be inverted to media.
- **Liveness.** Blink challenge defeats trivial photo-replay attacks.
- **Phishing-resistant.** WebAuthn passkeys are origin-bound by design.
- **Audit trail.** Every action emits a structured JSON event with a correlation ID.
- **Privacy-by-design.** No persistence, 30-minute TTL eviction, user-initiated deletion.
- **DPDP Act 2023 / GDPR aligned.** Explicit consent, real deletion, India residency.

## Performance

| Metric | Observed |
|--------|---------:|
| Cloud Run cold start | ~250–350 ms |
| Face verify p95 | < 25 ms |
| Voice verify p95 | < 8 ms |
| Keystroke verify p95 | < 6 ms |
| Container image | ~85 MiB |
| Idle cost | ₹0 / month |

## Roadmap

- pgvector + envelope-encrypted persistence
- 3D liveness + deepfake voice detection
- Continuous behavioural authentication
- Drop-in JS SDK + native bindings
- SOC 2 Type II, ISO 27001, DPDP DPO console

## License

MIT. See [LICENSE](./LICENSE).

## Author

**Lakshika Tanwar** ([@iamlakshikatanwar](https://github.com/iamlakshikatanwar)) · GF202220476
B.Tech CSE — Cloud Computing · Shoolini University.
