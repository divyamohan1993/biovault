// Pitch deck navigation. Arrow keys, click, swipe. URL hash carries slide #.
(function () {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const total = slides.length;
  const bar = document.getElementById("bar");
  const counter = document.getElementById("counter");
  const deck = document.getElementById("deck");
  let i = clampIndex(parseInt(location.hash.slice(1), 10) - 1) || 0;

  function clampIndex(n) {
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(total - 1, n));
  }

  function render() {
    slides.forEach((s, k) => {
      s.classList.toggle("active", k === i);
      s.classList.toggle("prev", k < i);
    });
    bar.style.width = `${((i + 1) / total) * 100}%`;
    counter.textContent = `${i + 1} / ${total}`;
    history.replaceState(null, "", `#${i + 1}`);
  }

  function go(delta) { i = clampIndex(i + delta); render(); }
  function jump(n) { i = clampIndex(n); render(); }

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " && !e.shiftKey) { go(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) { go(-1); e.preventDefault(); }
    else if (e.key === "Home") { jump(0); e.preventDefault(); }
    else if (e.key === "End") { jump(total - 1); e.preventDefault(); }
    else if (e.key === "f" || e.key === "F") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } else if (/^[0-9]$/.test(e.key)) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= total) jump(n - 1);
    }
  });

  // click forward / shift-click back
  deck.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return;
    if (e.shiftKey) go(-1); else go(1);
  });

  // touch swipe
  let tx = 0;
  deck.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
  deck.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener("hashchange", () => {
    i = clampIndex(parseInt(location.hash.slice(1), 10) - 1) || 0;
    render();
  });

  deck.focus();
  render();
})();
