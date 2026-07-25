"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  audioContext: null,
  metronomeRunning: false,
  currentBeat: 0,
  nextNoteTime: 0,
  schedulerId: null,
  beatTimers: [],
  tapTimes: [],
  chordTimers: [],
  chordOscillators: [],
  progression: [],
  roman: [],
  deferredInstallPrompt: null,
  tunerRunning: false,
  tunerStarting: false,
  tunerRequestToken: 0,
  tunerStream: null,
  tunerSource: null,
  tunerAnalyser: null,
  tunerTimerId: null,
  tunerBuffer: null,
  tunerYinBuffer: null,
  tunerPitchHistory: [],
  tunerMissCount: 0
};

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP = { Eb: "D#", Ab: "G#", Bb: "A#" };
const DISPLAY_FLATS = new Set(["Eb", "Ab", "Bb"]);
const TUNING_PRESETS = {
  guitarStandard: [
    { midi: 40, label: "6번 줄 E2" },
    { midi: 45, label: "5번 줄 A2" },
    { midi: 50, label: "4번 줄 D3" },
    { midi: 55, label: "3번 줄 G3" },
    { midi: 59, label: "2번 줄 B3" },
    { midi: 64, label: "1번 줄 E4" }
  ],
  guitarDropD: [
    { midi: 38, label: "6번 줄 D2" },
    { midi: 45, label: "5번 줄 A2" },
    { midi: 50, label: "4번 줄 D3" },
    { midi: 55, label: "3번 줄 G3" },
    { midi: 59, label: "2번 줄 B3" },
    { midi: 64, label: "1번 줄 E4" }
  ]
};

const moodProgressions = {
  bright: [
    [1, 5, 6, 4],
    [1, 4, 5, 1],
    [1, 6, 4, 5]
  ],
  emotional: [
    [6, 4, 1, 5],
    [1, 3, 6, 4],
    [6, 5, 4, 5]
  ],
  powerful: [
    [1, 5, 4, 5],
    [1, 4, 6, 5],
    [6, 4, 5, 1]
  ],
  dreamy: [
    [1, 3, 4, 4],
    [6, 2, 4, 5],
    [1, 6, 2, 5]
  ]
};

const romanNumerals = { 1: "I", 2: "ii", 3: "iii", 4: "IV", 5: "V", 6: "vi", 7: "vii°" };
const majorScaleSemitones = [0, 2, 4, 5, 7, 9, 11];
const chordQualities = ["", "m", "m", "", "", "m", "dim"];
const triadIntervals = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6]
};

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("이 브라우저는 오디오 기능을 지원하지 않습니다.");
    state.audioContext = new AudioContext();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function tempoDescription(bpm) {
  if (bpm < 50) return "매우 느리게";
  if (bpm < 70) return "느리게";
  if (bpm < 90) return "조금 느리게";
  if (bpm < 120) return "보통 빠르기";
  if (bpm < 150) return "빠르게";
  if (bpm < 180) return "매우 빠르게";
  return "극도로 빠르게";
}

function setBpm(value) {
  const bpm = clamp(Math.round(Number(value) || 100), 30, 240);
  $("#bpmSlider").value = String(bpm);
  $("#bpmValue").textContent = String(bpm);
  $("#tempoLabel").textContent = tempoDescription(bpm);
  localStorage.setItem("hoonMusicBpm", String(bpm));
}

function renderBeatIndicators() {
  const beats = Number($("#timeSignature").value);
  const container = $("#beatIndicators");
  container.innerHTML = "";
  for (let i = 0; i < beats; i += 1) {
    const dot = document.createElement("span");
    dot.className = "beat-dot";
    dot.setAttribute("aria-hidden", "true");
    container.appendChild(dot);
  }
  state.currentBeat = 0;
}

function clearBeatTimers() {
  state.beatTimers.forEach(clearTimeout);
  state.beatTimers = [];
  $$(".beat-dot").forEach((dot) => dot.classList.remove("is-active"));
}

function scheduleClick(beatNumber, time) {
  const audio = ensureAudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const volume = Number($("#metronomeVolume").value) / 100;

  oscillator.frequency.value = beatNumber === 0 ? 1150 : 760;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.35), time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.065);

  const delay = Math.max(0, (time - audio.currentTime) * 1000);
  const timer = setTimeout(() => {
    const dots = $$(".beat-dot");
    dots.forEach((dot) => dot.classList.remove("is-active"));
    if (dots[beatNumber]) dots[beatNumber].classList.add("is-active");
  }, delay);
  state.beatTimers.push(timer);
}

function nextBeat() {
  const bpm = Number($("#bpmSlider").value);
  const beats = Number($("#timeSignature").value);
  state.nextNoteTime += 60 / bpm;
  state.currentBeat = (state.currentBeat + 1) % beats;
}

function scheduler() {
  const audio = ensureAudioContext();
  while (state.nextNoteTime < audio.currentTime + 0.1) {
    scheduleClick(state.currentBeat, state.nextNoteTime);
    nextBeat();
  }
}

function startMetronome() {
  const audio = ensureAudioContext();
  state.metronomeRunning = true;
  state.currentBeat = 0;
  state.nextNoteTime = audio.currentTime + 0.05;
  state.schedulerId = window.setInterval(scheduler, 25);
  $("#toggleMetronome").textContent = "정지";
}

function stopMetronome() {
  state.metronomeRunning = false;
  window.clearInterval(state.schedulerId);
  state.schedulerId = null;
  clearBeatTimers();
  $("#toggleMetronome").textContent = "시작";
}

function toggleMetronome() {
  try {
    state.metronomeRunning ? stopMetronome() : startMetronome();
  } catch (error) {
    alert(error.message);
  }
}

function handleTapTempo() {
  const now = performance.now();
  state.tapTimes = state.tapTimes.filter((time) => now - time < 2500);
  state.tapTimes.push(now);

  if (state.tapTimes.length >= 4) {
    const intervals = [];
    for (let i = 1; i < state.tapTimes.length; i += 1) intervals.push(state.tapTimes[i] - state.tapTimes[i - 1]);
    const average = intervals.reduce((sum, item) => sum + item, 0) / intervals.length;
    setBpm(60000 / average);
  }
}

function normalizeRoot(key) {
  return FLAT_TO_SHARP[key] || key;
}

function noteAt(root, semitones, preferFlats = false) {
  const rootIndex = NOTE_NAMES_SHARP.indexOf(normalizeRoot(root));
  const sharpName = NOTE_NAMES_SHARP[(rootIndex + semitones + 120) % 12];
  if (!preferFlats) return sharpName;
  const flatMap = { "D#": "Eb", "G#": "Ab", "A#": "Bb", "C#": "Db", "F#": "Gb" };
  return flatMap[sharpName] || sharpName;
}

function chordFromDegree(key, degree) {
  const degreeIndex = degree - 1;
  const preferFlats = DISPLAY_FLATS.has(key);
  const root = noteAt(key, majorScaleSemitones[degreeIndex], preferFlats);
  const quality = chordQualities[degreeIndex];
  return {
    degree,
    symbol: `${root}${quality}`,
    root,
    quality,
    roman: romanNumerals[degree]
  };
}

function generateProgression() {
  stopProgression();
  const key = $("#keySelect").value;
  const mood = $("#moodSelect").value;
  const candidates = moodProgressions[mood] || moodProgressions.bright;
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  state.progression = selected.map((degree) => chordFromDegree(key, degree));
  state.roman = selected.map((degree) => romanNumerals[degree]);
  renderProgression();
  saveChordSettings();
}

function renderProgression() {
  $("#romanProgression").textContent = state.roman.join(" – ");
  const container = $("#chordCards");
  container.innerHTML = "";
  state.progression.forEach((chord, index) => {
    const card = document.createElement("div");
    card.className = "chord-card";
    card.dataset.index = String(index);
    const notes = getChordNotes(chord).join(" · ");
    card.innerHTML = `<strong>${chord.symbol}</strong><span title="${notes}">${notes}</span>`;
    container.appendChild(card);
  });
}

function getChordNotes(chord) {
  const intervals = triadIntervals[chord.quality] || triadIntervals[""];
  const preferFlats = /b/.test(chord.root);
  return intervals.map((interval) => noteAt(chord.root, interval, preferFlats));
}

function noteFrequency(noteName, octave = 4) {
  const normalized = normalizeRoot(noteName);
  const noteIndex = NOTE_NAMES_SHARP.indexOf(normalized);
  const midi = 12 * (octave + 1) + noteIndex;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function playChord(chord, startTime, duration = 1.2) {
  const audio = ensureAudioContext();
  const master = audio.createGain();
  const notes = getChordNotes(chord);
  master.gain.setValueAtTime(0.0001, startTime);
  master.gain.exponentialRampToValueAtTime(0.22, startTime + 0.03);
  master.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  master.connect(audio.destination);

  notes.forEach((note, index) => {
    const oscillator = audio.createOscillator();
    const partialGain = audio.createGain();
    oscillator.type = index === 0 ? "triangle" : "sine";
    oscillator.frequency.value = noteFrequency(note, index === 0 ? 3 : 4);
    partialGain.gain.value = index === 0 ? 0.65 : 0.45;
    oscillator.connect(partialGain).connect(master);
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
    state.chordOscillators.push(oscillator);
    oscillator.addEventListener("ended", () => {
      state.chordOscillators = state.chordOscillators.filter((item) => item !== oscillator);
    }, { once: true });
  });
}

function clearChordHighlights() {
  $$(".chord-card").forEach((card) => card.classList.remove("is-playing"));
}

function playProgression() {
  try {
    stopProgression();
    const audio = ensureAudioContext();
    const bpm = clamp(Number($("#chordBpm").value) || 90, 40, 200);
    $("#chordBpm").value = String(bpm);
    const secondsPerChord = (60 / bpm) * 4;
    const startAt = audio.currentTime + 0.08;

    state.progression.forEach((chord, index) => {
      const chordStart = startAt + index * secondsPerChord;
      playChord(chord, chordStart, Math.min(secondsPerChord * 0.92, 2.8));
      const delay = Math.max(0, (chordStart - audio.currentTime) * 1000);
      const timer = setTimeout(() => {
        clearChordHighlights();
        const card = $(`.chord-card[data-index="${index}"]`);
        if (card) card.classList.add("is-playing");
      }, delay);
      state.chordTimers.push(timer);
    });

    state.chordTimers.push(setTimeout(clearChordHighlights, state.progression.length * secondsPerChord * 1000 + 200));
    localStorage.setItem("hoonMusicChordBpm", String(bpm));
  } catch (error) {
    alert(error.message);
  }
}

function stopProgression() {
  state.chordTimers.forEach(clearTimeout);
  state.chordTimers = [];
  clearChordHighlights();
  state.chordOscillators.forEach((oscillator) => {
    try { oscillator.stop(); } catch {}
  });
  state.chordOscillators = [];
}

async function copyProgression() {
  const text = state.progression.map((chord) => chord.symbol).join(" - ");
  try {
    await navigator.clipboard.writeText(text);
    $("#copyStatus").textContent = `복사됨: ${text}`;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    $("#copyStatus").textContent = `복사됨: ${text}`;
  }
}

function saveChordSettings() {
  localStorage.setItem("hoonMusicKey", $("#keySelect").value);
  localStorage.setItem("hoonMusicMood", $("#moodSelect").value);
}

function loadSettings() {
  setBpm(localStorage.getItem("hoonMusicBpm") || 100);
  $("#keySelect").value = localStorage.getItem("hoonMusicKey") || "C";
  $("#moodSelect").value = localStorage.getItem("hoonMusicMood") || "bright";
  $("#chordBpm").value = localStorage.getItem("hoonMusicChordBpm") || "90";
  $("#tuningMode").value = localStorage.getItem("hoonMusicTuningMode") || "chromatic";
  setA4Reference(localStorage.getItem("hoonMusicA4") || 440);
}


function getA4Reference() {
  return clamp(Math.round(Number($("#a4Reference").value) || 440), 430, 450);
}

function setA4Reference(value) {
  const reference = clamp(Math.round(Number(value) || 440), 430, 450);
  $("#a4Reference").value = String(reference);
  localStorage.setItem("hoonMusicA4", String(reference));
  state.tunerPitchHistory = [];
}

function midiFrequency(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

function midiNoteName(midi) {
  const rounded = Math.round(midi);
  const note = NOTE_NAMES_SHARP[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function detectPitchYin(input, sampleRate) {
  let sumSquares = 0;
  let mean = 0;
  for (let i = 0; i < input.length; i += 1) mean += input[i];
  mean /= input.length;
  for (let i = 0; i < input.length; i += 1) {
    const sample = input[i] - mean;
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / input.length);
  if (rms < 0.008) return null;

  const minFrequency = 55;
  const maxFrequency = 1200;
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(input.length / 2) - 1);
  const windowSize = input.length - maxTau;

  if (!state.tunerYinBuffer || state.tunerYinBuffer.length < maxTau + 2) {
    state.tunerYinBuffer = new Float32Array(maxTau + 2);
  }
  const difference = state.tunerYinBuffer;
  difference.fill(0, 0, maxTau + 2);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let value = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const delta = (input[i] - mean) - (input[i + tau] - mean);
      value += delta * delta;
    }
    difference[tau] = value;
  }

  let runningSum = 0;
  difference[0] = 1;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    difference[tau] = runningSum > 0 ? (difference[tau] * tau) / runningSum : 1;
  }

  const threshold = 0.16;
  let bestTau = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (difference[tau] < threshold) {
      while (tau + 1 <= maxTau && difference[tau + 1] < difference[tau]) tau += 1;
      bestTau = tau;
      break;
    }
  }

  if (bestTau < 0) {
    let bestValue = 1;
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (difference[tau] < bestValue) {
        bestValue = difference[tau];
        bestTau = tau;
      }
    }
    if (bestValue > 0.32) return null;
  }

  const previous = difference[Math.max(minTau, bestTau - 1)];
  const current = difference[bestTau];
  const next = difference[Math.min(maxTau, bestTau + 1)];
  const denominator = 2 * (previous - 2 * current + next);
  const adjustment = Math.abs(denominator) > 1e-8 ? (previous - next) / denominator : 0;
  const refinedTau = bestTau + clamp(adjustment, -1, 1);
  const frequency = sampleRate / refinedTau;

  return Number.isFinite(frequency) && frequency >= minFrequency && frequency <= maxFrequency ? frequency : null;
}

function nearestTunerTarget(frequency) {
  const a4 = getA4Reference();
  const midiFloat = 69 + 12 * Math.log2(frequency / a4);
  const mode = $("#tuningMode").value;

  if (mode === "chromatic") {
    const midi = Math.round(midiFloat);
    return {
      midi,
      label: `감지 음정 · 기준 ${midiFrequency(midi, a4).toFixed(1)} Hz`,
      name: midiNoteName(midi)
    };
  }

  const preset = TUNING_PRESETS[mode] || TUNING_PRESETS.guitarStandard;
  const target = preset.reduce((best, item) => (
    Math.abs(item.midi - midiFloat) < Math.abs(best.midi - midiFloat) ? item : best
  ));
  return { ...target, name: midiNoteName(target.midi) };
}

function setTunerBadge(text, mode = "idle") {
  const badge = $("#tunerStatusBadge");
  badge.textContent = text;
  badge.classList.toggle("is-listening", mode === "listening");
  badge.classList.toggle("is-error", mode === "error");
}

function resetTunerDisplay(message = "조용한 곳에서 악기 한 음을 길게 연주하면 더 정확하게 감지됩니다.") {
  $("#tunerTarget").textContent = state.tunerRunning ? "소리를 기다리는 중" : "마이크를 시작해 주세요";
  $("#detectedNote").textContent = "--";
  $("#detectedNote").classList.remove("is-in-tune");
  $("#detectedFrequency").textContent = "-- Hz";
  $("#detectedCents").textContent = "-- cents";
  $("#tunerNeedle").style.setProperty("--needle-position", "0");
  $("#tunerNeedle").classList.remove("is-in-tune");
  $("#tunerMessage").textContent = message;
}

function updateTunerDisplay(frequency) {
  const target = nearestTunerTarget(frequency);
  const targetFrequency = midiFrequency(target.midi, getA4Reference());
  const cents = 1200 * Math.log2(frequency / targetFrequency);
  const roundedCents = Math.round(cents);
  const absoluteCents = Math.abs(cents);
  const inTune = absoluteCents <= 5;
  const sign = roundedCents > 0 ? "+" : "";

  $("#tunerTarget").textContent = target.label;
  $("#detectedNote").textContent = target.name;
  $("#detectedNote").classList.toggle("is-in-tune", inTune);
  $("#detectedFrequency").textContent = `${frequency.toFixed(1)} Hz`;
  $("#detectedCents").textContent = `${sign}${roundedCents} cents`;
  $("#tunerNeedle").style.setProperty("--needle-position", String(clamp(cents, -50, 50)));
  $("#tunerNeedle").classList.toggle("is-in-tune", inTune);

  if (inTune) {
    $("#tunerMessage").textContent = "정확한 음정입니다.";
    setTunerBadge("정확", "listening");
  } else if (absoluteCents <= 15) {
    $("#tunerMessage").textContent = cents < 0 ? "조금 낮습니다. 아주 조금 올려 주세요." : "조금 높습니다. 아주 조금 내려 주세요.";
    setTunerBadge("거의 맞음", "listening");
  } else if (absoluteCents > 180 && $("#tuningMode").value !== "chromatic") {
    $("#tunerMessage").textContent = "선택한 기타 줄과 음정 차이가 큽니다. 다른 줄인지 확인해 주세요.";
    setTunerBadge(cents < 0 ? "낮음" : "높음", "listening");
  } else {
    const isGuitarMode = $("#tuningMode").value !== "chromatic";
    if (isGuitarMode) {
      $("#tunerMessage").textContent = cents < 0 ? "음정이 낮습니다. 줄을 조금 조여 주세요." : "음정이 높습니다. 줄을 조금 풀어 주세요.";
    } else {
      $("#tunerMessage").textContent = cents < 0 ? "음정이 낮습니다. 소리를 조금 올려 주세요." : "음정이 높습니다. 소리를 조금 내려 주세요.";
    }
    setTunerBadge(cents < 0 ? "낮음" : "높음", "listening");
  }
}

function runTunerAnalysis() {
  if (!state.tunerRunning || !state.tunerAnalyser || !state.tunerBuffer) return;

  state.tunerAnalyser.getFloatTimeDomainData(state.tunerBuffer);
  const frequency = detectPitchYin(state.tunerBuffer, state.audioContext.sampleRate);

  if (frequency) {
    state.tunerMissCount = 0;
    state.tunerPitchHistory.push(frequency);
    if (state.tunerPitchHistory.length > 3) state.tunerPitchHistory.shift();
    updateTunerDisplay(median(state.tunerPitchHistory));
  } else {
    state.tunerMissCount += 1;
    if (state.tunerMissCount >= 4) {
      state.tunerPitchHistory = [];
      resetTunerDisplay("소리가 작거나 불규칙합니다. 한 음을 조금 더 크게 길게 연주해 주세요.");
      setTunerBadge("듣는 중", "listening");
    }
  }

  state.tunerTimerId = window.setTimeout(runTunerAnalysis, 70);
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "마이크 권한이 차단되었습니다. 브라우저 주소창의 마이크 권한을 허용해 주세요.";
  if (error?.name === "NotFoundError") return "사용할 수 있는 마이크를 찾지 못했습니다.";
  if (error?.name === "NotReadableError") return "다른 프로그램이 마이크를 사용 중일 수 있습니다.";
  return error?.message || "마이크를 시작하지 못했습니다.";
}

async function startTuner() {
  const requestToken = ++state.tunerRequestToken;
  state.tunerStarting = true;
  $("#toggleTuner").disabled = true;
  $("#toggleTuner").textContent = "시작 중...";

  try {
    if (location.protocol === "file:") {
      throw new Error("튜너는 마이크 보안을 위해 GitHub Pages 또는 localhost 주소에서 실행해야 합니다.");
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저 환경에서는 마이크를 사용할 수 없습니다. HTTPS 주소로 접속해 주세요.");
    }

    stopMetronome();
    stopProgression();
    setTunerBadge("권한 확인 중", "listening");
    $("#tunerMessage").textContent = "마이크 사용 권한을 확인하고 있습니다.";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    });
    if (requestToken !== state.tunerRequestToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const audio = ensureAudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    const source = audio.createMediaStreamSource(stream);
    source.connect(analyser);

    state.tunerStream = stream;
    state.tunerSource = source;
    state.tunerAnalyser = analyser;
    state.tunerBuffer = new Float32Array(analyser.fftSize);
    state.tunerPitchHistory = [];
    state.tunerMissCount = 0;
    state.tunerStarting = false;
    state.tunerRunning = true;

    $("#toggleTuner").disabled = false;
    $("#toggleTuner").textContent = "튜너 정지";
    setTunerBadge("듣는 중", "listening");
    resetTunerDisplay("악기 한 음을 길게 연주해 주세요.");
    runTunerAnalysis();
  } catch (error) {
    if (requestToken !== state.tunerRequestToken) return;
    stopTuner(false);
    const message = microphoneErrorMessage(error);
    resetTunerDisplay(message);
    setTunerBadge("사용 불가", "error");
  }
}

function stopTuner(reset = true) {
  state.tunerRequestToken += 1;
  state.tunerStarting = false;
  window.clearTimeout(state.tunerTimerId);
  state.tunerTimerId = null;
  if (state.tunerSource) {
    try { state.tunerSource.disconnect(); } catch {}
  }
  if (state.tunerStream) state.tunerStream.getTracks().forEach((track) => track.stop());
  state.tunerStream = null;
  state.tunerSource = null;
  state.tunerAnalyser = null;
  state.tunerBuffer = null;
  state.tunerPitchHistory = [];
  state.tunerMissCount = 0;
  state.tunerRunning = false;
  $("#toggleTuner").disabled = false;
  $("#toggleTuner").textContent = "튜너 시작";
  if (reset) {
    resetTunerDisplay();
    setTunerBadge("대기 중");
  }
}

function toggleTuner() {
  if (state.tunerStarting) return;
  if (state.tunerRunning) stopTuner();
  else startTuner();
}

function setupTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      stopMetronome();
      stopProgression();
      stopTuner();
      const target = tab.dataset.tab;
      $$(".tab").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === target));
    });
  });
}

function setupPwaInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    $("#installBtn").hidden = false;
  });

  $("#installBtn").addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    $("#installBtn").hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    $("#installBtn").hidden = true;
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker registration failed", error));
  }
}

function bindEvents() {
  $("#bpmSlider").addEventListener("input", (event) => setBpm(event.target.value));
  $("#bpmMinus").addEventListener("click", () => setBpm(Number($("#bpmSlider").value) - 1));
  $("#bpmPlus").addEventListener("click", () => setBpm(Number($("#bpmSlider").value) + 1));
  $("#toggleMetronome").addEventListener("click", toggleMetronome);
  $("#tapTempo").addEventListener("click", handleTapTempo);
  $("#timeSignature").addEventListener("change", () => {
    const wasRunning = state.metronomeRunning;
    stopMetronome();
    renderBeatIndicators();
    if (wasRunning) startMetronome();
  });

  $("#randomizeBtn").addEventListener("click", generateProgression);
  $("#keySelect").addEventListener("change", generateProgression);
  $("#moodSelect").addEventListener("change", generateProgression);
  $("#playProgression").addEventListener("click", playProgression);
  $("#stopProgression").addEventListener("click", stopProgression);
  $("#copyProgression").addEventListener("click", copyProgression);

  $("#toggleTuner").addEventListener("click", toggleTuner);
  $("#a4Minus").addEventListener("click", () => setA4Reference(getA4Reference() - 1));
  $("#a4Plus").addEventListener("click", () => setA4Reference(getA4Reference() + 1));
  $("#a4Reference").addEventListener("change", (event) => setA4Reference(event.target.value));
  $("#tuningMode").addEventListener("change", (event) => {
    localStorage.setItem("hoonMusicTuningMode", event.target.value);
    state.tunerPitchHistory = [];
    if (state.tunerRunning) resetTunerDisplay("새 튜닝 모드로 악기 한 음을 연주해 주세요.");
  });

  window.addEventListener("pagehide", () => {
    stopMetronome();
    stopProgression();
    stopTuner(false);
  });
}

loadSettings();
setupTabs();
renderBeatIndicators();
generateProgression();
bindEvents();
setupPwaInstall();
registerServiceWorker();
