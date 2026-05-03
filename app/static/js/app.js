import { api } from "./api.js";
import * as Face from "./face.js";
import { recordAndExtract as voiceRecord } from "./voice.js";
import { attachKeystrokeCapture } from "./keystroke.js";
import { registerPasskey, authenticatePasskey } from "./passkey.js";

const state = {
  user: null,
  scores: {},
  passed: {},
  decision: null,
};

const $ = (s) => document.querySelector(s);
const setMeter = (sel, score, pass = null) => {
  const m = $(sel).parentElement;
  m.classList.remove("ok", "bad");
  if (pass === true) m.classList.add("ok");
  else if (pass === false) m.classList.add("bad");
  $(sel).style.width = `${Math.round((score || 0) * 100)}%`;
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function setStatus(sel, text, kind = "") {
  const el = $(sel);
  el.className = `status ${kind}`;
  el.textContent = text;
}

function el(tag, props = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "title") node.title = v;
    else if (k === "type") node.type = v;
    else node.setAttribute(k, v);
  }
  if (text != null) node.textContent = String(text);
  return node;
}

async function refreshUsers() {
  const { users } = await api("/api/users");
  const list = $("#user-list");
  list.replaceChildren();
  for (const u of users) {
    const f = u.factors || {};
    const tag = `${f.face ? "F" : "·"}${f.voice ? "V" : "·"}${f.keystroke ? "K" : "·"}${f.passkey ? "P" : "·"}`;
    const pill = el("button", { class: "user-pill" + (state.user?.user_id === u.user_id ? " active" : ""), title: `id=${u.user_id}` });
    pill.appendChild(el("span", {}, u.label));
    pill.appendChild(el("span", { class: "factors" }, tag));
    pill.addEventListener("click", () => selectUser(u));
    list.appendChild(pill);
  }
  if (!state.user && users[0]) selectUser(users[0]);
}

function selectUser(u) {
  state.user = u;
  state.scores = {}; state.passed = {}; state.decision = null;
  $("#factor-active-user").textContent = `Active user: ${u.label} (${u.user_id})`;
  $("#btn-face-verify").disabled = !u.factors.face;
  $("#btn-voice-verify").disabled = !u.factors.voice;
  $("#btn-keys-verify").disabled = !u.factors.keystroke;
  $("#btn-passkey-verify").disabled = !u.factors.passkey;
  $("#btn-decide").disabled = true;
  $("#tile-face").classList.toggle("enrolled", !!u.factors.face);
  $("#tile-voice").classList.toggle("enrolled", !!u.factors.voice);
  $("#tile-keys").classList.toggle("enrolled", !!u.factors.keystroke);
  $("#tile-passkey").classList.toggle("enrolled", !!u.factors.passkey);
  setStatus("#face-status", u.factors.face ? "Enrolled" : "Not enrolled", u.factors.face ? "ok" : "");
  setStatus("#voice-status", u.factors.voice ? "Enrolled" : "Not enrolled", u.factors.voice ? "ok" : "");
  setStatus("#keys-status", u.factors.keystroke ? "Enrolled" : "Not enrolled", u.factors.keystroke ? "ok" : "");
  setStatus("#passkey-status", u.factors.passkey ? "Enrolled" : "Not enrolled", u.factors.passkey ? "ok" : "");
  if (u.passphrase) $("#kbd-passphrase").value = u.passphrase;
  refreshUsers();
  resetMeters();
  updateLiveCard();
}

function resetMeters() {
  setMeter("#face-meter", 0); setMeter("#voice-meter", 0); setMeter("#keys-meter", 0); setMeter("#passkey-meter", 0);
  $("#m-face").textContent = "—";
  $("#m-voice").textContent = "—";
  $("#m-keys").textContent = "—";
  $("#m-passkey").textContent = "—";
  $("#m-trust").textContent = "0%";
  $("#live-trust").style.width = "0%";
  $("#live-action").textContent = "— idle —";
  $("#decision-row").className = "decision";
  $("#decision-label").textContent = "No decision yet";
  $("#decision-val").textContent = "trust=0.000";
}

function updateLiveCard() {
  const fmt = (k) => state.scores[k] != null ? state.scores[k].toFixed(2) : "—";
  $("#m-face").textContent = fmt("face");
  $("#m-voice").textContent = fmt("voice");
  $("#m-keys").textContent = fmt("keystroke");
  $("#m-passkey").textContent = state.scores.passkey != null ? "1.00" : "—";
  $("#btn-decide").disabled = Object.keys(state.scores).length === 0;
}

async function withButton(btn, label, fn) {
  const orig = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

function requireUser() {
  if (!state.user) { toast("Pick a user first.", "bad"); throw new Error("no user"); }
}

async function faceCapture(mode) {
  requireUser();
  const wrap = $("#face-video-wrap"); wrap.hidden = false;
  const video = $("#face-video"); const canvas = $("#face-canvas"); const prompt = $("#face-prompt");
  await Face.startCamera(video);
  try {
    const { descriptor, livenessPassed } = await Face.captureWithLiveness(video, canvas, prompt);
    if (mode === "enroll") {
      await api("/api/face/enroll", { user_id: state.user.user_id, descriptor, liveness_passed: livenessPassed });
      toast(`Face enrolled (liveness ${livenessPassed ? "✓" : "—"}).`, "ok");
      setStatus("#face-status", "Enrolled", "ok");
      $("#btn-face-verify").disabled = false;
      $("#tile-face").classList.add("enrolled");
      await refreshUsers();
    } else {
      const r = await api("/api/face/verify", { user_id: state.user.user_id, descriptor, liveness_passed: livenessPassed });
      state.scores.face = r.score; state.passed.face = r.passed && livenessPassed;
      setMeter("#face-meter", r.score, state.passed.face);
      setStatus("#face-status",
        `${state.passed.face ? "Match ✓" : "No match"} · score ${r.score} · dist ${r.distance}`,
        state.passed.face ? "ok" : "bad");
      toast(state.passed.face ? `Face match (${r.score}).` : `Face mismatch (${r.score}).`, state.passed.face ? "ok" : "bad");
    }
  } finally {
    Face.stopCamera(video); wrap.hidden = true; updateLiveCard();
  }
}

async function voiceCapture(mode) {
  requireUser();
  toast("Speak the phrase…");
  const features = await voiceRecord();
  if (mode === "enroll") {
    await api("/api/voice/enroll", { user_id: state.user.user_id, features });
    toast("Voice enrolled.", "ok");
    setStatus("#voice-status", "Enrolled", "ok");
    $("#btn-voice-verify").disabled = false;
    $("#tile-voice").classList.add("enrolled");
    await refreshUsers();
  } else {
    const r = await api("/api/voice/verify", { user_id: state.user.user_id, features });
    state.scores.voice = r.score; state.passed.voice = r.passed;
    setMeter("#voice-meter", r.score, r.passed);
    setStatus("#voice-status", `${r.passed ? "Match ✓" : "No match"} · score ${r.score}`, r.passed ? "ok" : "bad");
    toast(r.passed ? `Voice match (${r.score}).` : `Voice mismatch (${r.score}).`, r.passed ? "ok" : "bad");
  }
  updateLiveCard();
}

let kbd;
function setupKeystroke() {
  const input = $("#kbd-input"); const fb = $("#kbd-feedback");
  const passphrase = () => $("#kbd-passphrase").value.toLowerCase();
  kbd = attachKeystrokeCapture(input, passphrase, fb);
  $("#kbd-passphrase").addEventListener("input", () => kbd.start());
}

async function keysCapture(mode) {
  requireUser();
  if (!kbd.isComplete()) { toast("Type the passphrase fully.", "bad"); return; }
  const snap = kbd.snapshot();
  if (mode === "enroll") {
    await api("/api/keystroke/enroll", { user_id: state.user.user_id, passphrase: snap.passphrase, timing: snap.timing });
    toast("Keystroke pattern enrolled.", "ok");
    setStatus("#keys-status", "Enrolled", "ok");
    $("#btn-keys-verify").disabled = false;
    $("#tile-keys").classList.add("enrolled");
    await refreshUsers();
  } else {
    const r = await api("/api/keystroke/verify", { user_id: state.user.user_id, timing: snap.timing });
    state.scores.keystroke = r.score; state.passed.keystroke = r.passed;
    setMeter("#keys-meter", r.score, r.passed);
    setStatus("#keys-status", `${r.passed ? "Match ✓" : "No match"} · score ${r.score}`, r.passed ? "ok" : "bad");
    toast(r.passed ? `Typing match (${r.score}).` : `Typing mismatch (${r.score}).`, r.passed ? "ok" : "bad");
  }
  kbd.start();
  updateLiveCard();
}

async function passkeyAction(mode) {
  requireUser();
  if (mode === "enroll") {
    await registerPasskey(state.user.user_id);
    toast("Passkey registered.", "ok");
    setStatus("#passkey-status", "Enrolled", "ok");
    $("#btn-passkey-verify").disabled = false;
    $("#tile-passkey").classList.add("enrolled");
    await refreshUsers();
  } else {
    const r = await authenticatePasskey(state.user.user_id);
    state.scores.passkey = r.score; state.passed.passkey = r.passed;
    setMeter("#passkey-meter", r.score, r.passed);
    setStatus("#passkey-status", "Authenticated ✓", "ok");
    toast("Passkey verified.", "ok");
  }
  updateLiveCard();
}

async function decide() {
  requireUser();
  const r = await api("/api/risk/score", { user_id: state.user.user_id, scores: state.scores, passed: state.passed });
  state.decision = r;
  $("#m-trust").textContent = `${Math.round(r.trust * 100)}%`;
  $("#live-trust").style.width = `${Math.round(r.trust * 100)}%`;
  const live = $("#live-action");
  const row = $("#decision-row");
  row.className = "decision " + (r.action === "ALLOW" ? "allow" : r.action === "STEP_UP" ? "stepup" : "deny");
  $("#decision-label").textContent = r.action.replace("_", " ");
  $("#decision-val").textContent = `trust=${r.trust.toFixed(3)} · risk=${r.risk.toFixed(3)} · ${Object.keys(r.factors).length} factor${Object.keys(r.factors).length !== 1 ? "s" : ""}`;
  live.textContent = r.action;
  toast(`Decision: ${r.action} (trust ${r.trust.toFixed(2)})`, r.action === "ALLOW" ? "ok" : r.action === "DENY" ? "bad" : "");
}

async function pollEvents() {
  try {
    const { events } = await api("/api/events?limit=80");
    const log = $("#siem-log");
    log.replaceChildren();
    for (const e of events) {
      const row = el("div", { class: "row" });
      const t = new Date(e.ts * 1000);
      const passed = e.passed === true ? "ok" : e.passed === false ? "fail" : "";
      row.appendChild(el("div", { class: "ts" }, t.toLocaleTimeString()));
      row.appendChild(el("div", { class: `ev ${passed}` }, e.type));
      const parts = [];
      if (e.user_id) parts.push(`u=${e.user_id}`);
      if (e.score != null) parts.push(`s=${e.score}`);
      if (e.action) parts.push(`-> ${e.action}`);
      if (e.trust != null) parts.push(`trust=${e.trust}`);
      row.appendChild(el("div", { class: "det" }, parts.join(" ")));
      log.appendChild(row);
    }
  } catch (e) { /* transient */ }
}

function wire() {
  setupKeystroke();
  $("#btn-create-user").addEventListener("click", async () => {
    const label = $("#user-label").value.trim();
    if (!label) { toast("Enter a display name.", "bad"); return; }
    const u = await api("/api/users", { label });
    $("#user-label").value = "";
    await refreshUsers();
    const fresh = (await api("/api/users")).users.find((x) => x.user_id === u.user_id) || u;
    selectUser(fresh);
    toast(`Created ${u.label}.`, "ok");
  });
  $("#cta-start").addEventListener("click", () => $("#step-id").scrollIntoView({ behavior: "smooth" }));
  $("#btn-face-enroll").addEventListener("click", (e) => withButton(e.currentTarget, "Capturing…", () => faceCapture("enroll")).catch((err) => toast(err.message, "bad")));
  $("#btn-face-verify").addEventListener("click", (e) => withButton(e.currentTarget, "Verifying…", () => faceCapture("verify")).catch((err) => toast(err.message, "bad")));
  $("#btn-voice-enroll").addEventListener("click", (e) => withButton(e.currentTarget, "Recording…", () => voiceCapture("enroll")).catch((err) => toast(err.message, "bad")));
  $("#btn-voice-verify").addEventListener("click", (e) => withButton(e.currentTarget, "Recording…", () => voiceCapture("verify")).catch((err) => toast(err.message, "bad")));
  $("#btn-keys-enroll").addEventListener("click", (e) => withButton(e.currentTarget, "Saving…", () => keysCapture("enroll")).catch((err) => toast(err.message, "bad")));
  $("#btn-keys-verify").addEventListener("click", (e) => withButton(e.currentTarget, "Checking…", () => keysCapture("verify")).catch((err) => toast(err.message, "bad")));
  $("#btn-passkey-enroll").addEventListener("click", (e) => withButton(e.currentTarget, "…", () => passkeyAction("enroll")).catch((err) => toast(err.message, "bad")));
  $("#btn-passkey-verify").addEventListener("click", (e) => withButton(e.currentTarget, "…", () => passkeyAction("verify")).catch((err) => toast(err.message, "bad")));
  $("#btn-decide").addEventListener("click", (e) => withButton(e.currentTarget, "Computing…", decide).catch((err) => toast(err.message, "bad")));
}

async function init() {
  wire();
  try {
    const v = await api("/api/version"); $("#ver").textContent = v.version;
  } catch {}
  await refreshUsers();
  pollEvents(); setInterval(pollEvents, 3000);
  Face.loadModels().catch(() => {});
}

init();
