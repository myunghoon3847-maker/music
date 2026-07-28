"use strict";

(() => {
  const TRACK_KEYS = ["mr", "vocal"];
  const DEFAULT_TRACK = { volume: 1, pan: 0, offsetMs: 0, muted: false, solo: false, fadeIn: 0, fadeOut: 0 };
  const DEFAULT_SETTINGS = {
    mr: { ...DEFAULT_TRACK, volume: 0.8 },
    vocal: { ...DEFAULT_TRACK, volume: 1 },
    masterVolume: 0.9
  };

  const state = {
    callbacks: {},
    recording: null,
    selectedId: "",
    buffers: { mr: null, vocal: null },
    sources: { mr: null, vocal: null },
    nodes: { mr: null, vocal: null, master: null, limiter: null },
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    context: null,
    loadingToken: 0,
    playing: false,
    startAt: 0,
    startPosition: 0,
    position: 0,
    duration: 0,
    frameId: null,
    endTimer: null,
    saveTimer: null,
    restartTimer: null,
    seeking: false,
    initialized: false
  };

  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function structuredCloneSafe(value) {
    try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function getRecordings() {
    return state.callbacks.getRecordings?.() || [];
  }

  function normalizeSettings(recording) {
    const saved = recording?.mixSettings || {};
    const sync = Number(recording?.syncOffsetMs) || 0;
    const initialMrOffset = sync > 0 ? sync : 0;
    const initialVocalOffset = sync < 0 ? Math.abs(sync) : 0;
    const mergeTrack = (key, fallbackOffset) => ({
      ...DEFAULT_TRACK,
      ...(key === "mr" ? { volume: 0.8 } : { volume: 1 }),
      offsetMs: fallbackOffset,
      ...(saved[key] || {})
    });
    return {
      mr: mergeTrack("mr", initialMrOffset),
      vocal: mergeTrack("vocal", initialVocalOffset),
      masterVolume: clamp(saved.masterVolume ?? DEFAULT_SETTINGS.masterVolume, 0, 1.5)
    };
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
      badge.textContent = mode === "loading" ? "불러오는 중" : mode === "playing" ? "재생 중" : mode === "error" ? "오류" : "준비";
      badge.dataset.mode = mode;
    }
    state.callbacks.onStatus?.(message, mode);
  }

  function clearTimer() {
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
    state.sources[key] = null;
  }

  function disconnectNodes() {
    TRACK_KEYS.forEach((key) => {
      const nodes = state.nodes[key];
      if (!nodes) return;
      Object.values(nodes).forEach((node) => { try { node?.disconnect?.(); } catch {} });
      state.nodes[key] = null;
    });
    if (state.nodes.master) {
      try { state.nodes.master.disconnect(); } catch {}
      state.nodes.master = null;
    }
    if (state.nodes.limiter) {
      try { state.nodes.limiter.disconnect(); } catch {}
      state.nodes.limiter = null;
    }
  }

  function effectiveTrackStarts() {
    const raw = TRACK_KEYS.map((key) => state.buffers[key] ? Number(state.settings[key].offsetMs) / 1000 : 0);
    const minOffset = Math.min(0, ...raw);
    return {
      shift: -minOffset,
      mr: (Number(state.settings.mr.offsetMs) / 1000) - minOffset,
      vocal: (Number(state.settings.vocal.offsetMs) / 1000) - minOffset
    };
  }

  function calculateDuration() {
    const starts = effectiveTrackStarts();
    state.duration = Math.max(0,
      state.buffers.mr ? starts.mr + state.buffers.mr.duration : 0,
      state.buffers.vocal ? starts.vocal + state.buffers.vocal.duration : 0
    );
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
    const current = $("mixerCurrentTime");
    const duration = $("mixerDuration");
    if (current) current.textContent = formatTime(position);
    if (duration) duration.textContent = formatTime(state.duration);
    const timeline = document.querySelector("#mixer .mixer-timeline");
    if (timeline) timeline.style.setProperty("--mixer-progress", String(state.duration ? position / state.duration : 0));
  }

  function animationLoop() {
    updateTimeUi();
    if (state.playing) state.frameId = requestAnimationFrame(animationLoop);
  }

  function updateTimeline() {
    const starts = effectiveTrackStarts();
    TRACK_KEYS.forEach((key) => {
      const lane = $(`mixer${key === "mr" ? "Mr" : "Vocal"}Clip`);
      const buffer = state.buffers[key];
      if (!lane) return;
      if (!buffer || !state.duration) {
        lane.hidden = true;
        return;
      }
      lane.hidden = false;
      const start = starts[key];
      lane.style.left = `${(start / state.duration) * 100}%`;
      lane.style.width = `${Math.max(1.2, (buffer.duration / state.duration) * 100)}%`;
      lane.title = `${key === "mr" ? "MR" : "보컬"} · ${formatTime(buffer.duration)}`;
    });
  }

  function anySolo() {
    return TRACK_KEYS.some((key) => state.settings[key].solo);
  }

  function effectiveGain(key) {
    const settings = state.settings[key];
    const mutedBySolo = anySolo() && !settings.solo;
    return settings.muted || mutedBySolo ? 0 : clamp(settings.volume, 0, 1.5);
  }

  function updateLiveNodes() {
    const now = state.context?.currentTime || 0;
    TRACK_KEYS.forEach((key) => {
      const nodes = state.nodes[key];
      if (!nodes) return;
      nodes.controlGain.gain.setTargetAtTime(effectiveGain(key), now, 0.015);
      if (nodes.panner?.pan) nodes.panner.pan.setTargetAtTime(clamp(state.settings[key].pan, -1, 1), now, 0.015);
    });
    if (state.nodes.master) state.nodes.master.gain.setTargetAtTime(clamp(state.settings.masterVolume, 0, 1.5), now, 0.015);
  }

  function applyFadeEnvelope(key, nodes, when, bufferOffset, playableDuration) {
    const buffer = state.buffers[key];
    const settings = state.settings[key];
    const param = nodes.fadeGain.gain;
    const fadeIn = clamp(settings.fadeIn, 0, 10);
    const fadeOut = clamp(settings.fadeOut, 0, 10);
    const remaining = Math.max(0, buffer.duration - bufferOffset);
    let initial = 1;
    if (fadeIn > 0 && bufferOffset < fadeIn) initial = Math.min(initial, bufferOffset / fadeIn);
    if (fadeOut > 0 && remaining < fadeOut) initial = Math.min(initial, remaining / fadeOut);
    param.cancelScheduledValues(when);
    param.setValueAtTime(clamp(initial, 0, 1), when);
    if (fadeIn > 0 && bufferOffset < fadeIn) {
      param.linearRampToValueAtTime(1, when + Math.min(playableDuration, fadeIn - bufferOffset));
    }
    if (fadeOut > 0) {
      const fadeStartInBuffer = Math.max(0, buffer.duration - fadeOut);
      const fadeStartAfter = fadeStartInBuffer - bufferOffset;
      if (fadeStartAfter >= 0 && fadeStartAfter < playableDuration) {
        param.setValueAtTime(1, when + fadeStartAfter);
        param.linearRampToValueAtTime(0, when + Math.min(playableDuration, remaining));
      }
    }
  }

  function createTrackNodes(key) {
    const context = state.context;
    const fadeGain = context.createGain();
    const controlGain = context.createGain();
    const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : context.createGain();
    fadeGain.connect(controlGain);
    controlGain.connect(panner);
    panner.connect(state.nodes.master);
    controlGain.gain.value = effectiveGain(key);
    if (panner.pan) panner.pan.value = clamp(state.settings[key].pan, -1, 1);
    return { fadeGain, controlGain, panner };
  }

  function scheduleTrack(key, timelinePosition, startAt, starts) {
    const buffer = state.buffers[key];
    if (!buffer) return false;
    const trackStart = starts[key];
    let sourceWhen = startAt;
    let bufferOffset = timelinePosition - trackStart;
    if (bufferOffset < 0) {
      sourceWhen += -bufferOffset;
      bufferOffset = 0;
    }
    if (bufferOffset >= buffer.duration) return false;
    const playableDuration = buffer.duration - bufferOffset;
    const source = state.context.createBufferSource();
    source.buffer = buffer;
    const nodes = createTrackNodes(key);
    source.connect(nodes.fadeGain);
    applyFadeEnvelope(key, nodes, sourceWhen, bufferOffset, playableDuration);
    source.start(sourceWhen, bufferOffset, playableDuration);
    state.sources[key] = source;
    state.nodes[key] = nodes;
    return true;
  }

  async function play(fromPosition = state.position) {
    if (!state.recording || (!state.buffers.mr && !state.buffers.vocal)) {
      setStatus("먼저 2트랙 녹음을 선택해 주세요.", "error");
      return;
    }
    state.callbacks.stopOtherAudio?.();
    stop({ preservePosition: true, silent: true });
    const context = ensureContext();
    const position = clamp(fromPosition, 0, state.duration);
    if (position >= state.duration - 0.02) state.position = 0;
    else state.position = position;
    const startAt = context.currentTime + 0.06;
    state.nodes.master = context.createGain();
    state.nodes.master.gain.value = clamp(state.settings.masterVolume, 0, 1.5);
    if (typeof context.createDynamicsCompressor === "function") {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      state.nodes.master.connect(limiter);
      limiter.connect(context.destination);
      state.nodes.limiter = limiter;
    } else {
      state.nodes.master.connect(context.destination);
    }
    const starts = effectiveTrackStarts();
    let scheduled = false;
    TRACK_KEYS.forEach((key) => {
      if (scheduleTrack(key, state.position, startAt, starts)) scheduled = true;
    });
    if (!scheduled) {
      disconnectNodes();
      state.position = 0;
      updateTimeUi();
      return;
    }
    state.startAt = startAt;
    state.startPosition = state.position;
    state.playing = true;
    updateButtons();
    clearTimer();
    animationLoop();
    const remainingMs = Math.max(30, (state.duration - state.position) * 1000 + 120);
    state.endTimer = window.setTimeout(() => {
      if (!state.playing) return;
      state.position = state.duration;
      stop({ preservePosition: true, silent: true });
      setStatus("재생이 끝났습니다.", "idle");
      state.callbacks.transportUpdate?.(state.recording.name || "2트랙 믹서", "재생 완료", false, "idle");
    }, remainingMs);
    setStatus("보컬과 MR을 같은 오디오 시간축에서 재생합니다.", "playing");
    state.callbacks.transportUpdate?.(state.recording.name || "2트랙 믹서", "믹스 재생 중", true, "playing");
  }

  function pause() {
    if (!state.playing) return;
    state.position = currentPosition();
    stop({ preservePosition: true, silent: true });
    setStatus("일시정지했습니다.", "idle");
    state.callbacks.transportUpdate?.(state.recording?.name || "2트랙 믹서", "일시정지", false, "idle");
  }

  function stop(options = {}) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
    const preservePosition = Boolean(options.preservePosition);
    if (state.playing && preservePosition) state.position = currentPosition();
    state.playing = false;
    clearTimer();
    TRACK_KEYS.forEach(disconnectSource);
    disconnectNodes();
    if (!preservePosition) state.position = 0;
    updateButtons();
    updateTimeUi();
    if (!options.silent) {
      setStatus("재생을 정지했습니다.", "idle");
      state.callbacks.transportUpdate?.(state.recording?.name || "2트랙 믹서", "정지", false, "idle");
    }
  }

  function toggle() {
    state.playing ? pause() : play(state.position);
  }

  function updateButtons() {
    const playButton = $("mixerPlay");
    if (playButton) playButton.textContent = state.playing ? "일시정지" : "전체 재생";
  }

  function disableControls(disabled) {
    document.querySelectorAll("#mixer .mixer-control").forEach((element) => { element.disabled = disabled; });
    const play = $("mixerPlay");
    const stopButton = $("mixerStop");
    if (play) play.disabled = disabled;
    if (stopButton) stopButton.disabled = disabled;
  }

  function renderTrackControls(key) {
    const prefix = `mixer${key === "mr" ? "Mr" : "Vocal"}`;
    const settings = state.settings[key];
    const volume = $(`${prefix}Volume`);
    const pan = $(`${prefix}Pan`);
    const offset = $(`${prefix}Offset`);
    const offsetNumber = $(`${prefix}OffsetNumber`);
    const fadeIn = $(`${prefix}FadeIn`);
    const fadeOut = $(`${prefix}FadeOut`);
    if (volume) volume.value = String(Math.round(settings.volume * 100));
    if (pan) pan.value = String(Math.round(settings.pan * 100));
    if (offset) offset.value = String(settings.offsetMs);
    if (offsetNumber) offsetNumber.value = String(settings.offsetMs);
    if (fadeIn) fadeIn.value = String(settings.fadeIn);
    if (fadeOut) fadeOut.value = String(settings.fadeOut);
    const volumeValue = $(`${prefix}VolumeValue`);
    const panValue = $(`${prefix}PanValue`);
    const offsetValue = $(`${prefix}OffsetValue`);
    const fadeValue = $(`${prefix}FadeValue`);
    if (volumeValue) volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
    if (panValue) panValue.textContent = settings.pan === 0 ? "C" : settings.pan < 0 ? `L${Math.abs(Math.round(settings.pan * 100))}` : `R${Math.round(settings.pan * 100)}`;
    if (offsetValue) offsetValue.textContent = `${settings.offsetMs > 0 ? "+" : ""}${settings.offsetMs}ms`;
    if (fadeValue) fadeValue.textContent = `${Number(settings.fadeIn).toFixed(1)}s / ${Number(settings.fadeOut).toFixed(1)}s`;
    const mute = $(`${prefix}Mute`);
    const solo = $(`${prefix}Solo`);
    if (mute) mute.classList.toggle("is-active", settings.muted);
    if (solo) solo.classList.toggle("is-active", settings.solo);
    const row = $(`${prefix}Row`);
    if (row) {
      row.classList.toggle("is-muted", settings.muted || (anySolo() && !settings.solo));
      row.classList.toggle("is-solo", settings.solo);
      row.classList.toggle("is-unavailable", !state.buffers[key]);
    }
  }

  function updateAvailability() {
    const hasAny = Boolean(state.buffers.mr || state.buffers.vocal);
    TRACK_KEYS.forEach((key) => {
      const prefix = `mixer${key === "mr" ? "Mr" : "Vocal"}`;
      const available = Boolean(state.buffers[key]);
      const row = $(`${prefix}Row`);
      row?.querySelectorAll(".mixer-control").forEach((element) => { element.disabled = !available; });
    });
    const reset = $("mixerReset");
    const master = $("mixerMasterVolume");
    const seek = $("mixerSeek");
    const playButton = $("mixerPlay");
    const stopButton = $("mixerStop");
    if (reset) reset.disabled = !hasAny;
    if (master) master.disabled = !hasAny;
    if (seek) seek.disabled = !hasAny;
    if (playButton) playButton.disabled = !hasAny;
    if (stopButton) stopButton.disabled = !hasAny;
  }

  function renderControls() {
    TRACK_KEYS.forEach(renderTrackControls);
    const master = $("mixerMasterVolume");
    const masterValue = $("mixerMasterVolumeValue");
    if (master) master.value = String(Math.round(state.settings.masterVolume * 100));
    if (masterValue) masterValue.textContent = `${Math.round(state.settings.masterVolume * 100)}%`;
    updateButtons();
    updateAvailability();
  }

  function updateMeta() {
    const title = $("mixerRecordingTitle");
    const memo = $("mixerRecordingMemo");
    const legacy = $("mixerLegacyNotice");
    if (title) title.textContent = state.recording?.name || "녹음을 선택해 주세요";
    if (memo) {
      memo.textContent = String(state.recording?.memo || "").trim() || "저장된 보컬·MR 트랙을 앱 안에서 바로 재생하고 조절합니다.";
    }
    const separated = Boolean(state.recording?.vocalBlob || state.recording?.mrBlob);
    if (legacy) {
      legacy.hidden = !state.recording || separated;
      legacy.textContent = state.recording && !separated ? "이 녹음은 합쳐진 파일만 있어 2트랙 믹서를 사용할 수 없습니다. v1.7 이후 새 녹음을 선택해 주세요." : "";
    }
  }

  async function decodeBlob(blob, token) {
    if (!(blob instanceof Blob)) return null;
    const context = ensureContext();
    const arrayBuffer = await blob.arrayBuffer();
    if (token !== state.loadingToken) return null;
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  async function loadRecording(recording) {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    stop();
    state.recording = recording || null;
    state.selectedId = recording ? String(recording.id) : "";
    state.buffers = { mr: null, vocal: null };
    state.settings = normalizeSettings(recording);
    state.position = 0;
    state.duration = 0;
    updateMeta();
    renderControls();
    calculateDuration();
    if (!recording) {
      disableControls(true);
      setStatus("2트랙 녹음을 선택해 주세요.", "idle");
      return;
    }
    const token = ++state.loadingToken;
    setStatus("보컬과 MR 트랙을 불러오고 있습니다.", "loading");
    disableControls(true);
    try {
      const [mrResult, vocalResult] = await Promise.allSettled([
        decodeBlob(recording.mrBlob, token),
        decodeBlob(recording.vocalBlob, token)
      ]);
      if (token !== state.loadingToken) return;
      const mr = mrResult.status === "fulfilled" ? mrResult.value : null;
      const vocal = vocalResult.status === "fulfilled" ? vocalResult.value : null;
      state.buffers = { mr, vocal };
      calculateDuration();
      renderControls();
      const available = Boolean(mr || vocal);
      updateAvailability();
      if (!available) throw new Error("분리 트랙을 찾지 못했습니다.");
      setStatus(mr && vocal ? "보컬과 MR 2트랙을 준비했습니다." : `${mr ? "MR" : "보컬"} 트랙만 준비했습니다.`, "idle");
    } catch (error) {
      state.buffers = { mr: null, vocal: null };
      calculateDuration();
      disableControls(true);
      setStatus(`트랙을 불러오지 못했습니다: ${error.message}`, "error");
    }
  }

  function renderRecordingSelect() {
    const select = $("mixerRecordingSelect");
    if (!select) return;
    const recordings = [...getRecordings()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    const previous = state.selectedId;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = recordings.length ? "녹음을 선택하세요" : "현재 프로젝트에 녹음이 없습니다";
    select.appendChild(placeholder);
    recordings.forEach((recording) => {
      const option = document.createElement("option");
      option.value = String(recording.id);
      option.textContent = `${recording.name || "보컬 녹음"}${recording.hasSeparatedTracks ? " · 2트랙" : " · 믹스만"}`;
      select.appendChild(option);
    });
    const current = recordings.find((recording) => String(recording.id) === previous);
    if (current) {
      select.value = previous;
      state.recording = current;
      updateMeta();
    } else {
      state.selectedId = "";
      select.value = "";
      if (state.recording) loadRecording(null);
    }
  }

  function refresh() {
    renderRecordingSelect();
  }

  function selectRecording(id) {
    const recording = getRecordings().find((entry) => String(entry.id) === String(id));
    const select = $("mixerRecordingSelect");
    if (select) select.value = recording ? String(recording.id) : "";
    return loadRecording(recording || null);
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(async () => {
      if (!state.recording) return;
      try {
        const updated = await state.callbacks.saveSettings?.(state.recording, structuredCloneSafe(state.settings));
        if (updated) state.recording = updated;
      } catch (error) {
        setStatus(`믹서 설정을 저장하지 못했습니다: ${error.message}`, "error");
      }
    }, 350);
  }

  function restartIfPlaying() {
    calculateDuration();
    if (!state.playing) return;
    clearTimeout(state.restartTimer);
    state.restartTimer = window.setTimeout(() => {
      state.restartTimer = null;
      if (state.playing) play(currentPosition());
    }, 90);
  }

  function setTrackValue(key, field, value) {
    if (!state.settings[key]) return;
    if (field === "volume") state.settings[key][field] = clamp(Number(value) / 100, 0, 1.5);
    else if (field === "pan") state.settings[key][field] = clamp(Number(value) / 100, -1, 1);
    else if (field === "offsetMs") state.settings[key][field] = clamp(Math.round(Number(value) / 10) * 10, -1000, 1000);
    else if (field === "fadeIn" || field === "fadeOut") state.settings[key][field] = clamp(value, 0, 10);
    renderTrackControls(key);
    updateLiveNodes();
    if (field === "offsetMs") restartIfPlaying();
    else if (field === "fadeIn" || field === "fadeOut") {
      if (state.playing) restartIfPlaying();
    }
    scheduleSave();
  }

  function toggleTrackFlag(key, flag) {
    state.settings[key][flag] = !state.settings[key][flag];
    renderControls();
    updateLiveNodes();
    scheduleSave();
  }

  function playOnly(key) {
    TRACK_KEYS.forEach((trackKey) => { state.settings[trackKey].solo = trackKey === key; });
    renderControls();
    updateLiveNodes();
    scheduleSave();
    if (!state.playing) play(state.position);
    else restartIfPlaying();
  }

  function resetSettings() {
    if (!state.recording) return;
    state.settings = normalizeSettings({ ...state.recording, mixSettings: null });
    renderControls();
    calculateDuration();
    if (state.playing) restartIfPlaying();
    scheduleSave();
    setStatus("믹서 설정을 초기값으로 되돌렸습니다.", "idle");
  }

  function bindTrack(key) {
    const prefix = `mixer${key === "mr" ? "Mr" : "Vocal"}`;
    $(`${prefix}Volume`)?.addEventListener("input", (event) => setTrackValue(key, "volume", event.target.value));
    $(`${prefix}Pan`)?.addEventListener("input", (event) => setTrackValue(key, "pan", event.target.value));
    $(`${prefix}Offset`)?.addEventListener("input", (event) => {
      const number = $(`${prefix}OffsetNumber`);
      if (number) number.value = event.target.value;
      setTrackValue(key, "offsetMs", event.target.value);
    });
    $(`${prefix}OffsetNumber`)?.addEventListener("change", (event) => {
      const range = $(`${prefix}Offset`);
      const next = clamp(event.target.value, -1000, 1000);
      if (range) range.value = String(next);
      setTrackValue(key, "offsetMs", next);
    });
    $(`${prefix}FadeIn`)?.addEventListener("input", (event) => setTrackValue(key, "fadeIn", event.target.value));
    $(`${prefix}FadeOut`)?.addEventListener("input", (event) => setTrackValue(key, "fadeOut", event.target.value));
    $(`${prefix}Mute`)?.addEventListener("click", () => toggleTrackFlag(key, "muted"));
    $(`${prefix}Solo`)?.addEventListener("click", () => toggleTrackFlag(key, "solo"));
    $(`${prefix}PlayOnly`)?.addEventListener("click", () => playOnly(key));
  }

  function init(callbacks = {}) {
    if (state.initialized) return;
    state.callbacks = callbacks;
    $("mixerRecordingSelect")?.addEventListener("change", (event) => selectRecording(event.target.value));
    $("mixerPlay")?.addEventListener("click", toggle);
    $("mixerStop")?.addEventListener("click", () => stop());
    $("mixerReset")?.addEventListener("click", resetSettings);
    $("mixerMasterVolume")?.addEventListener("input", (event) => {
      state.settings.masterVolume = clamp(Number(event.target.value) / 100, 0, 1.5);
      renderControls();
      updateLiveNodes();
      scheduleSave();
    });
    const seek = $("mixerSeek");
    seek?.addEventListener("pointerdown", () => { state.seeking = true; });
    seek?.addEventListener("input", () => {
      state.seeking = true;
      state.position = clamp(seek.value, 0, state.duration);
      updateTimeUi();
    });
    ["change", "pointerup", "pointercancel"].forEach((eventName) => seek?.addEventListener(eventName, () => {
      const wasPlaying = state.playing;
      const next = clamp(seek.value, 0, state.duration);
      state.seeking = false;
      state.position = next;
      if (wasPlaying) play(next);
      else updateTimeUi();
    }));
    bindTrack("mr");
    bindTrack("vocal");
    state.initialized = true;
    refresh();
    renderControls();
    disableControls(true);
    setStatus("2트랙 녹음을 선택해 주세요.", "idle");
  }

  function isPlaying() { return state.playing; }
  function getSelectedId() { return state.selectedId; }

  window.HoonMixer = { init, refresh, selectRecording, play, pause, stop, toggle, isPlaying, getSelectedId };
})();
