// Face descriptor + blink-based liveness using face-api.js (loaded via CDN).
// All inference is local. Server only sees the 128-D float vector.

let modelsReady = false;

const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

export async function loadModels() {
  if (modelsReady) return;
  if (!window.faceapi) throw new Error("face-api.js failed to load");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  modelsReady = true;
}

let activeStream = null;

export async function startCamera(videoEl) {
  if (activeStream) return activeStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable in this browser");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 480, height: 360, facingMode: "user" },
    audio: false,
  });
  videoEl.srcObject = stream;
  await new Promise((r) => (videoEl.onloadedmetadata = r));
  activeStream = stream;
  return stream;
}

export function stopCamera(videoEl) {
  if (!activeStream) return;
  for (const t of activeStream.getTracks()) t.stop();
  activeStream = null;
  if (videoEl) videoEl.srcObject = null;
}

const detectorOpts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 });

// Eye-aspect ratio = simple openness measure across 6 landmarks per eye.
function eyeOpenness(eye) {
  // eye = 6 points (0..5). EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const v = d(eye[1], eye[5]) + d(eye[2], eye[4]);
  const h = 2 * d(eye[0], eye[3]) || 1e-6;
  return v / h;
}

// Run liveness then capture a stable descriptor. Resolves with { descriptor, livenessPassed }.
export async function captureWithLiveness(videoEl, canvasEl, promptEl) {
  await loadModels();
  const promptSet = (s) => { if (promptEl) promptEl.textContent = s; };
  promptSet("Look at the camera…");
  const ctx = canvasEl.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvasEl.width = videoEl.videoWidth * dpr;
    canvasEl.height = videoEl.videoHeight * dpr;
    canvasEl.style.width = "100%"; canvasEl.style.height = "100%";
  };
  resize();

  const drawBox = (det) => {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!det) return;
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = "rgba(0,229,255,0.9)";
    ctx.shadowColor = "rgba(0,229,255,0.6)";
    ctx.shadowBlur = 18 * dpr;
    const b = det.detection.box;
    ctx.strokeRect(b.x * dpr, b.y * dpr, b.width * dpr, b.height * dpr);
  };

  const stable = await waitForStableFace(videoEl, drawBox, promptSet);
  if (!stable) throw new Error("No face detected. Move closer and ensure good lighting.");

  // Liveness: detect a blink. Track EAR over ~3.5 seconds; need a clear dip.
  promptSet("Now blink once 👁️");
  const livenessPassed = await detectBlink(videoEl, drawBox);
  promptSet(livenessPassed ? "Liveness ✓ — capturing template…" : "Liveness inconclusive — capturing anyway…");

  // Capture the descriptor across a few frames and average for stability.
  const descriptors = [];
  for (let i = 0; i < 4; i++) {
    const result = await faceapi
      .detectSingleFace(videoEl, detectorOpts())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (result?.descriptor) descriptors.push(Array.from(result.descriptor));
    await sleep(140);
  }
  if (descriptors.length === 0) throw new Error("Could not extract a face descriptor.");
  const dim = descriptors[0].length;
  const avg = new Array(dim).fill(0);
  for (const d of descriptors) for (let i = 0; i < dim; i++) avg[i] += d[i];
  for (let i = 0; i < dim; i++) avg[i] /= descriptors.length;
  // Re-normalize to unit length (face-api descriptors are already ~unit but average isn't)
  let n = 0; for (const v of avg) n += v * v; n = Math.sqrt(n) || 1;
  for (let i = 0; i < dim; i++) avg[i] /= n;
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  return { descriptor: avg, livenessPassed };
}

async function waitForStableFace(videoEl, drawBox, promptSet, ms = 4000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const det = await faceapi.detectSingleFace(videoEl, detectorOpts()).withFaceLandmarks();
    drawBox(det);
    if (det) return det;
    promptSet("Looking for your face…");
    await sleep(120);
  }
  return null;
}

async function detectBlink(videoEl, drawBox, ms = 3500) {
  const t0 = performance.now();
  let baseline = null;
  let minSeen = Infinity;
  let dipSeen = false;
  while (performance.now() - t0 < ms) {
    const det = await faceapi.detectSingleFace(videoEl, detectorOpts()).withFaceLandmarks();
    drawBox(det);
    if (det?.landmarks) {
      const left = det.landmarks.getLeftEye();
      const right = det.landmarks.getRightEye();
      const ear = (eyeOpenness(left) + eyeOpenness(right)) / 2;
      if (baseline === null) baseline = ear;
      baseline = baseline * 0.85 + ear * 0.15;
      if (ear < minSeen) minSeen = ear;
      if (baseline > 0 && minSeen < baseline * 0.6) { dipSeen = true; break; }
    }
    await sleep(80);
  }
  return dipSeen;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
