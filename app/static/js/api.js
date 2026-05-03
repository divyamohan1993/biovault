// Tiny fetch helper. Throws on non-2xx with the server-shaped error.
const CID = (() => {
  const k = "biovault.cid";
  let id = sessionStorage.getItem(k);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, "").slice(0, 12);
    sessionStorage.setItem(k, id);
  }
  return id;
})();

export async function api(path, body, opts = {}) {
  const init = {
    method: body == null ? (opts.method || "GET") : (opts.method || "POST"),
    headers: { "x-correlation-id": CID, ...(body == null ? {} : { "content-type": "application/json" }) },
    ...opts,
  };
  if (body != null) init.body = typeof body === "string" ? body : JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new Error(`Network failure: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { _raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const correlationId = CID;
