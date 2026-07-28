"use strict";

(() => {
  const BASE_KEYS = ["mr", "vocal"];
  const DEFAULT_TRACK = { volume: 1, pan: 0, offsetMs: 0, muted: false, solo: false, fadeIn: 0, fadeOut: 0 };
  const DEFAULT_SETTINGS = { mr: { ...DEFAULT_TRACK, volume: 0.8 }, vocal: { ...DEFAULT_TRACK }, masterVolume: 0.9 };
  const OVERDUB_MAX_TRACKS = 6;

  const state = {
    callbacks: {}, recording: null, selectedId: "", trackDefs: [], buffers: {}, originalBuffer: null,
    sources: {}, nodes: { master: null, limiter: null, original: null }, settings: clone(DEFAULT_SETTINGS),
    context: null, loadingToken: 0, playing: false, compareOriginal: false, startAt: 0, startPosition: 0,
    position: 0, duration: 0, mixDuration: 0, frameId: null, endTimer: null, saveTimer: null,
    restartTimer: null, seeking: false, initialized: false, exportUrl: "", exportBlob: null, exporting: false,
    overdub: {
      active: false, recorder: null, stream: null, chunks: [], source: null, gate: null, destination: null,
      analyser: null, levelData: null, levelFrame: null, startAt: 0, recorderStartAt: 0, timerId: null,
      autoStopTimer: null, countInNodes: [], stopping: false
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
      if (!(track?.blob instanceof Blob)) return;
      defs.push({
        key: getTrackKey(track), kind: "extra", name: String(track.name || `추가 트랙 ${index + 1}`).slice(0, 40),
        blob: track.blob, trimStartSec: Math.max(0, Number(track.trimStartMs || 0) / 1000), base: false, data: track
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
      result[def.key] = { ...fallback, ...(saved[def.key] || {}) };
      result[def.key].volume = clamp(result[def.key].volume, 0, 1.5);
      result[def.key].pan = clamp(result[def.key].pan, -1, 1);
      result[def.key].offsetMs = clamp(Math.round(Number(result[def.key].offsetMs || 0) / 10) * 10, -1000, 1000);
      result[def.key].fadeIn = clamp(result[def.key].fadeIn, 0, 10);
      result[def.key].fadeOut = clamp(result[def.key].fadeOut, 0, 10);
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

  function setSaveState(mode, text) {
    const element = $("mixerSaveState");
    if (!element) return;
    element.dataset.state = mode;
    element.textContent = text || (mode === "dirty" ? "변경됨" : mode === "saving" ? "저장 중" : mode === "error" ? "저장 오류" : "저장됨");
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
    Object.keys(state.nodes).forEach((key) => {
      const nodes = state.nodes[key];
      if (!nodes) return;
      if (nodes && typeof nodes === "object" && !nodes.disconnect) {
        Object.values(nodes).forEach((node) => { try { node?.disconnect?.(); } catch {} });
      } else {
        try { nodes.disconnect?.(); } catch {}
      }
    });
    state.nodes = { master: null, limiter: null, original: null };
  }

  function trackPlayableDuration(def) {
    const buffer = state.buffers[def.key];
    if (!buffer) return 0;
    return Math.max(0, buffer.duration - clamp(def.trimStartSec || 0, 0, buffer.duration));
  }

  function effectiveTrackStarts() {
    const available = state.trackDefs.filter((def) => state.buffers[def.key]);
    const raw = available.map((def) => Number(state.settings[def.key]?.offsetMs || 0) / 1000);
    const minOffset = Math.min(0, ...raw);
    const starts = { shift: -minOffset };
    state.trackDefs.forEach((def) => { starts[def.key] = Number(state.settings[def.key]?.offsetMs || 0) / 1000 - minOffset; });
    return starts;
  }

  function calculateDuration() {
    const starts = effectiveTrackStarts();
    state.mixDuration = Math.max(0, ...state.trackDefs.map((def) => state.buffers[def.key] ? starts[def.key] + trackPlayableDuration(def) : 0));
    state.duration = Math.max(state.mixDuration, state.originalBuffer?.duration || 0);
    const seek = $("mixerSeek");
    if (seek) seek.max = String(Math.max(0.01, state.duration));
    updateTimeline();
    updateTimeUi();
  }

  function currentPosition() {
    if (!state.playing || !state.context) return clamp(state.position, 0, state.duration);
    return clamp(state.startPosition + Math.max(0, state.context.currentTime - state.startAt), 0, state.duration);
  }

  function updateTimeUi() {
    const position = currentPosition();
    const seek = $("mixerSeek");
    if (seek && !state.seeking) seek.value = String(position);
    if ($("mixerCurrentTime")) $("mixerCurrentTime").textContent = formatTime(position);
    if ($("mixerDuration")) $("mixerDuration").textContent = formatTime(state.duration);
    const timeline = document.querySelector("#mixer .mixer-timeline");
    if (timeline) timeline.style.setProperty("--mixer-progress", String(state.duration ? position / state.duration : 0));
  }

  function animationLoop() {
    updateTimeUi();
    if (state.playing) state.frameId = requestAnimationFrame(animationLoop);
  }

  function setLaneClip(clip, def, starts) {
    const buffer = state.buffers[def.key];
    if (!clip) return;
    if (!buffer || !state.duration) { clip.hidden = true; return; }
    clip.hidden = false;
    const start = starts[def.key];
    clip.style.left = `${(start / state.duration) * 100}%`;
    clip.style.width = `${Math.max(1.2, (trackPlayableDuration(def) / state.duration) * 100)}%`;
    clip.title = `${def.name} · ${formatTime(trackPlayableDuration(def))}`;
  }

  function updateTimeline() {
    const starts = effectiveTrackStarts();
    const mr = getTrackDef("mr");
    const vocal = getTrackDef("vocal");
    if (mr) setLaneClip($("mixerMrClip"), mr, starts); else if ($("mixerMrClip")) $("mixerMrClip").hidden = true;
    if (vocal) setLaneClip($("mixerVocalClip"), vocal, starts); else if ($("mixerVocalClip")) $("mixerVocalClip").hidden = true;
    state.trackDefs.filter((def) => !def.base).forEach((def) => setLaneClip(findDataElement("data-extra-clip", def.key), def, starts));
  }

  function anySolo() { return getTrackKeys().some((key) => Boolean(state.settings[key]?.solo)); }
  function effectiveGain(key) {
    const settings = state.settings[key] || DEFAULT_TRACK;
    return settings.muted || (anySolo() && !settings.solo) ? 0 : clamp(settings.volume, 0, 1.5);
  }

  function updateLiveNodes() {
    const now = state.context?.currentTime || 0;
    getTrackKeys().forEach((key) => {
      const nodes = state.nodes[key];
      if (!nodes) return;
      nodes.controlGain.gain.setTargetAtTime(effectiveGain(key), now, 0.015);
      if (nodes.panner?.pan) nodes.panner.pan.setTargetAtTime(clamp(state.settings[key]?.pan || 0, -1, 1), now, 0.015);
    });
    state.nodes.master?.gain?.setTargetAtTime(clamp(state.settings.masterVolume, 0, 1.5), now, 0.015);
  }

  function applyFadeEnvelope(def, nodes, when, contentOffset, playableDuration) {
    const settings = state.settings[def.key] || DEFAULT_TRACK;
    const total = trackPlayableDuration(def);
    const fadeIn = clamp(settings.fadeIn, 0, Math.min(10, total));
    const fadeOut = clamp(settings.fadeOut, 0, Math.min(10, total));
    const param = nodes.fadeGain.gain;
    let initial = 1;
    if (fadeIn > 0 && contentOffset < fadeIn) initial = Math.min(initial, contentOffset / fadeIn);
    if (fadeOut > 0 && total - contentOffset < fadeOut) initial = Math.min(initial, (total - contentOffset) / fadeOut);
    param.cancelScheduledValues(when);
    param.setValueAtTime(clamp(initial, 0, 1), when);
    if (fadeIn > 0 && contentOffset < fadeIn) param.linearRampToValueAtTime(1, when + Math.min(playableDuration, fadeIn - contentOffset));
    if (fadeOut > 0) {
      const fadeStartAfter = Math.max(0, total - fadeOut - contentOffset);
      if (fadeStartAfter < playableDuration) {
        param.setValueAtTime(1, when + fadeStartAfter);
        param.linearRampToValueAtTime(0, when + playableDuration);
      }
    }
  }

  function createTrackNodes(key) {
    const context = state.context;
    const fadeGain = context.createGain();
    const controlGain = context.createGain();
    const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : context.createGain();
    fadeGain.connect(controlGain); controlGain.connect(panner); panner.connect(state.nodes.master);
    controlGain.gain.value = effectiveGain(key);
    if (panner.pan) panner.pan.value = clamp(state.settings[key]?.pan || 0, -1, 1);
    return { fadeGain, controlGain, panner };
  }

  function scheduleTrack(def, timelinePosition, startAt, starts) {
    const buffer = state.buffers[def.key];
    if (!buffer) return false;
    const trackStart = starts[def.key];
    let sourceWhen = startAt;
    let contentOffset = timelinePosition - trackStart;
    if (contentOffset < 0) { sourceWhen += -contentOffset; contentOffset = 0; }
    const total = trackPlayableDuration(def);
    if (contentOffset >= total) return false;
    const trim = clamp(def.trimStartSec || 0, 0, buffer.duration);
    const bufferOffset = trim + contentOffset;
    const playableDuration = Math.max(0, total - contentOffset);
    const source = state.context.createBufferSource();
    source.buffer = buffer;
    const nodes = createTrackNodes(def.key);
    source.connect(nodes.fadeGain);
    applyFadeEnvelope(def, nodes, sourceWhen, contentOffset, playableDuration);
    source.start(sourceWhen, bufferOffset, playableDuration);
    state.sources[def.key] = source;
    state.nodes[def.key] = nodes;
    return true;
  }

  function createMasterChain() {
    const context = state.context;
    state.nodes.master = context.createGain();
    state.nodes.master.gain.value = clamp(state.settings.masterVolume, 0, 1.5);
    if (typeof context.createDynamicsCompressor === "function") {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
      state.nodes.master.connect(limiter); limiter.connect(context.destination); state.nodes.limiter = limiter;
    } else state.nodes.master.connect(context.destination);
  }

  function startPlaybackAt(timelinePosition, startAt, options = {}) {
    const context = ensureContext();
    const position = clamp(timelinePosition, 0, state.duration);
    state.position = position >= state.duration - 0.02 ? 0 : position;
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
      const starts = effectiveTrackStarts();
      state.trackDefs.forEach((def) => { if (scheduleTrack(def, state.position, startAt, starts)) scheduled = true; });
    }
    if (!scheduled) { disconnectNodes(); state.position = 0; updateTimeUi(); return false; }
    state.startAt = startAt; state.startPosition = state.position; state.playing = true;
    updateButtons(); clearPlaybackTimers(); animationLoop();
    const endDuration = state.compareOriginal ? state.originalBuffer?.duration || state.duration : state.mixDuration;
    const remainingMs = Math.max(30, (endDuration - state.position) * 1000 + 120);
    state.endTimer = window.setTimeout(() => {
      if (!state.playing) return;
      if (options.overdub && state.overdub.active) { finishOverdub(); return; }
      state.position = Math.min(state.duration, endDuration);
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
    state.callbacks.transportUpdate?.(state.recording.name || "믹서", `${label} 재생 중`, true, "playing");
  }

  function pause() {
    if (!state.playing || state.overdub.active) return;
    state.position = currentPosition();
    stop({ preservePosition: true, silent: true, keepOverdub: true });
    setStatus("일시정지했습니다.", "idle");
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
    if (!options.silent) {
      setStatus("재생을 정지했습니다.", "idle");
      state.callbacks.transportUpdate?.(state.recording?.name || "믹서", "정지", false, "idle");
    }
  }

  function toggle() { state.playing ? pause() : play(state.position); }

  function updateButtons() {
    if ($("mixerPlay")) $("mixerPlay").textContent = state.playing && !state.overdub.active ? "일시정지" : "전체 재생";
    if ($("mixerCompare")) $("mixerCompare").textContent = state.compareOriginal ? "현재 믹스로" : "원본 비교";
  }

  function basePrefix(key) { return `mixer${key === "mr" ? "Mr" : "Vocal"}`; }

  function renderBaseTrackControls(key) {
    const prefix = basePrefix(key); const settings = state.settings[key] || defaultTrackSettings({ key, base: true }, state.recording);
    const values = {
      Volume: Math.round(settings.volume * 100), Pan: Math.round(settings.pan * 100), Offset: settings.offsetMs,
      FadeIn: settings.fadeIn, FadeOut: settings.fadeOut
    };
    Object.entries(values).forEach(([suffix, value]) => { const el = $(`${prefix}${suffix}`); if (el) el.value = String(value); });
    if ($(`${prefix}VolumeNumber`)) $(`${prefix}VolumeNumber`).value = String(values.Volume);
    if ($(`${prefix}PanNumber`)) $(`${prefix}PanNumber`).value = String(values.Pan);
    if ($(`${prefix}OffsetNumber`)) $(`${prefix}OffsetNumber`).value = String(values.Offset);
    if ($(`${prefix}VolumeValue`)) $(`${prefix}VolumeValue`).textContent = `${values.Volume}%`;
    if ($(`${prefix}PanValue`)) $(`${prefix}PanValue`).textContent = values.Pan === 0 ? "C" : values.Pan < 0 ? `L${Math.abs(values.Pan)}` : `R${values.Pan}`;
    if ($(`${prefix}OffsetValue`)) $(`${prefix}OffsetValue`).textContent = `${values.Offset > 0 ? "+" : ""}${values.Offset}ms`;
    if ($(`${prefix}FadeValue`)) $(`${prefix}FadeValue`).textContent = `${Number(settings.fadeIn).toFixed(1)}s / ${Number(settings.fadeOut).toFixed(1)}s`;
    $(`${prefix}Mute`)?.classList.toggle("is-active", settings.muted);
    $(`${prefix}Solo`)?.classList.toggle("is-active", settings.solo);
    const row = $(`${prefix}Row`);
    if (row) {
      row.classList.toggle("is-muted", settings.muted || (anySolo() && !settings.solo));
      row.classList.toggle("is-solo", settings.solo);
      row.classList.toggle("is-unavailable", !state.buffers[key]);
    }
  }

  function extraCardHtml(def) {
    const key = escapeHtml(def.key); const name = escapeHtml(def.name);
    return `<article class="mixer-track-card is-extra" data-extra-card="${key}">
      <header><div><span class="mixer-track-kicker">ADDITIONAL TRACK</span><strong>${name}</strong></div>
      <div class="mixer-track-actions"><button class="mixer-mini-btn" data-action="play">이 트랙만</button><button class="mixer-mini-btn" data-action="mute">음소거</button><button class="mixer-mini-btn" data-action="solo">솔로</button><button class="mixer-mini-btn" data-action="reset">초기화</button><button class="mixer-mini-btn is-danger" data-action="delete">삭제</button></div></header>
      <div class="mixer-control-grid">
        <div class="mixer-value-control"><label><span>음량 <output data-output="volume">100%</output></span><input class="range compact" data-field="volume" type="range" min="0" max="150" value="100" /></label><input class="mixer-small-number" data-number="volume" type="number" min="0" max="150" step="1" value="100" /></div>
        <div class="mixer-value-control"><label><span>팬 <output data-output="pan">C</output></span><input class="range compact" data-field="pan" type="range" min="-100" max="100" value="0" /></label><input class="mixer-small-number" data-number="pan" type="number" min="-100" max="100" step="1" value="0" /></div>
      </div>
      <div class="mixer-offset-control"><label><span>트랙 위치 <output data-output="offsetMs">0ms</output></span><input class="range compact" data-field="offsetMs" type="range" min="-1000" max="1000" step="10" value="0" /></label><input class="mixer-offset-number" data-number="offsetMs" type="number" min="-1000" max="1000" step="10" value="0" /></div>
      <details class="mixer-advanced"><summary>페이드 설정 <span data-output="fade">0.0s / 0.0s</span></summary><div class="mixer-control-grid"><label><span>페이드인</span><input class="range compact" data-field="fadeIn" type="range" min="0" max="10" step="0.1" value="0" /></label><label><span>페이드아웃</span><input class="range compact" data-field="fadeOut" type="range" min="0" max="10" step="0.1" value="0" /></label></div></details>
    </article>`;
  }

  function renderExtraStructure() {
    const lanes = $("mixerExtraLanes"); const grid = $("mixerExtraTrackGrid");
    if (!lanes || !grid) return;
    const extras = state.trackDefs.filter((def) => !def.base);
    lanes.innerHTML = extras.map((def, index) => `<div class="mixer-lane"><b>ADD ${index + 1}</b><div class="mixer-lane-track"><span class="mixer-clip is-extra" data-extra-clip="${escapeHtml(def.key)}">${escapeHtml(def.name)}</span></div></div>`).join("");
    grid.innerHTML = extras.map(extraCardHtml).join("");
    extras.forEach(bindExtraCard);
  }

  function renderExtraTrackControls(def) {
    const card = findDataElement("data-extra-card", def.key); if (!card) return;
    const settings = state.settings[def.key] || defaultTrackSettings(def, state.recording);
    const values = { volume: Math.round(settings.volume * 100), pan: Math.round(settings.pan * 100), offsetMs: settings.offsetMs, fadeIn: settings.fadeIn, fadeOut: settings.fadeOut };
    Object.entries(values).forEach(([field, value]) => { card.querySelector(`[data-field="${field}"]`)?.setAttribute("value", String(value)); const input = card.querySelector(`[data-field="${field}"]`); if (input) input.value = String(value); });
    ["volume", "pan", "offsetMs"].forEach((field) => { const input = card.querySelector(`[data-number="${field}"]`); if (input) input.value = String(values[field]); });
    const volumeOut = card.querySelector('[data-output="volume"]'); if (volumeOut) volumeOut.textContent = `${values.volume}%`;
    const panOut = card.querySelector('[data-output="pan"]'); if (panOut) panOut.textContent = values.pan === 0 ? "C" : values.pan < 0 ? `L${Math.abs(values.pan)}` : `R${values.pan}`;
    const offsetOut = card.querySelector('[data-output="offsetMs"]'); if (offsetOut) offsetOut.textContent = `${values.offsetMs > 0 ? "+" : ""}${values.offsetMs}ms`;
    const fadeOut = card.querySelector('[data-output="fade"]'); if (fadeOut) fadeOut.textContent = `${Number(values.fadeIn).toFixed(1)}s / ${Number(values.fadeOut).toFixed(1)}s`;
    card.querySelector('[data-action="mute"]')?.classList.toggle("is-active", settings.muted);
    card.querySelector('[data-action="solo"]')?.classList.toggle("is-active", settings.solo);
    card.classList.toggle("is-muted", settings.muted || (anySolo() && !settings.solo));
    card.classList.toggle("is-solo", settings.solo); card.classList.toggle("is-unavailable", !state.buffers[def.key]);
  }

  function renderControls() {
    BASE_KEYS.forEach(renderBaseTrackControls);
    state.trackDefs.filter((def) => !def.base).forEach(renderExtraTrackControls);
    const master = Math.round(state.settings.masterVolume * 100);
    if ($("mixerMasterVolume")) $("mixerMasterVolume").value = String(master);
    if ($("mixerMasterVolumeNumber")) $("mixerMasterVolumeNumber").value = String(master);
    if ($("mixerMasterVolumeValue")) $("mixerMasterVolumeValue").textContent = `${master}%`;
    updateButtons(); updateAvailability();
  }

  function updateAvailability() {
    const hasAny = state.trackDefs.some((def) => Boolean(state.buffers[def.key]));
    BASE_KEYS.forEach((key) => {
      const available = Boolean(state.buffers[key]);
      $(`${basePrefix(key)}Row`)?.querySelectorAll(".mixer-control").forEach((element) => { element.disabled = !available || state.overdub.active || state.exporting; });
    });
    document.querySelectorAll("#mixerExtraTrackGrid input, #mixerExtraTrackGrid button").forEach((element) => { element.disabled = state.overdub.active || state.exporting; });
    ["mixerReset", "mixerMasterVolume", "mixerMasterVolumeNumber", "mixerSeek", "mixerPlay", "mixerStop", "mixerExportName", "mixerExportWav"].forEach((id) => { const el = $(id); if (el) el.disabled = !hasAny || state.overdub.active || state.exporting; });
    if ($("mixerCompare")) $("mixerCompare").disabled = !state.originalBuffer || state.overdub.active || state.exporting;
    const extraCount = state.trackDefs.filter((def) => !def.base).length;
    if ($("mixerOverdubStart")) $("mixerOverdubStart").disabled = !hasAny || state.overdub.active || state.exporting || extraCount >= OVERDUB_MAX_TRACKS;
    if ($("mixerOverdubStop")) $("mixerOverdubStop").disabled = !state.overdub.active;
    if ($("mixerOverdubName")) $("mixerOverdubName").disabled = state.overdub.active || !hasAny;
    if ($("mixerOverdubCountIn")) $("mixerOverdubCountIn").disabled = state.overdub.active || !hasAny;
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
    clearTimeout(state.saveTimer); state.saveTimer = null; setSaveState("saved");
    if (state.overdub.active) await finishOverdub();
    stop({ keepOverdub: true }); revokeExport();
    state.recording = recording || null; state.selectedId = recording ? String(recording.id) : "";
    state.trackDefs = buildTrackDefs(recording); state.buffers = {}; state.originalBuffer = null;
    state.settings = normalizeSettings(recording, state.trackDefs); state.position = 0; state.duration = 0; state.mixDuration = 0; state.compareOriginal = false;
    updateMeta(); renderExtraStructure(); renderControls(); calculateDuration();
    if (!recording) { setStatus("트랙이 있는 녹음을 선택해 주세요.", "idle"); updateAvailability(); return; }
    const token = ++state.loadingToken; setStatus("저장된 트랙을 불러오고 있습니다.", "loading"); updateAvailability();
    try {
      const entries = [...state.trackDefs.map((def) => [def.key, def.blob]), ["__original", recording.blob]];
      const results = await Promise.allSettled(entries.map(([, blob]) => decodeBlob(blob, token)));
      if (token !== state.loadingToken) return;
      results.forEach((result, index) => {
        const key = entries[index][0]; const value = result.status === "fulfilled" ? result.value : null;
        if (key === "__original") state.originalBuffer = value; else state.buffers[key] = value;
      });
      state.trackDefs = state.trackDefs.filter((def) => state.buffers[def.key]);
      if (!state.trackDefs.length) throw new Error("분리 트랙을 찾지 못했습니다.");
      renderExtraStructure(); calculateDuration(); renderControls(); updateMeta();
      setStatus(`${state.trackDefs.length}개 트랙을 준비했습니다.`, "idle");
    } catch (error) {
      state.buffers = {}; state.originalBuffer = null; state.trackDefs = []; renderExtraStructure(); calculateDuration(); renderControls();
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

  function scheduleSave() {
    setSaveState("dirty"); clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(async () => {
      if (!state.recording) return; setSaveState("saving");
      try { const updated = await state.callbacks.saveSettings?.(state.recording, clone(state.settings)); if (updated) state.recording = updated; setSaveState("saved"); }
      catch (error) { setSaveState("error"); setStatus(`믹서 설정을 저장하지 못했습니다: ${error.message}`, "error"); }
    }, 350);
  }

  function restartIfPlaying() {
    calculateDuration(); if (!state.playing || state.overdub.active) return; clearTimeout(state.restartTimer);
    const position = currentPosition(); state.restartTimer = window.setTimeout(() => { state.restartTimer = null; if (state.playing) play(position); }, 90);
  }

  function normalizeField(field, value) {
    if (field === "volume") return clamp(Number(value) / 100, 0, 1.5);
    if (field === "pan") return clamp(Number(value) / 100, -1, 1);
    if (field === "offsetMs") return clamp(Math.round(Number(value) / 10) * 10, -1000, 1000);
    if (field === "fadeIn" || field === "fadeOut") return clamp(value, 0, 10);
    return value;
  }

  function setTrackValue(key, field, value) {
    if (!state.settings[key]) return; state.settings[key][field] = normalizeField(field, value);
    if (BASE_KEYS.includes(key)) renderBaseTrackControls(key); else { const def = getTrackDef(key); if (def) renderExtraTrackControls(def); }
    updateLiveNodes(); if (["offsetMs", "fadeIn", "fadeOut"].includes(field)) restartIfPlaying(); scheduleSave();
  }

  function toggleTrackFlag(key, flag) {
    if (!state.settings[key]) return; state.settings[key][flag] = !state.settings[key][flag]; renderControls(); updateLiveNodes(); scheduleSave();
  }

  function playOnly(key) {
    getTrackKeys().forEach((trackKey) => { state.settings[trackKey].solo = trackKey === key; }); renderControls(); updateLiveNodes(); scheduleSave();
    if (!state.playing) play(state.position); else restartIfPlaying();
  }

  function resetTrack(key) {
    const def = getTrackDef(key); if (!def) return; state.settings[key] = defaultTrackSettings(def, state.recording); renderControls(); updateLiveNodes(); restartIfPlaying(); scheduleSave();
  }

  function resetSettings() {
    if (!state.recording) return; state.settings = normalizeSettings({ ...state.recording, mixSettings: null }, state.trackDefs); renderControls(); calculateDuration(); restartIfPlaying(); scheduleSave(); setStatus("모든 믹서 설정을 초기값으로 되돌렸습니다.", "idle");
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
    $(`${prefix}FadeIn`)?.addEventListener("input", (event) => setTrackValue(key, "fadeIn", event.target.value));
    $(`${prefix}FadeOut`)?.addEventListener("input", (event) => setTrackValue(key, "fadeOut", event.target.value));
    $(`${prefix}Mute`)?.addEventListener("click", () => toggleTrackFlag(key, "muted"));
    $(`${prefix}Solo`)?.addEventListener("click", () => toggleTrackFlag(key, "solo"));
    $(`${prefix}PlayOnly`)?.addEventListener("click", () => playOnly(key));
    $(`${prefix}Reset`)?.addEventListener("click", () => resetTrack(key));
  }

  function bindExtraCard(def) {
    const card = findDataElement("data-extra-card", def.key); if (!card) return;
    card.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("input", (event) => {
      const field = event.target.dataset.field; const number = card.querySelector(`[data-number="${field}"]`); if (number) number.value = event.target.value; setTrackValue(def.key, field, event.target.value);
    }));
    card.querySelectorAll("[data-number]").forEach((input) => input.addEventListener("change", (event) => {
      const field = event.target.dataset.number; const min = Number(event.target.min); const max = Number(event.target.max); const next = clamp(event.target.value, min, max); const range = card.querySelector(`[data-field="${field}"]`); if (range) range.value = String(next); setTrackValue(def.key, field, next);
    }));
    card.querySelector('[data-action="mute"]')?.addEventListener("click", () => toggleTrackFlag(def.key, "muted"));
    card.querySelector('[data-action="solo"]')?.addEventListener("click", () => toggleTrackFlag(def.key, "solo"));
    card.querySelector('[data-action="play"]')?.addEventListener("click", () => playOnly(def.key));
    card.querySelector('[data-action="reset"]')?.addEventListener("click", () => resetTrack(def.key));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteExtraTrack(def));
    renderExtraTrackControls(def);
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
    const starts = effectiveTrackStarts();
    return state.trackDefs.filter((def) => state.buffers[def.key]).map((def) => ({ key: def.key, label: def.name, buffer: state.buffers[def.key], startSec: starts[def.key], trimStartSec: def.trimStartSec || 0 }));
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
    Object.assign(state.overdub, { active: false, recorder: null, stream: null, chunks: [], source: null, gate: null, destination: null, analyser: null, levelData: null, levelFrame: null, startAt: 0, recorderStartAt: 0, timerId: null, autoStopTimer: null, countInNodes: [], stopping: false });
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

  async function startOverdub() {
    if (state.overdub.active || !state.recording) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setStatus("추가 트랙 녹음은 HTTPS 또는 PC 실행 파일의 최신 Chrome·Edge에서 사용할 수 있습니다.", "error"); return; }
    const extraCount = state.trackDefs.filter((def) => !def.base).length;
    if (extraCount >= OVERDUB_MAX_TRACKS) { setStatus(`추가 녹음 트랙은 현재 ${OVERDUB_MAX_TRACKS}개까지 지원합니다.`, "error"); return; }
    state.callbacks.stopOtherAudio?.(); stop({ silent: true, keepOverdub: true });
    try {
      const context = ensureContext(); const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      const source = context.createMediaStreamSource(stream); const gate = context.createGain(); const destination = context.createMediaStreamDestination(); const analyser = context.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.65;
      gate.gain.value = 0; source.connect(gate); gate.connect(destination); source.connect(analyser);
      const mimeType = preferredMimeType(); const recorder = mimeType ? new MediaRecorder(destination.stream, { mimeType }) : new MediaRecorder(destination.stream);
      const countIn = $("mixerOverdubCountIn")?.checked ? 3 : 0; const leadSeconds = countIn ? countIn + 0.12 : 0.18; const recorderStartAt = context.currentTime; const startAt = recorderStartAt + leadSeconds;
      Object.assign(state.overdub, { active: true, recorder, stream, chunks: [], source, gate, destination, analyser, levelData: new Uint8Array(analyser.fftSize), startAt, recorderStartAt, stopping: false });
      recorder.ondataavailable = (event) => { if (event.data?.size) state.overdub.chunks.push(event.data); };
      recorder.onerror = (event) => setStatus(`추가 트랙 녹음 오류: ${event.error?.message || "알 수 없는 오류"}`, "error");
      recorder.start(1000); gate.gain.setValueAtTime(0, context.currentTime); gate.gain.setValueAtTime(1, startAt);
      if (countIn) scheduleCountIn(context, startAt);
      if (!startPlaybackAt(0, startAt, { overdub: true })) throw new Error("현재 믹스를 재생할 수 없습니다.");
      state.overdub.timerId = window.setInterval(() => { const elapsed = Math.max(0, context.currentTime - startAt); if ($("mixerOverdubTimer")) $("mixerOverdubTimer").textContent = formatTime(elapsed); }, 100);
      state.overdub.autoStopTimer = window.setTimeout(() => finishOverdub(), Math.max(500, (state.mixDuration + leadSeconds) * 1000 + 120));
      runOverdubLevel(); updateAvailability(); setStatus("현재 믹스를 들으며 추가 트랙을 녹음합니다.", "recording");
      if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = countIn ? "3초 카운트인 뒤 녹음이 시작됩니다. 이어폰을 사용하세요." : "잠시 후 녹음이 시작됩니다. 이어폰을 사용하세요.";
      state.callbacks.transportUpdate?.(state.recording.name || "믹서", "추가 트랙 녹음 중", true, "recording");
    } catch (error) { cleanupOverdub(); stop({ silent: true, keepOverdub: true }); setStatus(`추가 트랙 녹음을 시작하지 못했습니다: ${error.message}`, "error"); }
  }

  async function finishOverdub() {
    const overdub = state.overdub; if (!overdub.active || overdub.stopping) return; overdub.stopping = true;
    clearTimeout(overdub.autoStopTimer); try { overdub.gate?.gain?.setValueAtTime(0, state.context?.currentTime || 0); } catch {}
    stop({ preservePosition: false, silent: true, keepOverdub: true });
    const recorder = overdub.recorder; const chunks = overdub.chunks; const startAt = overdub.startAt; const recorderStartAt = overdub.recorderStartAt;
    try {
      const stopped = new Promise((resolve) => { if (!recorder || recorder.state === "inactive") resolve(); else recorder.addEventListener("stop", resolve, { once: true }); });
      if (recorder && recorder.state !== "inactive") recorder.stop(); await stopped;
      const mimeType = recorder?.mimeType || chunks[0]?.type || "audio/webm"; const blob = new Blob(chunks, { type: mimeType });
      const durationMs = Math.max(0, Math.min(state.mixDuration * 1000, ((state.context?.currentTime || startAt) - startAt) * 1000));
      if (!blob.size || durationMs < 250) throw new Error("녹음된 내용이 너무 짧습니다.");
      const inputName = String($("mixerOverdubName")?.value || "").trim().slice(0, 40);
      const track = { id: crypto.randomUUID?.() || `track-${Date.now()}`, name: inputName || `추가 녹음 ${state.trackDefs.filter((def) => !def.base).length + 1}`, blob, mimeType, createdAt: Date.now(), durationMs, trimStartMs: Math.max(0, Math.round((startAt - recorderStartAt) * 1000)), offsetMs: 0 };
      const updated = await state.callbacks.addExtraTrack?.(state.recording, track);
      cleanupOverdub(); if ($("mixerOverdubName")) $("mixerOverdubName").value = "";
      if (updated) await loadRecording(updated);
      setStatus(`‘${track.name}’ 트랙을 믹서에 추가했습니다.`, "idle"); if ($("mixerOverdubStatus")) $("mixerOverdubStatus").textContent = "새 트랙을 추가했습니다. 음량과 위치를 조절해 주세요.";
    } catch (error) { cleanupOverdub(); setStatus(`추가 트랙을 저장하지 못했습니다: ${error.message}`, "error"); }
  }

  function bindMaster() {
    const range = $("mixerMasterVolume"); const number = $("mixerMasterVolumeNumber");
    range?.addEventListener("input", (event) => { if (number) number.value = event.target.value; state.settings.masterVolume = clamp(Number(event.target.value) / 100, 0, 1.5); renderControls(); updateLiveNodes(); scheduleSave(); });
    number?.addEventListener("change", (event) => { const next = clamp(event.target.value, 0, 150); if (range) range.value = String(next); state.settings.masterVolume = next / 100; renderControls(); updateLiveNodes(); scheduleSave(); });
  }

  function init(callbacks = {}) {
    if (state.initialized) return; state.callbacks = callbacks;
    $("mixerRecordingSelect")?.addEventListener("change", (event) => selectRecording(event.target.value));
    $("mixerPlay")?.addEventListener("click", toggle); $("mixerStop")?.addEventListener("click", () => stop()); $("mixerCompare")?.addEventListener("click", toggleCompare); $("mixerReset")?.addEventListener("click", resetSettings);
    bindMaster(); BASE_KEYS.forEach(bindBaseTrack);
    const seek = $("mixerSeek"); seek?.addEventListener("pointerdown", () => { state.seeking = true; });
    seek?.addEventListener("input", () => { state.seeking = true; state.position = clamp(seek.value, 0, state.duration); updateTimeUi(); });
    ["change", "pointerup", "pointercancel"].forEach((eventName) => seek?.addEventListener(eventName, () => { const wasPlaying = state.playing; const next = clamp(seek.value, 0, state.duration); state.seeking = false; state.position = next; if (wasPlaying && !state.overdub.active) play(next); else updateTimeUi(); }));
    $("mixerExportWav")?.addEventListener("click", exportWav); $("mixerExportDownload")?.addEventListener("click", downloadExport);
    $("mixerOverdubStart")?.addEventListener("click", startOverdub); $("mixerOverdubStop")?.addEventListener("click", finishOverdub);
    window.addEventListener("beforeunload", () => { revokeExport(); if (state.overdub.active) { try { state.overdub.recorder?.stop(); } catch {} cleanupOverdub(); } });
    state.initialized = true; refresh(); renderControls(); updateAvailability(); setStatus("트랙이 있는 녹음을 선택해 주세요.", "idle");
  }

  function isPlaying() { return state.playing; }
  function isRecording() { return state.overdub.active; }
  function getSelectedId() { return state.selectedId; }

  window.HoonMixer = { init, refresh, selectRecording, play, pause, stop, toggle, isPlaying, isRecording, getSelectedId, finishOverdub };
})();
