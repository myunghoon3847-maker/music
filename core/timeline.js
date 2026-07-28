"use strict";

(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function sanitizeTrackSettings(settings = {}, buffer, sourceTrimStartSec = 0) {
    const sourceStart = clamp(sourceTrimStartSec, 0, buffer?.duration || 0);
    const available = Math.max(0, (buffer?.duration || 0) - sourceStart);
    let trimStart = clamp(settings.trimStartSec || 0, 0, Math.max(0, available - 0.05));
    let trimEnd = clamp(settings.trimEndSec || 0, 0, Math.max(0, available - trimStart - 0.05));
    if (trimStart + trimEnd > Math.max(0, available - 0.05)) {
      trimEnd = Math.max(0, available - trimStart - 0.05);
    }
    return { ...settings, trimStartSec: trimStart, trimEndSec: trimEnd };
  }

  function getTrackWindow(def, settings = {}, buffer) {
    if (!def || !buffer) return null;
    const clean = sanitizeTrackSettings(settings, buffer, def.trimStartSec || 0);
    const sourceStartSec = clamp(def.trimStartSec || 0, 0, buffer.duration);
    const trimStartSec = clean.trimStartSec || 0;
    const trimEndSec = clean.trimEndSec || 0;
    const playableDuration = Math.max(0, buffer.duration - sourceStartSec - trimStartSec - trimEndSec);
    const rawStartSec = (Number(clean.offsetMs) || 0) / 1000 + trimStartSec;
    return {
      key: def.key,
      sourceStartSec,
      trimStartSec,
      trimEndSec,
      bufferOffsetSec: sourceStartSec + trimStartSec,
      playableDuration,
      rawStartSec,
      rawEndSec: rawStartSec + playableDuration
    };
  }

  function buildTimeline(defs = [], settings = {}, buffers = {}) {
    const windows = {};
    defs.forEach((def) => {
      const windowInfo = getTrackWindow(def, settings[def.key] || {}, buffers[def.key]);
      if (windowInfo) windows[def.key] = windowInfo;
    });
    const list = Object.values(windows);
    const minRawStart = Math.min(0, ...list.map((item) => item.rawStartSec));
    const shiftSec = -minRawStart;
    let duration = 0;
    list.forEach((item) => {
      item.startSec = item.rawStartSec + shiftSec;
      item.endSec = item.startSec + item.playableDuration;
      duration = Math.max(duration, item.endSec);
    });
    return { windows, shiftSec, duration };
  }

  function snapMs(value, step = 10) {
    const safeStep = Math.max(1, Number(step) || 10);
    return Math.round((Number(value) || 0) / safeStep) * safeStep;
  }

  window.HoonTimeline = { sanitizeTrackSettings, getTrackWindow, buildTimeline, snapMs };
})();
