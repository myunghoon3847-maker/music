"use strict";

(() => {
  const cache = new WeakMap();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function cacheFor(buffer) {
    let map = cache.get(buffer);
    if (!map) { map = new Map(); cache.set(buffer, map); }
    return map;
  }

  function createPeaks(buffer, startSec = 0, durationSec = buffer?.duration || 0, bins = 600) {
    if (!buffer || !buffer.length) return new Float32Array(0);
    const safeBins = Math.max(24, Math.min(1600, Math.round(bins)));
    const startFrame = Math.floor(clamp(startSec, 0, buffer.duration) * buffer.sampleRate);
    const durationFrames = Math.max(1, Math.floor(clamp(durationSec, 0, buffer.duration - startSec) * buffer.sampleRate));
    const endFrame = Math.min(buffer.length, startFrame + durationFrames);
    const key = `${startFrame}:${endFrame}:${safeBins}`;
    const map = cacheFor(buffer);
    if (map.has(key)) return map.get(key);
    const peaks = new Float32Array(safeBins);
    const span = Math.max(1, endFrame - startFrame);
    for (let bin = 0; bin < safeBins; bin += 1) {
      const from = startFrame + Math.floor((bin / safeBins) * span);
      const to = Math.min(endFrame, startFrame + Math.floor(((bin + 1) / safeBins) * span));
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        const stride = Math.max(1, Math.floor((to - from) / 48));
        for (let index = from; index < to; index += stride) peak = Math.max(peak, Math.abs(data[index] || 0));
      }
      peaks[bin] = peak;
    }
    map.set(key, peaks);
    return peaks;
  }

  function draw(canvas, peaks, options = {}) {
    if (!canvas || !peaks?.length) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    const color = options.color || getComputedStyle(canvas).color || "#fff";
    context.fillStyle = color;
    context.globalAlpha = options.alpha ?? 0.8;
    const center = height / 2;
    const barWidth = width / peaks.length;
    for (let index = 0; index < peaks.length; index += 1) {
      const amplitude = Math.max(1, peaks[index] * height * 0.84);
      context.fillRect(index * barWidth, center - amplitude / 2, Math.max(1, barWidth * 0.72), amplitude);
    }
    context.globalAlpha = 1;
  }

  function clear(buffer) {
    if (buffer) cache.delete(buffer);
  }

  window.HoonWaveform = { createPeaks, draw, clear };
})();
