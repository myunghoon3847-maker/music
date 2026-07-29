"use strict";

(() => {
  const callbacks = {};
  let source = "준비";
  let status = "대기 중";
  let active = false;
  let mode = "idle";

  const get = (id) => document.getElementById(id);

  function render() {
    const sourceEl = get("transportSource");
    const statusEl = get("transportStatus");
    const playButton = get("transportPlay");
    const transport = get("studioTransport");
    if (sourceEl) sourceEl.textContent = source;
    if (statusEl) statusEl.textContent = status;
    if (playButton) {
      playButton.textContent = active ? "⏸" : "▶";
      playButton.setAttribute("aria-label", active ? "일시정지" : "재생");
      playButton.title = `${active ? "일시정지" : "재생"} · Space`;
    }
    if (transport) {
      transport.dataset.mode = mode;
      transport.classList.toggle("is-active", active);
    }
  }

  function update(next = {}) {
    if (next.source !== undefined) source = next.source;
    if (next.status !== undefined) status = next.status;
    if (next.active !== undefined) active = Boolean(next.active);
    if (next.mode !== undefined) mode = next.mode || "idle";
    render();
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || "").toLowerCase();
    return ["input", "textarea", "select"].includes(tag) || target.isContentEditable;
  }

  function configure(nextCallbacks = {}) {
    Object.assign(callbacks, nextCallbacks);
  }

  function init() {
    get("transportPlay")?.addEventListener("click", () => callbacks.playPause?.());
    get("transportStop")?.addEventListener("click", () => callbacks.stop?.());
    get("transportRecord")?.addEventListener("click", () => callbacks.record?.());

    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Space") {
        event.preventDefault();
        callbacks.playPause?.();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        callbacks.record?.();
      } else if (event.key === "Escape") {
        callbacks.stop?.();
      }
    });
    render();
  }

  window.HoonTransport = { configure, init, update, render };
})();
