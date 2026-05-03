// Voice features extracted from a short microphone recording.
// Output: 18-D vector = [ZCR, centroid, rolloff, flatness, energy] + 13 mel-band log-energies.

const SAMPLE_RATE = 16000;
const RECORD_MS = 2800;
const FRAME_MS = 25;
const HOP_MS = 10;
const N_MELS = 13;

export async function recordAndExtract(progress) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone unavailable.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true },
  });
  try {
    return await captureFromStream(stream, progress);
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

async function captureFromStream(stream, progress) {
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
  const src = ac.createMediaStreamSource(stream);
  const samples = [];
  const buf = ac.createScriptProcessor ? ac.createScriptProcessor(4096, 1, 1) : null;
  if (!buf) { ac.close(); throw new Error("AudioContext does not expose script processor; please use a recent browser."); }
  buf.onaudioprocess = (e) => {
    const ch = e.inputBuffer.getChannelData(0);
    samples.push(new Float32Array(ch));
  };
  src.connect(buf); buf.connect(ac.destination);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - t0;
      progress?.(Math.min(1, elapsed / RECORD_MS));
      if (elapsed >= RECORD_MS) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  buf.disconnect(); src.disconnect(); await ac.close();
  const total = samples.reduce((s, a) => s + a.length, 0);
  const all = new Float32Array(total);
  let off = 0; for (const s of samples) { all.set(s, off); off += s.length; }
  return extractFeatures(all, SAMPLE_RATE);
}

function extractFeatures(signal, sr) {
  const frame = Math.round(sr * FRAME_MS / 1000);
  const hop = Math.round(sr * HOP_MS / 1000);
  const win = hannWindow(frame);
  const fft = nextPow2(frame);
  const half = fft / 2;
  const melFb = melFilterbank(N_MELS, fft, sr);

  // global stats
  let zcrSum = 0, zcrFrames = 0, energySum = 0;
  let centroidSum = 0, rolloffSum = 0, flatnessSum = 0;
  const melSum = new Array(N_MELS).fill(0);
  let voiced = 0;

  const re = new Float32Array(fft);
  const im = new Float32Array(fft);

  for (let start = 0; start + frame <= signal.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < frame; i++) {
      const s = signal[start + i] * win[i];
      re[i] = s; im[i] = 0;
      energy += s * s;
    }
    for (let i = frame; i < fft; i++) { re[i] = 0; im[i] = 0; }
    if (energy < 1e-5) continue;
    voiced++;
    energySum += energy;

    // zero-crossing rate on raw frame
    let zc = 0;
    for (let i = 1; i < frame; i++) {
      if ((signal[start + i - 1] >= 0) !== (signal[start + i] >= 0)) zc++;
    }
    zcrSum += zc / frame; zcrFrames++;

    fftInPlace(re, im);
    // power spectrum
    const ps = new Float32Array(half);
    let totalPower = 0;
    for (let k = 0; k < half; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      ps[k] = p; totalPower += p;
    }
    if (totalPower <= 0) continue;

    // spectral centroid
    let csum = 0;
    for (let k = 0; k < half; k++) csum += k * ps[k];
    centroidSum += csum / totalPower / half;

    // rolloff (85%)
    let cum = 0; let rolloffK = 0;
    for (let k = 0; k < half; k++) { cum += ps[k]; if (cum >= 0.85 * totalPower) { rolloffK = k; break; } }
    rolloffSum += rolloffK / half;

    // flatness = exp(mean(log)) / mean
    let logSum = 0; let lin = 0;
    for (let k = 1; k < half; k++) { const v = ps[k] + 1e-12; logSum += Math.log(v); lin += v; }
    const flat = Math.exp(logSum / (half - 1)) / (lin / (half - 1) + 1e-12);
    flatnessSum += flat;

    // mel energies
    for (let m = 0; m < N_MELS; m++) {
      const fbk = melFb[m];
      let e = 0;
      for (let k = 0; k < half; k++) e += ps[k] * fbk[k];
      melSum[m] += Math.log(e + 1e-9);
    }
  }
  if (voiced === 0) throw new Error("No voiced audio detected. Speak louder, in a quiet room.");

  const features = [
    zcrSum / Math.max(zcrFrames, 1),
    centroidSum / voiced,
    rolloffSum / voiced,
    flatnessSum / voiced,
    Math.log(energySum / voiced + 1e-9),
  ];
  for (let m = 0; m < N_MELS; m++) features.push(melSum[m] / voiced);
  return features.map((x) => +x.toFixed(6));
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// Iterative in-place radix-2 Cooley-Tukey FFT.
function fftInPlace(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wpr = Math.cos(ang), wpi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const tr = wr * re[i + k + len / 2] - wi * im[i + k + len / 2];
        const ti = wr * im[i + k + len / 2] + wi * re[i + k + len / 2];
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr; wr = nwr;
      }
    }
  }
}

function melFilterbank(nMels, fftSize, sr) {
  const half = fftSize / 2;
  const hz2mel = (h) => 2595 * Math.log10(1 + h / 700);
  const mel2hz = (m) => 700 * (Math.pow(10, m / 2595) - 1);
  const mLo = hz2mel(80), mHi = hz2mel(sr / 2);
  const points = new Array(nMels + 2);
  for (let i = 0; i < points.length; i++) points[i] = mel2hz(mLo + (i * (mHi - mLo)) / (nMels + 1));
  const bins = points.map((f) => Math.floor((fftSize + 1) * f / sr));
  const fb = [];
  for (let m = 1; m <= nMels; m++) {
    const fbk = new Float32Array(half);
    for (let k = bins[m - 1]; k < bins[m]; k++) {
      if (k >= 0 && k < half) fbk[k] = (k - bins[m - 1]) / Math.max(bins[m] - bins[m - 1], 1);
    }
    for (let k = bins[m]; k < bins[m + 1]; k++) {
      if (k >= 0 && k < half) fbk[k] = (bins[m + 1] - k) / Math.max(bins[m + 1] - bins[m], 1);
    }
    fb.push(fbk);
  }
  return fb;
}
