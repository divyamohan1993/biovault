// Keystroke dynamics: capture dwell + flight times for a fixed passphrase.
// Returned vector layout: [dwell0, flight01, dwell1, flight12, ..., dwellN-1].
// Length = 2*N - 1 for an N-character passphrase.

export function attachKeystrokeCapture(input, passphraseGetter, feedbackEl) {
  const state = reset();

  function reset() {
    return {
      target: passphraseGetter(),
      idx: 0,
      down: new Map(),    // char index -> performance.now()
      lastUp: null,
      vec: [],
    };
  }

  function paintFeedback() {
    if (!feedbackEl) return;
    feedbackEl.replaceChildren();
    const target = state.target;
    for (let i = 0; i < target.length; i++) {
      const span = document.createElement("span");
      const c = target[i] === " " ? "␣" : target[i];
      span.textContent = c;
      if (i < state.idx) span.classList.add("hit");
      feedbackEl.appendChild(span);
    }
  }

  function start() {
    Object.assign(state, reset());
    input.value = "";
    paintFeedback();
  }

  function onKeyDown(e) {
    if (e.key.length !== 1 && e.key !== " ") return;
    const expected = state.target[state.idx];
    if (e.key !== expected) return;
    if (state.lastUp != null) {
      const flight = performance.now() - state.lastUp;
      state.vec.push(flight);
    }
    state.down.set(state.idx, performance.now());
  }

  function onKeyUp(e) {
    const expected = state.target[state.idx];
    if (e.key !== expected) return;
    const downAt = state.down.get(state.idx);
    if (downAt == null) return;
    const dwell = performance.now() - downAt;
    state.vec.push(dwell);
    state.idx += 1;
    state.lastUp = performance.now();
    paintFeedback();
  }

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("keyup", onKeyUp);
  input.addEventListener("focus", start);

  return {
    start,
    isComplete: () => state.idx === state.target.length && state.vec.length === 2 * state.target.length - 1,
    snapshot: () => ({ passphrase: state.target, timing: state.vec.slice() }),
    expectedLen: () => 2 * state.target.length - 1,
    progress: () => state.idx / Math.max(state.target.length, 1),
  };
}

export function expectedTimingLen(passphrase) {
  return 2 * passphrase.length - 1;
}
