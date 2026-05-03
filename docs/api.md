# API reference

All endpoints accept and return JSON. Errors use the shape `{"error": {"code", "message", "correlation_id"}}`.

OpenAPI / Swagger is available at `/api/docs`.

## Users

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/users` | `{"label": "Lakshika"}` | user summary |
| `GET` | `/api/users` | — | `{"users": [...]}` |
| `DELETE` | `/api/users/{id}` | — | `{"deleted": id}` |

User summary:

```json
{
  "user_id": "kvNWf7-A",
  "label": "Lakshika",
  "created_at": 1720000000.0,
  "factors": { "face": false, "voice": false, "keystroke": false, "passkey": false },
  "passphrase": null
}
```

## Face

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/face/enroll` | `{ user_id, descriptor: float[128], liveness_passed }` |
| `POST` | `/api/face/verify` | `{ user_id, descriptor: float[128], liveness_passed }` |

Verify returns `{ distance, cosine_similarity, score, passed, threshold }`.

## Voice

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/voice/enroll` | `{ user_id, features: float[18] }` |
| `POST` | `/api/voice/verify` | `{ user_id, features: float[18] }` |

Verify returns `{ cosine_similarity, score, passed, threshold }`.

## Keystroke

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/keystroke/enroll` | `{ user_id, passphrase, timing: float[2N-1] }` |
| `POST` | `/api/keystroke/verify` | `{ user_id, timing: float[2N-1] }` |

Verify returns `{ manhattan_distance, normalized_distance, score, passed, threshold }`.

## Passkey (WebAuthn)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/passkey/register/begin` | `{ user_id }` → PublicKeyCredentialCreationOptions |
| `POST` | `/api/passkey/register/complete` | `{ user_id, credential }` |
| `POST` | `/api/passkey/auth/begin` | `{ user_id }` → PublicKeyCredentialRequestOptions |
| `POST` | `/api/passkey/auth/complete` | `{ user_id, credential }` |

The `credential` shape follows the W3C JSON encoding: each `ArrayBuffer` is sent as a base64url string.

## Risk fusion

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/risk/score` | `{ user_id, scores: {face?, voice?, keystroke?, passkey?}, passed?: {...} }` |

Returns `{ trust, risk, action, reasons, factors }` where `action ∈ {ALLOW, STEP_UP, DENY}`.

## Audit

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/api/events?limit=50` | `{ events: [...] }` |
| `GET` | `/api/stats` | `{ users, events, uptime_sec }` |

## Operational

| Path | Use |
|------|-----|
| `/health` | Liveness probe + store stats |
| `/api/version` | Build / region / revision |
| `/api/docs` | Swagger UI |
