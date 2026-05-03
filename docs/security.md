# Security & privacy notes

This is an MVP. The choices here are deliberate, not laziness.

## What we don't do (intentionally)

- **Persist anything.** Templates live only in container RAM with a 30-minute TTL. Cloud Run min=0 means zero data exists when the service is idle.
- **Send raw media.** All ML happens in the browser. Only feature vectors and base64url-encoded WebAuthn material cross the wire.
- **Trust a single factor.** Even a perfect face match without liveness, or a typing match alone, scores below the ALLOW threshold by design.
- **Skip phishing-resistance.** WebAuthn passkeys carry the highest weight (0.30) because they are the only factor that is intrinsically origin-bound.

## What we do

- **HSTS preload-style headers** on every response (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
- **Restrictive Permissions-Policy** allowing camera/microphone/passkey only on the same origin.
- **`X-Content-Type-Options: nosniff`** and a strict referrer policy.
- **Correlation IDs.** Every request gets one (`X-Correlation-ID`); structured logs include it for end-to-end traceability.
- **Input validation at boundaries.** Pydantic v2 models enforce vector dimension and finite values before any compute.
- **Constant-time logic** in challenge consumption (`pop` followed by TTL check), mitigating challenge-replay races.
- **Single-factor and hard-fail penalties** in fusion to prevent any one signal from dominating.

## Roadmap items

- Envelope-encrypted persistence (KMS-managed) once users opt in.
- Cloud Armor + per-IP rate limiting.
- IP-, device-, and geo-risk inputs to the fusion policy.
- Formal anti-spoofing measurement against a deepfake corpus.

## Disclosure

Found something? Open a private security advisory on the GitHub repo.
