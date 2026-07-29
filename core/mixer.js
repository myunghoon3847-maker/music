"use strict";

(() => {
  const BASE_KEYS = ["mr", "vocal"];
  const DEFAULT_TRACK = { volume: 1, pan: 0, offsetMs: 0, muted: false, solo: false, fadeIn: 0, fadeOut: 0, trimStartSec: 0, trimEndSec: 0, clipModelVersion: 0, clips: [] };
  const DEFAULT_SETTINGS = { mr: { ...DEFAULT_TRACK, volume: 0.8 }, vocal: { ...DEFAULT_TRACK }, masterVolume: 0.9 };
  const OVERDUB_MAX_TRACKS = 6;

  const state = {
    callbacks: {}, recording: null, selectedId: "", trackDefs: [], buffers: {}, originalBuffer: null,
    sources: {}, nodes: { master: null, limiter: null, original: null, trackNodes: {} }, settings: clone(DEFAULT_SETTINGS),
    context: null, loadingToken: 0, playing: false, compareOriginal: false, startAt: 0, startPosition: 0,
    position: 0, duration: 0, mixDuration: 0, frameId: null, endTimer: null, saveTimer: null,
    saveRevision: 0, savedRevision: 0, savePending: null, saveInFlight: false, savePromise: null, saveFailures: new Map(),
    restartTimer: null, seeking: false, initialized: false, exportUrl: "", exportBlob: null, exporting: false, addingTrack: false,
    timeline: { zoom: 1, snapMs: 10, selectedTrackKey: "", selectedClipId: "", drag: null, loopEnabled: false, loopStartSec: 0, loopEndSec: 0, lastAutoScrollAt: 0, resize: null },
    history: window.HoonEditHistory?.create?.(60) || null, historyCoalesce: { key: "", at: 0 },
    overdub: {
      active: false, recorder: null, stream: null, chunks: [], source: null, gate: null, destination: null,
      analyser: null, levelData: null, levelFrame: null, startAt: 0, recorderStartAt: 0, timerId: null,
      autoStopTimer: null, countInNodes: [], stopping: false, targetTrackId: "", recordStartSec: 0,
      recordEndSec: 0, monitorStartSec: 0, timelineRawStartSec: 0, mode: "manual", overlapMode: "keep"
    }
  };

  const $ = (id) => document.getElementById(id);
  const findDataElement = (attribute, value, root = document) => [...root.querySelectorAll(`[${attribute}]`)].find((element) => element.getAttribute(attribute) === String(value)) || null;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function clone(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function safeName(value) {
    return String(value || "훈뮤직툴 믹스").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "훈뮤직툴 믹스";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function getRecordings() { return state.callbacks.getRecordings?.() || []; }
  function getTrackKey(extra) { return `extra:${extra.id}`; }
  function getTrackDef(key) { return state.trackDefs.find((track) => track.key === key); }
  function getTrackKeys() { return state.trackDefs.map((track) => track.key); }

  function buildTrackDefs(recording) {
    if (!recording) return [];
    const defs = [];
    if (recording.mrBlob instanceof Blob) defs.push({ key: "mr", kind: "mr", name: "MR 트랙", blob: recording.mrBlob, trimStartSec: 0, base: true });
    if (recording.vocalBlob instanceof Blob) defs.push({ key: "vocal", kind: "vocal", name: "보컬 트랙", blob: recording.vocalBlob, trimStartSec: 0, base: true });
    (Array.isArray(recording.extraTracks) ? recording.extraTracks : []).forEach((track, index) => {
      if (!track?.id) return;
      const blob = track.blob instanceof Blob ? track.blob : null;
      defs.push({
        key: getTrackKey(track), kind: "extra", name: String(track.name || `추가 트랙 ${index + 1}`).slice(0, 40),
        blob, empty: !blob, trimStartSec: Math.max(0, Number(track.trimStartMs || 0) / 1000),
        recordedDurationSec: Math.max(0, Number(track.durationMs || 0) / 1000), base: false, data: track
      });
    });
    return defs;
  }

  function initialBaseOffset(recording, key) {
    const sync = Number(recording?.syncOffsetMs) || 0;
    if (key === "mr") return sync > 0 ? sync : 0;
    if (key === "vocal") return sync < 0 ? Math.abs(sync) : 0;
    return 0;
  }

  function defaultTrackSettings(def, recording) {
    return {
      ...DEFAULT_TRACK,
      volume: def.key === "mr" ? 0.8 : 1,
      offsetMs: def.base ? initialBaseOffset(recording, def.key) : Number(def.data?.offsetMs) || 0
    };
  }

  function normalizeSettings(recording, defs = state.trackDefs) {
    const saved = recording?.mixSettings || {};
    const result = { masterVolume: clamp(saved.masterVolume ?? DEFAULT_SETTINGS.masterVolume, 0, 1.5) };
    defs.forEach((def) => {
      const fallback = defaultTrackSettings(def, recording);
      const savedTrack = saved[def.key] || {};
      result[def.key] = { ...fallback, ...savedTrack, clips: Array.isArray(savedTrack.clips) ? clone(savedTrack.clips) : [] };
      result[def.key].volume = clamp(result[def.key].volume, 0, 1.5);
      result[def.key].pan = clamp(result[def.key].pan, -1, 1);
      result[def.key].offsetMs = clamp(Math.round(Number(result[def.key].offsetMs || 0) / 10) * 10, -1000, 1000);
      result[def.key].fadeIn = clamp(result[def.key].fadeIn, 0, 10);
      result[def.key].fadeOut = clamp(result[def.key].fadeOut, 0, 10);
      result[def.key].trimStartSec = clamp(result[def.key].trimStartSec, 0, 3600);
      result[def.key].trimEndSec = clamp(result[def.key].trimEndSec, 0, 3600);
    });
    return result;
  }

  function ensureContext() {
    const context = state.callbacks.getAudioContext?.();
    if (!context) throw new Error("오디오 엔진을 시작하지 못했습니다.");
    state.context = context;
    if (context.state === "suspended") context.resume();
    return context;
  }

  function setStatus(message, mode = "idle") {
    const element = $("mixerStatus");
    if (element) element.textContent = message;
    const badge = $("mixerStatusBadge");
    if (badge) {
      badge.textContent = mode === "loading" ? "불러오는 중" : mode === "playing" ? "재생 중" : mode === "recording" ? "녹음 중" : mode === "error" ? "오류" : "준비";
      badge.dataset.mode = mode;
    }
    state.callbacks.onStatus?.(message, mode);
  }

  function updateMediaSession(mode = "none") {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = mode === "playing" ? "playing" : mode === "paused" ? "paused" : "none";
      if (state.recording && typeof window.MediaMetadata === "function") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: state.recording.name || "훈뮤직툴 믹서",
          artist: "훈뮤직툴",
          album: mode === "recording" ? "멀티트랙 녹음" : "멀티트랙 믹서"
        });
      }
    } catch {}
  }

  function bindMediaSession() {
    if (!("mediaSession" in navigator) || state.mediaSessionBound) return;
    state.mediaSessionBound = true;
    const handlers = {
      play: () => { if (!state.overdub.active) play(state.position); },
      pause: () => { if (!state.overdub.active) pause(); },
      stop: () => { if (state.overdub.active) finishOverdub(); else stop(); },
      seekbackward: (details) => setPosition(currentPosition() - (Number(details?.seekOffset) || 10), { restart: state.playing }),
      seekforward: (details) => setPosition(currentPosition() + (Number(details?.seekOffset) || 10), { restart: state.playing }),
      seekto: (details) => setPosition(Number(details?.seekTime) || 0, { restart: state.playing })
    };
    Object.entries(handlers).forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} });
  }

  function currentRecordingId() { return state.recording ? String(state.recording.id) : ""; }

  function getCurrentSaveFailure() {
    const id = currentRecordingId();
    return id ? state.saveFailures.get(id) || null : null;
  }

  function hasUnsavedMixerWork() {
    return Boolean(state.saveTimer || state.savePending || state.saveInFlight || state.saveFailures.size);
  }

  function setSaveState(mode, text) {
    const element = $("mixerSaveState");
    if (element) {
      element.dataset.state = mode;
      element.textContent = text || (mode === "dirty" ? "변경됨" : mode === "saving" ? "저장 중" : mode === "error" ? "저장 오류" : "저장됨");
    }
    const retry = $("mixerSaveRetry");
    if (retry) {
      retry.hidden = mode !== "error" || !getCurrentSaveFailure();
      retry.disabled = state.saveInFlight;
    }
  }

  function clearPlaybackTimers() {
    if (state.frameId) cancelAnimationFrame(state.frameId);
    if (state.endTimer) clearTimeout(state.endTimer);
    state.frameId = null;
    state.endTimer = null;
  }

  function disconnectSource(key) {
    const source = state.sources[key];
    if (!source) return;
    try { source.onended = null; source.stop(); } catch {}
    try { source.disconnect(); } catch {}
    delete state.sources[key];
  }

  function disconnectNodes() {
    Object.values(state.nodes.trackNodes || {}).flat().forEach((nodes) => {
      Object.values(nodes || {}).forEach((node) => { try { node?.disconnect?.(); } catch {} });
    });
    [state.nodes.original, state.nodes.master, state.nodes.limiter].forEach((node) => { try { node?.disconnect?.(); } catch {} });
    state.nodes = { master: null, limiter: null, original: null, trackNodes: {} };
  }

  function timelineModel() {
    return window.HoonTimeline?.buildTimeline?.(state.trackDefs, state.settings, state.buffers) || { clipsByTrack: {}, clipMap: {}, windows: {}, shiftSec: 0, duration: 0 };
  }

  function getClipRef(trackKey, clipId) {
    return window.HoonTimeline?.getClip?.(state.settings[trackKey] || {}, clipId) || null;
  }

  function getSelectedClip() {
    const trackKey = state.timeline.selectedTrackKey;
    const clip = getClipRef(trackKey, state.timeline.selectedClipId);
    return clip ? { trackKey, clip, def: getTrackDef(trackKey), buffer: state.buffers[trackKey] } : null;
  }

  function ensureAllTrackClips() {
    state.trackDefs.forEach((def) => {
      const buffer = state.buffers[def.key];
      const settings = state.settings[def.key];
      if (!buffer || !settings) return;
      const initialized = Number(settings.clipModelVersion) >= 1;
      settings.clips = window.HoonTimeline?.sanitizeTrackClips?.(def, settings, buffer) || [];
      if (!initialized) {
        const recordedStart = Number(def.data?.timelineStartSec);
        if (settings.clips[0] && Number.isFinite(recordedStart)) settings.clips[0].timelineStartSec = recordedStart;
        if (settings.clips[0] && Number(def.recordedDurationSec) > 0) {
          settings.clips[0].sourceEndSec = Math.min(buffer.duration, settings.clips[0].sourceStartSec + Number(def.recordedDurationSec));
        }
        settings.clipModelVersion = 1;
        settings.trimStartSec = 0;
        settings.trimEndSec = 0;
        settings.fadeIn = 0;
        settings.fadeOut = 0;
      }
    });
  }

  function sanitizeAllTrackEdits() {
    ensureAllTrackClips();
  }

  function calculateDuration() {
    sanitizeAllTrackEdits();
    const model = timelineModel();
    state.mixDuration = model.duration;
    state.duration = Math.max(state.mixDuration, state.originalBuffer?.duration || 0);
    state.position = clamp(state.position, 0, state.duration);
    if (state.timeline.loopEndSec <= state.timeline.loopStartSec || state.timeline.loopEndSec > state.duration) {
      state.timeline.loopStartSec = clamp(state.timeline.loopStartSec, 0, Math.max(0, state.duration - 0.1));
      state.timeline.loopEndSec = state.duration;
    }
    const seek = $("mixerSeek");
    if (seek) seek.max = String(Math.max(0.01, state.duration));
    updateTimeline();
    updateTimeUi();
  }

  function currentPosition() {
    if (!state.playing || !state.context) return clamp(state.position, 0, state.duration);
    return clamp(state.startPosition + Math.max(0, state.context.currentTime - state.startAt), 0, state.duration);
  }

  function setPosition(position, { restart = false } = {}) {
    const next = clamp(position, 0, state.duration);
    const wasPlaying = state.playing;
    state.position = next;
    updateTimeUi();
    if (restart && wasPlaying && !state.overdub.active) play(next);
  }

  function autoScrollTimeline(position) {
    if (!state.playing || state.timeline.zoom <= 1) return;
    const now = performance.now();
    if (now - state.timeline.lastAutoScrollAt < 120) return;
    state.timeline.lastAutoScrollAt = now;
    const viewport = $("mixerTimelineViewport");
    const content = $("mixerTimelineContent");
    if (!viewport || !content || !state.duration) return;
    const x = (position / state.duration) * content.scrollWidth;
    const minVisible = viewport.scrollLeft + viewport.clientWidth * 0.18;
    const maxVisible = viewport.scrollLeft + viewport.clientWidth * 0.82;
    if (x < minVisible || x > maxVisible) viewport.scrollLeft = Math.max(0, x - viewport.clientWidth * 0.35);
  }

  function updateLoopUi() {
    const region = $("mixerLoopRegion");
    const valid = state.timeline.loopEnabled && state.duration > 0 && state.timeline.loopEndSec > state.timeline.loopStartSec;
    if (region) {
      region.hidden = !valid;
      if (valid) {
        region.style.setProperty("--loop-start", String(state.timeline.loopStartSec / state.duration));
        region.style.setProperty("--loop-size", String((state.timeline.loopEndSec - state.timeline.loopStartSec) / state.duration));
      }
    }
    if ($("mixerLoopToggle")) {
      $("mixerLoopToggle").classList.toggle("is-active", valid);
      $("mixerLoopToggle").textContent = valid ? "반복 켜짐" : "구간 반복";
    }
    if ($("mixerLoopInfo")) {
      $("mixerLoopInfo").textContent = valid ? `${formatTime(state.timeline.loopStartSec)} – ${formatTime(state.timeline.loopEndSec)}` : "반복 구간 없음";
    }
  }

  function updateTimeUi() {
    const position = currentPosition();
    const seek = $("mixerSeek");
    if (seek && !state.seeking) seek.value = String(position);
    if ($("mixerCurrentTime")) $("mixerCurrentTime").textContent = formatTime(position);
    if ($("mixerDuration")) $("mixerDuration").textContent = formatTime(state.duration);
    const timeline = $("mixerTimelineContent");
    if (timeline) timeline.style.setProperty("--mixer-progress", String(state.duration ? position / state.duration : 0));
    if ($("mixerPlayheadTime")) $("mixerPlayheadTime").textContent = formatTime(position);
    autoScrollTimeline(position);
  }

  function animationLoop() {
    updateTimeUi();
    if (state.playing) state.frameId = requestAnimationFrame(animationLoop);
  }

  function drawClipWaveform(element, def, clipWindow) {
    const canvas = element?.querySelector("canvas");
    const buffer = state.buffers[def.key];
    if (!canvas || !buffer || !window.HoonWaveform || !clipWindow) return;
    window.requestAnimationFrame(() => {
      const bins = Math.max(50, Math.round((canvas.clientWidth || 180) * 1.25));
      const peaks = window.HoonWaveform.createPeaks(buffer, clipWindow.sourceStartSec, clipWindow.duration, bins);
      window.HoonWaveform.draw(canvas, peaks, { alpha: 0.84 });
    });
  }

  function clipElementHtml(def, clipWindow, index) {
    const selected = state.timeline.selectedClipId === clipWindow.clipId;
    const muted = Boolean(clipWindow.muted);
    const label = clipWindow.name || `${def.name} ${index + 1}`;
    return `<span class="mixer-clip is-${def.kind} ${selected ? "is-selected" : ""} ${muted ? "is-muted" : ""}" data-track-clip="${escapeHtml(def.key)}" data-clip-id="${escapeHtml(clipWindow.clipId)}" tabindex="0"><canvas aria-hidden="true"></canvas><em>${escapeHtml(label)}</em><small>${formatTime(clipWindow.duration)}</small><button class="mixer-clip-mute" data-clip-action="mute" type="button" aria-label="${muted ? "클립 음소거 해제" : "클립 음소거"}" title="${muted ? "클립 음소거 해제" : "클립 음소거"}">${muted ? "🔇" : "M"}</button><i class="mixer-trim-handle is-start" data-trim-edge="start"></i><i class="mixer-trim-handle is-end" data-trim-edge="end"></i></span>`;
  }

  function timelineHeaderHtml(def) {
    const key = escapeHtml(def.key);
    const isExtra = !def.base;
    const shortName = def.key === "mr" ? "MR" : def.key === "vocal" ? "VOCAL" : escapeHtml(def.name);
    return `<div class="mixer-lane" data-track-row="${key}">
      <div class="mixer-lane-header" data-track-header="${key}" data-track-select="${key}">
        <button class="mixer-lane-name" data-timeline-action="select" data-track-key="${key}" type="button" title="${escapeHtml(def.name)} 선택">${shortName}</button>
        <div class="mixer-lane-actions">
          <button data-timeline-action="mute" data-track-key="${key}" type="button" aria-label="${escapeHtml(def.name)} 음소거" title="음소거">M</button>
          <button data-timeline-action="solo" data-track-key="${key}" type="button" aria-label="${escapeHtml(def.name)} 솔로" title="솔로">S</button>
          <button data-timeline-action="preview" data-track-key="${key}" type="button" aria-label="${escapeHtml(def.name)}만 재생" title="이 트랙만 듣기">▶</button>
          ${isExtra ? `<button data-timeline-action="record" data-track-key="${key}" type="button" aria-label="${escapeHtml(def.name)} 녹음 대상으로 선택" title="녹음 대상">●</button>` : ""}
        </div>
        <input class="mixer-lane-volume" data-timeline-volume="${key}" type="range" min="0" max="150" step="1" value="100" aria-label="${escapeHtml(def.name)} 음량" />
      </div>
      <div class="mixer-lane-track" data-lane="${key}"></div>
    </div>`;
  }

  function renderTimelineStructure() {
    const rows = $("mixerTimelineRows");
    if (!rows) return;
    rows.innerHTML = state.trackDefs.map(timelineHeaderHtml).join("");
  }

  function renderTimelineTrackControls(def) {
    const header = findDataElement("data-track-header", def.key);
    if (!header) return;
    const settings = state.settings[def.key] || defaultTrackSettings(def, state.recording);
    const available = Boolean(state.buffers[def.key]);
    const mutedBySolo = anySolo() && !settings.solo;
    header.classList.toggle("is-selected", state.timeline.selectedTrackKey === def.key);
    header.classList.toggle("is-muted", settings.muted || mutedBySolo);
    header.classList.toggle("is-solo", settings.solo);
    header.classList.toggle("is-empty", !available);
    const volume = header.querySelector("[data-timeline-volume]");
    if (volume) { volume.value = String(Math.round((settings.volume ?? 1) * 100)); volume.disabled = !available || state.overdub.active || state.exporting; }
    ["mute", "solo", "preview"].forEach((action) => {
      const button = header.querySelector(`[data-timeline-action="${action}"]`);
      if (!button) return;
      button.disabled = !available || state.overdub.active || state.exporting;
      button.classList.toggle("is-active", action === "mute" ? settings.muted : action === "solo" ? settings.solo : false);
    });
    const record = header.querySelector('[data-timeline-action="record"]');
    if (record) {
      record.disabled = state.overdub.active || state.exporting;
      record.classList.toggle("is-active", state.timeline.selectedTrackKey === def.key);
    }
  }

  function renderLaneClips(def, model) {
    const lane = findDataElement("data-lane", def.key);
    if (!lane) return;
    const clips = model.clipsByTrack[def.key] || [];
    lane.innerHTML = clips.map((clip, index) => clipElementHtml(def, clip, index)).join("");
    [...lane.querySelectorAll("[data-clip-id]")].forEach((element) => {
      const clipWindow = model.clipMap[element.dataset.clipId];
      if (!clipWindow || !state.duration) return;
      element.style.left = `${(clipWindow.startSec / state.duration) * 100}%`;
      element.style.width = `${Math.max(0.35, (clipWindow.duration / state.duration) * 100)}%`;
      element.title = `${def.name} · ${formatTime(clipWindow.duration)} · 시작 ${formatTime(clipWindow.startSec)}${clipWindow.muted ? " · 음소거" : ""}`;
      drawClipWaveform(element, def, clipWindow);
    });
  }

  function updateRuler() {
    if ($("mixerRulerStart")) $("mixerRulerStart").textContent = "0:00";
    if ($("mixerRulerMiddle")) $("mixerRulerMiddle").textContent = formatTime(state.duration / 2);
    if ($("mixerRulerEnd")) $("mixerRulerEnd").textContent = formatTime(state.duration);
    const content = $("mixerTimelineContent");
    if (content) {
      content.style.width = `${Math.max(75, state.timeline.zoom * 100)}%`;
      content.style.setProperty("--timeline-zoom", String(state.timeline.zoom));
    }
  }

  function updateTimeline() {
    applyTimelineScale();
    const model = timelineModel();
    state.trackDefs.forEach((def) => { renderLaneClips(def, model); renderTimelineTrackControls(def); });
    updateRuler();
    updateLoopUi();
    bindTimelineClips();
    updateSelectedClipInspector();
  }

  function anySolo() { return getTrackKeys().some((key) => Boolean(state.settings[key]?.solo)); }
  function effectiveGain(key) {
    const settings = state.settings[key] || DEFAULT_TRACK;
    return settings.muted || (anySolo() && !settings.solo) ? 0 : clamp(settings.volume, 0, 1.5);
  }

  function updateLiveNodes() {
    const now = state.context?.currentTime || 0;
    getTrackKeys().forEach((key) => {
      (state.nodes.trackNodes?.[key] || []).forEach((nodes) => {
        nodes.controlGain.gain.setTargetAtTime(effectiveGain(key), now, 0.015);
        if (nodes.panner?.pan) nodes.panner.pan.setTargetAtTime(clamp(state.settings[key]?.pan || 0, -1, 1), now, 0.015);
      });
    });
    state.nodes.master?.gain?.setTargetAtTime(clamp(state.settings.masterVolume, 0, 1.5), now, 0.015);
  }

  function applyClipFadeEnvelope(clipWindow, nodes, when, contentOffset, playableDuration) {
    const total = clipWindow.duration;
    const fadeIn = clamp(clipWindow.fadeIn || 0, 0, Math.min(10, total / 2));
    const fadeOut = clamp(clipWindow.fadeOut || 0, 0, Math.min(10, total / 2));
    const param = nodes.fadeGain.gain;
    const fadeOutStart = total - fadeOut;
    let initial = 1;
    if (fadeIn > 0 && contentOffset < fadeIn) initial = contentOffset / fadeIn;
    if (fadeOut > 0 && contentOffset >= fadeOutStart) initial = Math.min(initial, (total - contentOffset) / fadeOut);
    param.cancelScheduledValues(when);
    param.setValueAtTime(clamp(initial, 0, 1), when);

    if (fadeIn > 0 && contentOffset < fadeIn) {
      const fadeInRemaining = Math.min(playableDuration, fadeIn - contentOffset);
      if (fadeInRemaining > 0) param.linearRampToValueAtTime(1, when + fadeInRemaining);
    }

    if (fadeOut > 0) {
      const fadeStartAfter = fadeOutStart - contentOffset;
      if (fadeStartAfter <= 0) {
        param.linearRampToValueAtTime(0, when + playableDuration);
      } else if (fadeStartAfter < playableDuration) {
        param.setValueAtTime(1, when + fadeStartAfter);
        param.linearRampToValueAtTime(0, when + playableDuration);
      }
    }
  }

  function createClipNodes(trackKey, clipWindow) {
    const context = state.context;
    const fadeGain = context.createGain();
    const clipGain = context.createGain();
    const controlGain = context.createGain();
    const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : context.createGain();
    fadeGain.connect(clipGain); clipGain.connect(controlGain); controlGain.connect(panner); panner.connect(state.nodes.master);
    clipGain.gain.value = clamp(clipWindow.volume ?? 1, 0, 1.5);
    controlGain.gain.value = effectiveGain(trackKey);
    if (panner.pan) panner.pan.value = clamp(state.settings[trackKey]?.pan || 0, -1, 1);
    const nodes = { fadeGain, clipGain, controlGain, panner };
    state.nodes.trackNodes[trackKey] ||= [];
    state.nodes.trackNodes[trackKey].push(nodes);
    return nodes;
  }

  function scheduleClip(def, clipWindow, timelinePosition, startAt) {
    const buffer = state.buffers[def.key];
    if (!buffer || !clipWindow?.duration || clipWindow.muted) return false;
    let sourceWhen = startAt;
    let contentOffset = timelinePosition - clipWindow.startSec;
    if (contentOffset < 0) { sourceWhen += -contentOffset; contentOffset = 0; }
    if (contentOffset >= clipWindow.duration) return false;
    const bufferOffset = clipWindow.sourceStartSec + contentOffset;
    const playableDuration = Math.max(0, clipWindow.duration - contentOffset);
    const source = state.context.createBufferSource();
    source.buffer = buffer;
    const nodes = createClipNodes(def.key, clipWindow);
    source.connect(nodes.fadeGain);
    applyClipFadeEnvelope(clipWindow, nodes, sourceWhen, contentOffset, playableDuration);
    source.start(sourceWhen, bufferOffset, playableDuration);
    const sourceKey = `${def.key}:${clipWindow.clipId}`;
    state.sources[sourceKey] = source;
    return true;
  }

  function createMasterChain() {
    const context = state.context;
    state.nodes.trackNodes = {};
    state.nodes.master = context.createGain();
    state.nodes.master.gain.value = clamp(state.settings.masterVolume, 0, 1.5);
    if (typeof context.createDynamicsCompressor === "function") {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
      state.nodes.master.connect(limiter); limiter.connect(context.destination); state.nodes.limiter = limiter;
    } else state.nodes.master.connect(context.destination);
  }

  function loopIsValid() {
    return Boolean(state.timeline.loopEnabled && state.timeline.loopEndSec - state.timeline.loopStartSec >= 0.1 && state.timeline.loopEndSec <= state.duration + 0.01);
  }

  function startPlaybackAt(timelinePosition, startAt, options = {}) {
    const context = ensureContext();
    const loopActive = loopIsValid() && !options.overdub;
    let requested = clamp(timelinePosition, 0, state.duration);
    if (loopActive && (requested < state.timeline.loopStartSec || requested >= state.timeline.loopEndSec)) requested = state.timeline.loopStartSec;
    state.position = requested >= state.duration - 0.02 ? (loopActive ? state.timeline.loopStartSec : 0) : requested;
    createMasterChain();
    let scheduled = false;
    if (state.compareOriginal && state.originalBuffer) {
      if (state.position < state.originalBuffer.duration) {
        const source = context.createBufferSource();
        source.buffer = state.originalBuffer;
        source.connect(state.nodes.master);
        source.start(startAt, state.position, state.originalBuffer.duration - state.position);
        state.sources.original = source;
        scheduled = true;
      }
    } else {
      const model = timelineModel();
      state.trackDefs.forEach((def) => {
        if (options.excludeTrackKey && def.key === options.excludeTrackKey) return;
        (model.clipsByTrack[def.key] || []).forEach((clipWindow) => {
          if (scheduleClip(def, clipWindow, state.position, startAt)) scheduled = true;
        });
      });
    }
    if (!scheduled && options.overdub) scheduled = true;
    if (!scheduled) { disconnectNodes(); state.position = loopActive ? state.timeline.loopStartSec : 0; updateTimeUi(); return false; }
    state.startAt = startAt; state.startPosition = state.position; state.playing = true;
    updateButtons(); clearPlaybackTimers(); animationLoop();
    const naturalEnd = state.compareOriginal ? state.originalBuffer?.duration || state.duration : state.mixDuration;
    const requestedStop = Number(options.stopAtSec);
    const boundedEnd = Number.isFinite(requestedStop) ? clamp(requestedStop, state.position + 0.05, naturalEnd) : naturalEnd;
    const playbackEnd = loopActive ? Math.min(state.timeline.loopEndSec, boundedEnd) : boundedEnd;
    const remainingMs = Math.max(10, (playbackEnd - state.position) * 1000 + (loopActive ? 0 : 80));
    state.endTimer = window.setTimeout(() => {
      if (!state.playing) return;
      if (options.overdub && state.overdub.active) { finishOverdub(); return; }
      if (loopActive) {
        stop({ preservePosition: false, silent: true, keepOverdub: true });
        state.position = state.timeline.loopStartSec;
        const nextContext = ensureContext();
        if (!startPlaybackAt(state.timeline.loopStartSec, nextContext.currentTime + 0.008)) {
          setStatus("반복 구간에 재생할 클립이 없습니다.", "error");
          state.callbacks.transportUpdate?.(state.recording?.name || "믹서", "반복 재생 정지", false, "idle");
        }
        return;
      }
      state.position = Math.min(state.duration, naturalEnd);
      stop({ preservePosition: true, silent: true, keepOverdub: true });
      setStatus("재생이 끝났습니다.", "idle");
      state.callbacks.transportUpdate?.(state.recording?.name || "믹서", "재생 완료", false, "idle");
    }, remainingMs);
    return true;
  }

  async function play(fromPosition = state.position) {
    if (!state.recording || !state.trackDefs.some((def) => state.buffers[def.key])) { setStatus("먼저 트랙이 있는 녹음을 선택해 주세요.", "error"); return; }
    if (state.overdub.active) return;
    state.callbacks.stopOtherAudio?.();
    stop({ preservePosition: true, silent: true, keepOverdub: true });
    const context = ensureContext();
    if (!startPlaybackAt(fromPosition, context.currentTime + 0.06)) return;
    const label = state.compareOriginal ? "원본 믹스" : "현재 믹스";
    setStatus(`${label}를 재생합니다.`, "playing");
    updateMediaSession("playing");
    state.callbacks.transportUpdate?.(state.recording.name || "믹서", `${label} 재생 중`, true, "playing");
  }

  function pause() {
    if (!state.playing || state.overdub.active) return;
    state.position = currentPosition();
    stop({ preservePosition: true, silent: true, keepOverdub: true });
    setStatus("일시정지했습니다.", "idle");
    updateMediaSession("paused");
    state.callbacks.transportUpdate?.(state.recording?.name || "믹서", "일시정지", false, "idle");
  }

  function stop(options = {}) {
    if (state.overdub.active && !options.keepOverdub) { finishOverdub(); return; }
    clearTimeout(state.restartTimer); state.restartTimer = null;
    const preservePosition = Boolean(options.preservePosition);
    if (state.playing && preservePosition) state.position = currentPosition();
    state.playing = false; clearPlaybackTimers(); Object.keys(state.sources).forEach(disconnectSource); disconnectNodes();
    if (!preservePosition) state.position = 0;
    updateButtons(); updateTimeUi();
    if (!state.overdub.active) updateMediaSession(preservePosition && state.position > 0 ? "paused" : "none");
    if (!options.silent) {
      setStatus("재생을 정지했습니다.", "idle");
      state.callbacks.transportUpdate?.(state.recording?.name || "믹서", "정지", false, "idle");
    }
  }

  function toggle() { state.playing ? pause() : play(state.position); }

  function updateButtons() {
    const playButton = $("mixerPlay");
    if (playButton) {
      const paused = state.playing && !state.overdub.active;
      playButton.textContent = paused ? "⏸" : "▶";
      playButton.setAttribute("aria-label", paused ? "일시정지" : "재생");
      playButton.title = `${paused ? "일시정지" : "재생"} · Space`;
      playButton.classList.toggle("is-playing", paused);
    }
    const compare = $("mixerCompare");
    if (compare) {
      compare.textContent = state.compareOriginal ? "MIX" : "A/B";
      compare.setAttribute("aria-label", state.compareOriginal ? "현재 믹스로 돌아가기" : "원본과 현재 믹스 비교");
      compare.title = state.compareOriginal ? "현재 믹스로 돌아가기" : "원본과 현재 믹스 비교";
      compare.classList.toggle("is-active", state.compareOriginal);
    }
  }

  function basePrefix(key) { return `mixer${key === "mr" ? "Mr" : "Vocal"}`; }

  function renderBaseTrackControls(key) {
    const prefix = basePrefix(key); const settings = state.settings[key] || defaultTrackSettings({ key, base: true }, state.recording);
    const values = {
      Volume: Math.round(settings.volume * 100), Pan: Math.round(settings.pan * 100), Offset: settings.offsetMs,
      FadeIn: settings.fadeIn, FadeOut: settings.fadeOut, TrimStart: settings.trimStartSec || 0, TrimEnd: settings.trimEndSec || 0
    };
    Object.entries(values).forEach(([suffix, value]) => { const el = $(`${prefix}${suffix}`); if (el) el.value = String(value); });
    if ($(`${prefix}VolumeNumber`)) $(`${prefix}VolumeNumber`).value = String(values.Volume);
    if ($(`${prefix}PanNumber`)) $(`${prefix}PanNumber`).value = String(values.Pan);
    if ($(`${prefix}OffsetNumber`)) $(`${prefix}OffsetNumber`).value = String(values.Offset);
    if ($(`${prefix}VolumeValue`)) $(`${prefix}VolumeValue`).textContent = `${values.Volume}%`;
    if ($(`${prefix}PanValue`)) $(`${prefix}PanValue`).textContent = values.Pan === 0 ? "C" : values.Pan < 0 ? `L${Math.abs(values.Pan)}` : `R${values.Pan}`;
    if ($(`${prefix}OffsetValue`)) $(`${prefix}OffsetValue`).textContent = `${values.Offset > 0 ? "+" : ""}${values.Offset}ms`;
    if ($(`${prefix}EditValue`)) $(`${prefix}EditValue`).textContent = `앞 ${Number(values.TrimStart).toFixed(1)}s · 뒤 ${Number(values.TrimEnd).toFixed(1)}s`;
    const def = getTrackDef(key); const buffer = state.buffers[key];
    const available = buffer ? Math.max(0, buffer.duration - Number(def?.trimStartSec || 0)) : 0;
    const trimStartInput = $(`${prefix}TrimStart`); const trimEndInput = $(`${prefix}TrimEnd`);
    if (trimStartInput) trimStartInput.max = String(Math.max(0, available - Number(values.TrimEnd) - 0.05));
    if (trimEndInput) trimEndInput.max = String(Math.max(0, available - Number(values.TrimStart) - 0.05));
    $(`${prefix}Mute`)?.classList.toggle("is-active", settings.muted);
    $(`${prefix}Solo`)?.classList.toggle("is-active", settings.solo);
    const row = $(`${prefix}Row`);
    if (row) {
      row.classList.toggle("is-muted", settings.muted || (anySolo() && !settings.solo));
      row.classList.toggle("is-solo", settings.solo);
      row.classList.toggle("is-unavailable", !state.buffers[key]);
      row.classList.toggle("is-selected", state.timeline.selectedTrackKey === key);
    }
  }

  function extraCardHtml(def) {
    const key = escapeHtml(def.key); const name = escapeHtml(def.name);
    const trackState = def.empty ? "빈 트랙" : "녹음 있음";
    return `<article class="mixer-track-card is-extra${def.empty ? " is-empty" : ""}" data-extra-card="${key}" data-track-select="${key}">
      <header><div><span class="mixer-track-kicker">ADDITIONAL TRACK</span><strong>${name}</strong><span class="mixer-track-state" data-track-state>${trackState}</span></div>
      <div class="mixer-track-actions"><button class="mixer-mini-btn is-record-target" data-action="target" type="button">녹음 대상</button><button class="mixer-mini-btn" data-action="play" type="button">이 트랙만</button><button class="mixer-mini-btn" data-action="mute" type="button">음소거</button><button class="mixer-mini-btn" data-action="solo" type="button">솔로</button><button class="mixer-mini-btn" data-action="reset" type="button">초기화</button><button class="mixer-mini-btn is-danger" data-action="delete" type="button">삭제</button></div></header>
      <div class="mixer-control-grid">
        <div class="mixer-value-control"><label><span>음량 <output data-output="volume">100%</output></span><input class="range compact" data-field="volume" type="range" min="0" max="150" value="100" /></label><input class="mixer-small-number" data-number="volume" type="number" min="0" max="150" step="1" value="100" /></div>
        <div class="mixer-value-control"><label><span>팬 <output data-output="pan">C</output></span><input class="range compact" data-field="pan" type="range" min="-100" max="100" value="0" /></label><input class="mixer-small-number" data-number="pan" type="number" min="-100" max="100" step="1" value="0" /></div>
      </div>
      <div class="mixer-offset-control"><label><span>트랙 위치 <output data-output="offsetMs">0ms</output></span><input class="range compact" data-field="offsetMs" type="range" min="-1000" max="1000" step="10" value="0" /></label><input class="mixer-offset-number" data-number="offsetMs" type="number" min="-1000" max="1000" step="10" value="0" /></div>
      <details class="mixer-advanced"><summary>자르기·페이드 <span data-output="edit">앞 0.0s · 뒤 0.0s</span></summary>
        <div class="mixer-trim-grid"><label><span>앞 자르기</span><input data-field="trimStartSec" type="number" min="0" max="0" step="0.1" value="0" /></label><label><span>뒤 자르기</span><input data-field="trimEndSec" type="number" min="0" max="0" step="0.1" value="0" /></label></div>
        <div class="mixer-control-grid"><label><span>페이드인</span><input class="range compact" data-field="fadeIn" type="range" min="0" max="10" step="0.1" value="0" /></label><label><span>페이드아웃</span><input class="range compact" data-field="fadeOut" type="range" min="0" max="10" step="0.1" value="0" /></label></div>
      </details>
    </article>`;
  }

  function renderExtraStructure() {
    const grid = $("mixerExtraTrackGrid");
    if (!grid) return;
    const extras = state.trackDefs.filter((def) => !def.base);
    renderTimelineStructure();
    grid.innerHTML = extras.map(extraCardHtml).join("");
    extras.forEach(bindExtraCard);
    setTimelineSnap(state.timeline.snapMs);
    updateTimeline();
  }

  function renderExtraTrackControls(def) {
    const card = findDataElement("data-extra-card", def.key); if (!card) return;
    const settings = state.settings[def.key] || defaultTrackSettings(def, state.recording);
    const values = {
      volume: Math.round(settings.volume * 100), pan: Math.round(settings.pan * 100), offsetMs: settings.offsetMs,
      fadeIn: settings.fadeIn, fadeOut: settings.fadeOut, trimStartSec: settings.trimStartSec || 0, trimEndSec: settings.trimEndSec || 0
    };
    Object.entries(values).forEach(([field, value]) => { const input = card.querySelector(`[data-field="${field}"]`); if (input) input.value = String(value); });
    ["volume", "pan", "offsetMs"].forEach((field) => { const input = card.querySelector(`[data-number="${field}"]`); if (input) input.value = String(values[field]); });
    const volumeOut = card.querySelector('[data-output="volume"]'); if (volumeOut) volumeOut.textContent = `${values.volume}%`;
    const panOut = card.querySelector('[data-output="pan"]'); if (panOut) panOut.textContent = values.pan === 0 ? "C" : values.pan < 0 ? `L${Math.abs(values.pan)}` : `R${values.pan}`;
    const offsetOut = card.querySelector('[data-output="offsetMs"]'); if (offsetOut) offsetOut.textContent = `${values.offsetMs > 0 ? "+" : ""}${values.offsetMs}ms`;
    const editOut = card.querySelector('[data-output="edit"]'); if (editOut) editOut.textContent = `앞 ${Number(values.trimStartSec).toFixed(1)}s · 뒤 ${Number(values.trimEndSec).toFixed(1)}s`;
    const buffer = state.buffers[def.key]; const available = buffer ? Math.max(0, buffer.duration - Number(def.trimStartSec || 0)) : 0;
    const startInput = card.querySelector('[data-field="trimStartSec"]'); const endInput = card.querySelector('[data-field="trimEndSec"]');
    if (startInput) startInput.max = String(Math.max(0, available - Number(values.trimEndSec) - 0.05));
    if (endInput) endInput.max = String(Math.max(0, available - Number(values.trimStartSec) - 0.05));
    card.querySelector('[data-action="mute"]')?.classList.toggle("is-active", settings.muted);
    card.querySelector('[data-action="solo"]')?.classList.toggle("is-active", settings.solo);
    card.classList.toggle("is-muted", settings.muted || (anySolo() && !settings.solo));
    card.classList.toggle("is-solo", settings.solo); card.classList.toggle("is-unavailable", !state.buffers[def.key]);
    card.classList.toggle("is-selected", state.timeline.selectedTrackKey === def.key);
  }

  function panLabel(value) {
    const pan = Math.round(Number(value) || 0);
    return pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`;
  }

  function updateQuickTrackInspector() {
    const key = state.timeline.selectedTrackKey;
    const def = getTrackDef(key);
    const settings = def ? state.settings[key] : null;
    const available = Boolean(def && state.buffers[key]);
    const busy = state.overdub.active || state.exporting;
    if ($("mixerQuickTrackName")) {
      $("mixerQuickTrackName").textContent = def ? `${def.name}${available ? "" : " · 빈 트랙"}` : "트랙을 선택해 주세요";
    }
    const volume = Math.round(Number(settings?.volume ?? 1) * 100);
    const pan = Math.round(Number(settings?.pan ?? 0) * 100);
    const offset = Math.round(Number(settings?.offsetMs ?? 0));
    if ($("mixerQuickVolume")) $("mixerQuickVolume").value = String(volume);
    if ($("mixerQuickPan")) $("mixerQuickPan").value = String(pan);
    if ($("mixerQuickOffset")) $("mixerQuickOffset").value = String(offset);
    if ($("mixerQuickVolumeValue")) $("mixerQuickVolumeValue").textContent = `${volume}%`;
    if ($("mixerQuickPanValue")) $("mixerQuickPanValue").textContent = panLabel(pan);
    if ($("mixerQuickOffsetValue")) $("mixerQuickOffsetValue").textContent = `${offset > 0 ? "+" : ""}${offset}ms`;
    ["mixerQuickVolume", "mixerQuickPan", "mixerQuickOffset"].forEach((id) => {
      const input = $(id); if (input) input.disabled = !settings || !available || busy;
    });
    const preview = $("mixerQuickPreview");
    if (preview) preview.disabled = !settings || !available || busy;
    const mute = $("mixerQuickMute");
    if (mute) { mute.disabled = !settings || !available || busy; mute.classList.toggle("is-active", Boolean(settings?.muted)); mute.setAttribute("aria-pressed", String(Boolean(settings?.muted))); }
    const solo = $("mixerQuickSolo");
    if (solo) { solo.disabled = !settings || !available || busy; solo.classList.toggle("is-active", Boolean(settings?.solo)); solo.setAttribute("aria-pressed", String(Boolean(settings?.solo))); }
    const record = $("mixerQuickRecord");
    if (record) {
      const canRecord = Boolean(def && !def.base && def.data?.id && state.recording && !state.exporting);
      record.hidden = !def || def.base;
      record.disabled = !canRecord;
      record.classList.toggle("is-active", Boolean(state.overdub.active && state.overdub.targetTrackId === String(def?.data?.id || "")));
      record.title = state.overdub.active ? "녹음 정지·저장" : "선택한 추가 트랙에 녹음";
    }
  }

  function bindQuickTrackInspector() {
    const bindRange = (id, field, label) => {
      $(id)?.addEventListener("input", (event) => {
        const key = state.timeline.selectedTrackKey;
        if (!key || !state.settings[key]) return;
        setTrackValue(key, field, event.target.value, { label: `${getTrackDef(key)?.name || "트랙"} ${label}` });
      });
    };
    bindRange("mixerQuickVolume", "volume", "음량");
    bindRange("mixerQuickPan", "pan", "팬");
    bindRange("mixerQuickOffset", "offsetMs", "위치");
    $("mixerQuickPreview")?.addEventListener("click", () => {
      const key = state.timeline.selectedTrackKey; if (key) playOnly(key);
    });
    $("mixerQuickMute")?.addEventListener("click", () => {
      const key = state.timeline.selectedTrackKey; if (key) toggleTrackFlag(key, "muted");
    });
    $("mixerQuickSolo")?.addEventListener("click", () => {
      const key = state.timeline.selectedTrackKey; if (key) toggleTrackFlag(key, "solo");
    });
    $("mixerQuickRecord")?.addEventListener("click", () => {
      if (state.overdub.active) finishOverdub(); else startOverdub({ fromQuickInspector: true });
    });
  }

  function updateSelectedTrackUi() {
    const key = state.timeline.selectedTrackKey;
    const def = getTrackDef(key);
    const clip = getClipRef(key, state.timeline.selectedClipId);
    if ($("mixerSelectedTrack")) $("mixerSelectedTrack").textContent = def ? `${def.name}${clip ? " · 클립 선택됨" : " 선택됨"}` : "트랙을 선택해 주세요";
    document.querySelectorAll("#mixer [data-track-clip]").forEach((element) => {
      element.classList.toggle("is-selected", element.dataset.trackClip === key && element.dataset.clipId === state.timeline.selectedClipId);
    });
    document.querySelectorAll("#mixer [data-track-select]").forEach((card) => card.classList.toggle("is-selected", card.dataset.trackSelect === key));
    state.trackDefs.forEach(renderTimelineTrackControls);
    BASE_KEYS.forEach((baseKey) => $(`${basePrefix(baseKey)}Row`)?.classList.toggle("is-selected", baseKey === key));
    updateSelectedClipInspector();
    updateRecordTargetUi();
    updateQuickTrackInspector();
  }

  function updateHistoryButtons() {
    const canUndo = Boolean(state.history?.canUndo?.()); const canRedo = Boolean(state.history?.canRedo?.());
    if ($("mixerUndo")) $("mixerUndo").disabled = !canUndo || state.overdub.active || state.exporting;
    if ($("mixerRedo")) $("mixerRedo").disabled = !canRedo || state.overdub.active || state.exporting;
    const labels = state.history?.labels?.() || {};
    if ($("mixerUndo")) $("mixerUndo").title = labels.undo ? `실행 취소: ${labels.undo}` : "실행 취소";
    if ($("mixerRedo")) $("mixerRedo").title = labels.redo ? `다시 실행: ${labels.redo}` : "다시 실행";
  }

  function updateSelectedClipInspector() {
    const selected = getSelectedClip();
    const controls = ["mixerSplitClip", "mixerMuteClip", "mixerDeleteClip", "mixerClipPosition", "mixerClipSourceStart", "mixerClipSourceEnd", "mixerClipVolume", "mixerClipFadeIn", "mixerClipFadeOut"];
    controls.forEach((id) => { const element = $(id); if (element) element.disabled = !selected || state.overdub.active || state.exporting; });
    if (!selected) {
      if ($("mixerClipInfo")) $("mixerClipInfo").textContent = "타임라인에서 클립을 선택해 주세요.";
      const muteButton = $("mixerMuteClip");
      if (muteButton) { muteButton.classList.remove("is-active"); muteButton.setAttribute("aria-pressed", "false"); }
      return;
    }
    const { def, clip, buffer } = selected;
    const model = timelineModel();
    const windowInfo = model.clipMap[clip.id];
    if ($("mixerClipInfo")) $("mixerClipInfo").textContent = `${def.name} · ${formatTime(clip.sourceEndSec - clip.sourceStartSec)} · 타임라인 ${formatTime(windowInfo?.startSec || 0)}${clip.muted ? " · 음소거" : ""}`;
    const muteButton = $("mixerMuteClip");
    if (muteButton) {
      muteButton.classList.toggle("is-active", Boolean(clip.muted));
      muteButton.setAttribute("aria-pressed", String(Boolean(clip.muted)));
      muteButton.setAttribute("aria-label", clip.muted ? "선택 클립 음소거 해제" : "선택 클립 음소거");
      muteButton.title = clip.muted ? "선택 클립 음소거 해제" : "선택 클립 음소거";
      muteButton.querySelector('[aria-hidden="true"]')?.replaceChildren(document.createTextNode(clip.muted ? "🔊" : "🔇"));
    }
    if ($("mixerClipPosition")) $("mixerClipPosition").value = String(Math.round(Number(clip.timelineStartSec || 0) * 1000));
    if ($("mixerClipSourceStart")) { $("mixerClipSourceStart").value = String(Number(clip.sourceStartSec || 0).toFixed(2)); $("mixerClipSourceStart").max = String(Math.max(0, Number(clip.sourceEndSec || 0) - 0.05)); }
    if ($("mixerClipSourceEnd")) { $("mixerClipSourceEnd").value = String(Number(clip.sourceEndSec || 0).toFixed(2)); $("mixerClipSourceEnd").max = String(buffer?.duration || clip.sourceEndSec || 0); $("mixerClipSourceEnd").min = String(Number(clip.sourceStartSec || 0) + 0.05); }
    if ($("mixerClipVolume")) $("mixerClipVolume").value = String(Math.round(Number(clip.volume ?? 1) * 100));
    if ($("mixerClipFadeIn")) { $("mixerClipFadeIn").value = String(Number(clip.fadeIn || 0).toFixed(2)); $("mixerClipFadeIn").max = String(Math.min(10, (clip.sourceEndSec - clip.sourceStartSec) / 2)); }
    if ($("mixerClipFadeOut")) { $("mixerClipFadeOut").value = String(Number(clip.fadeOut || 0).toFixed(2)); $("mixerClipFadeOut").max = String(Math.min(10, (clip.sourceEndSec - clip.sourceStartSec) / 2)); }
  }

  function selectTrack(key, { scroll = false, keepClip = false } = {}) {
    if (!getTrackDef(key)) return;
    state.timeline.selectedTrackKey = key;
    const clips = state.settings[key]?.clips || [];
    if (!keepClip || !clips.some((clip) => clip.id === state.timeline.selectedClipId)) state.timeline.selectedClipId = clips[0]?.id || "";
    updateSelectedTrackUi();
    updateRecordTargetUi({ syncStart: true });
    if (scroll) {
      const target = BASE_KEYS.includes(key) ? $(`${basePrefix(key)}Row`) : findDataElement("data-extra-card", key);
      target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }

  function selectClip(trackKey, clipId, { scroll = false } = {}) {
    if (!getTrackDef(trackKey) || !getClipRef(trackKey, clipId)) return;
    state.timeline.selectedTrackKey = trackKey;
    state.timeline.selectedClipId = clipId;
    updateSelectedTrackUi();
    updateRecordTargetUi({ syncStart: true });
    if (scroll) {
      const target = BASE_KEYS.includes(trackKey) ? $(`${basePrefix(trackKey)}Row`) : findDataElement("data-extra-card", trackKey);
      target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }

  function renderControls() {
    BASE_KEYS.forEach(renderBaseTrackControls);
    state.trackDefs.filter((def) => !def.base).forEach(renderExtraTrackControls);
    state.trackDefs.forEach(renderTimelineTrackControls);
    const master = Math.round(state.settings.masterVolume * 100);
    if ($("mixerMasterVolume")) $("mixerMasterVolume").value = String(master);
    if ($("mixerMasterVolumeNumber")) $("mixerMasterVolumeNumber").value = String(master);
    if ($("mixerMasterVolumeValue")) $("mixerMasterVolumeValue").textContent = `${master}%`;
    updateSelectedTrackUi(); updateHistoryButtons(); updateButtons(); updateAvailability();
  }

  function updateAvailability() {
    const hasAny = state.trackDefs.some((def) => Boolean(state.buffers[def.key]));
    const selectedExtra = getSelectedExtraDef();
    BASE_KEYS.forEach((key) => {
      const available = Boolean(state.buffers[key]);
      $(`${basePrefix(key)}Row`)?.querySelectorAll(".mixer-control").forEach((element) => { element.disabled = !available || state.overdub.active || state.exporting; });
    });
    state.trackDefs.filter((def) => !def.base).forEach((def) => {
      const card = findDataElement("data-extra-card", def.key);
      if (!card) return;
      const available = Boolean(state.buffers[def.key]);
      card.querySelectorAll("input").forEach((element) => { element.disabled = !available || state.overdub.active || state.exporting; });
      card.querySelectorAll("button").forEach((element) => {
        const action = element.dataset.action;
        element.disabled = state.overdub.active || state.exporting || (!available && !["target", "delete"].includes(action));
      });
    });
    ["mixerReset", "mixerMasterVolume", "mixerMasterVolumeNumber", "mixerSeek", "mixerPlay", "mixerStop", "mixerExportName", "mixerExportWav", "mixerZoom", "mixerSnap", "mixerLoopStart", "mixerLoopEnd", "mixerLoopToggle"].forEach((id) => { const el = $(id); if (el) el.disabled = !hasAny || state.overdub.active || state.exporting; });
    if ($("mixerCompare")) $("mixerCompare").disabled = !state.originalBuffer || state.overdub.active || state.exporting;
    const extraCount = state.trackDefs.filter((def) => !def.base).length;
    if ($("mixerAddTrack")) $("mixerAddTrack").disabled = !state.recording || state.overdub.active || state.exporting || state.addingTrack || extraCount >= OVERDUB_MAX_TRACKS;
    if ($("mixerRecordOptionsToggle")) $("mixerRecordOptionsToggle").disabled = !state.recording || state.overdub.active || state.exporting;
    const canRecordTarget = Boolean(state.recording && selectedExtra && selectedExtra.data?.id);
    if ($("mixerTrackRecordStart")) $("mixerTrackRecordStart").disabled = !canRecordTarget || state.overdub.active || state.exporting;
    if ($("mixerTrackRecordStop")) $("mixerTrackRecordStop").disabled = !state.overdub.active;
    ["mixerRecordMode", "mixerRecordStartPosition", "mixerRecordEndPosition", "mixerRecordUsePlayhead", "mixerRecordUseLoop", "mixerPunchOverlap", "mixerOverdubCountIn"].forEach((id) => {
      const element = $(id); if (element) element.disabled = !canRecordTarget || state.overdub.active || state.exporting;
    });
    state.trackDefs.forEach(renderTimelineTrackControls);
    updateHistoryButtons();
    updateSelectedClipInspector();
    updateRecordTargetUi();
    updateQuickTrackInspector();
  }

  function updateMeta() {
    if ($("mixerRecordingTitle")) $("mixerRecordingTitle").textContent = state.recording?.name || "녹음을 선택해 주세요";
    if ($("mixerRecordingMemo")) $("mixerRecordingMemo").textContent = String(state.recording?.memo || "").trim() || "저장된 트랙을 앱 안에서 바로 재생하고 조절합니다.";
    const separated = Boolean(state.recording && buildTrackDefs(state.recording).length);
    if ($("mixerLegacyNotice")) {
      $("mixerLegacyNotice").hidden = !state.recording || separated;
      $("mixerLegacyNotice").textContent = state.recording && !separated ? "이 녹음은 합쳐진 파일만 있어 멀티트랙 믹서를 사용할 수 없습니다. v1.7 이후 새 녹음을 선택해 주세요." : "";
    }
    if ($("mixerExportName")) $("mixerExportName").value = state.recording ? `${safeName(state.recording.name)}_최종믹스` : "";
  }

  async function decodeBlob(blob, token) {
    if (!(blob instanceof Blob)) return null;
    const context = ensureContext(); const arrayBuffer = await blob.arrayBuffer();
    if (token !== state.loadingToken) return null;
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  function revokeExport() {
    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = ""; state.exportBlob = null;
    if ($("mixerExportAudio")) { $("mixerExportAudio").removeAttribute("src"); $("mixerExportAudio").load(); }
    if ($("mixerExportResult")) $("mixerExportResult").hidden = true;
    if ($("mixerExportProgress")) { $("mixerExportProgress").hidden = true; $("mixerExportProgress").value = 0; }
    if ($("mixerOutputBadge")) { $("mixerOutputBadge").dataset.state = "idle"; $("mixerOutputBadge").textContent = "출력 대기"; }
    if ($("mixerExportStatus")) $("mixerExportStatus").textContent = "44.1kHz · 스테레오 · 16bit WAV로 생성합니다.";
  }

  async function loadRecording(recording) {
    await flushSaveQueue({ force: true });
    if (recording?.id) recording = getRecordings().find((entry) => String(entry.id) === String(recording.id)) || recording;
    if (state.overdub.active) await finishOverdub();
    ++state.loadingToken;
    stop({ keepOverdub: true }); revokeExport();
    Object.values(state.buffers).forEach((buffer) => window.HoonWaveform?.clear?.(buffer));
    state.recording = recording || null; state.selectedId = recording ? String(recording.id) : "";
    setSaveState(getCurrentSaveFailure() ? "error" : "saved");
    state.trackDefs = buildTrackDefs(recording); state.buffers = {}; state.originalBuffer = null;
    state.settings = normalizeSettings(recording, state.trackDefs); state.position = 0; state.duration = 0; state.mixDuration = 0; state.compareOriginal = false;
    Object.assign(state.timeline, { selectedTrackKey: "", selectedClipId: "", drag: null, loopEnabled: false, loopStartSec: 0, loopEndSec: 0 });
    state.history?.clear?.(); state.historyCoalesce = { key: "", at: 0 };
    updateMeta(); renderExtraStructure(); renderControls(); calculateDuration();
    if (!recording) { setStatus("트랙이 있는 녹음을 선택해 주세요.", "idle"); updateAvailability(); return; }
    const token = ++state.loadingToken; setStatus("저장된 트랙과 클립 파형을 불러오고 있습니다.", "loading"); updateAvailability();
    try {
      const entries = [...state.trackDefs.map((def) => [def.key, def.blob]), ["__original", recording.blob]];
      const results = await Promise.allSettled(entries.map(([, blob]) => decodeBlob(blob, token)));
      if (token !== state.loadingToken) return;
      results.forEach((result, index) => {
        const key = entries[index][0]; const value = result.status === "fulfilled" ? result.value : null;
        if (key === "__original") state.originalBuffer = value; else state.buffers[key] = value;
      });
      const playableDefs = state.trackDefs.filter((def) => state.buffers[def.key]);
      if (!playableDefs.length) throw new Error("재생할 수 있는 분리 트랙을 찾지 못했습니다.");
      const hadClipData = playableDefs.every((def) => Number(state.settings[def.key]?.clipModelVersion) >= 1);
      sanitizeAllTrackEdits();
      const firstDef = state.trackDefs.find((def) => def.key === "vocal") || playableDefs[0] || state.trackDefs[0];
      state.timeline.selectedTrackKey = firstDef.key;
      state.timeline.selectedClipId = state.settings[firstDef.key]?.clips?.[0]?.id || "";
      renderExtraStructure(); calculateDuration(); renderControls(); updateMeta();
      if (!hadClipData) scheduleSave();
      const clipCount = state.trackDefs.reduce((sum, def) => sum + (state.settings[def.key]?.clips?.length || 0), 0);
      const emptyCount = state.trackDefs.filter((def) => !def.base && !state.buffers[def.key]).length;
      setStatus(`${state.trackDefs.length}개 트랙 · ${clipCount}개 클립${emptyCount ? ` · 빈 트랙 ${emptyCount}개` : ""}를 준비했습니다.`, "idle");
    } catch (error) {
      state.buffers = {}; state.originalBuffer = null; state.trackDefs = []; state.timeline.selectedTrackKey = ""; state.timeline.selectedClipId = "";
      renderExtraStructure(); calculateDuration(); renderControls();
      setStatus(`트랙을 불러오지 못했습니다: ${error.message}`, "error");
    }
  }

  function renderRecordingSelect() {
    const select = $("mixerRecordingSelect"); if (!select) return;
    const recordings = [...getRecordings()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)); const previous = state.selectedId;
    select.innerHTML = ""; const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = recordings.length ? "녹음을 선택하세요" : "현재 프로젝트에 녹음이 없습니다"; select.appendChild(placeholder);
    recordings.forEach((recording) => {
      const option = document.createElement("option"); option.value = String(recording.id);
      const count = buildTrackDefs(recording).length; option.textContent = `${recording.name || "보컬 녹음"}${count ? ` · ${count}트랙` : " · 믹스만"}`; select.appendChild(option);
    });
    const current = recordings.find((recording) => String(recording.id) === previous);
    if (current) { select.value = previous; state.recording = current; updateMeta(); }
    else { state.selectedId = ""; select.value = ""; if (state.recording) loadRecording(null); }
  }

  function refresh() { renderRecordingSelect(); }
  function selectRecording(id) {
    const recording = getRecordings().find((entry) => String(entry.id) === String(id));
    if ($("mixerRecordingSelect")) $("mixerRecordingSelect").value = recording ? String(recording.id) : "";
    return loadRecording(recording || null);
  }

  async function flushSaveQueue({ force = false } = {}) {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    if (state.saveInFlight) return state.savePromise;
    if (!state.savePending) return null;
    const job = state.savePending;
    state.savePending = null;
    state.saveInFlight = true;
    setSaveState("saving");
    state.savePromise = (async () => {
      try {
        const latest = getRecordings().find((entry) => String(entry.id) === job.recordingId)
          || (currentRecordingId() === job.recordingId ? state.recording : job.recording);
        if (!latest) throw new Error("저장할 녹음을 찾지 못했습니다.");
        const updated = await state.callbacks.saveSettings?.(latest, clone(job.settings));
        state.savedRevision = Math.max(state.savedRevision, job.revision);
        state.saveFailures.delete(job.recordingId);
        if (updated && currentRecordingId() === job.recordingId) state.recording = updated;
      } catch (error) {
        state.saveFailures.set(job.recordingId, { ...job, error });
        if (currentRecordingId() === job.recordingId) {
          setStatus(`믹서 설정을 저장하지 못했습니다: ${error.message}`, "error");
        }
      } finally {
        state.saveInFlight = false;
        state.savePromise = null;
        if (state.savePending) {
          setSaveState("dirty");
          window.setTimeout(() => flushSaveQueue(), 0);
        } else if (getCurrentSaveFailure()) setSaveState("error");
        else setSaveState("saved");
      }
    })();
    return state.savePromise;
  }

  function scheduleSave({ immediate = false } = {}) {
    if (!state.recording) return;
    const recordingId = currentRecordingId();
    state.saveRevision += 1;
    state.savePending = {
      revision: state.saveRevision,
      recordingId,
      recording: state.recording,
      settings: clone(state.settings)
    };
    state.saveFailures.delete(recordingId);
    setSaveState("dirty");
    clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      flushSaveQueue();
    }, immediate ? 0 : 350);
  }

  function retryCurrentSave() {
    const failed = getCurrentSaveFailure();
    if (!failed || state.saveInFlight) return;
    state.saveFailures.delete(failed.recordingId);
    state.savePending = { ...failed, revision: ++state.saveRevision, settings: clone(failed.settings) };
    setSaveState("dirty", "재저장 대기");
    flushSaveQueue({ force: true });
  }

  function rememberEdit(label, key = label, force = false) {
    if (!state.history) return;
    const now = performance.now();
    if (!force && state.historyCoalesce.key === key && now - state.historyCoalesce.at < 420) {
      state.historyCoalesce.at = now;
      return;
    }
    state.history.push(state.settings, label);
    state.historyCoalesce = { key, at: now };
    updateHistoryButtons();
  }

  function applyHistorySnapshot(result, direction) {
    if (!result?.snapshot) return;
    const wasPlaying = state.playing; const position = currentPosition();
    if (wasPlaying) stop({ preservePosition: true, silent: true, keepOverdub: true });
    state.settings = clone(result.snapshot); sanitizeAllTrackEdits(); state.historyCoalesce = { key: "", at: 0 };
    const selectedClips = state.settings[state.timeline.selectedTrackKey]?.clips || [];
    if (!selectedClips.some((clip) => clip.id === state.timeline.selectedClipId)) state.timeline.selectedClipId = selectedClips[0]?.id || "";
    calculateDuration(); renderControls(); updateLiveNodes(); scheduleSave();
    if (wasPlaying) play(Math.min(position, state.duration));
    setStatus(`${result.label || "편집"} 작업을 ${direction === "undo" ? "취소" : "다시 적용"}했습니다.`, "idle");
  }

  function undoEdit() { applyHistorySnapshot(state.history?.undo?.(state.settings), "undo"); updateHistoryButtons(); }
  function redoEdit() { applyHistorySnapshot(state.history?.redo?.(state.settings), "redo"); updateHistoryButtons(); }

  function restartIfPlaying() {
    calculateDuration(); if (!state.playing || state.overdub.active) return; clearTimeout(state.restartTimer);
    const position = currentPosition(); state.restartTimer = window.setTimeout(() => { state.restartTimer = null; if (state.playing) play(Math.min(position, state.duration)); }, 90);
  }

  function normalizeField(field, value) {
    if (field === "volume") return clamp(Number(value) / 100, 0, 1.5);
    if (field === "pan") return clamp(Number(value) / 100, -1, 1);
    if (field === "offsetMs") return clamp(window.HoonTimeline?.snapMs?.(value, 10) ?? Math.round(Number(value) / 10) * 10, -1000, 1000);
    if (field === "fadeIn" || field === "fadeOut") return clamp(value, 0, 10);
    if (field === "trimStartSec" || field === "trimEndSec") return clamp(Math.round(Number(value) * 100) / 100, 0, 3600);
    return value;
  }

  function setTrackValue(key, field, value, options = {}) {
    if (!state.settings[key]) return;
    if (options.remember !== false) rememberEdit(options.label || `${getTrackDef(key)?.name || "트랙"} ${field}`, `${key}:${field}`);
    state.settings[key][field] = normalizeField(field, value);
    const def = getTrackDef(key);
    if (BASE_KEYS.includes(key)) renderBaseTrackControls(key); else if (def) renderExtraTrackControls(def);
    selectTrack(key, { keepClip: true }); updateLiveNodes();
    if (["offsetMs", "fadeIn", "fadeOut", "trimStartSec", "trimEndSec"].includes(field)) restartIfPlaying();
    else if (!["volume", "pan"].includes(field)) updateTimeline();
    scheduleSave();
  }

  function toggleTrackFlag(key, flag) {
    if (!state.settings[key]) return; rememberEdit(`${getTrackDef(key)?.name || "트랙"} ${flag === "muted" ? "음소거" : "솔로"}`, `${key}:${flag}`, true);
    state.settings[key][flag] = !state.settings[key][flag]; selectTrack(key); renderControls(); updateLiveNodes(); scheduleSave();
  }

  function playOnly(key) {
    rememberEdit(`${getTrackDef(key)?.name || "트랙"}만 듣기`, `solo:${key}`, true);
    getTrackKeys().forEach((trackKey) => { state.settings[trackKey].solo = trackKey === key; }); selectTrack(key); renderControls(); updateLiveNodes(); scheduleSave();
    if (!state.playing) play(state.position); else restartIfPlaying();
  }

  function resetTrack(key) {
    const def = getTrackDef(key); if (!def) return; rememberEdit(`${def.name} 초기화`, `reset:${key}`, true);
    state.settings[key] = defaultTrackSettings(def, state.recording); sanitizeAllTrackEdits(); selectTrack(key); calculateDuration(); renderControls(); updateLiveNodes(); restartIfPlaying(); scheduleSave();
  }

  function resetSettings() {
    if (!state.recording) return; rememberEdit("전체 믹서 초기화", "reset:all", true);
    state.settings = normalizeSettings({ ...state.recording, mixSettings: null }, state.trackDefs); sanitizeAllTrackEdits();
    const firstDef = state.trackDefs.find((def) => def.key === "vocal") || state.trackDefs[0];
    state.timeline.selectedTrackKey = firstDef?.key || ""; state.timeline.selectedClipId = firstDef ? state.settings[firstDef.key]?.clips?.[0]?.id || "" : "";
    calculateDuration(); renderControls(); restartIfPlaying(); scheduleSave(); setStatus("모든 믹서 설정을 초기값으로 되돌렸습니다.", "idle");
  }

  function bindBaseTrack(key) {
    const prefix = basePrefix(key);
    const bindPair = (field, min, max) => {
      const range = $(`${prefix}${field === "volume" ? "Volume" : "Pan"}`); const number = $(`${prefix}${field === "volume" ? "VolumeNumber" : "PanNumber"}`);
      range?.addEventListener("input", (event) => { if (number) number.value = event.target.value; setTrackValue(key, field, event.target.value); });
      number?.addEventListener("change", (event) => { const next = clamp(event.target.value, min, max); if (range) range.value = String(next); setTrackValue(key, field, next); });
    };
    bindPair("volume", 0, 150); bindPair("pan", -100, 100);
    $(`${prefix}Offset`)?.addEventListener("input", (event) => { if ($(`${prefix}OffsetNumber`)) $(`${prefix}OffsetNumber`).value = event.target.value; setTrackValue(key, "offsetMs", event.target.value); });
    $(`${prefix}OffsetNumber`)?.addEventListener("change", (event) => { const next = clamp(event.target.value, -1000, 1000); if ($(`${prefix}Offset`)) $(`${prefix}Offset`).value = String(next); setTrackValue(key, "offsetMs", next); });
    $(`${prefix}TrimStart`)?.addEventListener("change", (event) => setTrackValue(key, "trimStartSec", event.target.value, { label: `${getTrackDef(key)?.name || "트랙"} 앞 자르기` }));
    $(`${prefix}TrimEnd`)?.addEventListener("change", (event) => setTrackValue(key, "trimEndSec", event.target.value, { label: `${getTrackDef(key)?.name || "트랙"} 뒤 자르기` }));
    $(`${prefix}FadeIn`)?.addEventListener("input", (event) => setTrackValue(key, "fadeIn", event.target.value));
    $(`${prefix}FadeOut`)?.addEventListener("input", (event) => setTrackValue(key, "fadeOut", event.target.value));
    $(`${prefix}Mute`)?.addEventListener("click", () => toggleTrackFlag(key, "muted"));
    $(`${prefix}Solo`)?.addEventListener("click", () => toggleTrackFlag(key, "solo"));
    $(`${prefix}PlayOnly`)?.addEventListener("click", () => playOnly(key));
    $(`${prefix}Reset`)?.addEventListener("click", () => resetTrack(key));
    $(`${prefix}Row`)?.setAttribute("data-track-select", key);
    $(`${prefix}Row`)?.addEventListener("click", (event) => { if (!event.target.closest("button,input,select,summary")) selectTrack(key); });
  }

  function bindExtraCard(def) {
    const card = findDataElement("data-extra-card", def.key); if (!card) return;
    card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener(input.type === "number" ? "change" : "input", (event) => {
      const field = event.target.dataset.field; const number = card.querySelector(`[data-number="${field}"]`); if (number) number.value = event.target.value;
      const label = field === "trimStartSec" ? `${def.name} 앞 자르기` : field === "trimEndSec" ? `${def.name} 뒤 자르기` : `${def.name} ${field}`;
      setTrackValue(def.key, field, event.target.value, { label });
    }));
    card.querySelectorAll("[data-number]").forEach((input) => input.addEventListener("change", (event) => {
      const field = event.target.dataset.number; const min = Number(event.target.min); const max = Number(event.target.max); const next = clamp(event.target.value, min, max); const range = card.querySelector(`[data-field="${field}"]`); if (range) range.value = String(next); setTrackValue(def.key, field, next);
    }));
    card.querySelector('[data-action="mute"]')?.addEventListener("click", () => toggleTrackFlag(def.key, "muted"));
    card.querySelector('[data-action="solo"]')?.addEventListener("click", () => toggleTrackFlag(def.key, "solo"));
    card.querySelector('[data-action="play"]')?.addEventListener("click", () => playOnly(def.key));
    card.querySelector('[data-action="reset"]')?.addEventListener("click", () => resetTrack(def.key));
    card.querySelector('[data-action="target"]')?.addEventListener("click", () => selectTrack(def.key, { scroll: true }));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteExtraTrack(def));
    card.addEventListener("click", (event) => { if (!event.target.closest("button,input,select,summary")) selectTrack(def.key); });
    renderExtraTrackControls(def);
  }

  function timelineDeltaSeconds(deltaX, lane) {
    const width = Math.max(1, lane?.getBoundingClientRect?.().width || 1);
    return (Number(deltaX) || 0) / width * Math.max(0.01, state.duration);
  }

  function normalizeClipField(field, value, clip, buffer) {
    const minimum = window.HoonTimeline?.MIN_CLIP_SECONDS || 0.05;
    if (field === "timelineStartSec") return clamp((window.HoonTimeline?.snapMs?.(Number(value) * 1000, state.timeline.snapMs) || 0) / 1000, -3600, 3600);
    if (field === "sourceStartSec") return clamp(Number(value), 0, Math.max(0, Number(clip.sourceEndSec) - minimum));
    if (field === "sourceEndSec") return clamp(Number(value), Number(clip.sourceStartSec) + minimum, buffer?.duration || Number(clip.sourceEndSec));
    if (field === "volume") return clamp(Number(value), 0, 1.5);
    if (field === "fadeIn" || field === "fadeOut") return clamp(Number(value), 0, Math.min(10, (clip.sourceEndSec - clip.sourceStartSec) / 2));
    if (field === "muted") return Boolean(value);
    return value;
  }

  function replaceClipInSettings(trackKey, clipId, nextClip) {
    const settings = state.settings[trackKey];
    if (!settings) return false;
    const index = (settings.clips || []).findIndex((clip) => String(clip.id) === String(clipId));
    if (index < 0) return false;
    settings.clips[index] = window.HoonTimeline?.sanitizeClip?.({ ...settings.clips[index], ...nextClip }, state.buffers[trackKey], { name: getTrackDef(trackKey)?.name }) || { ...settings.clips[index], ...nextClip };
    return true;
  }

  function setClipValue(trackKey, clipId, field, value, options = {}) {
    const clip = getClipRef(trackKey, clipId); const buffer = state.buffers[trackKey];
    if (!clip || !buffer) return;
    if (options.remember !== false) rememberEdit(options.label || `${getTrackDef(trackKey)?.name || "클립"} 편집`, `clip:${clipId}:${field}`, Boolean(options.force));
    const normalized = normalizeClipField(field, value, clip, buffer);
    const next = { [field]: normalized };
    if (field === "sourceStartSec" && options.keepTimeline !== false) next.timelineStartSec = Number(clip.timelineStartSec || 0) + (normalized - Number(clip.sourceStartSec || 0));
    replaceClipInSettings(trackKey, clipId, next);
    selectClip(trackKey, clipId);
    calculateDuration();
    if (state.playing && !state.overdub.active) restartIfPlaying();
    scheduleSave();
  }

  function toggleSelectedClipMute(trackKey = state.timeline.selectedTrackKey, clipId = state.timeline.selectedClipId) {
    const clip = getClipRef(trackKey, clipId);
    const def = getTrackDef(trackKey);
    if (!clip || !def) { setStatus("음소거할 클립을 먼저 선택해 주세요.", "error"); return; }
    setClipValue(trackKey, clipId, "muted", !clip.muted, { label: `${def.name} 클립 ${clip.muted ? "음소거 해제" : "음소거"}`, force: true });
    if (state.playing && !state.overdub.active) restartIfPlaying();
    setStatus(clip.muted ? "선택 클립의 음소거를 해제했습니다." : "선택한 클립만 음소거했습니다.", "idle");
  }

  function splitSelectedClip() {
    const selected = getSelectedClip();
    if (!selected) { setStatus("분할할 클립을 먼저 선택해 주세요.", "error"); return; }
    const model = timelineModel(); const windowInfo = model.clipMap[selected.clip.id];
    const position = currentPosition();
    if (!windowInfo || position <= windowInfo.startSec + 0.05 || position >= windowInfo.endSec - 0.05) {
      setStatus("재생선을 클립 안쪽으로 옮긴 뒤 분할해 주세요.", "error"); return;
    }
    const sourceSplit = selected.clip.sourceStartSec + (position - windowInfo.startSec);
    const pair = window.HoonTimeline?.splitClip?.(selected.clip, sourceSplit);
    if (!pair) { setStatus("클립 가장자리와 너무 가까워 분할할 수 없습니다.", "error"); return; }
    rememberEdit(`${selected.def.name} 클립 분할`, `split:${selected.clip.id}`, true);
    const clips = state.settings[selected.trackKey].clips;
    const index = clips.findIndex((clip) => clip.id === selected.clip.id);
    clips.splice(index, 1, ...pair);
    state.timeline.selectedClipId = pair[1].id;
    calculateDuration(); renderControls(); scheduleSave();
    setStatus(`${selected.def.name} 클립을 두 구간으로 분할했습니다.`, "idle");
  }

  function deleteSelectedClip() {
    const selected = getSelectedClip();
    if (!selected) return;
    const trackClips = state.settings[selected.trackKey]?.clips || [];
    if (!confirm(`선택한 ${selected.def.name} 클립을 타임라인에서 제거할까요? 원본 오디오 파일은 보존됩니다.`)) return;
    rememberEdit(`${selected.def.name} 클립 삭제`, `delete-clip:${selected.clip.id}`, true);
    const index = trackClips.findIndex((clip) => clip.id === selected.clip.id);
    trackClips.splice(index, 1);
    const next = trackClips[Math.min(index, trackClips.length - 1)];
    state.timeline.selectedClipId = next?.id || "";
    calculateDuration(); renderControls(); scheduleSave();
    setStatus("클립을 비파괴 방식으로 제거했습니다. 취소 버튼으로 복구할 수 있습니다.", "idle");
  }

  function setLoopBoundary(type) {
    if (!state.duration) return;
    const position = currentPosition();
    if (type === "start") {
      state.timeline.loopStartSec = Math.min(position, Math.max(0, state.timeline.loopEndSec - 0.1));
      if (state.timeline.loopEndSec <= state.timeline.loopStartSec + 0.1) state.timeline.loopEndSec = Math.min(state.duration, state.timeline.loopStartSec + Math.max(1, state.duration * 0.1));
    } else {
      state.timeline.loopEndSec = Math.max(position, state.timeline.loopStartSec + 0.1);
    }
    state.timeline.loopEnabled = true;
    updateLoopUi();
    setStatus(`반복 ${type === "start" ? "시작" : "끝"} 지점을 설정했습니다.`, "idle");
    if (state.playing) restartIfPlaying();
  }

  function toggleLoop() {
    if (!state.duration) return;
    if (state.timeline.loopEndSec <= state.timeline.loopStartSec + 0.1) {
      state.timeline.loopStartSec = clamp(currentPosition(), 0, Math.max(0, state.duration - 1));
      state.timeline.loopEndSec = Math.min(state.duration, state.timeline.loopStartSec + Math.min(8, Math.max(1, state.duration - state.timeline.loopStartSec)));
    }
    state.timeline.loopEnabled = !state.timeline.loopEnabled;
    updateLoopUi();
    if (state.playing) restartIfPlaying();
  }

  function beginClipDrag(event, element) {
    if (event.target.closest("[data-clip-action]")) return;
    if (state.overdub.active || state.exporting || !state.recording) return;
    const trackKey = element.dataset.trackClip; const clipId = element.dataset.clipId;
    const def = getTrackDef(trackKey); const clip = getClipRef(trackKey, clipId); const buffer = state.buffers[trackKey];
    if (!def || !clip || !buffer) return;
    const edge = event.target.closest("[data-trim-edge]")?.dataset.trimEdge || "move";
    const position = currentPosition(); const wasPlaying = state.playing;
    if (wasPlaying) stop({ preservePosition: true, silent: true, keepOverdub: true });
    selectClip(trackKey, clipId);
    const immediate = event.pointerType !== "touch" || edge !== "move";
    state.timeline.drag = {
      trackKey, clipId, edge, startX: event.clientX, startY: event.clientY, lane: element.parentElement,
      initial: clone(clip), pointerId: event.pointerId, wasPlaying, position, active: immediate, remembered: false, startedAt: performance.now(), element
    };
    if (immediate) {
      rememberEdit(edge === "move" ? `${def.name} 클립 이동` : `${def.name} 클립 ${edge === "start" ? "앞" : "뒤"} 자르기`, `drag:${clipId}:${edge}`, true);
      state.timeline.drag.remembered = true;
      element.classList.add("is-dragging");
    }
    try { element.setPointerCapture(event.pointerId); } catch {}
    if (immediate) { event.preventDefault(); event.stopPropagation(); }
  }

  function activateTouchDrag(drag, event) {
    const dx = event.clientX - drag.startX; const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > Math.abs(dx) * 1.25 && performance.now() - drag.startedAt < 260) return false;
    if (Math.abs(dx) < 10 && performance.now() - drag.startedAt < 240) return false;
    drag.active = true;
    if (!drag.remembered) {
      const def = getTrackDef(drag.trackKey);
      rememberEdit(`${def?.name || "클립"} 이동`, `drag:${drag.clipId}:move`, true);
      drag.remembered = true;
    }
    drag.element?.classList.add("is-dragging");
    return true;
  }

  function positionDraggedElement(element, trackKey, clipId) {
    const model = timelineModel(); const item = model.clipMap[clipId];
    if (!element || !item || !state.duration) return;
    element.style.left = `${(item.startSec / state.duration) * 100}%`;
    element.style.width = `${Math.max(0.35, (item.duration / state.duration) * 100)}%`;
  }

  function moveClipDrag(event, element) {
    const drag = state.timeline.drag;
    if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== element.dataset.clipId) return;
    if (!drag.active && !activateTouchDrag(drag, event)) return;
    const buffer = state.buffers[drag.trackKey];
    if (!buffer) return;
    const deltaSec = timelineDeltaSeconds(event.clientX - drag.startX, drag.lane);
    const minimum = window.HoonTimeline?.MIN_CLIP_SECONDS || 0.05;
    let next = { ...drag.initial };
    if (drag.edge === "move") {
      next.timelineStartSec = (window.HoonTimeline?.snapMs?.((Number(drag.initial.timelineStartSec || 0) + deltaSec) * 1000, state.timeline.snapMs) || 0) / 1000;
    } else if (drag.edge === "start") {
      const snappedDelta = (window.HoonTimeline?.snapMs?.(deltaSec * 1000, state.timeline.snapMs) || 0) / 1000;
      const sourceStart = clamp(Number(drag.initial.sourceStartSec) + snappedDelta, 0, Number(drag.initial.sourceEndSec) - minimum);
      const actualDelta = sourceStart - Number(drag.initial.sourceStartSec);
      next.sourceStartSec = sourceStart;
      next.timelineStartSec = Number(drag.initial.timelineStartSec || 0) + actualDelta;
    } else {
      const snappedDelta = (window.HoonTimeline?.snapMs?.(deltaSec * 1000, state.timeline.snapMs) || 0) / 1000;
      next.sourceEndSec = clamp(Number(drag.initial.sourceEndSec) + snappedDelta, Number(drag.initial.sourceStartSec) + minimum, buffer.duration);
    }
    replaceClipInSettings(drag.trackKey, drag.clipId, next);
    positionDraggedElement(element, drag.trackKey, drag.clipId);
    updateSelectedClipInspector();
    event.preventDefault();
  }

  function endClipDrag(event, element) {
    const drag = state.timeline.drag;
    if (!drag || drag.pointerId !== event.pointerId || drag.clipId !== element.dataset.clipId) return;
    element.classList.remove("is-dragging");
    try { element.releasePointerCapture(event.pointerId); } catch {}
    state.timeline.drag = null;
    if (drag.active) {
      calculateDuration(); renderControls(); scheduleSave();
      if (drag.wasPlaying) play(Math.min(drag.position, state.duration));
      setStatus(`${getTrackDef(drag.trackKey)?.name || "클립"} 편집값을 적용했습니다.`, "idle");
      event.preventDefault();
    }
  }

  function bindTimelineClip(element) {
    if (!element || element.dataset.timelineBound === "true") return;
    element.dataset.timelineBound = "true";
    element.addEventListener("pointerdown", (event) => beginClipDrag(event, element));
    element.addEventListener("pointermove", (event) => moveClipDrag(event, element));
    ["pointerup", "pointercancel"].forEach((name) => element.addEventListener(name, (event) => endClipDrag(event, element)));
    element.querySelector('[data-clip-action="mute"]')?.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); selectClip(element.dataset.trackClip, element.dataset.clipId); toggleSelectedClipMute(element.dataset.trackClip, element.dataset.clipId);
    });
    element.addEventListener("click", (event) => { if (event.target.closest("[data-clip-action]")) return; event.stopPropagation(); selectClip(element.dataset.trackClip, element.dataset.clipId, { scroll: event.detail > 1 }); });
    element.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        const clip = getClipRef(element.dataset.trackClip, element.dataset.clipId); if (!clip) return;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setClipValue(element.dataset.trackClip, element.dataset.clipId, "timelineStartSec", Number(clip.timelineStartSec || 0) + direction * state.timeline.snapMs / 1000, { label: `${getTrackDef(element.dataset.trackClip)?.name || "클립"} 이동` });
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key.toLowerCase() === "s") {
        splitSelectedClip();
        event.preventDefault();
        event.stopPropagation();
      } else if (["Delete", "Backspace"].includes(event.key)) {
        deleteSelectedClip();
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  function seekFromTimelineEvent(event, lane) {
    if (!state.duration || event.target.closest("[data-track-clip],[data-timeline-action],[data-timeline-volume]")) return;
    const rect = lane.getBoundingClientRect();
    let left = rect.left;
    let width = rect.width;
    if (lane.classList.contains("mixer-timeline-ruler")) {
      const editor = $("mixerTimelineContent");
      const styles = editor ? getComputedStyle(editor) : null;
      const headerWidth = Number.parseFloat(styles?.getPropertyValue("--track-header-width")) || 132;
      const gap = Number.parseFloat(styles?.getPropertyValue("--timeline-gap")) || 8;
      left += headerWidth + gap;
      width = Math.max(1, width - headerWidth - gap);
    }
    const next = clamp(((event.clientX - left) / Math.max(1, width)) * state.duration, 0, state.duration);
    const wasPlaying = state.playing;
    setPosition(next);
    if (wasPlaying && !state.overdub.active) play(next);
  }

  function bindTimelineClips() {
    document.querySelectorAll("#mixer [data-track-clip]").forEach(bindTimelineClip);
    document.querySelectorAll("#mixer .mixer-lane-track, #mixer .mixer-timeline-ruler").forEach((lane) => {
      if (lane.dataset.seekBound === "true") return;
      lane.dataset.seekBound = "true";
      lane.addEventListener("click", (event) => seekFromTimelineEvent(event, lane));
    });
  }

  function applyTimelineScale() {
    const editor = $("mixer")?.querySelector(".mixer-editor");
    const viewport = $("mixerTimelineViewport");
    if (!editor || !viewport) return;
    const trackCount = Math.max(1, state.trackDefs.length);
    const base = window.matchMedia?.("(max-width: 899px)")?.matches ? 46 : 48;
    const viewportHeight = Math.max(220, viewport.getBoundingClientRect().height || 360);
    const usable = Math.max(base, viewportHeight - 52 - Math.max(0, trackCount - 1) * 7);
    const fitScale = clamp(usable / (trackCount * base), 0.72, 2.2);
    const zoomScale = clamp(0.72 + state.timeline.zoom * 0.38, 0.8, 2.05);
    const scale = clamp(Math.min(zoomScale, Math.max(0.82, fitScale * 1.2)), 0.78, 2.05);
    editor.style.setProperty("--timeline-lane-scale", String(scale));
    editor.dataset.zoomDensity = scale < 0.95 ? "compact" : scale > 1.45 ? "large" : "normal";
  }

  function setTimelineZoom(value, anchor = null) {
    const viewport = $("mixerTimelineViewport");
    const content = $("mixerTimelineContent");
    const beforeWidth = content?.scrollWidth || 1;
    const beforeHeight = content?.scrollHeight || 1;
    const x = anchor?.x ?? ((viewport?.clientWidth || 0) / 2);
    const y = anchor?.y ?? ((viewport?.clientHeight || 0) / 2);
    const xRatio = viewport ? (viewport.scrollLeft + x) / beforeWidth : 0;
    const yRatio = viewport ? (viewport.scrollTop + y) / beforeHeight : 0;
    state.timeline.zoom = clamp(value, 0.75, 4);
    applyTimelineScale();
    const select = $("mixerZoom");
    if (select) select.value = String(state.timeline.zoom);
    updateTimeline();
    requestAnimationFrame(() => {
      if (!viewport || !content) return;
      viewport.scrollLeft = Math.max(0, xRatio * content.scrollWidth - x);
      viewport.scrollTop = Math.max(0, yRatio * content.scrollHeight - y);
    });
  }

  function bindTimelineHeaderControls() {
    const rows = $("mixerTimelineRows");
    if (!rows || rows.dataset.controlsBound === "true") return;
    rows.dataset.controlsBound = "true";
    rows.addEventListener("click", (event) => {
      const button = event.target.closest("[data-timeline-action]");
      if (!button) return;
      const key = button.dataset.trackKey;
      const action = button.dataset.timelineAction;
      if (!getTrackDef(key)) return;
      event.preventDefault(); event.stopPropagation();
      if (action === "select") selectTrack(key);
      else if (action === "mute") toggleTrackFlag(key, "muted");
      else if (action === "solo") toggleTrackFlag(key, "solo");
      else if (action === "preview") playOnly(key);
      else if (action === "record") { selectTrack(key); updateRecordTargetUi({ syncStart: true }); setStatus(`‘${getTrackDef(key)?.name || "추가 트랙"}’을 녹음 대상으로 선택했습니다.`, "idle"); }
    });
    rows.addEventListener("input", (event) => {
      const input = event.target.closest("[data-timeline-volume]");
      if (!input) return;
      setTrackValue(input.dataset.timelineVolume, "volume", input.value, { label: `${getTrackDef(input.dataset.timelineVolume)?.name || "트랙"} 음량` });
    });
  }

  function bindTimelineWheelZoom() {
    const viewport = $("mixerTimelineViewport");
    if (!viewport || viewport.dataset.wheelBound === "true") return;
    viewport.dataset.wheelBound = "true";
    viewport.addEventListener("wheel", (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const values = [0.75, 1, 1.25, 1.5, 2, 3, 4];
        const currentIndex = values.reduce((best, value, index) => Math.abs(value - state.timeline.zoom) < Math.abs(values[best] - state.timeline.zoom) ? index : best, 0);
        const nextIndex = clamp(currentIndex + (event.deltaY < 0 ? 1 : -1), 0, values.length - 1);
        const rect = viewport.getBoundingClientRect();
        setTimelineZoom(values[nextIndex], { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else if (event.shiftKey) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaY || event.deltaX;
      }
    }, { passive: false });
  }

  function timelineHeightStorageKey() {
    return `hoonMusicTool.mixerTimelineHeight.${window.matchMedia?.("(max-width: 899px)")?.matches ? "mobile" : "desktop"}`;
  }

  function applyTimelineHeight(value, { save = false } = {}) {
    const viewport = $("mixerTimelineViewport");
    if (!viewport) return;
    const min = window.matchMedia?.("(max-width: 899px)")?.matches ? 220 : 260;
    const max = Math.max(min, Math.min(820, Math.round(window.innerHeight * 0.78)));
    const height = Math.round(clamp(value, min, max));
    viewport.style.height = `${height}px`;
    applyTimelineScale();
    if (save) { try { localStorage.setItem(timelineHeightStorageKey(), String(height)); } catch {} }
  }

  function restoreTimelineHeight() {
    let saved = 0;
    try { saved = Number(localStorage.getItem(timelineHeightStorageKey())) || 0; } catch {}
    applyTimelineHeight(saved || (window.matchMedia?.("(max-width: 899px)")?.matches ? 300 : 360));
  }

  function bindTimelineResize() {
    const handle = $("mixerTimelineResizeHandle");
    const viewport = $("mixerTimelineViewport");
    if (!handle || !viewport || handle.dataset.resizeBound === "true") return;
    handle.dataset.resizeBound = "true";
    handle.addEventListener("pointerdown", (event) => {
      state.timeline.resize = { startY: event.clientY, startHeight: viewport.getBoundingClientRect().height, pointerId: event.pointerId };
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add("is-resizing-mixer-timeline");
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!state.timeline.resize || state.timeline.resize.pointerId !== event.pointerId) return;
      applyTimelineHeight(state.timeline.resize.startHeight + event.clientY - state.timeline.resize.startY);
      event.preventDefault();
    });
    const end = (event) => {
      if (!state.timeline.resize || state.timeline.resize.pointerId !== event.pointerId) return;
      const height = viewport.getBoundingClientRect().height;
      state.timeline.resize = null;
      document.body.classList.remove("is-resizing-mixer-timeline");
      applyTimelineHeight(height, { save: true });
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => { applyTimelineHeight(window.matchMedia?.("(max-width: 899px)")?.matches ? 300 : 360, { save: true }); });
  }

  function setTimelineSnap(value) {
    state.timeline.snapMs = [10, 50, 100].includes(Number(value)) ? Number(value) : 10;
    BASE_KEYS.forEach((key) => {
      const range = $(`${basePrefix(key)}Offset`); const number = $(`${basePrefix(key)}OffsetNumber`);
      if (range) range.step = String(state.timeline.snapMs); if (number) number.step = String(state.timeline.snapMs);
    });
    document.querySelectorAll('#mixerExtraTrackGrid [data-field="offsetMs"], #mixerExtraTrackGrid [data-number="offsetMs"]').forEach((input) => { input.step = String(state.timeline.snapMs); });
    if ($("mixerClipPosition")) $("mixerClipPosition").step = String(state.timeline.snapMs);
    if ($("mixerQuickOffset")) $("mixerQuickOffset").step = String(state.timeline.snapMs);
  }

  async function deleteExtraTrack(def) {
    if (!state.recording || !def.data) return;
    if (!confirm(`‘${def.name}’ 트랙을 삭제할까요? 원본 녹음 파일도 함께 삭제됩니다.`)) return;
    try {
      const updated = await state.callbacks.removeExtraTrack?.(state.recording, def.data.id);
      if (updated) await loadRecording(updated);
      setStatus("추가 트랙을 삭제했습니다.", "idle");
    } catch (error) { setStatus(`트랙을 삭제하지 못했습니다: ${error.message}`, "error"); }
  }

  function toggleCompare() {
    if (!state.originalBuffer || state.overdub.active) return; const position = currentPosition(); state.compareOriginal = !state.compareOriginal; updateButtons();
    if (state.playing) { stop({ preservePosition: true, silent: true, keepOverdub: true }); play(position); }
    else setStatus(state.compareOriginal ? "원본 믹스 비교 모드입니다." : "현재 믹서 설정 모드입니다.", "idle");
  }

  function getRenderableTracks() {
    const model = timelineModel();
    const tracks = [];
    state.trackDefs.forEach((def) => {
      const buffer = state.buffers[def.key];
      if (!buffer) return;
      (model.clipsByTrack[def.key] || []).forEach((clipWindow, index) => {
        tracks.push({
          key: def.key,
          settingsKey: def.key,
          clipId: clipWindow.clipId,
          label: `${def.name} ${index + 1}`,
          buffer,
          startSec: clipWindow.startSec,
          trimStartSec: clipWindow.sourceStartSec,
          trimEndSec: Math.max(0, buffer.duration - clipWindow.sourceEndSec),
          playableDuration: clipWindow.duration,
          clipVolume: clipWindow.volume,
          clipMuted: Boolean(clipWindow.muted),
          clipFadeIn: clipWindow.fadeIn,
          clipFadeOut: clipWindow.fadeOut
        });
      });
    });
    return tracks;
  }

  function setExportProgress(stage, ratio) {
    const progress = $("mixerExportProgress"); if (progress) { progress.hidden = false; progress.value = Math.round(clamp(ratio, 0, 1) * 100); }
    const labels = { rendering: "믹스를 계산하고 있습니다.", analyzing: "출력 피크를 검사하고 있습니다.", encoding: "WAV 파일로 변환하고 있습니다.", done: "WAV 믹스를 완성했습니다." };
    if ($("mixerExportStatus") && labels[stage]) $("mixerExportStatus").textContent = labels[stage];
  }

  async function exportWav() {
    if (state.exporting || !state.recording || !window.HoonMixRenderer) return;
    const tracks = getRenderableTracks(); if (!tracks.length) return;
    stop({ preservePosition: true, silent: true, keepOverdub: true }); revokeExport(); state.exporting = true; updateAvailability();
    if ($("mixerExportWav")) $("mixerExportWav").textContent = "믹스 생성 중";
    try {
      const mobile = window.matchMedia?.("(max-width: 899px)")?.matches;
      const result = await window.HoonMixRenderer.render({ tracks, settings: state.settings, masterVolume: state.settings.masterVolume, sampleRate: 44100, useLimiter: true, maxDurationSeconds: mobile ? 480 : 900, onProgress: setExportProgress });
      const wav = await window.HoonMixRenderer.encodeWav(result.buffer, { onProgress: setExportProgress });
      state.exportBlob = wav; state.exportUrl = URL.createObjectURL(wav);
      if ($("mixerExportAudio")) $("mixerExportAudio").src = state.exportUrl;
      if ($("mixerExportResult")) $("mixerExportResult").hidden = false;
      const badge = $("mixerOutputBadge");
      if (badge) {
        const risky = result.analysis.clippedSamples > 0 || result.analysis.peakDb > -0.3;
        const high = !risky && result.analysis.peakDb > -1.2;
        badge.dataset.state = risky ? "danger" : high ? "warn" : "ok";
        badge.textContent = risky ? "클리핑 위험" : high ? "출력 높음" : "출력 정상";
      }
      const peakText = Number.isFinite(result.analysis.peakDb) ? `${result.analysis.peakDb.toFixed(1)}dBFS` : "무음";
      if ($("mixerExportStatus")) $("mixerExportStatus").textContent = `WAV 완성 · ${formatTime(result.duration)} · 피크 ${peakText}`;
      state.callbacks.recordExport?.(state.recording, { filename: `${safeName($("mixerExportName")?.value)}.wav`, createdAt: Date.now(), durationMs: Math.round(result.duration * 1000), peakDb: result.analysis.peakDb });
      setStatus("WAV 믹스를 만들었습니다. 결과를 확인한 뒤 저장하세요.", "idle");
    } catch (error) {
      if ($("mixerOutputBadge")) { $("mixerOutputBadge").dataset.state = "danger"; $("mixerOutputBadge").textContent = "생성 실패"; }
      if ($("mixerExportStatus")) $("mixerExportStatus").textContent = error.message;
      setStatus(`WAV 믹스를 만들지 못했습니다: ${error.message}`, "error");
    } finally {
      state.exporting = false; if ($("mixerExportWav")) $("mixerExportWav").textContent = "WAV 믹스 만들기"; updateAvailability();
    }
  }

  function downloadExport() {
    if (!state.exportUrl || !state.exportBlob) return; const link = document.createElement("a"); link.href = state.exportUrl; link.download = `${safeName($("mixerExportName")?.value)}.wav`; document.body.appendChild(link); link.click(); link.remove();
  }

  function getSelectedExtraDef() {
    const def = getTrackDef(state.timeline.selectedTrackKey);
    return def && !def.base ? def : null;
  }

  function updateRecordModeUi() {
    const mode = $("mixerRecordMode")?.value || "manual";
    const endInput = $("mixerRecordEndPosition");
    const overlap = $("mixerPunchOverlap");
    const useLoop = $("mixerRecordUseLoop");
    if (endInput) endInput.closest("label").hidden = mode !== "punch";
    if (overlap) overlap.closest("label").hidden = mode !== "punch";
    if (useLoop) useLoop.hidden = mode !== "punch";
    const button = $("mixerTrackRecordStart");
    if (button && !state.overdub.active) button.textContent = mode === "punch" ? "● 펀치 녹음" : "● 녹음";
  }

  function updateRecordTargetUi({ syncStart = false } = {}) {
    const def = getSelectedExtraDef();
    const target = $("mixerRecordTarget");
    const startInput = $("mixerRecordStartPosition");
    const endInput = $("mixerRecordEndPosition");
    const max = Math.max(0, state.mixDuration || state.duration || 0);
    if (target) {
      target.textContent = def
        ? `${def.name} · ${state.buffers[def.key] ? "녹음 있음" : "빈 트랙"}`
        : "추가 트랙을 선택해 주세요.";
    }
    if (startInput) {
      startInput.max = String(max);
      if (syncStart && def && !state.overdub.active) startInput.value = String(Number(currentPosition()).toFixed(2));
    }
    if (endInput) {
      endInput.max = String(max);
      if (syncStart && def && !state.overdub.active) endInput.value = String(Math.min(max, currentPosition() + 8).toFixed(2));
    }
    updateRecordModeUi();
  }

  function useCurrentPlayheadForRecording() {
    const input = $("mixerRecordStartPosition");
    if (!input) return;
    input.value = String(Number(currentPosition()).toFixed(2));
    if ($("mixerRecordMode")?.value === "punch" && $("mixerRecordEndPosition")) {
      const max = Math.max(0, state.mixDuration || state.duration || 0);
      $("mixerRecordEndPosition").value = String(Math.min(max, currentPosition() + 8).toFixed(2));
    }
    setStatus(`녹음 시작 위치를 ${formatTime(currentPosition())}로 설정했습니다.`, "idle");
  }

  function useLoopRangeForRecording() {
    if (!loopIsValid()) { setStatus("먼저 반복 시작과 끝을 지정해 주세요.", "error"); return; }
    if ($("mixerRecordMode")) $("mixerRecordMode").value = "punch";
    if ($("mixerRecordStartPosition")) $("mixerRecordStartPosition").value = String(state.timeline.loopStartSec.toFixed(2));
    if ($("mixerRecordEndPosition")) $("mixerRecordEndPosition").value = String(state.timeline.loopEndSec.toFixed(2));
    updateRecordModeUi();
    setStatus(`반복 구간 ${formatTime(state.timeline.loopStartSec)}–${formatTime(state.timeline.loopEndSec)}를 펀치 인 구간으로 설정했습니다.`, "idle");
  }

  function attachEmptyTrack(updated, track) {
    const def = buildTrackDefs(updated).find((entry) => entry.key === getTrackKey(track));
    if (!def) throw new Error("생성된 트랙을 화면에 연결하지 못했습니다.");
    state.recording = updated;
    state.selectedId = String(updated.id);
    if (!state.trackDefs.some((entry) => entry.key === def.key)) state.trackDefs.push(def);
    else state.trackDefs = state.trackDefs.map((entry) => entry.key === def.key ? def : entry);
    state.buffers[def.key] = null;
    if (!state.settings[def.key]) state.settings[def.key] = { ...defaultTrackSettings(def, updated), clips: [] };
    renderExtraStructure();
    calculateDuration();
    renderControls();
    updateMeta();
    selectTrack(def.key, { scroll: false });
  }

  async function addEmptyTrack() {
    if (!state.recording || state.overdub.active || state.exporting || state.addingTrack) return;
    const extraCount = state.trackDefs.filter((def) => !def.base).length;
    if (extraCount >= OVERDUB_MAX_TRACKS) { setStatus(`추가 트랙은 현재 ${OVERDUB_MAX_TRACKS}개까지 지원합니다.`, "error"); return; }
    const name = `트랙 ${extraCount + 1}`;
    const track = {
      id: globalThis.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      blob: null,
      empty: true,
      createdAt: Date.now(),
      durationMs: 0,
      trimStartMs: 0,
      offsetMs: 0
    };
    state.addingTrack = true;
    updateAvailability();
    if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = "빈 트랙을 추가하는 중입니다…";
    try {
      if (typeof state.callbacks.createEmptyTrack !== "function") throw new Error("트랙 저장 기능이 연결되지 않았습니다.");
      const updated = await state.callbacks.createEmptyTrack(state.recording, track);
      if (!updated || !(Array.isArray(updated.extraTracks) && updated.extraTracks.some((entry) => String(entry.id) === String(track.id)))) {
        throw new Error("트랙 저장 결과를 확인하지 못했습니다.");
      }
      attachEmptyTrack(updated, track);
      setStatus(`‘${name}’ 빈 트랙을 추가했습니다.`, "idle");
      if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = "새 트랙이 선택되었습니다. 재생선을 옮긴 뒤 녹음을 누르세요.";
    } catch (error) {
      setStatus(`빈 트랙을 추가하지 못했습니다: ${error.message}`, "error");
      if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = `트랙 추가 실패 · ${error.message}`;
    } finally {
      state.addingTrack = false;
      updateAvailability();
    }
  }

  function toggleRecordOptions() {
    const panel = $("mixerRecordOptions");
    const button = $("mixerRecordOptionsToggle");
    if (!panel || !button) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
    button.textContent = willOpen ? "설정 닫기" : "설정";
  }

  function preferredMimeType() {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  function scheduleCountIn(context, startAt) {
    state.overdub.countInNodes = [];
    for (let count = 3; count >= 1; count -= 1) {
      const when = startAt - count; if (when < context.currentTime) continue;
      const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = count === 1 ? 1040 : 820;
      gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(0.18, when + 0.006); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(when); oscillator.stop(when + 0.11); state.overdub.countInNodes.push(oscillator, gain);
    }
  }

  function cleanupOverdub() {
    clearInterval(state.overdub.timerId); clearTimeout(state.overdub.autoStopTimer); cancelAnimationFrame(state.overdub.levelFrame);
    state.overdub.countInNodes.forEach((node) => { try { node.stop?.(); } catch {} try { node.disconnect?.(); } catch {} });
    try { state.overdub.source?.disconnect(); } catch {} try { state.overdub.gate?.disconnect(); } catch {} try { state.overdub.analyser?.disconnect(); } catch {}
    state.overdub.stream?.getTracks?.().forEach((track) => track.stop());
    Object.assign(state.overdub, { active: false, recorder: null, stream: null, chunks: [], source: null, gate: null, destination: null, analyser: null, levelData: null, levelFrame: null, startAt: 0, recorderStartAt: 0, timerId: null, autoStopTimer: null, countInNodes: [], stopping: false, targetTrackId: "", recordStartSec: 0, recordEndSec: 0, monitorStartSec: 0, timelineRawStartSec: 0, mode: "manual", overlapMode: "keep" });
    if ($("mixerOverdubTimer")) $("mixerOverdubTimer").textContent = "00:00";
    if ($("mixerOverdubLevel")) $("mixerOverdubLevel").style.width = "0%";
    updateAvailability();
  }

  function runOverdubLevel() {
    const overdub = state.overdub; if (!overdub.active || !overdub.analyser || !overdub.levelData) return;
    overdub.analyser.getByteTimeDomainData(overdub.levelData); let sum = 0;
    overdub.levelData.forEach((value) => { const normalized = (value - 128) / 128; sum += normalized * normalized; });
    const level = clamp(Math.sqrt(sum / overdub.levelData.length) * 420, 1, 100); if ($("mixerOverdubLevel")) $("mixerOverdubLevel").style.width = `${level}%`;
    overdub.levelFrame = requestAnimationFrame(runOverdubLevel);
  }

  function punchAdjustedClips(trackKey, startSec, endSec, mode) {
    const settings = state.settings[trackKey];
    if (!settings || !["mute", "replace"].includes(mode)) return false;
    const model = timelineModel();
    const windows = model.clipsByTrack[trackKey] || [];
    const sourceClips = Array.isArray(settings.clips) ? settings.clips : [];
    const next = [];
    let changed = false;
    sourceClips.forEach((clip) => {
      const windowClip = windows.find((entry) => String(entry.clipId) === String(clip.id));
      if (!windowClip || windowClip.endSec <= startSec || windowClip.startSec >= endSec) { next.push(clip); return; }
      changed = true;
      if (mode === "mute") { next.push({ ...clip, muted: true }); return; }
      const overlapStart = Math.max(startSec, windowClip.startSec);
      const overlapEnd = Math.min(endSec, windowClip.endSec);
      const leftDuration = Math.max(0, overlapStart - windowClip.startSec);
      const middleDuration = Math.max(0, overlapEnd - overlapStart);
      const rightDuration = Math.max(0, windowClip.endSec - overlapEnd);
      const makePart = (sourceStartSec, sourceEndSec, timelineStartSec, muted, suffix) => ({
        ...clip,
        id: suffix === "left" ? clip.id : window.HoonTimeline?.makeId?.("clip") || `${clip.id}-${suffix}-${Date.now()}`,
        sourceStartSec,
        sourceEndSec,
        timelineStartSec,
        muted,
        fadeIn: Math.min(Number(clip.fadeIn) || 0, Math.max(0, (sourceEndSec - sourceStartSec) / 2)),
        fadeOut: Math.min(Number(clip.fadeOut) || 0, Math.max(0, (sourceEndSec - sourceStartSec) / 2))
      });
      if (leftDuration >= 0.05) next.push(makePart(clip.sourceStartSec, clip.sourceStartSec + leftDuration, clip.timelineStartSec, Boolean(clip.muted), "left"));
      if (middleDuration >= 0.05) {
        const middle = makePart(clip.sourceStartSec + leftDuration, clip.sourceStartSec + leftDuration + middleDuration, clip.timelineStartSec + leftDuration, true, "middle");
        middle.name = `${clip.name || "클립"} · 교체 전`;
        next.push(middle);
      }
      if (rightDuration >= 0.05) next.push(makePart(clip.sourceEndSec - rightDuration, clip.sourceEndSec, clip.timelineStartSec + leftDuration + middleDuration, Boolean(clip.muted), "right"));
    });
    if (changed) {
      settings.clips = next.sort((a, b) => a.timelineStartSec - b.timelineStartSec);
      settings.clipModelVersion = 1;
    }
    return changed;
  }

  async function startOverdub(options = {}) {
    if (state.overdub.active || !state.recording) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setStatus("추가 트랙 녹음은 HTTPS 또는 PC 실행 파일의 최신 Chrome·Edge에서 사용할 수 있습니다.", "error"); return; }
    const targetDef = getSelectedExtraDef();
    if (!targetDef?.data?.id) { setStatus("먼저 + 버튼으로 트랙을 추가하고 녹음 대상을 선택해 주세요.", "error"); return; }
    const mode = $("mixerRecordMode")?.value === "punch" ? "punch" : "manual";
    const extraCount = state.trackDefs.filter((def) => !def.base).length;
    if (mode === "punch" && state.buffers[targetDef.key] && extraCount >= OVERDUB_MAX_TRACKS) { setStatus(`펀치 테이크를 보존하려면 빈 트랙 자리가 필요합니다. 추가 트랙은 현재 ${OVERDUB_MAX_TRACKS}개까지 지원합니다.`, "error"); return; }
    if (mode === "manual" && state.buffers[targetDef.key] && !confirm(`‘${targetDef.name}’ 트랙의 기존 녹음을 새 녹음으로 교체할까요?`)) return;
    const maxStart = Math.max(0, state.mixDuration || state.duration || 0);
    const requestedStart = Number(String($("mixerRecordStartPosition")?.value ?? "").trim());
    const recordStartSec = clamp(Number.isFinite(requestedStart) ? requestedStart : currentPosition(), 0, maxStart);
    const requestedEnd = Number(String($("mixerRecordEndPosition")?.value ?? "").trim());
    const recordEndSec = mode === "punch" ? clamp(Number.isFinite(requestedEnd) ? requestedEnd : recordStartSec + 8, 0, maxStart) : maxStart;
    if (maxStart - recordStartSec < 0.25) { setStatus("녹음 시작 위치가 곡의 끝과 너무 가깝습니다.", "error"); return; }
    if (mode === "punch" && recordEndSec - recordStartSec < 0.25) { setStatus("펀치 인 종료 위치는 시작 위치보다 0.25초 이상 뒤여야 합니다.", "error"); return; }
    const overlapMode = mode === "punch" ? ($("mixerPunchOverlap")?.value || "keep") : "keep";
    state.callbacks.stopOtherAudio?.(); stop({ silent: true, keepOverdub: true });
    try {
      const context = ensureContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      const source = context.createMediaStreamSource(stream); const gate = context.createGain(); const destination = context.createMediaStreamDestination(); const analyser = context.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.65;
      gate.gain.value = 0; source.connect(gate); gate.connect(destination); source.connect(analyser);
      const mimeType = preferredMimeType(); const recorder = mimeType ? new MediaRecorder(destination.stream, { mimeType }) : new MediaRecorder(destination.stream);
      const countIn = $("mixerOverdubCountIn")?.checked ? 3 : 0;
      const preRollSec = countIn ? Math.min(3, recordStartSec) : 0;
      const countdownOnlySec = countIn ? Math.max(0, 3 - preRollSec) : 0;
      const monitorStartSec = Math.max(0, recordStartSec - preRollSec);
      const recorderStartAt = context.currentTime;
      const monitorAt = recorderStartAt + 0.16 + countdownOnlySec;
      const startAt = monitorAt + (recordStartSec - monitorStartSec);
      const currentModel = timelineModel();
      Object.assign(state.overdub, {
        active: true, recorder, stream, chunks: [], source, gate, destination, analyser,
        levelData: new Uint8Array(analyser.fftSize), startAt, recorderStartAt, stopping: false,
        targetTrackId: String(targetDef.data.id), recordStartSec, recordEndSec, monitorStartSec,
        timelineRawStartSec: recordStartSec - Number(currentModel.shiftSec || 0), mode, overlapMode
      });
      recorder.ondataavailable = (event) => { if (event.data?.size) state.overdub.chunks.push(event.data); };
      recorder.onerror = (event) => setStatus(`추가 트랙 녹음 오류: ${event.error?.message || "알 수 없는 오류"}`, "error");
      recorder.start(500); gate.gain.setValueAtTime(0, context.currentTime); gate.gain.setValueAtTime(1, startAt);
      gate.gain.setValueAtTime(0, startAt + Math.max(0.25, recordEndSec - recordStartSec));
      if (countIn) scheduleCountIn(context, startAt);
      startPlaybackAt(monitorStartSec, monitorAt, { overdub: true, excludeTrackKey: targetDef.key, stopAtSec: recordEndSec });
      const timerTick = () => {
        const elapsed = Math.max(0, context.currentTime - startAt);
        if ($("mixerOverdubTimer")) $("mixerOverdubTimer").textContent = context.currentTime < startAt ? `-${formatTime(startAt - context.currentTime)}` : formatTime(elapsed);
      };
      state.overdub.timerId = window.setInterval(timerTick, 100); timerTick();
      const recordDuration = Math.max(0.25, recordEndSec - recordStartSec);
      state.overdub.autoStopTimer = window.setTimeout(() => finishOverdub(), Math.max(500, (startAt - context.currentTime + recordDuration) * 1000 + 160));
      runOverdubLevel(); updateAvailability(); updateMediaSession("recording");
      const label = mode === "punch" ? `${formatTime(recordStartSec)}–${formatTime(recordEndSec)} 펀치 인` : `${formatTime(recordStartSec)}부터`;
      setStatus(`${label} ‘${targetDef.name}’ 녹음을 준비합니다.`, "recording");
      if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = countIn ? `${formatTime(monitorStartSec)}부터 미리 재생하고 ${formatTime(recordStartSec)}에서 녹음합니다.` : `${formatTime(recordStartSec)}에서 곧 녹음합니다.`;
      state.callbacks.transportUpdate?.(state.recording.name || "믹서", `${targetDef.name} ${mode === "punch" ? "펀치 인" : "구간"} 녹음 중`, true, "recording");
    } catch (error) { cleanupOverdub(); stop({ silent: true, keepOverdub: true }); updateMediaSession("none"); setStatus(`선택 트랙 녹음을 시작하지 못했습니다: ${error.message}`, "error"); }
  }

  async function finishOverdub() {
    const overdub = state.overdub; if (!overdub.active || overdub.stopping) return; overdub.stopping = true;
    clearTimeout(overdub.autoStopTimer); try { overdub.gate?.gain?.setValueAtTime(0, state.context?.currentTime || 0); } catch {}
    stop({ preservePosition: false, silent: true, keepOverdub: true });
    const recorder = overdub.recorder; const chunks = overdub.chunks; const startAt = overdub.startAt; const recorderStartAt = overdub.recorderStartAt;
    const targetTrackId = overdub.targetTrackId; const recordStartSec = overdub.recordStartSec; const recordEndSec = overdub.recordEndSec; const timelineRawStartSec = overdub.timelineRawStartSec;
    const mode = overdub.mode; const overlapMode = overdub.overlapMode;
    const targetDef = state.trackDefs.find((def) => !def.base && String(def.data?.id) === String(targetTrackId));
    try {
      const stopped = new Promise((resolve) => { if (!recorder || recorder.state === "inactive") resolve(); else recorder.addEventListener("stop", resolve, { once: true }); });
      if (recorder && recorder.state !== "inactive") recorder.stop(); await stopped;
      const mimeType = recorder?.mimeType || chunks[0]?.type || "audio/webm"; const blob = new Blob(chunks, { type: mimeType });
      const intendedMs = Math.max(0, (recordEndSec - recordStartSec) * 1000);
      const actualMs = Math.max(0, ((state.context?.currentTime || startAt) - startAt) * 1000);
      const durationMs = Math.max(0, Math.min(intendedMs || actualMs, actualMs));
      if (!blob.size || durationMs < 250) throw new Error("녹음된 내용이 너무 짧습니다.");
      const basePatch = {
        blob, mimeType, empty: false, recordedAt: Date.now(), durationMs,
        trimStartMs: Math.max(0, Math.round((startAt - recorderStartAt) * 1000)),
        offsetMs: 0, timelineStartSec: timelineRawStartSec,
        punchInSec: mode === "punch" ? recordStartSec : null,
        punchOutSec: mode === "punch" ? recordStartSec + durationMs / 1000 : null
      };
      let updated;
      let selectedTrackId = targetTrackId;
      if (mode === "punch") {
        if (!state.buffers[targetDef.key]) {
          updated = await state.callbacks.updateExtraTrack?.(state.recording, targetTrackId, { ...basePatch, takeType: "punch" }, { resetMix: true });
        } else {
          rememberEdit(`${targetDef?.name || "트랙"} 펀치 인`, `punch:${targetDef?.key || targetTrackId}`);
          const changed = punchAdjustedClips(targetDef.key, recordStartSec, recordStartSec + durationMs / 1000, overlapMode);
          let recordingBase = state.recording;
          if (changed) recordingBase = await state.callbacks.saveSettings?.(state.recording, clone(state.settings)) || state.recording;
          const takeId = globalThis.crypto?.randomUUID?.() || `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const take = {
            id: takeId,
            name: `${targetDef?.name || "트랙"} · 펀치 ${formatTime(recordStartSec)}`,
            createdAt: Date.now(), sourceTrackId: targetTrackId, takeType: "punch", ...basePatch
          };
          updated = await state.callbacks.createEmptyTrack?.(recordingBase, take);
          selectedTrackId = takeId;
        }
      } else {
        updated = await state.callbacks.updateExtraTrack?.(state.recording, targetTrackId, basePatch, { resetMix: true });
      }
      const trackName = targetDef?.name || "추가 트랙";
      cleanupOverdub(); updateMediaSession("none");
      if (updated) { await loadRecording(updated); selectTrack(`extra:${selectedTrackId}`, { scroll: true }); }
      setStatus(mode === "punch" ? `‘${trackName}’의 펀치 테이크를 새 트랙에 안전하게 저장했습니다.` : `‘${trackName}’ 트랙에 ${formatTime(recordStartSec)}부터 녹음을 배치했습니다.`, "idle");
      if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = mode === "punch" ? "원본은 보존했습니다. 새 펀치 테이크와 기존 클립을 비교해 선택하세요." : "녹음을 저장했습니다. 파형을 이동하거나 분할해 세부 위치를 조절할 수 있습니다.";
    } catch (error) { cleanupOverdub(); updateMediaSession("none"); setStatus(`선택 트랙 녹음을 저장하지 못했습니다: ${error.message}`, "error"); }
  }

  function bindClipInspector() {
    $("mixerSplitClip")?.addEventListener("click", splitSelectedClip);
    $("mixerMuteClip")?.addEventListener("click", () => toggleSelectedClipMute());
    $("mixerDeleteClip")?.addEventListener("click", deleteSelectedClip);
    $("mixerLoopStart")?.addEventListener("click", () => setLoopBoundary("start"));
    $("mixerLoopEnd")?.addEventListener("click", () => setLoopBoundary("end"));
    $("mixerLoopToggle")?.addEventListener("click", toggleLoop);
    $("mixerClipPosition")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "timelineStartSec", Number(event.target.value) / 1000, { label: `${selected.def.name} 클립 위치` });
    });
    $("mixerClipSourceStart")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "sourceStartSec", event.target.value, { label: `${selected.def.name} 클립 앞 자르기` });
    });
    $("mixerClipSourceEnd")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "sourceEndSec", event.target.value, { label: `${selected.def.name} 클립 뒤 자르기` });
    });
    $("mixerClipVolume")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "volume", Number(event.target.value) / 100, { label: `${selected.def.name} 클립 음량` });
    });
    $("mixerClipFadeIn")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "fadeIn", event.target.value, { label: `${selected.def.name} 클립 페이드인` });
    });
    $("mixerClipFadeOut")?.addEventListener("change", (event) => {
      const selected = getSelectedClip(); if (!selected) return;
      setClipValue(selected.trackKey, selected.clip.id, "fadeOut", event.target.value, { label: `${selected.def.name} 클립 페이드아웃` });
    });
  }

  function bindMaster() {
    const range = $("mixerMasterVolume"); const number = $("mixerMasterVolumeNumber");
    range?.addEventListener("input", (event) => {
      rememberEdit("마스터 음량", "master:volume"); if (number) number.value = event.target.value;
      state.settings.masterVolume = clamp(Number(event.target.value) / 100, 0, 1.5); renderControls(); updateLiveNodes(); scheduleSave();
    });
    number?.addEventListener("change", (event) => {
      rememberEdit("마스터 음량", "master:volume"); const next = clamp(event.target.value, 0, 150); if (range) range.value = String(next);
      state.settings.masterVolume = next / 100; renderControls(); updateLiveNodes(); scheduleSave();
    });
  }

  function init(callbacks = {}) {
    if (state.initialized) return; state.callbacks = callbacks;
    $("mixerRecordingSelect")?.addEventListener("change", (event) => selectRecording(event.target.value));
    $("mixerPlay")?.addEventListener("click", toggle); $("mixerStop")?.addEventListener("click", () => stop()); $("mixerCompare")?.addEventListener("click", toggleCompare); $("mixerReset")?.addEventListener("click", resetSettings);
    $("mixerUndo")?.addEventListener("click", undoEdit); $("mixerRedo")?.addEventListener("click", redoEdit);
    $("mixerZoom")?.addEventListener("change", (event) => setTimelineZoom(event.target.value));
    $("mixerSnap")?.addEventListener("change", (event) => setTimelineSnap(event.target.value));
    bindMaster(); bindClipInspector(); bindQuickTrackInspector(); BASE_KEYS.forEach(bindBaseTrack); bindTimelineClips(); bindTimelineHeaderControls(); bindTimelineWheelZoom(); bindTimelineResize(); restoreTimelineHeight(); setTimelineSnap($("mixerSnap")?.value || 10);
    const seek = $("mixerSeek"); seek?.addEventListener("pointerdown", () => { state.seeking = true; });
    seek?.addEventListener("input", () => { state.seeking = true; state.position = clamp(seek.value, 0, state.duration); updateTimeUi(); });
    ["change", "pointerup", "pointercancel"].forEach((eventName) => seek?.addEventListener(eventName, () => { const wasPlaying = state.playing; const next = clamp(seek.value, 0, state.duration); state.seeking = false; state.position = next; if (wasPlaying && !state.overdub.active) play(next); else updateTimeUi(); }));
    $("mixerExportWav")?.addEventListener("click", exportWav); $("mixerExportDownload")?.addEventListener("click", downloadExport);
    $("mixerAddTrack")?.addEventListener("click", addEmptyTrack);
    $("mixerSaveRetry")?.addEventListener("click", retryCurrentSave);
    $("mixerRecordOptionsToggle")?.addEventListener("click", toggleRecordOptions);
    $("mixerRecordMode")?.addEventListener("change", updateRecordModeUi);
    $("mixerRecordUsePlayhead")?.addEventListener("click", useCurrentPlayheadForRecording);
    $("mixerRecordUseLoop")?.addEventListener("click", useLoopRangeForRecording);
    $("mixerTrackRecordStart")?.addEventListener("click", () => startOverdub()); $("mixerTrackRecordStop")?.addEventListener("click", finishOverdub);
    document.addEventListener("keydown", (event) => {
      const mixerActive = $("mixer")?.classList.contains("is-active");
      if (!mixerActive || event.target.closest("input,textarea,select,[contenteditable=true]") || state.overdub.active) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.shiftKey ? redoEdit() : undoEdit(); event.preventDefault(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { redoEdit(); event.preventDefault(); }
      else if (event.key.toLowerCase() === "s") { splitSelectedClip(); event.preventDefault(); }
      else if (["Delete", "Backspace"].includes(event.key) && getSelectedClip()) { deleteSelectedClip(); event.preventDefault(); }
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        if (state.context?.state === "suspended" && (state.playing || state.overdub.active)) state.context.resume?.().catch?.(() => {});
        if (state.overdub.active) {
          const punchDuration = Math.max(0, state.overdub.recordEndSec - state.overdub.recordStartSec);
          if (punchDuration && (state.context?.currentTime || 0) >= state.overdub.startAt + punchDuration) finishOverdub();
          else updateMediaSession("recording");
        } else if (state.playing) {
          const end = state.compareOriginal ? state.originalBuffer?.duration || state.duration : state.mixDuration;
          if (currentPosition() >= end - 0.02) stop({ preservePosition: false, silent: true });
          else updateMediaSession("playing");
        }
        updateTimeUi();
      }
    });
    window.addEventListener("resize", () => { updateTimeline(); const viewport = $("mixerTimelineViewport"); if (viewport) applyTimelineHeight(viewport.getBoundingClientRect().height); applyTimelineScale(); });
    window.addEventListener("beforeunload", (event) => {
      if (hasUnsavedMixerWork() || state.overdub.active || state.exporting) { event.preventDefault(); event.returnValue = ""; }
      revokeExport();
      if (state.overdub.active) { try { state.overdub.recorder?.stop(); } catch {} cleanupOverdub(); }
    });
    bindMediaSession();
    state.initialized = true; refresh(); renderControls(); updateAvailability(); updateRecordModeUi(); setStatus("트랙이 있는 녹음을 선택해 주세요.", "idle");
  }

  function isPlaying() { return state.playing; }
  function isRecording() { return state.overdub.active; }
  function getSelectedId() { return state.selectedId; }

  window.HoonMixer = { init, refresh, selectRecording, play, pause, stop, toggle, isPlaying, isRecording, getSelectedId, startOverdub, finishOverdub, flushSaveQueue, hasUnsavedMixerWork };
})();
