"""BioVault FastAPI application.

Endpoints:
  GET  /                    -> static SPA (biometric demo)
  GET  /pitch               -> pitch deck
  GET  /report              -> capstone report
  GET  /health              -> liveness
  GET  /api/version         -> build info
  GET  /api/stats           -> store stats
  GET  /api/events          -> recent verification events
  POST /api/users           -> create demo user
  GET  /api/users           -> list demo users
  DELETE /api/users/{id}    -> drop user
  POST /api/face/enroll     -> enroll face descriptor
  POST /api/face/verify     -> verify face descriptor
  POST /api/voice/enroll    -> enroll voice template
  POST /api/voice/verify    -> verify voice template
  POST /api/keystroke/enroll-> enroll keystroke timing
  POST /api/keystroke/verify-> verify keystroke timing
  POST /api/passkey/register/begin
  POST /api/passkey/register/complete
  POST /api/passkey/auth/begin
  POST /api/passkey/auth/complete
  POST /api/risk/score      -> compute aggregate risk

In-memory only. Designed for Cloud Run min=0 cold starts.
"""
from __future__ import annotations

import logging
import os
import time
import secrets
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, Any

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .biometric import (
    store,
    compare_face,
    compare_voice,
    compare_keystroke,
    compute_risk,
)
from .biometric.face import FACE_DESCRIPTOR_DIM
from .biometric.voice import VOICE_VECTOR_DIM
from .biometric.keystroke import expected_len

# WebAuthn (passkey) bits — optional but production-grade when domain is set
import webauthn
from webauthn.helpers.structs import (
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
)

# ---------------------------------------------------------------------------
# Logging — verbose, structured per global instructions
# ---------------------------------------------------------------------------

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "file": f"{record.filename}:{record.lineno}",
            "func": record.funcName,
            "msg": record.getMessage(),
        }
        cid = getattr(record, "correlation_id", None)
        if cid:
            payload["correlation_id"] = cid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO"))


_configure_logging()
log = logging.getLogger("biovault")


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("BioVault %s booting (region=%s, instance=%s)",
             __version__,
             os.getenv("CLOUD_RUN_REGION", "local"),
             os.getenv("K_REVISION", "dev"))
    yield
    log.info("BioVault shutting down")


app = FastAPI(
    title="BioVault — Multi-Modal Biometric Security",
    version=__version__,
    description="Capstone MVP: face + voice + keystroke + passkey, in-memory only.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
)

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],            # public demo, all reads same-origin
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Correlation ID + structured access logging + security headers
# ---------------------------------------------------------------------------

@app.middleware("http")
async def request_context(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:12]
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("Unhandled error", extra={"correlation_id": cid})
        return JSONResponse(
            {"error": {"code": "internal_error", "message": "Unexpected failure", "correlation_id": cid}},
            status_code=500,
        )
    dur_ms = (time.perf_counter() - start) * 1000
    log.info(
        "%s %s -> %d in %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        dur_ms,
        extra={"correlation_id": cid},
    )
    response.headers["X-Correlation-ID"] = cid
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), publickey-credentials-get=(self)"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    if not request.url.path.startswith("/static"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Static + page routes
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/pitch", response_class=HTMLResponse, include_in_schema=False)
@app.get("/pitch/", response_class=HTMLResponse, include_in_schema=False)
async def pitch() -> FileResponse:
    return FileResponse(STATIC_DIR / "pitch.html")


@app.get("/report", response_class=HTMLResponse, include_in_schema=False)
@app.get("/report/", response_class=HTMLResponse, include_in_schema=False)
async def report() -> FileResponse:
    return FileResponse(STATIC_DIR / "report.html")


@app.get("/report.docx", include_in_schema=False)
async def report_docx() -> FileResponse:
    f = STATIC_DIR / "BioVault-Capstone-Report.docx"
    if not f.exists():
        raise HTTPException(status_code=404, detail="report not built")
    return FileResponse(
        f,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="BioVault-Capstone-Report.docx",
    )


@app.get("/robots.txt", response_class=PlainTextResponse, include_in_schema=False)
async def robots() -> str:
    return "User-agent: *\nAllow: /\n"


@app.get("/health", include_in_schema=False)
async def health() -> dict:
    return {"status": "ok", "version": __version__, "store": store.stats()}


@app.get("/api/version")
async def version() -> dict:
    return {
        "name": "biovault",
        "version": __version__,
        "region": os.getenv("CLOUD_RUN_REGION", "local"),
        "revision": os.getenv("K_REVISION", "dev"),
    }


@app.get("/api/stats")
async def stats() -> dict:
    return store.stats()


@app.get("/api/events")
async def events(limit: int = 50) -> dict:
    return {"events": store.recent_events(min(max(limit, 1), 200))}


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class CreateUserBody(BaseModel):
    label: str = Field(min_length=1, max_length=60)


@app.post("/api/users")
async def create_user(body: CreateUserBody) -> dict:
    rec = store.create_user(body.label)
    store.log_event({"type": "user.created", "user_id": rec.user_id, "label": rec.label})
    return _user_summary(rec)


@app.get("/api/users")
async def list_users() -> dict:
    return {"users": [_user_summary(u) for u in store.list_users()]}


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str) -> dict:
    ok = store.delete_user(user_id)
    if not ok:
        raise HTTPException(404, detail="user not found")
    store.log_event({"type": "user.deleted", "user_id": user_id})
    return {"deleted": user_id}


def _user_summary(u) -> dict:
    return {
        "user_id": u.user_id,
        "label": u.label,
        "created_at": u.created_at,
        "factors": {
            "face": bool(u.face),
            "voice": bool(u.voice),
            "keystroke": bool(u.keystroke),
            "passkey": bool(u.passkey),
        },
        "passphrase": u.keystroke.passphrase if u.keystroke else None,
    }


# ---------------------------------------------------------------------------
# Face
# ---------------------------------------------------------------------------

class FaceEnrollBody(BaseModel):
    user_id: str
    descriptor: list[float]
    liveness_passed: bool = False

    @field_validator("descriptor")
    @classmethod
    def _len(cls, v: list[float]) -> list[float]:
        if len(v) != FACE_DESCRIPTOR_DIM:
            raise ValueError(f"descriptor must be {FACE_DESCRIPTOR_DIM}-D")
        return v


class FaceVerifyBody(BaseModel):
    user_id: str
    descriptor: list[float]
    liveness_passed: bool = False


@app.post("/api/face/enroll")
async def face_enroll(body: FaceEnrollBody) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    from .biometric.store import FaceTemplate
    user.face = FaceTemplate(descriptor=body.descriptor, liveness_passed=body.liveness_passed)
    user.touch()
    store.log_event({"type": "face.enrolled", "user_id": user.user_id})
    log.info("face enrolled user=%s liveness=%s", user.user_id, body.liveness_passed)
    return {"ok": True, "factors_enrolled": _user_summary(user)["factors"]}


@app.post("/api/face/verify")
async def face_verify(body: FaceVerifyBody) -> dict:
    user = store.get_user(body.user_id)
    if not user or not user.face:
        raise HTTPException(404, "face not enrolled")
    try:
        result = compare_face(user.face.descriptor, body.descriptor)
    except ValueError as e:
        raise HTTPException(400, str(e))
    result["liveness_passed"] = bool(body.liveness_passed)
    user.touch()
    store.log_event({
        "type": "face.verify",
        "user_id": user.user_id,
        "score": result["score"],
        "passed": result["passed"] and body.liveness_passed,
    })
    return result


# ---------------------------------------------------------------------------
# Voice
# ---------------------------------------------------------------------------

class VoiceBody(BaseModel):
    user_id: str
    features: list[float]

    @field_validator("features")
    @classmethod
    def _len(cls, v: list[float]) -> list[float]:
        if len(v) != VOICE_VECTOR_DIM:
            raise ValueError(f"features must be {VOICE_VECTOR_DIM}-D")
        return v


@app.post("/api/voice/enroll")
async def voice_enroll(body: VoiceBody) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    from .biometric.store import VoiceTemplate
    user.voice = VoiceTemplate(feature_vector=body.features)
    user.touch()
    store.log_event({"type": "voice.enrolled", "user_id": user.user_id})
    return {"ok": True, "factors_enrolled": _user_summary(user)["factors"]}


@app.post("/api/voice/verify")
async def voice_verify(body: VoiceBody) -> dict:
    user = store.get_user(body.user_id)
    if not user or not user.voice:
        raise HTTPException(404, "voice not enrolled")
    try:
        result = compare_voice(user.voice.feature_vector, body.features)
    except ValueError as e:
        raise HTTPException(400, str(e))
    user.touch()
    store.log_event({
        "type": "voice.verify",
        "user_id": user.user_id,
        "score": result["score"],
        "passed": result["passed"],
    })
    return result


# ---------------------------------------------------------------------------
# Keystroke
# ---------------------------------------------------------------------------

class KeystrokeEnrollBody(BaseModel):
    user_id: str
    passphrase: str = Field(min_length=4, max_length=64)
    timing: list[float]


class KeystrokeVerifyBody(BaseModel):
    user_id: str
    timing: list[float]


@app.post("/api/keystroke/enroll")
async def keystroke_enroll(body: KeystrokeEnrollBody) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    needed = expected_len(body.passphrase)
    if len(body.timing) != needed:
        raise HTTPException(400, f"timing must have {needed} entries")
    from .biometric.store import KeystrokeTemplate
    user.keystroke = KeystrokeTemplate(passphrase=body.passphrase, timing_vector=body.timing)
    user.touch()
    store.log_event({"type": "keystroke.enrolled", "user_id": user.user_id})
    return {"ok": True, "factors_enrolled": _user_summary(user)["factors"], "passphrase": body.passphrase}


@app.post("/api/keystroke/verify")
async def keystroke_verify(body: KeystrokeVerifyBody) -> dict:
    user = store.get_user(body.user_id)
    if not user or not user.keystroke:
        raise HTTPException(404, "keystroke not enrolled")
    try:
        result = compare_keystroke(user.keystroke.passphrase, user.keystroke.timing_vector, body.timing)
    except ValueError as e:
        raise HTTPException(400, str(e))
    user.touch()
    store.log_event({
        "type": "keystroke.verify",
        "user_id": user.user_id,
        "score": result["score"],
        "passed": result["passed"],
    })
    return result


# ---------------------------------------------------------------------------
# WebAuthn passkey
# ---------------------------------------------------------------------------

def _rp_for_request(request: Request) -> tuple[str, str]:
    """Return (rp_id, origin) consistent with the request host."""
    host = request.headers.get("x-forwarded-host") or request.url.hostname or "localhost"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    rp_id = host.split(":")[0]
    origin = f"{proto}://{host}"
    return rp_id, origin


class PasskeyBeginBody(BaseModel):
    user_id: str


class PasskeyCompleteBody(BaseModel):
    user_id: str
    credential: dict[str, Any]


@app.post("/api/passkey/register/begin")
async def passkey_register_begin(body: PasskeyBeginBody, request: Request) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    rp_id, _ = _rp_for_request(request)
    challenge = secrets.token_bytes(32)
    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name="BioVault",
        user_id=user.user_id.encode(),
        user_name=user.label or user.user_id,
        user_display_name=user.label or user.user_id,
        challenge=challenge,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.PREFERRED,
            resident_key=ResidentKeyRequirement.PREFERRED,
        ),
    )
    store.stash_challenge(f"reg:{user.user_id}", challenge)
    return json.loads(webauthn.options_to_json(options))


@app.post("/api/passkey/register/complete")
async def passkey_register_complete(body: PasskeyCompleteBody, request: Request) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    challenge = store.consume_challenge(f"reg:{user.user_id}")
    if not challenge:
        raise HTTPException(400, "challenge expired")
    rp_id, origin = _rp_for_request(request)
    try:
        verified = webauthn.verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
        )
    except Exception as e:
        log.warning("passkey reg failed: %s", e)
        raise HTTPException(400, f"registration failed: {e}")
    from .biometric.store import PasskeyCredential
    user.passkey = PasskeyCredential(
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
    )
    user.touch()
    store.log_event({"type": "passkey.registered", "user_id": user.user_id})
    return {"ok": True, "factors_enrolled": _user_summary(user)["factors"]}


@app.post("/api/passkey/auth/begin")
async def passkey_auth_begin(body: PasskeyBeginBody, request: Request) -> dict:
    user = store.get_user(body.user_id)
    if not user or not user.passkey:
        raise HTTPException(404, "passkey not enrolled")
    rp_id, _ = _rp_for_request(request)
    challenge = secrets.token_bytes(32)
    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge,
        allow_credentials=[PublicKeyCredentialDescriptor(id=user.passkey.credential_id)],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    store.stash_challenge(f"auth:{user.user_id}", challenge)
    return json.loads(webauthn.options_to_json(options))


@app.post("/api/passkey/auth/complete")
async def passkey_auth_complete(body: PasskeyCompleteBody, request: Request) -> dict:
    user = store.get_user(body.user_id)
    if not user or not user.passkey:
        raise HTTPException(404, "passkey not enrolled")
    challenge = store.consume_challenge(f"auth:{user.user_id}")
    if not challenge:
        raise HTTPException(400, "challenge expired")
    rp_id, origin = _rp_for_request(request)
    try:
        verified = webauthn.verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
            credential_public_key=user.passkey.public_key,
            credential_current_sign_count=user.passkey.sign_count,
        )
    except Exception as e:
        log.warning("passkey auth failed: %s", e)
        raise HTTPException(400, f"authentication failed: {e}")
    user.passkey.sign_count = verified.new_sign_count
    user.touch()
    store.log_event({"type": "passkey.verified", "user_id": user.user_id, "score": 1.0, "passed": True})
    return {"ok": True, "score": 1.0, "passed": True}


# ---------------------------------------------------------------------------
# Aggregate risk
# ---------------------------------------------------------------------------

class RiskBody(BaseModel):
    user_id: str
    scores: dict[str, float]
    passed: dict[str, bool] | None = None


@app.post("/api/risk/score")
async def risk_score(body: RiskBody) -> dict:
    user = store.get_user(body.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    decision = compute_risk(body.scores, body.passed)
    store.log_event({
        "type": "risk.decision",
        "user_id": user.user_id,
        "trust": decision["trust"],
        "action": decision["action"],
        "factors": decision["factors"],
    })
    return decision


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------

@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    cid = getattr(request.state, "cid", None) or request.headers.get("x-correlation-id") or "-"
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": f"http_{exc.status_code}", "message": exc.detail, "correlation_id": cid}},
    )
