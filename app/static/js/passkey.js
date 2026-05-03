// WebAuthn helpers.
import { api } from "./api.js";

const b64uToBuf = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
};
const bufToB64u = (b) => {
  const bytes = new Uint8Array(b);
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function decodeOptions(opts) {
  const o = { ...opts };
  o.challenge = b64uToBuf(opts.challenge);
  if (opts.user) o.user = { ...opts.user, id: b64uToBuf(opts.user.id) };
  if (opts.excludeCredentials) o.excludeCredentials = opts.excludeCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }));
  if (opts.allowCredentials) o.allowCredentials = opts.allowCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }));
  return o;
}

function encodeAttestation(cred) {
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufToB64u(cred.response.attestationObject),
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      transports: cred.response.getTransports?.() || [],
    },
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
  };
}

function encodeAssertion(cred) {
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufToB64u(cred.response.authenticatorData),
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      signature: bufToB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
  };
}

export async function registerPasskey(userId) {
  if (!window.PublicKeyCredential) throw new Error("Passkeys not supported in this browser");
  const opts = await api("/api/passkey/register/begin", { user_id: userId });
  const created = await navigator.credentials.create({ publicKey: decodeOptions(opts) });
  if (!created) throw new Error("Passkey registration cancelled");
  return api("/api/passkey/register/complete", { user_id: userId, credential: encodeAttestation(created) });
}

export async function authenticatePasskey(userId) {
  const opts = await api("/api/passkey/auth/begin", { user_id: userId });
  const got = await navigator.credentials.get({ publicKey: decodeOptions(opts) });
  if (!got) throw new Error("Passkey auth cancelled");
  return api("/api/passkey/auth/complete", { user_id: userId, credential: encodeAssertion(got) });
}
