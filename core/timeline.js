"use strict";

(() => {
  const MIN_CLIP_SECONDS = 0.05;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function makeId(prefix = "clip") {
    return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function sanitizeClip(clip = {}, buffer, fallback = {}) {
    const duration = Math.max(0, Number(buffer?.duration) || 0);
    let sourceStartSec = clamp(clip.sourceStartSec ?? fallback.sourceStartSec ?? 0, 0, Math.max(0, duration - MIN_CLIP_SECONDS));
    let sourceEndSec = clamp(clip.sourceEndSec ?? fallback.sourceEndSec ?? duration, sourceStartSec + MIN_CLIP_SECONDS, duration);
    if (sourceEndSec - sourceStartSec < MIN_CLIP_SECONDS) {
      sourceEndSec = Math.min(duration, sourceStartSec + MIN_CLIP_SECONDS);
      sourceStartSec = Math.max(0, sourceEndSec - MIN_CLIP_SECONDS);
    }
    const clipDuration = Math.max(MIN_CLIP_SECONDS, sourceEndSec - sourceStartSec);
    return {
      id: String(clip.id || makeId()),
      sourceStartSec,
      sourceEndSec,
      timelineStartSec: Number.isFinite(Number(clip.timelineStartSec)) ? Number(clip.timelineStartSec) : Number(fallback.timelineStartSec || 0),
      volume: clamp(clip.volume ?? fallback.volume ?? 1, 0, 1.5),
      fadeIn: clamp(clip.fadeIn ?? fallback.fadeIn ?? 0, 0, Math.min(10, clipDuration / 2)),
      fadeOut: clamp(clip.fadeOut ?? fallback.fadeOut ?? 0, 0, Math.min(10, clipDuration / 2)),
      name: String(clip.name || fallback.name || "").slice(0, 60)
    };
  }

  function createLegacyClip(def, settings = {}, buffer) {
    if (!def || !buffer?.duration) return null;
    const encodedLead = clamp(def.trimStartSec || 0, 0, buffer.duration);
    const frontTrim = clamp(settings.trimStartSec || 0, 0, Math.max(0, buffer.duration - encodedLead - MIN_CLIP_SECONDS));
    const sourceStartSec = encodedLead + frontTrim;
    const backTrim = clamp(settings.trimEndSec || 0, 0, Math.max(0, buffer.duration - sourceStartSec - MIN_CLIP_SECONDS));
    const sourceEndSec = Math.max(sourceStartSec + MIN_CLIP_SECONDS, buffer.duration - backTrim);
    return sanitizeClip({
      id: makeId(def.key === "vocal" ? "vocal" : def.key === "mr" ? "mr" : "take"),
      sourceStartSec,
      sourceEndSec,
      timelineStartSec: frontTrim,
      volume: 1,
      fadeIn: settings.fadeIn || 0,
      fadeOut: settings.fadeOut || 0,
      name: def.name || ""
    }, buffer);
  }

  function sanitizeTrackClips(def, settings = {}, buffer) {
    if (!def || !buffer) return [];
    const saved = Array.isArray(settings.clips) ? settings.clips : [];
    const clips = saved
      .map((clip) => sanitizeClip(clip, buffer, { name: def.name }))
      .filter((clip) => clip.sourceEndSec - clip.sourceStartSec >= MIN_CLIP_SECONDS)
      .sort((a, b) => a.timelineStartSec - b.timelineStartSec || a.sourceStartSec - b.sourceStartSec);
    if (clips.length || Number(settings.clipModelVersion) >= 1) return clips;
    const legacy = createLegacyClip(def, settings, buffer);
    return legacy ? [legacy] : [];
  }

  function buildTimeline(defs = [], settings = {}, buffers = {}) {
    const clipsByTrack = {};
    const clipMap = {};
    const raw = [];

    defs.forEach((def) => {
      const buffer = buffers[def.key];
      if (!buffer) return;
      const trackSettings = settings[def.key] || {};
      const trackOffsetSec = (Number(trackSettings.offsetMs) || 0) / 1000;
      const clips = sanitizeTrackClips(def, trackSettings, buffer);
      clipsByTrack[def.key] = clips.map((clip) => {
        const duration = Math.max(MIN_CLIP_SECONDS, clip.sourceEndSec - clip.sourceStartSec);
        const rawStartSec = clip.timelineStartSec + trackOffsetSec;
        const item = {
          ...clip,
          key: def.key,
          trackKey: def.key,
          clipId: clip.id,
          rawStartSec,
          rawEndSec: rawStartSec + duration,
          duration
        };
        raw.push(item);
        return item;
      });
    });

    const minRawStart = Math.min(0, ...raw.map((item) => item.rawStartSec));
    const shiftSec = -minRawStart;
    let duration = 0;
    raw.forEach((item) => {
      item.startSec = item.rawStartSec + shiftSec;
      item.endSec = item.startSec + item.duration;
      duration = Math.max(duration, item.endSec);
      clipMap[item.clipId] = item;
    });

    const windows = {};
    Object.entries(clipsByTrack).forEach(([key, clips]) => {
      if (!clips.length) return;
      const startSec = Math.min(...clips.map((clip) => clip.startSec));
      const endSec = Math.max(...clips.map((clip) => clip.endSec));
      windows[key] = {
        key,
        startSec,
        endSec,
        playableDuration: Math.max(0, endSec - startSec),
        clips
      };
    });

    return { clipsByTrack, clipMap, windows, shiftSec, duration };
  }

  function getClip(settings = {}, clipId) {
    return (Array.isArray(settings.clips) ? settings.clips : []).find((clip) => String(clip.id) === String(clipId)) || null;
  }

  function replaceClip(settings = {}, clipId, nextClip) {
    const clips = Array.isArray(settings.clips) ? settings.clips : [];
    return {
      ...settings,
      clips: clips.map((clip) => String(clip.id) === String(clipId) ? { ...clip, ...nextClip, id: clip.id } : clip)
    };
  }

  function splitClip(clip, splitSourceSec) {
    const point = Number(splitSourceSec);
    if (!clip || !Number.isFinite(point)) return null;
    const leftDuration = point - clip.sourceStartSec;
    const rightDuration = clip.sourceEndSec - point;
    if (leftDuration < MIN_CLIP_SECONDS || rightDuration < MIN_CLIP_SECONDS) return null;
    const microFade = 0.008;
    const left = {
      ...clip,
      sourceEndSec: point,
      fadeOut: Math.max(microFade, Math.min(Number(clip.fadeOut) || 0, leftDuration / 2))
    };
    const right = {
      ...clip,
      id: makeId("clip"),
      sourceStartSec: point,
      timelineStartSec: Number(clip.timelineStartSec || 0) + leftDuration,
      fadeIn: Math.max(microFade, Math.min(Number(clip.fadeIn) || 0, rightDuration / 2))
    };
    left.fadeIn = Math.min(Number(left.fadeIn) || 0, leftDuration / 2);
    right.fadeOut = Math.min(Number(right.fadeOut) || 0, rightDuration / 2);
    return [left, right];
  }

  function snapMs(value, step = 10) {
    const safeStep = Math.max(1, Number(step) || 10);
    return Math.round((Number(value) || 0) / safeStep) * safeStep;
  }

  window.HoonTimeline = {
    MIN_CLIP_SECONDS,
    makeId,
    sanitizeClip,
    sanitizeTrackClips,
    createLegacyClip,
    buildTimeline,
    getClip,
    replaceClip,
    splitClip,
    snapMs
  };
})();
