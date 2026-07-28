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
  progressionDegrees: [],
  roman: [],
  selectedChordIndex: 0,
  progressionLoopTimer: null,
  progressionPlaying: false,
  nextProgressionStart: 0,
  progressionCycleDuration: 0,
  savedProgressions: [],
  deferredInstallPrompt: null,
  pwaUpdateReady: false,
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
  tunerMissCount: 0,
  tunerTargetIndex: -1,
  vocalRunning: false,
  vocalStarting: false,
  vocalRequestToken: 0,
  vocalStream: null,
  vocalSource: null,
  vocalAnalyser: null,
  vocalTimerId: null,
  vocalBuffer: null,
  vocalPitchHistory: [],
  vocalMissCount: 0,
  vocalTargetMidi: null,
  vocalFixedPitchClass: 0,
  vocalScoreTotal: 0,
  vocalScoreSamples: 0,
  vocalHoldStart: 0,
  vocalRecentCents: [],
  vocalTrace: [],
  vocalToneNodes: [],
  mediaRecorder: null,
  vocalTrackRecorder: null,
  vocalTrackStream: null,
  vocalTrackChunks: [],
  vocalTrackStopPromise: null,
  vocalTrackStopResolve: null,
  recordingStream: null,
  recordingChunks: [],
  recordingStartedAt: 0,
  recordingSegmentStartedAt: 0,
  recordingActiveMs: 0,
  recordingTimerId: null,
  recordingLevelFrame: null,
  recordingAnalyser: null,
  recordingSource: null,
  recordingLevelBuffer: null,
  recordings: [],
  recordingObjectUrls: [],
  recordingPlayers: [],
  activeRecordingAudio: null,
  recordingMediaSegmentStartedAt: 0,
  recordingMediaActiveMs: 0,
  recordingDbPromise: null,
  mrObjectUrl: null,
  mrFile: null,
  mrAudioBuffer: null,
  mrDecodePromise: null,
  mrDecodeToken: 0,
  mrSourceNode: null,
  mrMonitorGain: null,
  mrRecordGain: null,
  mrRecordDelay: null,
  mrPlaybackSource: null,
  mrPlaybackStartAt: 0,
  mrPlaybackOffsetSec: 0,
  mrPlaybackScheduledOffsetSec: 0,
  mrPlaybackSessionId: 0,
  mrAutoStopTimer: null,
  recordingVocalGain: null,
  recordingVocalCompressor: null,
  recordingVocalDelay: null,
  recordingVocalTrackGate: null,
  recordingVocalTrackDestination: null,
  recordingMixBus: null,
  recordingMixDestination: null,
  recordingMixMicSource: null,
  recordingMixCompressor: null,
  recordingMixMasterGain: null,
  recordingGate: null,
  recordingOutputStream: null,
  recordingControlsMr: false,
  recordingStarting: false,
  recordingStopping: false,
  recordingStartTimeout: null,
  recordingStopTimeout: null,
  recordingUiStartTimeout: null,
  recordingCountdownFrame: null,
  recordingCountdownNodes: [],
  recordingSessionToken: 0,
  mrResumeAfterPause: false,
  currentRecordingMeta: null,
  currentTab: "chords",
  projectDialogMode: "create"
};

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const RECORDING_DB_NAME = "hoonMusicRecordingsDB";
const RECORDING_STORE_NAME = "recordings";
const MAX_RECORDING_MS = 30 * 60 * 1000;
const DEFAULT_MR_SYNC_MS = 0;
const MIN_MR_SYNC_MS = -800;
const MAX_MR_SYNC_MS = 800;
const RECORDING_PREROLL_MS = 180;
const RECORDING_RESUME_LEAD_MS = 45;
const FLAT_TO_SHARP = { Eb: "D#", Ab: "G#", Bb: "A#" };
const DISPLAY_FLATS = new Set(["Eb", "Ab", "Bb"]);
const TUNING_PRESETS = {
  guitarStandard: [
    { midi: 40, label: "6번 줄 E2", shortLabel: "6번 E2" },
    { midi: 45, label: "5번 줄 A2", shortLabel: "5번 A2" },
    { midi: 50, label: "4번 줄 D3", shortLabel: "4번 D3" },
    { midi: 55, label: "3번 줄 G3", shortLabel: "3번 G3" },
    { midi: 59, label: "2번 줄 B3", shortLabel: "2번 B3" },
    { midi: 64, label: "1번 줄 E4", shortLabel: "1번 E4" }
  ],
  guitarDropD: [
    { midi: 38, label: "6번 줄 D2", shortLabel: "6번 D2" },
    { midi: 45, label: "5번 줄 A2", shortLabel: "5번 A2" },
    { midi: 50, label: "4번 줄 D3", shortLabel: "4번 D3" },
    { midi: 55, label: "3번 줄 G3", shortLabel: "3번 G3" },
    { midi: 59, label: "2번 줄 B3", shortLabel: "2번 B3" },
    { midi: 64, label: "1번 줄 E4", shortLabel: "1번 E4" }
  ],
  guitarHalfStepDown: [
    { midi: 39, label: "6번 줄 D#2/Eb2", shortLabel: "6번 Eb2" },
    { midi: 44, label: "5번 줄 G#2/Ab2", shortLabel: "5번 Ab2" },
    { midi: 49, label: "4번 줄 C#3/Db3", shortLabel: "4번 Db3" },
    { midi: 54, label: "3번 줄 F#3/Gb3", shortLabel: "3번 Gb3" },
    { midi: 58, label: "2번 줄 A#3/Bb3", shortLabel: "2번 Bb3" },
    { midi: 63, label: "1번 줄 D#4/Eb4", shortLabel: "1번 Eb4" }
  ],
  guitarWholeStepDown: [
    { midi: 38, label: "6번 줄 D2", shortLabel: "6번 D2" },
    { midi: 43, label: "5번 줄 G2", shortLabel: "5번 G2" },
    { midi: 48, label: "4번 줄 C3", shortLabel: "4번 C3" },
    { midi: 53, label: "3번 줄 F3", shortLabel: "3번 F3" },
    { midi: 57, label: "2번 줄 A3", shortLabel: "2번 A3" },
    { midi: 62, label: "1번 줄 D4", shortLabel: "1번 D4" }
  ],
  ukuleleStandard: [
    { midi: 67, label: "4번 줄 G4 (High G)", shortLabel: "4번 G4" },
    { midi: 60, label: "3번 줄 C4", shortLabel: "3번 C4" },
    { midi: 64, label: "2번 줄 E4", shortLabel: "2번 E4" },
    { midi: 69, label: "1번 줄 A4", shortLabel: "1번 A4" }
  ],
  ukuleleLowG: [
    { midi: 55, label: "4번 줄 G3 (Low G)", shortLabel: "4번 G3" },
    { midi: 60, label: "3번 줄 C4", shortLabel: "3번 C4" },
    { midi: 64, label: "2번 줄 E4", shortLabel: "2번 E4" },
    { midi: 69, label: "1번 줄 A4", shortLabel: "1번 A4" }
  ]
};

const VOCAL_SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

const VOCAL_SCALE_LABELS = {
  major: "메이저",
  minor: "내추럴 마이너",
  majorPentatonic: "메이저 펜타토닉",
  minorPentatonic: "마이너 펜타토닉",
  chromatic: "크로매틱"
};

const VOCAL_RANGES = {
  all: { min: 65, max: 1200 },
  low: { min: 65, max: 392 },
  middle: { min: 87, max: 698 },
  high: { min: 130, max: 1200 }
};

const SCALE_DATA = {
  major: {
    semitones: [0, 2, 4, 5, 7, 9, 11],
    triads: ["", "m", "m", "", "", "m", "dim"],
    sevenths: ["maj7", "m7", "m7", "maj7", "7", "m7", "m7b5"],
    roman: ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
  },
  minor: {
    semitones: [0, 2, 3, 5, 7, 8, 10],
    triads: ["m", "dim", "", "m", "", "", ""],
    sevenths: ["m7", "m7b5", "maj7", "m7", "7", "maj7", "7"],
    roman: ["i", "ii°", "III", "iv", "V", "VI", "VII"]
  }
};

const CHORD_INTERVALS = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mMaj7: [0, 3, 7, 11],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9]
};

const COLOR_QUALITIES = {
  major: [
    ["add9", "maj7", "6"],
    ["m7", "madd9"],
    ["m7"],
    ["maj7", "add9"],
    ["7", "sus4", "sus2"],
    ["m7", "madd9"],
    ["m7b5"]
  ],
  minor: [
    ["m7", "madd9", "m6"],
    ["m7b5"],
    ["maj7", "add9"],
    ["m7", "madd9"],
    ["7", "sus4"],
    ["maj7", "add9"],
    ["7", "sus2"]
  ]
};

const PROGRESSION_LIBRARY = {
  major: {
    pop: [
      { degrees: [1, 5, 6, 4], moods: ["bright", "emotional"] },
      { degrees: [1, 6, 4, 5], moods: ["bright"] },
      { degrees: [6, 4, 1, 5], moods: ["emotional", "powerful"] },
      { degrees: [1, 3, 4, 5], moods: ["dreamy", "emotional"] },
      { degrees: [1, 5, 6, 4, 1, 5, 4, 4], moods: ["bright"] },
      { degrees: [6, 4, 1, 5, 6, 4, 5, 5], moods: ["emotional"] }
    ],
    ballad: [
      { degrees: [1, 3, 4, 5], moods: ["emotional", "dreamy"] },
      { degrees: [6, 4, 1, 5], moods: ["emotional"] },
      { degrees: [1, 6, 2, 5], moods: ["bright", "emotional"] },
      { degrees: [1, 5, 6, 3, 4, 1, 2, 5], moods: ["emotional"] },
      { degrees: [6, 3, 4, 1, 2, 5, 1, 5], moods: ["dreamy"] }
    ],
    rock: [
      { degrees: [1, 4, 5, 4], moods: ["powerful"] },
      { degrees: [1, 5, 4, 1], moods: ["powerful", "bright"] },
      { degrees: [6, 4, 1, 5], moods: ["powerful", "emotional"] },
      { degrees: [1, 4, 1, 5, 1, 4, 6, 5], moods: ["powerful"] },
      { degrees: [6, 4, 1, 5, 6, 4, 5, 5], moods: ["tense"] }
    ],
    indie: [
      { degrees: [1, 3, 6, 4], moods: ["dreamy", "emotional"] },
      { degrees: [1, 2, 4, 5], moods: ["bright", "dreamy"] },
      { degrees: [4, 1, 5, 6], moods: ["dreamy"] },
      { degrees: [1, 3, 6, 4, 1, 3, 2, 5], moods: ["dreamy"] },
      { degrees: [4, 1, 5, 6, 4, 1, 2, 5], moods: ["emotional"] }
    ],
    rnb: [
      { degrees: [2, 5, 1, 6], moods: ["emotional", "dreamy"] },
      { degrees: [1, 6, 2, 5], moods: ["emotional"] },
      { degrees: [4, 3, 2, 5], moods: ["dreamy", "tense"] },
      { degrees: [2, 5, 1, 6, 2, 5, 3, 6], moods: ["emotional"] },
      { degrees: [4, 3, 2, 5, 1, 6, 2, 5], moods: ["dreamy"] }
    ],
    jazz: [
      { degrees: [2, 5, 1, 6], moods: ["bright", "emotional"] },
      { degrees: [3, 6, 2, 5], moods: ["tense", "dreamy"] },
      { degrees: [1, 6, 2, 5], moods: ["bright"] },
      { degrees: [1, 6, 2, 5, 3, 6, 2, 5], moods: ["bright"] },
      { degrees: [3, 6, 2, 5, 1, 4, 2, 5], moods: ["tense"] }
    ]
  },
  minor: {
    pop: [
      { degrees: [1, 6, 3, 7], moods: ["emotional", "dreamy"] },
      { degrees: [1, 7, 6, 7], moods: ["powerful", "tense"] },
      { degrees: [6, 7, 1, 5], moods: ["emotional", "powerful"] },
      { degrees: [1, 6, 3, 7, 1, 6, 7, 7], moods: ["emotional"] },
      { degrees: [1, 7, 6, 7, 1, 7, 5, 5], moods: ["tense"] }
    ],
    ballad: [
      { degrees: [1, 6, 3, 7], moods: ["emotional", "dreamy"] },
      { degrees: [1, 4, 6, 5], moods: ["emotional"] },
      { degrees: [6, 7, 1, 5], moods: ["emotional", "tense"] },
      { degrees: [1, 6, 3, 7, 4, 6, 5, 5], moods: ["emotional"] },
      { degrees: [6, 3, 7, 1, 4, 6, 5, 5], moods: ["dreamy"] }
    ],
    rock: [
      { degrees: [1, 7, 6, 7], moods: ["powerful", "tense"] },
      { degrees: [1, 6, 7, 1], moods: ["powerful"] },
      { degrees: [1, 5, 6, 7], moods: ["powerful", "tense"] },
      { degrees: [1, 7, 6, 7, 1, 5, 6, 7], moods: ["powerful"] },
      { degrees: [1, 6, 7, 1, 6, 7, 5, 5], moods: ["tense"] }
    ],
    indie: [
      { degrees: [1, 3, 7, 6], moods: ["dreamy", "emotional"] },
      { degrees: [1, 4, 7, 3], moods: ["dreamy"] },
      { degrees: [6, 3, 7, 1], moods: ["emotional"] },
      { degrees: [1, 3, 7, 6, 1, 4, 7, 3], moods: ["dreamy"] },
      { degrees: [6, 3, 7, 1, 4, 6, 5, 5], moods: ["emotional"] }
    ],
    rnb: [
      { degrees: [1, 4, 7, 3], moods: ["dreamy", "emotional"] },
      { degrees: [6, 7, 1, 5], moods: ["emotional", "tense"] },
      { degrees: [4, 5, 1, 6], moods: ["emotional"] },
      { degrees: [1, 4, 7, 3, 6, 7, 1, 5], moods: ["dreamy"] },
      { degrees: [4, 5, 1, 6, 2, 5, 1, 1], moods: ["emotional"] }
    ],
    jazz: [
      { degrees: [2, 5, 1, 6], moods: ["tense", "emotional"] },
      { degrees: [1, 6, 2, 5], moods: ["dreamy"] },
      { degrees: [4, 7, 3, 6], moods: ["tense"] },
      { degrees: [2, 5, 1, 6, 2, 5, 1, 1], moods: ["emotional"] },
      { degrees: [4, 7, 3, 6, 2, 5, 1, 5], moods: ["tense"] }
    ]
  }
};

const GENRE_LABELS = { pop: "팝", ballad: "발라드", rock: "록", indie: "인디", rnb: "R&B", jazz: "재즈" };
const MOOD_LABELS = { bright: "밝고 편안함", emotional: "감성적", powerful: "강하고 시원함", dreamy: "몽환적", tense: "긴장감" };
const MODE_LABELS = { major: "메이저", minor: "마이너" };
const COMPLEXITY_LABELS = { basic: "기본 3화음", colorful: "감성 확장", seventh: "7th 중심" };
const HARMONIC_ROLES = {
  major: { tonic: [1, 3, 6], predominant: [2, 4, 6], dominant: [5, 7] },
  minor: { tonic: [1, 3, 6], predominant: [2, 4, 6], dominant: [5, 7] }
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

const TAB_LABELS = {
  chords: "코드 진행",
  vocalTune: "보컬튠",
  recording: "녹음실",
  mixer: "2트랙 믹서",
  metronome: "메트로놈",
  tuner: "튜너"
};

function transportUpdate(source, status, active = false, mode = "idle") {
  window.HoonTransport?.update({ source, status, active, mode });
}

function currentProjectId() {
  return window.HoonProjects?.getCurrentId?.() || "project-default";
}

function normalizedProjectId(recording) {
  return window.HoonProjects?.normalizeRecordingProjectId?.(recording?.projectId) || recording?.projectId || "project-default";
}

function visibleRecordings() {
  const projectId = currentProjectId();
  return state.recordings.filter((recording) => normalizedProjectId(recording) === projectId);
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
  transportUpdate("메트로놈", `${$("#bpmSlider").value} BPM 재생 중`, true, "playing");
}

function stopMetronome() {
  state.metronomeRunning = false;
  window.clearInterval(state.schedulerId);
  state.schedulerId = null;
  clearBeatTimers();
  $("#toggleMetronome").textContent = "시작";
  if (state.currentTab === "metronome") transportUpdate("메트로놈", "정지됨", false, "idle");
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

function prefersFlats(key, mode = null) {
  if (/b/.test(key) || key === "F") return true;
  if (mode === "minor") return ["D", "G", "C"].includes(key);
  return false;
}

function noteAt(root, semitones, preferFlats = false) {
  const rootIndex = NOTE_NAMES_SHARP.indexOf(normalizeRoot(root));
  const sharpName = NOTE_NAMES_SHARP[(rootIndex + semitones + 120) % 12];
  if (!preferFlats) return sharpName;
  const flatMap = { "D#": "Eb", "G#": "Ab", "A#": "Bb", "C#": "Db", "F#": "Gb" };
  return flatMap[sharpName] || sharpName;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getGeneratorSettings() {
  return {
    key: $("#keySelect").value,
    mode: $("#modeSelect").value,
    genre: $("#genreSelect").value,
    mood: $("#moodSelect").value,
    length: Number($("#progressionLength").value),
    complexity: $("#complexitySelect").value
  };
}

function qualityForDegree(mode, degree, complexity, randomizeColor = true) {
  const scale = SCALE_DATA[mode];
  if (complexity === "seventh") return scale.sevenths[degree - 1];
  if (complexity === "colorful") {
    const candidates = COLOR_QUALITIES[mode][degree - 1];
    return randomizeColor ? randomItem(candidates) : candidates[0];
  }
  return scale.triads[degree - 1];
}

function buildChord(key, mode, degree, complexity, randomizeColor = true) {
  const scale = SCALE_DATA[mode];
  const root = noteAt(key, scale.semitones[degree - 1], prefersFlats(key, mode));
  const quality = qualityForDegree(mode, degree, complexity, randomizeColor);
  return {
    degree,
    root,
    quality,
    symbol: `${root}${quality}`,
    roman: scale.roman[degree - 1]
  };
}

function chooseProgressionDegrees() {
  const { mode, genre, mood, length } = getGeneratorSettings();
  const all = PROGRESSION_LIBRARY[mode][genre];
  const correctLength = all.filter((item) => item.degrees.length === length);
  const moodMatches = correctLength.filter((item) => item.moods.includes(mood));
  return [...randomItem(moodMatches.length ? moodMatches : correctLength).degrees];
}

function rebuildProgressionFromDegrees(randomizeColor = true) {
  const { key, mode, complexity } = getGeneratorSettings();
  state.progression = state.progressionDegrees.map((degree) => buildChord(key, mode, degree, complexity, randomizeColor));
  state.roman = state.progression.map((chord) => chord.roman);
  state.selectedChordIndex = clamp(state.selectedChordIndex, 0, Math.max(0, state.progression.length - 1));
  renderProgression();
  updateGeneratorSummary();
  saveChordSettings();
}

function generateProgression() {
  stopProgression();
  state.progressionDegrees = chooseProgressionDegrees();
  state.selectedChordIndex = 0;
  rebuildProgressionFromDegrees(true);
  $("#copyStatus").textContent = "";
}

function updateGeneratorSummary() {
  const { key, mode, genre, mood, complexity } = getGeneratorSettings();
  $("#generatorSummary").textContent = `${key} ${MODE_LABELS[mode]} · ${GENRE_LABELS[genre]} · ${MOOD_LABELS[mood]} · ${COMPLEXITY_LABELS[complexity]}`;
}

function getChordNotes(chord) {
  const intervals = CHORD_INTERVALS[chord.quality] || CHORD_INTERVALS[""];
  const flat = prefersFlats(chord.root);
  return intervals.map((interval) => noteAt(chord.root, interval, flat));
}

function getHarmonicRole(mode, degree) {
  const entries = Object.entries(HARMONIC_ROLES[mode]);
  const found = entries.find(([, degrees]) => degrees.includes(degree));
  return found ? found[0] : "tonic";
}

function harmonicRoleLabel(role) {
  return { tonic: "안정감을 만드는 토닉 계열", predominant: "진행을 움직이는 서브도미넌트 계열", dominant: "긴장과 해결을 만드는 도미넌트 계열" }[role];
}

function renderProgression() {
  $("#romanProgression").textContent = state.roman.join(" – ");
  const container = $("#chordCards");
  container.innerHTML = "";

  state.progression.forEach((chord, index) => {
    const card = document.createElement("article");
    card.className = "chord-card";
    card.dataset.index = String(index);
    card.classList.toggle("is-selected", index === state.selectedChordIndex);
    const notes = getChordNotes(chord).join(" · ");
    card.innerHTML = `
      <button class="chord-select-area" type="button" aria-label="${chord.symbol} 코드 선택">
        <small>${index + 1}</small>
        <strong>${chord.symbol}</strong>
        <span>${notes}</span>
      </button>
      <div class="chord-card-actions">
        <button class="chord-mini-btn play-one" type="button" aria-label="${chord.symbol} 코드 듣기">▶</button>
        <button class="chord-mini-btn replace-one" type="button" aria-label="${chord.symbol} 코드 바꾸기">↻</button>
      </div>`;

    card.querySelector(".chord-select-area").addEventListener("click", () => selectChord(index));
    card.querySelector(".play-one").addEventListener("click", (event) => {
      event.stopPropagation();
      selectChord(index);
      playSingleChord(chord);
    });
    card.querySelector(".replace-one").addEventListener("click", (event) => {
      event.stopPropagation();
      replaceChordAt(index);
    });
    container.appendChild(card);
  });
  renderSelectedChord();
}

function selectChord(index) {
  state.selectedChordIndex = clamp(index, 0, state.progression.length - 1);
  $$(".chord-card").forEach((card, cardIndex) => card.classList.toggle("is-selected", cardIndex === state.selectedChordIndex));
  renderSelectedChord();
}

function replaceChordAt(index) {
  stopProgression();
  const { mode, key, complexity } = getGeneratorSettings();
  const currentDegree = state.progressionDegrees[index];
  const role = getHarmonicRole(mode, currentDegree);
  const alternatives = HARMONIC_ROLES[mode][role].filter((degree) => degree !== currentDegree);
  const nextDegree = alternatives.length ? randomItem(alternatives) : currentDegree;
  state.progressionDegrees[index] = nextDegree;
  state.progression[index] = buildChord(key, mode, nextDegree, complexity, true);
  state.roman[index] = state.progression[index].roman;
  state.selectedChordIndex = index;
  renderProgression();
  saveChordSettings();
}

function renderSelectedChord() {
  const chord = state.progression[state.selectedChordIndex];
  if (!chord) return;
  const notes = getChordNotes(chord);
  const role = getHarmonicRole($("#modeSelect").value, chord.degree);
  $("#selectedChordName").textContent = chord.symbol;
  $("#selectedChordInfo").textContent = `구성음 ${notes.join(" · ")} · ${harmonicRoleLabel(role)}`;
  renderPianoKeyboard(chord);
}

function renderPianoKeyboard(chord) {
  const container = $("#pianoKeyboard");
  const chordNotes = getChordNotes(chord).map(normalizeRoot);
  const root = normalizeRoot(chord.root);
  const whiteNotes = ["C", "D", "E", "F", "G", "A", "B"];
  const blackNotes = [
    { note: "C#", left: 10.8 },
    { note: "D#", left: 25.1 },
    { note: "F#", left: 53.7 },
    { note: "G#", left: 68.0 },
    { note: "A#", left: 82.3 }
  ];
  container.innerHTML = "";
  whiteNotes.forEach((note) => {
    const key = document.createElement("span");
    key.className = "piano-key white-key";
    key.classList.toggle("is-active", chordNotes.includes(note));
    key.classList.toggle("is-root", root === note);
    key.textContent = note;
    container.appendChild(key);
  });
  blackNotes.forEach(({ note, left }) => {
    const key = document.createElement("span");
    key.className = "piano-key black-key";
    key.style.left = `${left}%`;
    key.classList.toggle("is-active", chordNotes.includes(note));
    key.classList.toggle("is-root", root === note);
    key.textContent = note;
    container.appendChild(key);
  });
}

function noteFrequency(noteName, octave = 4) {
  const normalized = normalizeRoot(noteName);
  const noteIndex = NOTE_NAMES_SHARP.indexOf(normalized);
  const midi = 12 * (octave + 1) + noteIndex;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function oscillatorEnvelope(preset, gain, startTime, duration) {
  gain.gain.cancelScheduledValues(startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  if (preset === "pad") {
    gain.gain.linearRampToValueAtTime(0.13, startTime + Math.min(0.35, duration * 0.25));
    gain.gain.setValueAtTime(0.11, Math.max(startTime + 0.36, startTime + duration * 0.68));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  } else if (preset === "pluck") {
    gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(duration, 0.7));
  } else {
    gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.055, startTime + Math.min(0.3, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  }
}

function playTone(note, octave, startTime, duration, preset, level = 1) {
  const audio = ensureAudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = preset === "pad" ? "sine" : preset === "pluck" ? "triangle" : "triangle";
  oscillator.frequency.setValueAtTime(noteFrequency(note, octave), startTime);
  oscillator.detune.value = preset === "pad" ? -3 : 0;
  oscillatorEnvelope(preset, gain, startTime, duration);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.connect(audio.destination);
  oscillator.connect(gain);
  const scaledGain = audio.createGain();
  scaledGain.gain.value = level;
  gain.disconnect();
  gain.connect(scaledGain).connect(audio.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.08);
  state.chordOscillators.push(oscillator);
  oscillator.addEventListener("ended", () => {
    state.chordOscillators = state.chordOscillators.filter((item) => item !== oscillator);
  }, { once: true });
}

function chordTransitionOverlap(slotDuration, preset) {
  if (preset === "pluck") return 0;
  if (preset === "pad") return Math.min(0.2, slotDuration * 0.08);
  return Math.min(0.12, slotDuration * 0.05);
}

function playChord(chord, startTime, slotDuration = 1.2, style = "block", preset = "soft") {
  const notes = getChordNotes(chord);
  const noteEvents = [];
  const overlap = chordTransitionOverlap(slotDuration, preset);

  if (style === "arpeggio") {
    notes.forEach((note, index) => {
      const offset = index * Math.min(0.18, slotDuration / (notes.length + 2));
      noteEvents.push({
        note,
        offset,
        length: Math.max(0.35, slotDuration - offset + overlap)
      });
    });
  } else if (style === "pulse") {
    const pulseCount = Math.max(2, Math.round(slotDuration / 0.45));
    const pulseSpacing = slotDuration / pulseCount;
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      notes.forEach((note) => noteEvents.push({
        note,
        offset: pulse * pulseSpacing,
        length: Math.min(0.38, pulseSpacing * 0.9)
      }));
    }
  } else {
    notes.forEach((note) => noteEvents.push({ note, offset: 0, length: slotDuration + overlap }));
  }

  noteEvents.forEach((event, index) => {
    const noteIndex = notes.indexOf(event.note);
    const octave = noteIndex === 0 ? 3 : 4 + Math.floor((CHORD_INTERVALS[chord.quality]?.[noteIndex] || 0) / 12);
    playTone(event.note, octave, startTime + event.offset, event.length, preset, index === 0 ? 0.8 : 0.58);
  });
}

function clearChordHighlights() {
  $$(".chord-card").forEach((card) => card.classList.remove("is-playing"));
}

function scheduleProgressionCycle(startAt) {
  const audio = ensureAudioContext();
  const bpm = clamp(Number($("#chordBpm").value) || 90, 40, 200);
  const beats = Number($("#beatsPerChord").value) || 4;
  const style = $("#playStyle").value;
  const preset = $("#soundPreset").value;
  const secondsPerChord = (60 / bpm) * beats;

  state.progression.forEach((chord, index) => {
    const chordStart = startAt + index * secondsPerChord;
    // 코드 슬롯 전체를 재생하고, 부드러운 음색은 다음 코드와 짧게 겹쳐 공백을 없앤다.
    playChord(chord, chordStart, secondsPerChord, style, preset);
    const delay = Math.max(0, (chordStart - audio.currentTime) * 1000);
    const timer = setTimeout(() => {
      clearChordHighlights();
      const card = $(`.chord-card[data-index="${index}"]`);
      if (card) card.classList.add("is-playing");
      selectChord(index);
    }, delay);
    state.chordTimers.push(timer);
  });

  const cycleDuration = state.progression.length * secondsPerChord;
  state.chordTimers.push(setTimeout(clearChordHighlights, Math.max(0, (startAt - audio.currentTime + cycleDuration) * 1000)));
  return cycleDuration;
}

function queueProgressionLoops() {
  if (!state.progressionPlaying || !$("#loopProgression").checked) {
    window.clearInterval(state.progressionLoopTimer);
    state.progressionLoopTimer = null;
    return;
  }

  const audio = ensureAudioContext();
  const lookAheadSeconds = 0.75;
  while (state.nextProgressionStart <= audio.currentTime + lookAheadSeconds) {
    scheduleProgressionCycle(state.nextProgressionStart);
    state.nextProgressionStart += state.progressionCycleDuration;
  }
}

function playProgression() {
  try {
    stopProgression();
    stopMetronome();
    stopTuner();
    const audio = ensureAudioContext();
    const bpm = clamp(Number($("#chordBpm").value) || 90, 40, 200);
    $("#chordBpm").value = String(bpm);
    const firstStart = audio.currentTime + 0.08;
    const cycleDuration = scheduleProgressionCycle(firstStart);

    state.progressionPlaying = true;
    state.progressionCycleDuration = cycleDuration;
    state.nextProgressionStart = firstStart + cycleDuration;

    if ($("#loopProgression").checked) {
      // 다음 반복을 경계 시점이 아니라 미리 Web Audio 시간축에 예약해 타이머 지연으로 인한 끊김을 방지한다.
      state.progressionLoopTimer = window.setInterval(queueProgressionLoops, 50);
      queueProgressionLoops();
    } else {
      const finishDelay = Math.max(0, (firstStart - audio.currentTime + cycleDuration + 0.25) * 1000);
      state.chordTimers.push(window.setTimeout(() => {
        state.progressionPlaying = false;
        clearChordHighlights();
        if (state.currentTab === "chords") transportUpdate("코드 진행", "재생 완료", false, "idle");
      }, finishDelay));
    }
    transportUpdate("코드 진행", `${state.progression.map((chord) => chord.symbol).join(" – ")} 재생 중`, true, "playing");
    savePlaybackSettings();
  } catch (error) {
    alert(error.message);
  }
}

function playSingleChord(chord) {
  try {
    stopProgression();
    const audio = ensureAudioContext();
    playChord(chord, audio.currentTime + 0.04, 1.8, $("#playStyle").value === "pulse" ? "block" : $("#playStyle").value, $("#soundPreset").value);
  } catch (error) {
    alert(error.message);
  }
}

function stopProgression() {
  state.progressionPlaying = false;
  state.nextProgressionStart = 0;
  state.progressionCycleDuration = 0;
  state.chordTimers.forEach(clearTimeout);
  state.chordTimers = [];
  window.clearInterval(state.progressionLoopTimer);
  window.clearTimeout(state.progressionLoopTimer);
  state.progressionLoopTimer = null;
  clearChordHighlights();
  state.chordOscillators.forEach((oscillator) => {
    try { oscillator.stop(); } catch {}
  });
  state.chordOscillators = [];
  if (state.currentTab === "chords") transportUpdate("코드 진행", "정지됨", false, "idle");
}

async function copyProgression() {
  const chords = state.progression.map((chord) => chord.symbol).join(" - ");
  const roman = state.roman.join(" - ");
  const settings = getGeneratorSettings();
  const text = `${settings.key} ${MODE_LABELS[settings.mode]} · ${GENRE_LABELS[settings.genre]}\n${chords}\n${roman}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  $("#copyStatus").textContent = `복사됨: ${chords}`;
}

function saveCurrentProgression() {
  const settings = getGeneratorSettings();
  const item = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    settings,
    degrees: [...state.progressionDegrees],
    chords: state.progression.map((chord) => ({ ...chord }))
  };
  state.savedProgressions.unshift(item);
  state.savedProgressions = state.savedProgressions.slice(0, 20);
  localStorage.setItem("hoonMusicSavedProgressions", JSON.stringify(state.savedProgressions));
  renderSavedProgressions();
  $("#copyStatus").textContent = "현재 코드 진행을 저장했습니다.";
}

function loadSavedProgression(id) {
  const item = state.savedProgressions.find((saved) => saved.id === id);
  if (!item) return;
  stopProgression();
  const settings = item.settings;
  $("#keySelect").value = settings.key;
  $("#modeSelect").value = settings.mode;
  $("#genreSelect").value = settings.genre;
  $("#moodSelect").value = settings.mood;
  $("#progressionLength").value = String(settings.length);
  $("#complexitySelect").value = settings.complexity;
  state.progressionDegrees = [...item.degrees];
  state.progression = item.chords.map((chord) => ({ ...chord }));
  state.roman = state.progression.map((chord) => chord.roman);
  state.selectedChordIndex = 0;
  renderProgression();
  updateGeneratorSummary();
  saveChordSettings();
  $("#copyStatus").textContent = "저장한 코드 진행을 불러왔습니다.";
}

function deleteSavedProgression(id) {
  state.savedProgressions = state.savedProgressions.filter((item) => item.id !== id);
  localStorage.setItem("hoonMusicSavedProgressions", JSON.stringify(state.savedProgressions));
  renderSavedProgressions();
}

function renderSavedProgressions() {
  const container = $("#savedProgressions");
  $("#savedCount").textContent = `${state.savedProgressions.length}개`;
  container.innerHTML = "";
  if (!state.savedProgressions.length) {
    container.innerHTML = '<p class="saved-empty">마음에 드는 진행을 저장하면 여기에 표시됩니다.</p>';
    return;
  }

  state.savedProgressions.forEach((item) => {
    const row = document.createElement("article");
    row.className = "saved-item";
    const chordText = item.chords.map((chord) => chord.symbol).join(" · ");
    row.innerHTML = `
      <button class="saved-load" type="button">
        <strong>${item.settings.key} ${MODE_LABELS[item.settings.mode]} · ${GENRE_LABELS[item.settings.genre]}</strong>
        <span>${chordText}</span>
      </button>
      <button class="saved-delete" type="button" aria-label="저장한 진행 삭제">삭제</button>`;
    row.querySelector(".saved-load").addEventListener("click", () => loadSavedProgression(item.id));
    row.querySelector(".saved-delete").addEventListener("click", () => deleteSavedProgression(item.id));
    container.appendChild(row);
  });
}

function saveChordSettings() {
  const settings = getGeneratorSettings();
  Object.entries(settings).forEach(([key, value]) => localStorage.setItem(`hoonMusicChord_${key}`, String(value)));
}

function savePlaybackSettings() {
  localStorage.setItem("hoonMusicChordBpm", String($("#chordBpm").value));
  localStorage.setItem("hoonMusicBeatsPerChord", $("#beatsPerChord").value);
  localStorage.setItem("hoonMusicPlayStyle", $("#playStyle").value);
  localStorage.setItem("hoonMusicSoundPreset", $("#soundPreset").value);
  localStorage.setItem("hoonMusicLoopProgression", $("#loopProgression").checked ? "1" : "0");
}

function loadSettings() {
  setBpm(localStorage.getItem("hoonMusicBpm") || 100);
  $("#keySelect").value = localStorage.getItem("hoonMusicChord_key") || localStorage.getItem("hoonMusicKey") || "C";
  $("#modeSelect").value = localStorage.getItem("hoonMusicChord_mode") || "major";
  $("#genreSelect").value = localStorage.getItem("hoonMusicChord_genre") || "pop";
  $("#moodSelect").value = localStorage.getItem("hoonMusicChord_mood") || localStorage.getItem("hoonMusicMood") || "bright";
  $("#progressionLength").value = localStorage.getItem("hoonMusicChord_length") || "4";
  $("#complexitySelect").value = localStorage.getItem("hoonMusicChord_complexity") || "basic";
  $("#chordBpm").value = localStorage.getItem("hoonMusicChordBpm") || "90";
  $("#beatsPerChord").value = localStorage.getItem("hoonMusicBeatsPerChord") || "4";
  $("#playStyle").value = localStorage.getItem("hoonMusicPlayStyle") || "block";
  $("#soundPreset").value = localStorage.getItem("hoonMusicSoundPreset") || "soft";
  $("#loopProgression").checked = localStorage.getItem("hoonMusicLoopProgression") === "1";
  try {
    state.savedProgressions = JSON.parse(localStorage.getItem("hoonMusicSavedProgressions") || "[]");
    if (!Array.isArray(state.savedProgressions)) state.savedProgressions = [];
  } catch {
    state.savedProgressions = [];
  }

  const savedTuningMode = localStorage.getItem("hoonMusicTuningMode") || "chromatic";
  $("#tuningMode").value = savedTuningMode;
  const savedTargetValue = localStorage.getItem(`hoonMusicTarget_${savedTuningMode}`);
  const savedTarget = savedTargetValue === null ? -1 : Number(savedTargetValue);
  state.tunerTargetIndex = Number.isInteger(savedTarget) ? savedTarget : -1;
  setA4Reference(localStorage.getItem("hoonMusicA4") || 440);

  $("#vocalKeySelect").value = localStorage.getItem("hoonMusicVocalKey") || "C";
  $("#vocalScaleSelect").value = localStorage.getItem("hoonMusicVocalScale") || "major";
  $("#vocalTargetMode").value = localStorage.getItem("hoonMusicVocalTargetMode") || "auto";
  $("#vocalRangeSelect").value = localStorage.getItem("hoonMusicVocalRange") || "all";
  $("#vocalTargetOctave").value = localStorage.getItem("hoonMusicVocalOctave") || "4";
  const savedPitchClassValue = localStorage.getItem("hoonMusicVocalPitchClass");
  const savedPitchClass = savedPitchClassValue === null ? NaN : Number(savedPitchClassValue);
  const rootPitchClass = NOTE_NAMES_SHARP.indexOf(normalizeRoot($("#vocalKeySelect").value));
  state.vocalFixedPitchClass = Number.isInteger(savedPitchClass) && savedPitchClass >= 0 && savedPitchClass < 12
    ? savedPitchClass
    : rootPitchClass;

  $("#mrMonitorVolume").value = localStorage.getItem("hoonMusicMrMonitorVolume") || "80";
  $("#mrMixVolume").value = localStorage.getItem("hoonMusicMrMixVolume") || "70";
  $("#vocalMixVolume").value = localStorage.getItem("hoonMusicVocalMixVolume") || "100";
  $("#autoPlayMr").checked = localStorage.getItem("hoonMusicAutoPlayMr") !== "0";
  $("#includeMrInRecording").checked = localStorage.getItem("hoonMusicIncludeMr") !== "0";
  $("#autoStopOnMrEnd").checked = localStorage.getItem("hoonMusicAutoStopMr") !== "0";
  $("#recordingCountIn").checked = localStorage.getItem("hoonMusicRecordingCountIn") !== "0";
  $("#mrSyncOffset").value = String(clamp(Number(localStorage.getItem("hoonMusicMrSyncOffset") ?? DEFAULT_MR_SYNC_MS), MIN_MR_SYNC_MS, MAX_MR_SYNC_MS));
  updateMrMixerLabels();
  updateMrSyncControls();
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

function getCurrentTuningPreset() {
  return TUNING_PRESETS[$("#tuningMode").value] || null;
}

function renderTuningTargets() {
  const mode = $("#tuningMode").value;
  const preset = getCurrentTuningPreset();
  const container = $("#stringTargetButtons");
  const hint = $("#stringTargetHint");
  container.innerHTML = "";

  const createButton = (text, index, ariaLabel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "string-target-btn";
    button.textContent = text;
    button.setAttribute("aria-label", ariaLabel);
    button.classList.toggle("is-active", state.tunerTargetIndex === index);
    button.addEventListener("click", () => {
      state.tunerTargetIndex = index;
      localStorage.setItem(`hoonMusicTarget_${mode}`, String(index));
      state.tunerPitchHistory = [];
      renderTuningTargets();
      if (state.tunerRunning) {
        const message = index < 0 ? "자동 감지 모드입니다. 악기 한 줄을 연주해 주세요." : `${preset[index].label}을 길게 연주해 주세요.`;
        resetTunerDisplay(message);
      }
    });
    container.appendChild(button);
  };

  if (!preset) {
    state.tunerTargetIndex = -1;
    hint.textContent = "연주한 소리에서 가장 가까운 음을 자동으로 찾습니다.";
    createButton("자동 감지", -1, "모든 음 자동 감지");
    return;
  }

  if (state.tunerTargetIndex >= preset.length || state.tunerTargetIndex < -1) state.tunerTargetIndex = -1;
  hint.textContent = state.tunerTargetIndex < 0
    ? "자동으로 가장 가까운 줄을 찾습니다."
    : "선택한 줄만 기준으로 음정을 확인합니다.";
  createButton("자동", -1, "가장 가까운 줄 자동 선택");
  preset.forEach((item, index) => createButton(item.shortLabel, index, `${item.label} 선택`));
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

  const preset = getCurrentTuningPreset() || TUNING_PRESETS.guitarStandard;
  const lockedTarget = state.tunerTargetIndex >= 0 ? preset[state.tunerTargetIndex] : null;
  const target = lockedTarget || preset.reduce((best, item) => (
    Math.abs(item.midi - midiFloat) < Math.abs(best.midi - midiFloat) ? item : best
  ));
  return {
    ...target,
    label: lockedTarget ? `${target.label} · 고정` : target.label,
    name: midiNoteName(target.midi)
  };
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
    $("#tunerMessage").textContent = "선택한 줄과 음정 차이가 큽니다. 다른 줄인지 확인해 주세요.";
    setTunerBadge(cents < 0 ? "낮음" : "높음", "listening");
  } else {
    const isStringInstrumentMode = $("#tuningMode").value !== "chromatic";
    if (isStringInstrumentMode) {
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
    stopVocalTune(false);
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
    transportUpdate("튜너", "마이크 음정 분석 중", true, "analysis");
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
  if (state.currentTab === "tuner") transportUpdate("튜너", "대기 중", false, "idle");
}

function toggleTuner() {
  if (state.tunerStarting) return;
  if (state.tunerRunning) stopTuner();
  else startTuner();
}


function getVocalSettings() {
  return {
    key: $("#vocalKeySelect").value,
    scale: $("#vocalScaleSelect").value,
    targetMode: $("#vocalTargetMode").value,
    range: $("#vocalRangeSelect").value,
    octave: Number($("#vocalTargetOctave").value) || 4
  };
}

function saveVocalSettings() {
  const settings = getVocalSettings();
  localStorage.setItem("hoonMusicVocalKey", settings.key);
  localStorage.setItem("hoonMusicVocalScale", settings.scale);
  localStorage.setItem("hoonMusicVocalTargetMode", settings.targetMode);
  localStorage.setItem("hoonMusicVocalRange", settings.range);
  localStorage.setItem("hoonMusicVocalOctave", String(settings.octave));
  localStorage.setItem("hoonMusicVocalPitchClass", String(state.vocalFixedPitchClass));
}

function vocalScalePitchClasses() {
  const settings = getVocalSettings();
  const root = NOTE_NAMES_SHARP.indexOf(normalizeRoot(settings.key));
  const intervals = VOCAL_SCALE_INTERVALS[settings.scale] || VOCAL_SCALE_INTERVALS.major;
  return intervals.map((interval) => (root + interval) % 12);
}

function displayMidiName(midi, key = "C") {
  const rounded = Math.round(midi);
  const pitchClass = ((rounded % 12) + 12) % 12;
  const note = noteAt("C", pitchClass, prefersFlats(key));
  const octave = Math.floor(rounded / 12) - 1;
  return `${note}${octave}`;
}

function ensureValidVocalFixedPitch() {
  const allowed = vocalScalePitchClasses();
  if (!allowed.includes(state.vocalFixedPitchClass)) state.vocalFixedPitchClass = allowed[0];
}

function renderVocalScaleNotes() {
  ensureValidVocalFixedPitch();
  const settings = getVocalSettings();
  const container = $("#vocalScaleNotes");
  container.innerHTML = "";
  vocalScalePitchClasses().forEach((pitchClass) => {
    const chip = document.createElement("span");
    chip.className = "vocal-note-chip";
    chip.textContent = noteAt("C", pitchClass, prefersFlats(settings.key));
    container.appendChild(chip);
  });
  renderVocalTargetButtons();
  $("#vocalFixedTargetPanel").hidden = settings.targetMode !== "fixed";
  saveVocalSettings();
}

function renderVocalTargetButtons() {
  const settings = getVocalSettings();
  const container = $("#vocalTargetButtons");
  container.innerHTML = "";
  vocalScalePitchClasses().forEach((pitchClass) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vocal-target-btn";
    button.classList.toggle("is-active", pitchClass === state.vocalFixedPitchClass);
    button.textContent = noteAt("C", pitchClass, prefersFlats(settings.key));
    button.addEventListener("click", () => {
      state.vocalFixedPitchClass = pitchClass;
      state.vocalTargetMidi = fixedVocalTargetMidi();
      resetVocalPracticeStats(false);
      renderVocalTargetButtons();
      saveVocalSettings();
      updateVocalIdleTarget();
    });
    container.appendChild(button);
  });
}

function setVocalBadge(text, mode = "") {
  const badge = $("#vocalStatusBadge");
  badge.textContent = text;
  badge.classList.remove("is-listening", "is-close", "is-error");
  if (mode) badge.classList.add(`is-${mode}`);
}

function fixedVocalTargetMidi() {
  const octave = Number($("#vocalTargetOctave").value) || 4;
  return 12 * (octave + 1) + state.vocalFixedPitchClass;
}

function autoVocalTargetMidi(frequency) {
  const midiFloat = 69 + 12 * Math.log2(frequency / getA4Reference());
  const allowed = new Set(vocalScalePitchClasses());
  let bestMidi = Math.round(midiFloat);
  let bestDistance = Infinity;
  const center = Math.round(midiFloat);
  for (let midi = center - 12; midi <= center + 12; midi += 1) {
    if (!allowed.has(((midi % 12) + 12) % 12)) continue;
    const distance = Math.abs(midiFloat - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMidi = midi;
    }
  }
  return bestMidi;
}

function getVocalTargetMidi(frequency = null) {
  if ($("#vocalTargetMode").value === "fixed") return fixedVocalTargetMidi();
  if (frequency) return autoVocalTargetMidi(frequency);
  if (Number.isFinite(state.vocalTargetMidi)) return state.vocalTargetMidi;
  const settings = getVocalSettings();
  const rootPitchClass = NOTE_NAMES_SHARP.indexOf(normalizeRoot(settings.key));
  return 12 * (4 + 1) + rootPitchClass;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function renderVocalTrace() {
  const container = $("#vocalPitchTrace");
  container.innerHTML = "";
  if (!state.vocalTrace.length) {
    const empty = document.createElement("span");
    empty.className = "vocal-trace-empty";
    empty.textContent = "보컬튠을 시작하면 음정 움직임이 표시됩니다.";
    container.appendChild(empty);
    return;
  }
  state.vocalTrace.forEach((cents) => {
    const point = document.createElement("span");
    point.className = "vocal-trace-point";
    point.classList.toggle("is-in-tune", Math.abs(cents) <= 8);
    point.style.setProperty("--trace-position", String(clamp(cents, -50, 50)));
    container.appendChild(point);
  });
}

function resetVocalPracticeStats(clearTarget = true) {
  state.vocalScoreTotal = 0;
  state.vocalScoreSamples = 0;
  state.vocalHoldStart = 0;
  state.vocalRecentCents = [];
  state.vocalTrace = [];
  if (clearTarget && $("#vocalTargetMode").value === "auto") state.vocalTargetMidi = null;
  $("#vocalScore").textContent = "--";
  $("#vocalHoldTime").textContent = "0.0초";
  $("#vocalStability").textContent = "--";
  renderVocalTrace();
}

function updateVocalIdleTarget() {
  const settings = getVocalSettings();
  const targetMidi = getVocalTargetMidi();
  $("#vocalTargetNote").textContent = displayMidiName(targetMidi, settings.key);
  $("#vocalTargetText").textContent = settings.targetMode === "fixed"
    ? `${displayMidiName(targetMidi, settings.key)} 목표음을 길게 불러 보세요.`
    : `${settings.key} ${VOCAL_SCALE_LABELS[settings.scale]} 음에 맞춰 안내합니다.`;
}

function resetVocalDisplay(message = "한 음을 길고 편안하게 불러 주세요.") {
  $("#vocalDetectedNote").textContent = "--";
  $("#vocalDetectedNote").classList.remove("is-in-tune");
  $("#vocalFrequency").textContent = "-- Hz";
  $("#vocalCents").textContent = "-- cents";
  $("#vocalNeedle").style.setProperty("--needle-position", "0");
  $("#vocalNeedle").classList.remove("is-in-tune");
  $("#vocalMessage").textContent = message;
  updateVocalIdleTarget();
}

function updateVocalDisplay(frequency) {
  const settings = getVocalSettings();
  const range = VOCAL_RANGES[settings.range] || VOCAL_RANGES.all;
  if (frequency < range.min || frequency > range.max) {
    resetVocalDisplay("선택한 감지 범위를 벗어났습니다. 감지 범위를 바꾸거나 다른 음을 불러 주세요.");
    setVocalBadge("범위 밖", "close");
    return;
  }

  const targetMidi = getVocalTargetMidi(frequency);
  if (state.vocalTargetMidi !== targetMidi) {
    state.vocalRecentCents = [];
    state.vocalHoldStart = 0;
  }
  state.vocalTargetMidi = targetMidi;

  const targetFrequency = midiFrequency(targetMidi, getA4Reference());
  const cents = 1200 * Math.log2(frequency / targetFrequency);
  const roundedCents = Math.round(cents);
  const absoluteCents = Math.abs(cents);
  const inTune = absoluteCents <= 5;
  const close = absoluteCents <= 15;
  const detectedMidi = 69 + 12 * Math.log2(frequency / getA4Reference());
  const detectedName = displayMidiName(Math.round(detectedMidi), settings.key);
  const targetName = displayMidiName(targetMidi, settings.key);
  const sign = roundedCents > 0 ? "+" : "";

  $("#vocalDetectedNote").textContent = detectedName;
  $("#vocalDetectedNote").classList.toggle("is-in-tune", inTune);
  $("#vocalTargetNote").textContent = targetName;
  $("#vocalTargetText").textContent = settings.targetMode === "fixed"
    ? `${targetName} 목표음에 맞추는 중`
    : `${settings.key} ${VOCAL_SCALE_LABELS[settings.scale]}에서 가장 가까운 목표음`;
  $("#vocalFrequency").textContent = `${frequency.toFixed(1)} Hz`;
  $("#vocalCents").textContent = `${sign}${roundedCents} cents`;
  $("#vocalNeedle").style.setProperty("--needle-position", String(clamp(cents, -50, 50)));
  $("#vocalNeedle").classList.toggle("is-in-tune", inTune);

  const instantScore = Math.round(clamp(100 - absoluteCents * 2, 0, 100));
  state.vocalScoreTotal += instantScore;
  state.vocalScoreSamples += 1;
  const averageScore = Math.round(state.vocalScoreTotal / state.vocalScoreSamples);
  $("#vocalScore").textContent = `${averageScore}점`;

  state.vocalRecentCents.push(cents);
  if (state.vocalRecentCents.length > 10) state.vocalRecentCents.shift();
  const stability = Math.round(clamp(100 - standardDeviation(state.vocalRecentCents) * 3, 0, 100));
  $("#vocalStability").textContent = `${stability}%`;

  if (close) {
    if (!state.vocalHoldStart) state.vocalHoldStart = performance.now();
    const holdSeconds = (performance.now() - state.vocalHoldStart) / 1000;
    $("#vocalHoldTime").textContent = `${holdSeconds.toFixed(1)}초`;
  } else {
    state.vocalHoldStart = 0;
    $("#vocalHoldTime").textContent = "0.0초";
  }

  state.vocalTrace.push(cents);
  if (state.vocalTrace.length > 36) state.vocalTrace.shift();
  renderVocalTrace();

  if (inTune) {
    $("#vocalMessage").textContent = "정확한 음정입니다. 같은 힘으로 유지해 보세요.";
    setVocalBadge("정확", "listening");
  } else if (close) {
    $("#vocalMessage").textContent = cents < 0
      ? "거의 맞았습니다. 소리를 아주 조금 올려 주세요."
      : "거의 맞았습니다. 소리를 아주 조금 내려 주세요.";
    setVocalBadge("거의 맞음", "close");
  } else {
    $("#vocalMessage").textContent = cents < 0
      ? "목표음보다 낮습니다. 목에 힘을 주지 말고 음을 조금 올려 보세요."
      : "목표음보다 높습니다. 힘을 조금 빼고 음을 내려 보세요.";
    setVocalBadge(cents < 0 ? "낮음" : "높음", "close");
  }
}

function runVocalAnalysis() {
  if (!state.vocalRunning || !state.vocalAnalyser || !state.vocalBuffer) return;
  state.vocalAnalyser.getFloatTimeDomainData(state.vocalBuffer);
  const frequency = detectPitchYin(state.vocalBuffer, state.audioContext.sampleRate);

  if (frequency) {
    state.vocalMissCount = 0;
    state.vocalPitchHistory.push(frequency);
    if (state.vocalPitchHistory.length > 4) state.vocalPitchHistory.shift();
    updateVocalDisplay(median(state.vocalPitchHistory));
  } else {
    state.vocalMissCount += 1;
    if (state.vocalMissCount >= 5) {
      state.vocalPitchHistory = [];
      state.vocalHoldStart = 0;
      resetVocalDisplay("목소리가 작거나 숨소리가 섞였습니다. 한 음을 조금 더 또렷하게 길게 불러 주세요.");
      setVocalBadge("듣는 중", "listening");
    }
  }
  state.vocalTimerId = window.setTimeout(runVocalAnalysis, 65);
}

async function startVocalTune() {
  const requestToken = ++state.vocalRequestToken;
  state.vocalStarting = true;
  $("#toggleVocalTune").disabled = true;
  $("#toggleVocalTune").textContent = "시작 중...";

  try {
    if (location.protocol === "file:") throw new Error("보컬튠은 PC에서 훈뮤직툴 실행.bat을 사용하거나, 모바일에서 HTTPS 배포 주소로 열어야 합니다.");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저 환경에서는 마이크를 사용할 수 없습니다. localhost 또는 HTTPS 주소로 접속해 주세요.");

    stopMetronome();
    stopProgression();
    window.HoonMixer?.stop?.({ preservePosition: false, silent: true });
    stopTuner(false);
    setVocalBadge("권한 확인 중", "listening");
    $("#vocalMessage").textContent = "마이크 사용 권한을 확인하고 있습니다.";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    });
    if (requestToken !== state.vocalRequestToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const audio = ensureAudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    const source = audio.createMediaStreamSource(stream);
    source.connect(analyser);

    state.vocalStream = stream;
    state.vocalSource = source;
    state.vocalAnalyser = analyser;
    state.vocalBuffer = new Float32Array(analyser.fftSize);
    state.vocalPitchHistory = [];
    state.vocalMissCount = 0;
    state.vocalStarting = false;
    state.vocalRunning = true;
    resetVocalPracticeStats(false);

    $("#toggleVocalTune").disabled = false;
    $("#toggleVocalTune").textContent = "보컬튠 정지";
    setVocalBadge("듣는 중", "listening");
    transportUpdate("보컬튠", "실시간 음정 분석 중", true, "analysis");
    resetVocalDisplay("한 음을 길고 또렷하게 불러 주세요.");
    runVocalAnalysis();
  } catch (error) {
    if (requestToken !== state.vocalRequestToken) return;
    stopVocalTune(false);
    const message = microphoneErrorMessage(error);
    resetVocalDisplay(message);
    setVocalBadge("사용 불가", "error");
  }
}

function stopVocalTargetTone() {
  state.vocalToneNodes.forEach((node) => {
    try { node.stop?.(); } catch {}
    try { node.disconnect?.(); } catch {}
  });
  state.vocalToneNodes = [];
}

function playVocalTargetTone() {
  try {
    const audio = ensureAudioContext();
    stopVocalTargetTone();
    const targetMidi = getVocalTargetMidi();
    const frequency = midiFrequency(targetMidi, getA4Reference());
    const now = audio.currentTime + 0.02;
    const master = audio.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    master.gain.setValueAtTime(0.16, now + 0.75);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    master.connect(audio.destination);

    const oscillator = audio.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.connect(master);
    oscillator.start(now);
    oscillator.stop(now + 1.18);

    const harmonicGain = audio.createGain();
    harmonicGain.gain.value = 0.22;
    const harmonic = audio.createOscillator();
    harmonic.type = "sine";
    harmonic.frequency.setValueAtTime(frequency * 2, now);
    harmonic.connect(harmonicGain).connect(master);
    harmonic.start(now);
    harmonic.stop(now + 1.18);

    state.vocalToneNodes = [oscillator, harmonic, harmonicGain, master];
    $("#vocalMessage").textContent = `${displayMidiName(targetMidi, getVocalSettings().key)} 기준음을 재생했습니다.`;
    window.setTimeout(() => { state.vocalToneNodes = []; }, 1300);
  } catch (error) {
    $("#vocalMessage").textContent = error.message;
  }
}

function stopVocalTune(reset = true) {
  state.vocalRequestToken += 1;
  state.vocalStarting = false;
  window.clearTimeout(state.vocalTimerId);
  state.vocalTimerId = null;
  if (state.vocalSource) {
    try { state.vocalSource.disconnect(); } catch {}
  }
  if (state.vocalStream) {
    const streamIsRecording = state.recordingStream === state.vocalStream
      && state.mediaRecorder
      && state.mediaRecorder.state !== "inactive";
    if (!streamIsRecording) state.vocalStream.getTracks().forEach((track) => track.stop());
  }
  state.vocalStream = null;
  state.vocalSource = null;
  state.vocalAnalyser = null;
  state.vocalBuffer = null;
  state.vocalPitchHistory = [];
  state.vocalMissCount = 0;
  state.vocalRunning = false;
  stopVocalTargetTone();
  $("#toggleVocalTune").disabled = false;
  $("#toggleVocalTune").textContent = "보컬튠 시작";
  if (reset) {
    resetVocalDisplay("한 음을 길고 편안하게 불러 주세요.");
    setVocalBadge("대기 중");
  }
  if (state.currentTab === "vocalTune") transportUpdate("보컬튠", "대기 중", false, "idle");
}

function toggleVocalTune() {
  if (state.vocalStarting) return;
  if (state.vocalRunning) stopVocalTune();
  else startVocalTune();
}



function formatMrDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  return formatRecordingDuration(seconds * 1000);
}


function formatSignedMilliseconds(value) {
  const milliseconds = Math.round(Number(value) || 0);
  if (milliseconds === 0) return "0ms";
  return `${milliseconds > 0 ? "+" : ""}${milliseconds}ms`;
}

function normalizeMrSyncOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clamp(Math.round(parsed), MIN_MR_SYNC_MS, MAX_MR_SYNC_MS);
}

function getMrSyncOffsetMs() {
  return normalizeMrSyncOffset($("#mrSyncOffset")?.value);
}

function updateMrSyncControls(valueOverride) {
  const value = normalizeMrSyncOffset(valueOverride ?? $("#mrSyncOffset")?.value);
  $("#mrSyncOffset").value = String(value);
  if ($("#mrSyncNumber")) $("#mrSyncNumber").value = String(value);
  $("#mrSyncOffsetValue").textContent = formatSignedMilliseconds(value);
  const context = state.audioContext;
  const now = context?.currentTime || 0;
  if (state.mrRecordDelay) state.mrRecordDelay.delayTime.setTargetAtTime(Math.max(0, value) / 1000, now, 0.01);
  if (state.recordingVocalDelay) state.recordingVocalDelay.delayTime.setTargetAtTime(Math.max(0, -value) / 1000, now, 0.01);
  localStorage.setItem("hoonMusicMrSyncOffset", String(value));
}

function adjustMrSyncOffset(delta) {
  updateMrSyncControls(getMrSyncOffsetMs() + Number(delta || 0));
}

function resetMrSyncOffset() {
  updateMrSyncControls(0);
  $("#mrMessage").textContent = "싱크 보정을 0ms로 맞췄습니다. 보컬이 늦으면 +, 빠르면 − 방향으로 조절하세요.";
}

function getRecordingCountInSeconds() {
  return $("#recordingCountIn")?.checked ? 3 : 0;
}

function getRecordingSyncTailMs() {
  return Math.abs(getMrSyncOffsetMs()) + 180;
}

async function decodeMrFile(file, token) {
  const context = ensureAudioContext();
  const encoded = await file.arrayBuffer();
  const buffer = await context.decodeAudioData(encoded.slice(0));
  if (token !== state.mrDecodeToken) throw new DOMException("MR 불러오기가 취소되었습니다.", "AbortError");
  if (!buffer?.duration || !Number.isFinite(buffer.duration)) throw new Error("MR 파일의 재생 시간을 확인하지 못했습니다.");
  state.mrAudioBuffer = buffer;
  return buffer;
}

async function waitForMrBufferReady() {
  if (!hasMrFile()) return null;
  if (state.mrAudioBuffer) return state.mrAudioBuffer;
  if (state.mrDecodePromise) return state.mrDecodePromise;
  throw new Error("MR 파일을 아직 분석하지 못했습니다. 파일을 다시 선택해 주세요.");
}

function hasMrFile() {
  const audio = $("#mrAudio");
  return Boolean(audio?.src && state.mrObjectUrl);
}

function saveMrSettings() {
  localStorage.setItem("hoonMusicMrMonitorVolume", $("#mrMonitorVolume").value);
  localStorage.setItem("hoonMusicMrMixVolume", $("#mrMixVolume").value);
  localStorage.setItem("hoonMusicVocalMixVolume", $("#vocalMixVolume").value);
  localStorage.setItem("hoonMusicAutoPlayMr", $("#autoPlayMr").checked ? "1" : "0");
  localStorage.setItem("hoonMusicIncludeMr", $("#includeMrInRecording").checked ? "1" : "0");
  localStorage.setItem("hoonMusicAutoStopMr", $("#autoStopOnMrEnd").checked ? "1" : "0");
  localStorage.setItem("hoonMusicRecordingCountIn", $("#recordingCountIn").checked ? "1" : "0");
  localStorage.setItem("hoonMusicMrSyncOffset", String(getMrSyncOffsetMs()));
}

function getMrRecordingGainValue() {
  // 상용 MR은 이미 최대 음량에 가깝기 때문에 녹음 버스에 여유 공간을 확보합니다.
  return (Number($("#mrMixVolume").value) / 100) * 0.62;
}

function getVocalRecordingGainValue() {
  return (Number($("#vocalMixVolume").value) / 100) * 0.72;
}

function waitForMrReady(timeoutMs = 6000) {
  if (!hasMrFile()) return Promise.resolve();
  const audio = $("#mrAudio");
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("MR 파일을 충분히 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    }, timeoutMs);
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("MR 파일을 재생할 수 없습니다. MP3 또는 WAV 파일로 다시 시도해 주세요.")); };
    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("loadeddata", onReady);
      audio.removeEventListener("error", onError);
    };
    audio.addEventListener("canplay", onReady, { once: true });
    audio.addEventListener("loadeddata", onReady, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.load();
  });
}

async function warnIfBluetoothMicrophone(stream) {
  try {
    const track = stream?.getAudioTracks?.()[0];
    const deviceId = track?.getSettings?.().deviceId;
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    const active = devices?.find((device) => device.kind === "audioinput" && (!deviceId || device.deviceId === deviceId));
    const label = `${active?.label || ""} ${track?.label || ""}`;
    if (/bluetooth|airpods|buds|headset|hands.?free|sco/i.test(label)) {
      $("#mrMessage").textContent = "블루투스 마이크가 선택되었습니다. 일부 휴대폰은 녹음 중 MR을 통화용 저음질로 바꿉니다. 유선 이어폰 또는 휴대폰 마이크 사용을 권장합니다.";
    }
  } catch (_) {}
}

function updateMrMixerLabels() {
  $("#mrMonitorVolumeValue").textContent = `${$("#mrMonitorVolume").value}%`;
  $("#mrMixVolumeValue").textContent = `${$("#mrMixVolume").value}%`;
  $("#vocalMixVolumeValue").textContent = `${$("#vocalMixVolume").value}%`;

  const now = state.audioContext?.currentTime || 0;
  if (state.mrMonitorGain) state.mrMonitorGain.gain.setTargetAtTime(Number($("#mrMonitorVolume").value) / 100, now, 0.01);
  if (state.mrRecordGain) state.mrRecordGain.gain.setTargetAtTime(getMrRecordingGainValue(), now, 0.01);
  if (state.recordingVocalGain) state.recordingVocalGain.gain.setTargetAtTime(getVocalRecordingGainValue(), now, 0.01);
  updateMrSyncControls();
  saveMrSettings();
}

function updateRecordingIdleText() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") return;
  $("#recordingStateText").textContent = hasMrFile()
    ? "녹음 시작을 누르면 보컬 원본과 MR을 각각의 트랙으로 저장합니다."
    : "MR 없이 보컬 트랙만 녹음할 수도 있습니다.";
}

function ensureMrMonitorGain() {
  const audioContext = ensureAudioContext();
  if (!state.mrMonitorGain) {
    state.mrMonitorGain = audioContext.createGain();
    state.mrMonitorGain.connect(audioContext.destination);
  }
  state.mrMonitorGain.gain.setTargetAtTime(Number($("#mrMonitorVolume").value) / 100, audioContext.currentTime, 0.01);
  return state.mrMonitorGain;
}

function ensureMrAudioGraph() {
  if (!hasMrFile()) return null;
  const audioContext = ensureAudioContext();
  const monitorGain = ensureMrMonitorGain();
  if (!state.mrSourceNode) {
    const mrAudio = $("#mrAudio");
    mrAudio.volume = 1;
    mrAudio.preload = "auto";
    mrAudio.playsInline = true;
    state.mrSourceNode = audioContext.createMediaElementSource(mrAudio);
    state.mrSourceNode.connect(monitorGain);
  }
  return state.mrSourceNode;
}

function setMrRecordingLocked(locked) {
  $("#mrFileInput").disabled = locked;
  $("#removeMr").disabled = locked || !hasMrFile();
  $("#restartMr").disabled = locked || !hasMrFile();
  $("#autoPlayMr").disabled = locked;
  $("#includeMrInRecording").disabled = locked;
  $("#autoStopOnMrEnd").disabled = locked;
  $("#recordingCountIn").disabled = locked;
  $("#mrSyncOffset").disabled = locked;
  $("#mrSyncNumber").disabled = locked;
  $("#mrSyncMinus").disabled = locked;
  $("#mrSyncPlus").disabled = locked;
  $("#mrSyncReset").disabled = locked;
  $("#projectSelect").disabled = locked;
  $("#newProject").disabled = locked;
  $("#editProject").disabled = locked;
  $("#deleteProject").disabled = locked || currentProjectId() === window.HoonProjects?.DEFAULT_ID;
  $(".recorder-panel").classList.toggle("is-recording", locked);
}

function removeMrFile({ keepMessage = false } = {}) {
  if ((state.mediaRecorder && state.mediaRecorder.state !== "inactive") || state.recordingStarting) return;
  stopMrBufferPlayback({ preservePosition: false });
  const audio = $("#mrAudio");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audio.hidden = true;
  if (state.mrObjectUrl) URL.revokeObjectURL(state.mrObjectUrl);
  state.mrObjectUrl = null;
  state.mrFile = null;
  state.mrAudioBuffer = null;
  state.mrDecodePromise = null;
  state.mrDecodeToken += 1;
  $("#mrFileInput").value = "";
  $("#mrFileName").textContent = "선택된 MR이 없습니다.";
  $("#mrFileInfo span").textContent = "MP3·WAV·M4A 등 기기에 저장된 반주 파일을 불러올 수 있습니다.";
  $("#mrDuration").textContent = "--:--";
  $("#restartMr").disabled = true;
  $("#removeMr").disabled = true;
  if (!keepMessage) $("#mrMessage").textContent = "MR을 제거했습니다. 새 반주 파일을 선택할 수 있습니다.";
  updateRecordingIdleText();
}

async function handleMrFileSelection(event) {
  const [file] = event.target.files || [];
  if (!file) return;
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(file.name)) {
    $("#mrMessage").textContent = "오디오 형식의 MR 파일을 선택해 주세요.";
    event.target.value = "";
    return;
  }
  stopMrBufferPlayback({ preservePosition: false });
  const audio = $("#mrAudio");
  audio.pause();
  if (state.mrObjectUrl) URL.revokeObjectURL(state.mrObjectUrl);
  state.mrObjectUrl = URL.createObjectURL(file);
  state.mrFile = file;
  state.mrAudioBuffer = null;
  const token = ++state.mrDecodeToken;
  audio.src = state.mrObjectUrl;
  audio.preload = "auto";
  audio.playsInline = true;
  audio.volume = 1;
  audio.hidden = false;
  audio.load();
  $("#mrFileName").textContent = file.name;
  $("#mrFileInfo span").textContent = `${formatFileSize(file.size)} · 싱크 녹음을 위해 오디오를 분석하고 있습니다.`;
  $("#restartMr").disabled = true;
  $("#removeMr").disabled = false;
  $("#mrDuration").textContent = "분석 중";
  $("#mrMessage").textContent = "MR을 메모리에 불러오는 중입니다. 완료되면 같은 오디오 시간축으로 녹음합니다.";
  updateRecordingIdleText();

  state.mrDecodePromise = decodeMrFile(file, token);
  try {
    const buffer = await state.mrDecodePromise;
    if (token !== state.mrDecodeToken) return;
    $("#mrDuration").textContent = formatMrDuration(buffer.duration);
    $("#mrFileInfo span").textContent = `${formatFileSize(file.size)} · ${formatMrDuration(buffer.duration)} · 싱크 녹음 준비 완료`;
    $("#restartMr").disabled = false;
    $("#mrMessage").textContent = "MR 분석이 끝났습니다. 녹음 시작 시 3초 카운트인 후 정확한 오디오 시간축에서 재생됩니다.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    state.mrAudioBuffer = null;
    state.mrDecodePromise = null;
    $("#restartMr").disabled = false;
    $("#mrDuration").textContent = "재생만 가능";
    $("#mrMessage").textContent = `MR 분석에 실패했습니다: ${error.message} MP3 또는 WAV 파일로 다시 시도해 주세요.`;
  }
}

async function restartMrPlayback() {
  if (!hasMrFile()) return;
  try {
    ensureMrAudioGraph();
    await waitForMrReady();
    const audio = $("#mrAudio");
    audio.currentTime = 0;
    await audio.play();
    $("#mrMessage").textContent = "MR을 처음부터 재생하고 있습니다.";
  } catch (error) {
    $("#mrMessage").textContent = `MR을 재생하지 못했습니다: ${error.message}`;
  }
}

function clearMrAutoStopTimer() {
  window.clearTimeout(state.mrAutoStopTimer);
  state.mrAutoStopTimer = null;
}

function getCurrentMrPlaybackOffset() {
  const buffer = state.mrAudioBuffer;
  if (!buffer) return 0;
  let offset = state.mrPlaybackScheduledOffsetSec || state.mrPlaybackOffsetSec || 0;
  const context = state.audioContext;
  if (state.mrPlaybackSource && context && context.currentTime > state.mrPlaybackStartAt) {
    offset += context.currentTime - state.mrPlaybackStartAt;
  }
  return clamp(offset, 0, buffer.duration);
}

function stopMrBufferPlayback({ preservePosition = true } = {}) {
  clearMrAutoStopTimer();
  const source = state.mrPlaybackSource;
  if (preservePosition) state.mrPlaybackOffsetSec = getCurrentMrPlaybackOffset();
  else state.mrPlaybackOffsetSec = 0;
  state.mrPlaybackSource = null;
  state.mrPlaybackStartAt = 0;
  state.mrPlaybackScheduledOffsetSec = state.mrPlaybackOffsetSec;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch {}
    try { source.disconnect(); } catch {}
  }
}

function updateMrDurationDuringRecording() {
  if (!state.mrAudioBuffer) return;
  const current = getCurrentMrPlaybackOffset();
  $("#mrDuration").textContent = `${formatMrDuration(current)} / ${formatMrDuration(state.mrAudioBuffer.duration)}`;
}

function scheduleMrBufferPlayback(startAt, offsetSec = 0) {
  const context = ensureAudioContext();
  const buffer = state.mrAudioBuffer;
  if (!buffer) throw new Error("MR 분석이 완료되지 않았습니다.");
  stopMrBufferPlayback({ preservePosition: false });
  const normalizedOffset = clamp(Number(offsetSec) || 0, 0, Math.max(0, buffer.duration - 0.01));
  const source = context.createBufferSource();
  source.buffer = buffer;
  const monitorRequested = $("#autoPlayMr").checked;
  if (monitorRequested) source.connect(ensureMrMonitorGain());
  if (state.mrRecordGain) source.connect(state.mrRecordGain);

  const sessionId = ++state.mrPlaybackSessionId;
  state.mrPlaybackSource = source;
  state.mrPlaybackStartAt = startAt;
  state.mrPlaybackOffsetSec = normalizedOffset;
  state.mrPlaybackScheduledOffsetSec = normalizedOffset;
  state.recordingControlsMr = true;

  source.onended = () => {
    if (sessionId !== state.mrPlaybackSessionId || source !== state.mrPlaybackSource) return;
    state.mrPlaybackOffsetSec = buffer.duration;
    state.mrPlaybackScheduledOffsetSec = buffer.duration;
    state.mrPlaybackSource = null;
    state.recordingControlsMr = false;
    $("#mrDuration").textContent = `${formatMrDuration(buffer.duration)} / ${formatMrDuration(buffer.duration)}`;
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive" && $("#autoStopOnMrEnd").checked) {
      $("#recordingMessage").textContent = "MR 재생이 끝났습니다. 싱크 보정 지연의 마지막 소리까지 담은 뒤 자동 저장합니다.";
      state.mrAutoStopTimer = window.setTimeout(() => stopRecording({ skipTail: true }), getRecordingSyncTailMs());
    }
  };
  source.start(startAt, normalizedOffset);
  return source;
}

function clearRecordingCountdown() {
  cancelAnimationFrame(state.recordingCountdownFrame);
  state.recordingCountdownFrame = null;
  state.recordingCountdownNodes.forEach((node) => {
    try { node.stop(); } catch {}
    try { node.disconnect(); } catch {}
  });
  state.recordingCountdownNodes = [];
  const countdown = $("#recordingCountdown");
  countdown.hidden = true;
  countdown.textContent = "3";
}

function scheduleCountIn(startAt, seconds) {
  clearRecordingCountdown();
  if (seconds <= 0) return;
  const context = ensureAudioContext();
  for (let remaining = seconds; remaining >= 1; remaining -= 1) {
    const when = startAt - remaining;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = remaining === 1 ? 1040 : 760;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.16, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(when);
    oscillator.stop(when + 0.12);
    state.recordingCountdownNodes.push(oscillator, gain);
  }
  const countdown = $("#recordingCountdown");
  countdown.hidden = false;
  const update = () => {
    const remaining = startAt - context.currentTime;
    if (remaining <= 0) {
      countdown.textContent = "시작";
      window.setTimeout(() => { countdown.hidden = true; }, 420);
      state.recordingCountdownFrame = null;
      return;
    }
    countdown.textContent = String(Math.max(1, Math.ceil(Math.min(seconds, remaining))));
    state.recordingCountdownFrame = requestAnimationFrame(update);
  };
  update();
}

function clearRecordingScheduledActions() {
  window.clearTimeout(state.recordingStartTimeout);
  window.clearTimeout(state.recordingUiStartTimeout);
  window.clearTimeout(state.recordingStopTimeout);
  state.recordingStartTimeout = null;
  state.recordingUiStartTimeout = null;
  state.recordingStopTimeout = null;
  clearRecordingCountdown();
}

function disconnectRecordingMix() {
  clearRecordingScheduledActions();
  stopMrBufferPlayback({ preservePosition: false });
  if (state.recordingMixMicSource) {
    try { state.recordingMixMicSource.disconnect(); } catch {}
  }
  if (state.recordingVocalGain) {
    try { state.recordingVocalGain.disconnect(); } catch {}
  }
  if (state.recordingVocalCompressor) {
    try { state.recordingVocalCompressor.disconnect(); } catch {}
  }
  if (state.recordingVocalDelay) {
    try { state.recordingVocalDelay.disconnect(); } catch {}
  }
  if (state.recordingVocalTrackGate) {
    try { state.recordingVocalTrackGate.disconnect(); } catch {}
  }
  if (state.recordingMixBus) {
    try { state.recordingMixBus.disconnect(); } catch {}
  }
  if (state.mrRecordGain) {
    try { state.mrRecordGain.disconnect(); } catch {}
  }
  if (state.mrRecordDelay) {
    try { state.mrRecordDelay.disconnect(); } catch {}
  }
  if (state.recordingMixCompressor) {
    try { state.recordingMixCompressor.disconnect(); } catch {}
  }
  if (state.recordingMixMasterGain) {
    try { state.recordingMixMasterGain.disconnect(); } catch {}
  }
  if (state.recordingGate) {
    try { state.recordingGate.disconnect(); } catch {}
  }
  if (state.recordingOutputStream) {
    state.recordingOutputStream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  }
  if (state.vocalTrackStream) {
    state.vocalTrackStream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  }
  state.recordingMixMicSource = null;
  state.recordingVocalGain = null;
  state.recordingVocalCompressor = null;
  state.recordingVocalDelay = null;
  state.recordingVocalTrackGate = null;
  state.recordingVocalTrackDestination = null;
  state.recordingMixBus = null;
  state.mrRecordGain = null;
  state.mrRecordDelay = null;
  state.recordingMixCompressor = null;
  state.recordingMixMasterGain = null;
  state.recordingGate = null;
  state.recordingMixDestination = null;
  state.recordingOutputStream = null;
  state.vocalTrackStream = null;
}

function createMixedRecordingStream(microphoneStream, scheduledStartAt) {
  const audioContext = ensureAudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const vocalTrackDestination = audioContext.createMediaStreamDestination();
  const microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  const vocalTrackGate = audioContext.createGain();
  const vocalGain = audioContext.createGain();
  const vocalCompressor = audioContext.createDynamicsCompressor();
  const vocalDelay = audioContext.createDelay(1);
  const mixBus = audioContext.createGain();
  const masterGain = audioContext.createGain();
  const limiter = audioContext.createDynamicsCompressor();
  const gate = audioContext.createGain();
  const includesMr = Boolean($("#includeMrInRecording").checked && state.mrAudioBuffer);
  const syncMs = includesMr ? getMrSyncOffsetMs() : 0;

  vocalCompressor.threshold.value = -18;
  vocalCompressor.knee.value = 12;
  vocalCompressor.ratio.value = 2.4;
  vocalCompressor.attack.value = 0.008;
  vocalCompressor.release.value = 0.16;
  vocalDelay.delayTime.value = Math.max(0, -syncMs) / 1000;

  limiter.threshold.value = -2;
  limiter.knee.value = 1;
  limiter.ratio.value = 16;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.07;
  masterGain.gain.value = 0.9;

  microphoneSource.connect(vocalTrackGate);
  vocalTrackGate.connect(vocalTrackDestination);
  microphoneSource.connect(vocalGain);
  vocalGain.gain.value = getVocalRecordingGainValue();
  vocalGain.connect(vocalCompressor);
  vocalCompressor.connect(vocalDelay);
  vocalDelay.connect(mixBus);

  if (includesMr) {
    const mrRecordGain = audioContext.createGain();
    const mrRecordDelay = audioContext.createDelay(1);
    mrRecordGain.gain.value = getMrRecordingGainValue();
    mrRecordDelay.delayTime.value = Math.max(0, syncMs) / 1000;
    mrRecordGain.connect(mrRecordDelay);
    mrRecordDelay.connect(mixBus);
    state.mrRecordGain = mrRecordGain;
    state.mrRecordDelay = mrRecordDelay;
  }

  mixBus.connect(masterGain);
  masterGain.connect(limiter);
  limiter.connect(gate);
  gate.connect(destination);
  gate.gain.setValueAtTime(0, audioContext.currentTime);
  gate.gain.setValueAtTime(0, Math.max(audioContext.currentTime, scheduledStartAt - 0.01));
  gate.gain.setValueAtTime(1, scheduledStartAt);
  vocalTrackGate.gain.setValueAtTime(0, audioContext.currentTime);
  vocalTrackGate.gain.setValueAtTime(0, Math.max(audioContext.currentTime, scheduledStartAt - 0.01));
  vocalTrackGate.gain.setValueAtTime(1, scheduledStartAt);

  state.recordingMixDestination = destination;
  state.recordingVocalTrackDestination = vocalTrackDestination;
  state.recordingVocalTrackGate = vocalTrackGate;
  state.recordingMixMicSource = microphoneSource;
  state.recordingMixCompressor = limiter;
  state.recordingVocalCompressor = vocalCompressor;
  state.recordingVocalDelay = vocalDelay;
  state.recordingMixBus = mixBus;
  state.recordingMixMasterGain = masterGain;
  state.recordingGate = gate;
  state.recordingVocalGain = vocalGain;
  state.recordingOutputStream = destination.stream;
  state.vocalTrackStream = vocalTrackDestination.stream;
  return { stream: destination.stream, vocalTrackStream: vocalTrackDestination.stream, includesMr, syncMs };
}

function formatRecordingDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function recordingExtension(mimeType = "") {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("aac")) return "aac";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("flac")) return "flac";
  return "webm";
}

function safeRecordingFilename(name) {
  return String(name || "보컬 녹음")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "보컬 녹음";
}

function defaultRecordingName() {
  const now = new Date();
  const date = now.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }).replace(/\s/g, "");
  const time = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${state.currentRecordingMeta?.hasMr ? "MR 보컬 녹음" : "보컬 녹음"} ${date} ${time}`;
}

function openRecordingDb() {
  if (state.recordingDbPromise) return state.recordingDbPromise;
  state.recordingDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("이 브라우저는 녹음 저장 기능을 지원하지 않습니다."));
      return;
    }
    const request = indexedDB.open(RECORDING_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDING_STORE_NAME)) {
        const store = db.createObjectStore(RECORDING_STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("녹음 저장소를 열지 못했습니다."));
  });
  return state.recordingDbPromise;
}

async function getStoredRecordings() {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_STORE_NAME, "readonly");
    const request = transaction.objectStore(RECORDING_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("녹음 목록을 불러오지 못했습니다."));
  });
}

async function addStoredRecording(recording) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_STORE_NAME, "readwrite");
    const request = transaction.objectStore(RECORDING_STORE_NAME).add(recording);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("녹음 파일을 저장하지 못했습니다."));
  });
}

async function putStoredRecording(recording) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_STORE_NAME, "readwrite");
    const request = transaction.objectStore(RECORDING_STORE_NAME).put(recording);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("녹음 정보를 수정하지 못했습니다."));
  });
}

async function deleteStoredRecording(id) {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_STORE_NAME, "readwrite");
    const request = transaction.objectStore(RECORDING_STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("녹음 파일을 삭제하지 못했습니다."));
  });
}

async function clearStoredRecordings() {
  const db = await openRecordingDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDING_STORE_NAME, "readwrite");
    const request = transaction.objectStore(RECORDING_STORE_NAME).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("녹음 목록을 비우지 못했습니다."));
  });
}

function pauseOtherRecordingPlayers(currentAudio) {
  state.recordingPlayers.forEach((player) => {
    if (player.audio !== currentAudio && !player.audio.paused) player.audio.pause();
  });
}

function stopRecordingPlayerAnimations() {
  state.recordingPlayers.forEach((player) => {
    if (player.frameId) cancelAnimationFrame(player.frameId);
    player.frameId = null;
    try { player.audio.pause(); } catch {}
  });
  state.recordingPlayers = [];
  state.activeRecordingAudio = null;
}

function revokeRecordingObjectUrls() {
  stopRecordingPlayerAnimations();
  state.recordingObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.recordingObjectUrls = [];
}

function recordingDurationSeconds(recording) {
  return Math.max(0.25, Number(recording.durationMs || 0) / 1000);
}

function createRecordingPlayer(recording, objectUrl) {
  const expectedDuration = recordingDurationSeconds(recording);
  const player = document.createElement("div");
  player.className = "recording-player";

  const playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "recording-play-btn";
  playButton.textContent = "▶";
  playButton.setAttribute("aria-label", "녹음 재생");

  const progress = document.createElement("input");
  progress.type = "range";
  progress.className = "recording-progress";
  progress.min = "0";
  progress.max = String(expectedDuration);
  progress.step = "0.01";
  progress.value = "0";
  progress.setAttribute("aria-label", "녹음 재생 위치");

  const time = document.createElement("span");
  time.className = "recording-player-time";
  time.textContent = `00:00 / ${formatRecordingDuration(expectedDuration * 1000)}`;

  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.playsInline = true;
  audio.src = objectUrl;
  audio.hidden = true;

  const controller = { audio, progress, playButton, time, frameId: null, dragging: false };
  state.recordingPlayers.push(controller);

  const update = () => {
    const current = clamp(Number(audio.currentTime) || 0, 0, expectedDuration);
    if (!controller.dragging) progress.value = String(current);
    time.textContent = `${formatRecordingDuration(current * 1000)} / ${formatRecordingDuration(expectedDuration * 1000)}`;
  };

  const stopFrame = () => {
    if (controller.frameId) cancelAnimationFrame(controller.frameId);
    controller.frameId = null;
  };

  const runFrame = () => {
    update();
    if (!audio.paused && !audio.ended) controller.frameId = requestAnimationFrame(runFrame);
    else controller.frameId = null;
  };

  const seek = () => {
    const next = clamp(Number(progress.value) || 0, 0, expectedDuration);
    try {
      if (typeof audio.fastSeek === "function") audio.fastSeek(next);
      else audio.currentTime = next;
    } catch {}
    time.textContent = `${formatRecordingDuration(next * 1000)} / ${formatRecordingDuration(expectedDuration * 1000)}`;
  };

  playButton.addEventListener("click", async () => {
    if (audio.paused || audio.ended) {
      stopMetronome();
      stopProgression();
      stopTuner();
      stopVocalTune();
      $("#mrAudio")?.pause();
      window.HoonMixer?.stop?.({ preservePosition: true, silent: true });
      pauseOtherRecordingPlayers(audio);
      if (audio.ended || Number(audio.currentTime) >= expectedDuration - 0.05) {
        try { audio.currentTime = 0; } catch {}
      }
      try {
        await audio.play();
      } catch (error) {
        $("#recordingMessage").textContent = `녹음을 재생하지 못했습니다: ${error.message}`;
      }
    } else {
      audio.pause();
    }
  });

  progress.addEventListener("pointerdown", () => { controller.dragging = true; });
  progress.addEventListener("input", () => {
    controller.dragging = true;
    seek();
  });
  ["change", "pointerup", "pointercancel"].forEach((type) => {
    progress.addEventListener(type, () => {
      seek();
      controller.dragging = false;
      update();
    });
  });

  audio.addEventListener("play", () => {
    state.activeRecordingAudio = audio;
    transportUpdate(recording.name || "저장된 녹음", "재생 중", true, "playing");
    playButton.textContent = "❚❚";
    playButton.setAttribute("aria-label", "녹음 일시정지");
    stopFrame();
    runFrame();
  });
  audio.addEventListener("pause", () => {
    if (state.activeRecordingAudio === audio && !audio.ended) transportUpdate(recording.name || "저장된 녹음", "일시정지", false, "idle");
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "녹음 재생");
    stopFrame();
    update();
  });
  audio.addEventListener("ended", () => {
    if (state.activeRecordingAudio === audio) transportUpdate(recording.name || "저장된 녹음", "재생 완료", false, "idle");
    playButton.textContent = "▶";
    playButton.setAttribute("aria-label", "녹음 다시 재생");
    stopFrame();
    progress.value = String(expectedDuration);
    time.textContent = `${formatRecordingDuration(expectedDuration * 1000)} / ${formatRecordingDuration(expectedDuration * 1000)}`;
  });
  audio.addEventListener("timeupdate", update);

  // 일부 모바일 브라우저는 WebM 전체 시간을 Infinity로 읽습니다.
  // 저장 당시 측정한 시간을 UI 기준으로 사용하고, 큰 seek로 메타데이터 재계산도 한 번 유도합니다.
  audio.addEventListener("loadedmetadata", () => {
    if (!Number.isFinite(audio.duration) || audio.duration === Infinity) {
      const restore = () => {
        try { audio.currentTime = 0; } catch {}
        update();
      };
      audio.addEventListener("durationchange", restore, { once: true });
      try { audio.currentTime = 1e101; } catch {}
      window.setTimeout(restore, 80);
    }
  }, { once: true });

  player.append(playButton, progress, time, audio);
  return player;
}

function renderRecordings() {
  const list = $("#recordingList");
  revokeRecordingObjectUrls();
  list.innerHTML = "";
  const sorted = [...visibleRecordings()].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  $("#recordingCount").textContent = `${sorted.length}개`;
  updateProjectSummary();
  $("#deleteAllRecordings").disabled = sorted.length === 0;

  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "recording-empty";
    empty.innerHTML = "<strong>이 프로젝트에 저장된 녹음이 없습니다.</strong><span>녹음을 시작하면 현재 프로젝트에 자동으로 정리됩니다.</span>";
    list.appendChild(empty);
    window.HoonMixer?.refresh?.();
    return;
  }

  sorted.forEach((recording) => {
    const item = document.createElement("article");
    item.className = "recording-item";

    const header = document.createElement("div");
    header.className = "recording-item-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "recording-title-wrap";
    const titleLine = document.createElement("div");
    titleLine.className = "recording-title-line";
    const title = document.createElement("strong");
    title.textContent = recording.name || "보컬 녹음";
    titleLine.appendChild(title);
    if (recording.hasSeparatedTracks) {
      const tag = document.createElement("span");
      tag.className = "recording-mr-tag is-tracks";
      tag.textContent = "2트랙";
      titleLine.appendChild(tag);
    } else if (recording.hasMr) {
      const tag = document.createElement("span");
      tag.className = "recording-mr-tag";
      tag.textContent = "MR 포함";
      titleLine.appendChild(tag);
    }
    const meta = document.createElement("span");
    const created = new Date(recording.createdAt);
    const syncText = recording.hasMr && Number(recording.syncOffsetMs) ? ` · 싱크 ${formatSignedMilliseconds(recording.syncOffsetMs)}` : "";
    const totalTrackSize = (recording.blob?.size || 0) + (recording.vocalBlob?.size || 0) + (recording.mrBlob?.size || 0);
    meta.textContent = `${created.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${formatRecordingDuration(recording.durationMs)} · ${formatFileSize(totalTrackSize || recording.blob?.size || 0)}${syncText}`;
    titleWrap.append(titleLine, meta);
    header.appendChild(titleWrap);

    const memoText = String(recording.memo || "").trim();
    const memo = document.createElement("p");
    memo.className = "recording-note";
    memo.textContent = memoText;
    memo.hidden = !memoText;

    const objectUrl = URL.createObjectURL(recording.blob);
    state.recordingObjectUrls.push(objectUrl);
    const player = createRecordingPlayer(recording, objectUrl);

    let trackPanel = null;
    if (recording.vocalBlob || recording.mrBlob) {
      trackPanel = document.createElement("details");
      trackPanel.className = "recording-track-panel";
      const summary = document.createElement("summary");
      const trackCount = [recording.vocalBlob, recording.mrBlob].filter(Boolean).length;
      summary.textContent = `분리 트랙 ${trackCount}개`;
      trackPanel.appendChild(summary);

      const trackList = document.createElement("div");
      trackList.className = "recording-track-list";

      const addTrackRow = (label, detail, trackBlob, mimeType, filename) => {
        if (!(trackBlob instanceof Blob)) return;
        const row = document.createElement("div");
        row.className = "recording-track-row";
        const info = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = label;
        const span = document.createElement("span");
        span.textContent = `${detail} · ${formatFileSize(trackBlob.size)}`;
        info.append(strong, span);
        const url = URL.createObjectURL(trackBlob);
        state.recordingObjectUrls.push(url);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "recording-small-btn";
        button.textContent = "트랙 저장";
        button.addEventListener("click", () => {
          const link = document.createElement("a");
          link.href = url;
          link.download = `${safeRecordingFilename(filename)}.${recordingExtension(mimeType || trackBlob.type)}`;
          document.body.appendChild(link);
          link.click();
          link.remove();
        });
        row.append(info, button);
        trackList.appendChild(row);
      };

      addTrackRow("보컬 트랙", "마이크 원본", recording.vocalBlob, recording.vocalMimeType, `${recording.name}-보컬`);
      addTrackRow("MR 트랙", recording.mrName || "원본 반주", recording.mrBlob, recording.mrMimeType, `${recording.name}-MR`);

      const timeline = document.createElement("p");
      timeline.className = "recording-track-timeline";
      const sync = Number(recording.syncOffsetMs) || 0;
      timeline.textContent = sync > 0
        ? `타임라인: MR을 보컬보다 ${sync}ms 늦게 배치`
        : sync < 0
          ? `타임라인: 보컬을 MR보다 ${Math.abs(sync)}ms 늦게 배치`
          : "타임라인: 보컬과 MR을 같은 시작점에 배치";
      trackList.appendChild(timeline);
      trackPanel.appendChild(trackList);
    }

    const actions = document.createElement("div");
    actions.className = "recording-item-actions";

    let openMixerButton = null;
    if (recording.vocalBlob || recording.mrBlob) {
      openMixerButton = document.createElement("button");
      openMixerButton.type = "button";
      openMixerButton.className = "recording-small-btn is-mixer";
      openMixerButton.textContent = "믹서로 열기";
      openMixerButton.addEventListener("click", async () => {
        activateTab("mixer");
        await window.HoonMixer?.selectRecording?.(recording.id);
      });
    }

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "recording-small-btn";
    editButton.textContent = "수정";

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "recording-small-btn";
    downloadButton.textContent = recording.hasSeparatedTracks ? "믹스 저장" : "파일 저장";
    downloadButton.addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${safeRecordingFilename(recording.name)}.${recordingExtension(recording.mimeType)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "recording-small-btn is-danger";
    deleteButton.textContent = "삭제";
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`‘${recording.name || "보컬 녹음"}’ 녹음을 삭제할까요?`)) return;
      try {
        if (recording.volatile) {
          state.recordings = state.recordings.filter((entry) => entry.id !== recording.id);
        } else {
          await deleteStoredRecording(recording.id);
          state.recordings = state.recordings.filter((entry) => entry.id !== recording.id);
        }
        renderRecordings();
        $("#recordingMessage").textContent = "녹음 파일을 삭제했습니다.";
      } catch (error) {
        $("#recordingMessage").textContent = error.message;
      }
    });

    const editor = document.createElement("div");
    editor.className = "recording-editor";
    editor.hidden = true;

    const nameLabel = document.createElement("label");
    nameLabel.innerHTML = "<span>제목</span>";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 60;
    nameInput.value = recording.name || "보컬 녹음";
    nameLabel.appendChild(nameInput);

    const memoLabel = document.createElement("label");
    memoLabel.innerHTML = "<span>메모</span>";
    const memoInput = document.createElement("textarea");
    memoInput.rows = 4;
    memoInput.maxLength = 500;
    memoInput.placeholder = "연습 구간, 느낀 점, 다시 녹음할 부분";
    memoInput.value = memoText;
    memoLabel.appendChild(memoInput);

    const editorActions = document.createElement("div");
    editorActions.className = "recording-editor-actions";
    const cancelEdit = document.createElement("button");
    cancelEdit.type = "button";
    cancelEdit.className = "secondary-btn";
    cancelEdit.textContent = "취소";
    const saveEdit = document.createElement("button");
    saveEdit.type = "button";
    saveEdit.className = "primary-btn";
    saveEdit.textContent = "저장";
    editorActions.append(cancelEdit, saveEdit);
    editor.append(nameLabel, memoLabel, editorActions);

    const closeEditor = () => {
      editor.hidden = true;
      editButton.textContent = "수정";
      nameInput.value = recording.name || "보컬 녹음";
      memoInput.value = String(recording.memo || "");
    };

    editButton.addEventListener("click", () => {
      const opening = editor.hidden;
      if (opening) {
        editor.hidden = false;
        editButton.textContent = "닫기";
        window.setTimeout(() => nameInput.focus(), 0);
      } else {
        closeEditor();
      }
    });
    cancelEdit.addEventListener("click", closeEditor);
    saveEdit.addEventListener("click", async () => {
      const nextName = nameInput.value.trim().slice(0, 60) || "보컬 녹음";
      const nextMemo = memoInput.value.trim().slice(0, 500);
      const updated = { ...recording, name: nextName, memo: nextMemo, updatedAt: Date.now() };
      saveEdit.disabled = true;
      saveEdit.textContent = "저장 중";
      try {
        if (!recording.volatile) await putStoredRecording(updated);
        state.recordings = state.recordings.map((entry) => entry.id === recording.id ? updated : entry);
        renderRecordings();
        $("#recordingMessage").textContent = "녹음 제목과 메모를 수정했습니다.";
      } catch (error) {
        saveEdit.disabled = false;
        saveEdit.textContent = "저장";
        $("#recordingMessage").textContent = error.message;
      }
    });

    if (openMixerButton) actions.append(openMixerButton);
    actions.append(editButton, downloadButton, deleteButton);
    item.append(header, memo, player);
    if (trackPanel) item.appendChild(trackPanel);
    item.append(actions, editor);
    list.appendChild(item);
  });
  window.HoonMixer?.refresh?.();
}

async function loadRecordings() {
  try {
    const loaded = await getStoredRecordings();
    const migrated = [];
    state.recordings = loaded.map((recording) => {
      if (recording.projectId) return recording;
      const updated = { ...recording, projectId: window.HoonProjects?.DEFAULT_ID || "project-default" };
      if (!recording.volatile) migrated.push(updated);
      return updated;
    });
    if (migrated.length) await Promise.allSettled(migrated.map((recording) => putStoredRecording(recording)));
    renderProjectUi();
    renderRecordings();
  } catch (error) {
    state.recordings = [];
    renderRecordings();
    $("#recordingMessage").textContent = `${error.message} 이번 실행 중 녹음은 임시로 유지됩니다.`;
  }
}

function setRecordingBadge(text, mode = "idle") {
  const badge = $("#recordingStatusBadge");
  badge.textContent = text;
  badge.classList.toggle("is-recording", mode === "recording");
  badge.classList.toggle("is-paused", mode === "paused");
  badge.classList.toggle("is-saving", mode === "saving");
  badge.classList.toggle("is-error", mode === "error");
}

function getRecordingElapsedMs() {
  let elapsed = state.recordingActiveMs;
  if (state.mediaRecorder?.state === "recording" && state.recordingSegmentStartedAt) {
    elapsed += Math.max(0, performance.now() - state.recordingSegmentStartedAt);
  }
  return Math.max(0, elapsed);
}

function updateRecordingTimer() {
  const elapsed = getRecordingElapsedMs();
  $("#recordingTimer").textContent = formatRecordingDuration(elapsed);
  if (state.recordingControlsMr && state.mrAudioBuffer) updateMrDurationDuringRecording();
  if (elapsed >= MAX_RECORDING_MS && state.mediaRecorder?.state !== "inactive") {
    $("#recordingMessage").textContent = "최대 녹음 시간 30분에 도달해 자동으로 저장합니다.";
    stopRecording();
  }
}

function stopRecordingLevelMonitor() {
  cancelAnimationFrame(state.recordingLevelFrame);
  state.recordingLevelFrame = null;
  $("#recordingLevelBar").style.width = "0%";
  if (state.recordingSource) {
    try { state.recordingSource.disconnect(); } catch {}
  }
  state.recordingSource = null;
  state.recordingAnalyser = null;
  state.recordingLevelBuffer = null;
}

function runRecordingLevelMonitor() {
  if (!state.recordingAnalyser || !state.recordingLevelBuffer || !state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    $("#recordingLevelBar").style.width = "0%";
    return;
  }
  if (state.mediaRecorder.state === "paused") {
    $("#recordingLevelBar").style.width = "0%";
  } else {
    state.recordingAnalyser.getByteTimeDomainData(state.recordingLevelBuffer);
    let sum = 0;
    for (const value of state.recordingLevelBuffer) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / state.recordingLevelBuffer.length);
    const level = clamp(Math.round(rms * 420), 2, 100);
    $("#recordingLevelBar").style.width = `${level}%`;
  }
  state.recordingLevelFrame = requestAnimationFrame(runRecordingLevelMonitor);
}

function setupRecordingLevelMonitor(stream) {
  stopRecordingLevelMonitor();
  try {
    const audio = ensureAudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.65;
    const source = audio.createMediaStreamSource(stream);
    source.connect(analyser);
    state.recordingSource = source;
    state.recordingAnalyser = analyser;
    state.recordingLevelBuffer = new Uint8Array(analyser.fftSize);
    runRecordingLevelMonitor();
  } catch {
    $("#recordingLevelBar").style.width = "18%";
  }
}

function preferredRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function resetRecordingControls() {
  clearRecordingScheduledActions();
  clearInterval(state.recordingTimerId);
  state.recordingTimerId = null;
  state.recordingStartedAt = 0;
  state.recordingSegmentStartedAt = 0;
  state.recordingActiveMs = 0;
  state.recordingMediaSegmentStartedAt = 0;
  state.recordingMediaActiveMs = 0;
  state.recordingStarting = false;
  state.recordingStopping = false;
  $("#recordingTimer").textContent = "00:00";
  if (state.mrAudioBuffer) $("#mrDuration").textContent = formatMrDuration(state.mrAudioBuffer.duration);
  $("#toggleRecording").disabled = false;
  $("#toggleRecording").textContent = "● 녹음 시작";
  $("#pauseRecording").disabled = true;
  $("#pauseRecording").textContent = "일시정지";
  $("#stopRecording").disabled = true;
  $("#recordingName").disabled = false;
  $("#recordingMemo").disabled = false;
  updateRecordingIdleText();
  setRecordingBadge("준비");
  setMrRecordingLocked(false);
  stopRecordingLevelMonitor();
  if (state.currentTab === "recording") {
    const projectName = window.HoonProjects?.getCurrent?.()?.name || "녹음 프로젝트";
    transportUpdate("녹음실", `${projectName} · 준비`, false, "idle");
  }
}

async function finishRecording(blob, durationMs, mimeType, vocalTrackResult = null) {
  const name = $("#recordingName").value.trim() || defaultRecordingName();
  const memo = $("#recordingMemo").value.trim().slice(0, 500);
  const meta = state.currentRecordingMeta || {};
  const vocalBlob = vocalTrackResult?.blob instanceof Blob ? vocalTrackResult.blob : null;
  const mrBlob = meta.mrBlob instanceof Blob ? meta.mrBlob : null;
  const record = {
    name,
    memo,
    projectId: meta.projectId || currentProjectId(),
    createdAt: Date.now(),
    durationMs,
    mimeType: mimeType || blob.type || "audio/webm",
    hasMr: Boolean(meta.hasMr),
    hasMrTrack: Boolean(mrBlob),
    hasSeparatedTracks: Boolean(vocalBlob && mrBlob),
    trackVersion: vocalBlob ? 2 : 1,
    mrName: meta.mrName || "",
    mrMimeType: meta.mrMimeType || mrBlob?.type || "audio/mpeg",
    mrDurationMs: Number(meta.mrDurationMs) || 0,
    syncOffsetMs: Number(meta.syncOffsetMs) || 0,
    vocalMimeType: vocalTrackResult?.mimeType || vocalBlob?.type || "audio/webm",
    vocalBlob,
    mrBlob,
    blob
  };
  try {
    const id = await addStoredRecording(record);
    state.recordings.unshift({ ...record, id });
    $("#recordingMessage").textContent = record.hasSeparatedTracks
      ? `‘${name}’을 보컬·MR 분리 트랙과 간편 재생 파일로 저장했습니다.`
      : record.vocalBlob
        ? `‘${name}’을 보컬 트랙으로 저장했습니다.`
        : `‘${name}’ 녹음을 기기에 저장했습니다.`;
  } catch (error) {
    state.recordings.unshift({ ...record, id: `memory-${Date.now()}`, volatile: true });
    $("#recordingMessage").textContent = `${error.message} 녹음은 현재 화면에서 임시로 재생·파일 저장할 수 있습니다.`;
  }
  window.HoonProjects?.touch?.(record.projectId);
  $("#recordingName").value = "";
  $("#recordingMemo").value = "";
  renderProjectUi();
  renderRecordings();
}

function cleanupRecordingStream() {
  const stream = state.recordingStream;
  disconnectRecordingMix();
  const sharedWithActiveVocalTune = stream && stream === state.vocalStream && state.vocalRunning;
  if (stream && !sharedWithActiveVocalTune) stream.getTracks().forEach((track) => track.stop());
  state.recordingStream = null;
  state.recordingChunks = [];
  state.vocalTrackChunks = [];
  state.mediaRecorder = null;
  state.vocalTrackRecorder = null;
  state.vocalTrackStopPromise = null;
  state.vocalTrackStopResolve = null;
  state.currentRecordingMeta = null;
  state.recordingControlsMr = false;
  state.recordingStarting = false;
  state.recordingStopping = false;
  state.mrResumeAfterPause = false;
  resetRecordingControls();
}

async function startRecording() {
  if (state.recordingStarting || (state.mediaRecorder && state.mediaRecorder.state !== "inactive")) return;
  const sessionToken = ++state.recordingSessionToken;
  state.recordingStarting = true;
  state.recordingStopping = false;
  try {
    if (location.protocol === "file:") throw new Error("녹음은 PC에서 훈뮤직툴 실행.bat을 사용하거나, 모바일에서 HTTPS 배포 주소로 열어야 합니다.");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저 환경에서는 마이크 녹음을 사용할 수 없습니다.");
    if (!window.MediaRecorder) throw new Error("이 브라우저는 녹음 기능을 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.");

    stopMetronome();
    stopProgression();
    stopTuner(false);
    stopVocalTargetTone();
    $("#mrAudio").pause();
    $("#toggleRecording").disabled = true;
    $("#toggleRecording").textContent = "마이크 확인 중...";
    $("#recordingStateText").textContent = "마이크와 MR을 준비하고 있습니다.";
    setRecordingBadge("준비 중", "saving");
    transportUpdate("녹음실", "마이크와 MR 준비 중", true, "recording");
    setMrRecordingLocked(true);

    let stream = state.vocalStream;
    const hasLiveTrack = stream?.getAudioTracks().some((track) => track.readyState === "live");
    if (!hasLiveTrack) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });
    }
    if (sessionToken !== state.recordingSessionToken) return;

    state.recordingStream = stream;
    await warnIfBluetoothMicrophone(stream);
    const context = ensureAudioContext();
    if (context.state === "suspended") await context.resume();

    const shouldUseMr = hasMrFile() && ($("#autoPlayMr").checked || $("#includeMrInRecording").checked);
    if (shouldUseMr) {
      $("#recordingStateText").textContent = "MR 전체를 메모리에 불러오고 있습니다.";
      await waitForMrBufferReady();
    }
    if (sessionToken !== state.recordingSessionToken) return;

    const countInSeconds = getRecordingCountInSeconds();
    const startAt = context.currentTime + countInSeconds + 0.22;
    const mixed = createMixedRecordingStream(stream, startAt);
    state.currentRecordingMeta = {
      projectId: currentProjectId(),
      hasMr: mixed.includesMr,
      hasMrTrack: Boolean(shouldUseMr && state.mrFile),
      mrName: shouldUseMr ? $("#mrFileName").textContent : "",
      mrBlob: shouldUseMr && state.mrFile ? state.mrFile : null,
      mrMimeType: shouldUseMr && state.mrFile ? state.mrFile.type : "",
      mrDurationMs: shouldUseMr && state.mrAudioBuffer ? Math.round(state.mrAudioBuffer.duration * 1000) : 0,
      syncOffsetMs: shouldUseMr ? getMrSyncOffsetMs() : 0
    };

    const mimeType = preferredRecordingMimeType();
    const options = mimeType ? { mimeType, audioBitsPerSecond: 160000 } : { audioBitsPerSecond: 160000 };
    let recorder;
    try {
      recorder = new MediaRecorder(mixed.stream, options);
    } catch {
      recorder = new MediaRecorder(mixed.stream);
    }

    let vocalTrackRecorder = null;
    const vocalTrackStream = mixed.vocalTrackStream || null;
    try {
      if (vocalTrackStream) {
        try {
          vocalTrackRecorder = new MediaRecorder(vocalTrackStream, options);
        } catch {
          vocalTrackRecorder = new MediaRecorder(vocalTrackStream);
        }
      }
    } catch (error) {
      console.warn("Separate vocal track recorder is unavailable:", error);
    }

    state.recordingChunks = [];
    state.vocalTrackChunks = [];
    state.mediaRecorder = recorder;
    state.vocalTrackRecorder = vocalTrackRecorder;
    state.vocalTrackStream = vocalTrackStream;
    state.vocalTrackStopPromise = new Promise((resolve) => { state.vocalTrackStopResolve = resolve; });
    state.recordingStartedAt = performance.now() + Math.max(0, (startAt - context.currentTime) * 1000);
    state.recordingSegmentStartedAt = 0;
    state.recordingActiveMs = 0;
    state.recordingMediaSegmentStartedAt = 0;
    state.recordingMediaActiveMs = 0;

    recorder.addEventListener("start", () => {
      state.recordingMediaSegmentStartedAt = performance.now();
    });
    recorder.addEventListener("resume", () => {
      state.recordingMediaSegmentStartedAt = performance.now();
    });

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) state.recordingChunks.push(event.data);
    });

    if (vocalTrackRecorder) {
      vocalTrackRecorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) state.vocalTrackChunks.push(event.data);
      });
      vocalTrackRecorder.addEventListener("stop", () => {
        const chunks = [...state.vocalTrackChunks];
        const finalMime = vocalTrackRecorder.mimeType || chunks[0]?.type || "audio/webm";
        const vocalBlob = new Blob(chunks, { type: finalMime });
        state.vocalTrackStopResolve?.(vocalBlob.size ? { blob: vocalBlob, mimeType: finalMime } : null);
        state.vocalTrackStopResolve = null;
      }, { once: true });
      vocalTrackRecorder.addEventListener("error", () => {
        state.vocalTrackStopResolve?.(null);
        state.vocalTrackStopResolve = null;
      }, { once: true });
    } else {
      state.vocalTrackStopResolve?.(null);
      state.vocalTrackStopResolve = null;
    }

    recorder.addEventListener("stop", async () => {
      const durationMs = Math.max(0, state.recordingMediaActiveMs || state.recordingActiveMs);
      const chunks = [...state.recordingChunks];
      const finalMime = recorder.mimeType || mimeType || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type: finalMime });
      setRecordingBadge("저장 중", "saving");
      $("#recordingStateText").textContent = "녹음 파일을 기기에 저장하고 있습니다.";
      let vocalTrackResult = null;
      try {
        vocalTrackResult = await Promise.race([
          state.vocalTrackStopPromise || Promise.resolve(null),
          new Promise((resolve) => window.setTimeout(() => resolve(null), 1800))
        ]);
      } catch {}
      if (blob.size > 0 && durationMs >= 250) await finishRecording(blob, durationMs, finalMime, vocalTrackResult);
      else $("#recordingMessage").textContent = "녹음 시간이 너무 짧거나 소리가 저장되지 않았습니다.";
      cleanupRecordingStream();
    }, { once: true });

    recorder.addEventListener("error", (event) => {
      $("#recordingMessage").textContent = event.error?.message || "녹음 중 오류가 발생했습니다.";
      setRecordingBadge("오류", "error");
    });

    state.recordingTimerId = window.setInterval(updateRecordingTimer, 100);
    $("#toggleRecording").disabled = true;
    $("#toggleRecording").textContent = countInSeconds ? `카운트인 ${countInSeconds}초` : "● 녹음 준비";
    $("#pauseRecording").disabled = true;
    $("#stopRecording").disabled = true;
    $("#recordingName").disabled = true;
    $("#recordingMemo").disabled = true;
    setRecordingBadge(countInSeconds ? "카운트인" : "시작 준비", "saving");
    transportUpdate("녹음실", countInSeconds ? `${countInSeconds}초 카운트인` : "녹음 시작 준비", true, "recording");

    if (shouldUseMr && state.mrAudioBuffer) {
      scheduleMrBufferPlayback(startAt, 0);
    }
    scheduleCountIn(startAt, countInSeconds);

    const recorderStartDelayMs = Math.max(0, (startAt - context.currentTime) * 1000 - RECORDING_PREROLL_MS);
    state.recordingStartTimeout = window.setTimeout(() => {
      if (sessionToken !== state.recordingSessionToken || state.mediaRecorder !== recorder || recorder.state !== "inactive") return;
      try {
        recorder.start(1000);
        if (vocalTrackRecorder && vocalTrackRecorder.state === "inactive") vocalTrackRecorder.start(1000);
        setupRecordingLevelMonitor(stream);
      } catch (error) {
        $("#recordingMessage").textContent = `녹음기를 시작하지 못했습니다: ${error.message}`;
        cleanupRecordingStream();
      }
    }, recorderStartDelayMs);

    const uiStartDelayMs = Math.max(0, (startAt - context.currentTime) * 1000);
    state.recordingUiStartTimeout = window.setTimeout(() => {
      if (sessionToken !== state.recordingSessionToken || state.mediaRecorder !== recorder) return;
      state.recordingStarting = false;
      state.recordingSegmentStartedAt = performance.now();
      $("#toggleRecording").textContent = "● 녹음 중";
      $("#pauseRecording").disabled = false;
      $("#stopRecording").disabled = false;
      setRecordingBadge("녹음 중", "recording");
      transportUpdate("녹음실", `${window.HoonProjects?.getCurrent?.()?.name || "프로젝트"} · 녹음 중`, true, "recording");
      const includesMrText = state.currentRecordingMeta?.hasMrTrack ? "MR과 보컬을 분리 트랙으로 녹음 중입니다." : "보컬 트랙을 녹음 중입니다.";
      $("#recordingStateText").textContent = includesMrText;
      $("#recordingMessage").textContent = state.currentRecordingMeta?.hasMr
        ? `싱크 ${formatSignedMilliseconds(state.currentRecordingMeta.syncOffsetMs)}를 기록하며 보컬 원본과 MR을 따로 저장합니다.`
        : "정지하면 보컬 트랙으로 자동 저장됩니다.";
      updateRecordingTimer();
    }, uiStartDelayMs);
  } catch (error) {
    state.recordingSessionToken += 1;
    cleanupRecordingStream();
    const message = microphoneErrorMessage(error);
    $("#recordingMessage").textContent = message;
    $("#recordingStateText").textContent = "녹음을 시작하지 못했습니다.";
    setRecordingBadge("사용 불가", "error");
  }
}

function pauseMrBufferPlayback() {
  if (!state.mrPlaybackSource) return false;
  state.mrPlaybackOffsetSec = getCurrentMrPlaybackOffset();
  stopMrBufferPlayback({ preservePosition: true });
  return true;
}

function toggleRecordingPause() {
  const recorder = state.mediaRecorder;
  if (!recorder || recorder.state === "inactive" || state.recordingStarting) return;
  const context = ensureAudioContext();
  if (recorder.state === "recording") {
    const pausedAt = performance.now();
    state.recordingActiveMs += state.recordingSegmentStartedAt ? Math.max(0, pausedAt - state.recordingSegmentStartedAt) : 0;
    state.recordingSegmentStartedAt = 0;
    state.recordingMediaActiveMs += state.recordingMediaSegmentStartedAt ? Math.max(0, pausedAt - state.recordingMediaSegmentStartedAt) : 0;
    state.recordingMediaSegmentStartedAt = 0;
    recorder.pause();
    if (state.vocalTrackRecorder?.state === "recording") state.vocalTrackRecorder.pause();
    state.recordingGate?.gain.cancelScheduledValues(context.currentTime);
    state.recordingGate?.gain.setValueAtTime(0, context.currentTime);
    state.recordingVocalTrackGate?.gain.cancelScheduledValues(context.currentTime);
    state.recordingVocalTrackGate?.gain.setValueAtTime(0, context.currentTime);
    state.mrResumeAfterPause = pauseMrBufferPlayback();
    $("#pauseRecording").textContent = "계속 녹음";
    $("#recordingStateText").textContent = "녹음과 MR을 같은 위치에서 잠시 멈췄습니다.";
    setRecordingBadge("일시정지", "paused");
    transportUpdate("녹음실", "녹음과 MR 일시정지", false, "idle");
    updateRecordingTimer();
  } else if (recorder.state === "paused") {
    const resumeAt = context.currentTime + RECORDING_RESUME_LEAD_MS / 1000;
    recorder.resume();
    if (state.vocalTrackRecorder?.state === "paused") state.vocalTrackRecorder.resume();
    state.recordingGate?.gain.cancelScheduledValues(context.currentTime);
    state.recordingGate?.gain.setValueAtTime(0, context.currentTime);
    state.recordingGate?.gain.setValueAtTime(1, resumeAt);
    state.recordingVocalTrackGate?.gain.cancelScheduledValues(context.currentTime);
    state.recordingVocalTrackGate?.gain.setValueAtTime(0, context.currentTime);
    state.recordingVocalTrackGate?.gain.setValueAtTime(1, resumeAt);
    if (state.mrResumeAfterPause && state.mrAudioBuffer && state.mrPlaybackOffsetSec < state.mrAudioBuffer.duration - 0.01) {
      scheduleMrBufferPlayback(resumeAt, state.mrPlaybackOffsetSec);
    }
    state.mrResumeAfterPause = false;
    state.recordingSegmentStartedAt = performance.now() + RECORDING_RESUME_LEAD_MS;
    $("#pauseRecording").textContent = "일시정지";
    $("#recordingStateText").textContent = "MR 위치를 복원해 녹음을 계속하고 있습니다.";
    setRecordingBadge("녹음 중", "recording");
    transportUpdate("녹음실", "녹음 계속", true, "recording");
  }
}

function stopRecording({ skipTail = false } = {}) {
  const recorder = state.mediaRecorder;
  if (!recorder || recorder.state === "inactive" || state.recordingStopping) return;
  state.recordingStopping = true;
  state.recordingSessionToken += 1;
  state.recordingStarting = false;
  clearRecordingScheduledActions();
  const context = state.audioContext;
  if (recorder.state === "recording" && state.recordingSegmentStartedAt) {
    state.recordingActiveMs += Math.max(0, performance.now() - state.recordingSegmentStartedAt);
    state.recordingSegmentStartedAt = 0;
  }
  clearInterval(state.recordingTimerId);
  state.recordingTimerId = null;
  updateRecordingTimer();
  $("#pauseRecording").disabled = true;
  $("#stopRecording").disabled = true;

  const wasPaused = recorder.state === "paused";
  const hasMixedMr = Boolean(state.currentRecordingMeta?.hasMr);
  const tailMs = skipTail || wasPaused ? 0 : (hasMixedMr ? getRecordingSyncTailMs() : 80);

  // 새 입력은 즉시 막고 DelayNode 안에 남아 있는 보정 신호만 끝까지 흘려보냅니다.
  if (context) {
    const now = context.currentTime;
    if (state.recordingVocalGain) {
      state.recordingVocalGain.gain.cancelScheduledValues(now);
      state.recordingVocalGain.gain.setValueAtTime(0, now);
    }
    if (state.mrRecordGain) {
      state.mrRecordGain.gain.cancelScheduledValues(now);
      state.mrRecordGain.gain.setValueAtTime(0, now);
    }
    if (state.recordingVocalTrackGate) {
      state.recordingVocalTrackGate.gain.cancelScheduledValues(now);
      state.recordingVocalTrackGate.gain.setValueAtTime(0, now);
    }
  }
  stopMrBufferPlayback({ preservePosition: false });
  $("#mrAudio").pause();
  state.recordingControlsMr = false;
  state.mrResumeAfterPause = false;
  $("#recordingStateText").textContent = tailMs > 0
    ? "싱크 보정의 마지막 소리까지 담고 있습니다."
    : "녹음을 마무리하고 있습니다.";
  setRecordingBadge("저장 중", "saving");
  transportUpdate("녹음실", "트랙 저장 중", true, "recording");

  const finalizeStop = () => {
    state.recordingStopTimeout = null;
    if (context && state.recordingGate) {
      state.recordingGate.gain.cancelScheduledValues(context.currentTime);
      state.recordingGate.gain.setValueAtTime(0, context.currentTime);
    }
    if (tailMs > 0) state.recordingActiveMs += tailMs;
    const mediaStoppedAt = performance.now();
    state.recordingMediaActiveMs += state.recordingMediaSegmentStartedAt ? Math.max(0, mediaStoppedAt - state.recordingMediaSegmentStartedAt) : 0;
    state.recordingMediaSegmentStartedAt = 0;
    try {
      if (state.vocalTrackRecorder && state.vocalTrackRecorder.state !== "inactive") {
        state.vocalTrackRecorder.requestData?.();
        state.vocalTrackRecorder.stop();
      } else {
        state.vocalTrackStopResolve?.(null);
        state.vocalTrackStopResolve = null;
      }
      recorder.requestData?.();
      recorder.stop();
    } catch (error) {
      $("#recordingMessage").textContent = error.message;
      cleanupRecordingStream();
    }
  };

  if (tailMs > 0) state.recordingStopTimeout = window.setTimeout(finalizeStop, tailMs);
  else finalizeStop();
}

async function deleteAllRecordings() {
  const targets = visibleRecordings();
  const project = window.HoonProjects?.getCurrent?.();
  if (!targets.length || !confirm(`‘${project?.name || "현재 프로젝트"}’의 녹음 ${targets.length}개를 모두 삭제할까요?`)) return;
  try {
    await Promise.all(targets.filter((recording) => !recording.volatile).map((recording) => deleteStoredRecording(recording.id)));
    const ids = new Set(targets.map((recording) => recording.id));
    state.recordings = state.recordings.filter((recording) => !ids.has(recording.id));
    renderProjectUi();
    renderRecordings();
    $("#recordingMessage").textContent = "현재 프로젝트의 녹음을 모두 삭제했습니다.";
  } catch (error) {
    $("#recordingMessage").textContent = error.message;
  }
}

function updateProjectSummary() {
  const project = window.HoonProjects?.getCurrent?.();
  const count = visibleRecordings().length;
  const summary = $("#projectSummary");
  if (!project || !summary) return;
  const memo = String(project.memo || "").trim();
  summary.textContent = `${count}개 녹음${memo ? ` · ${memo}` : " · 녹음과 MR을 프로젝트별로 정리합니다."}`;
  $("#deleteProject").disabled = project.id === window.HoonProjects?.DEFAULT_ID;
}

function renderProjectUi() {
  const select = $("#projectSelect");
  if (!select || !window.HoonProjects) return;
  const projects = window.HoonProjects.list().sort((a, b) => Number(b.lastUsedAt || b.updatedAt) - Number(a.lastUsedAt || a.updatedAt));
  const currentId = currentProjectId();
  select.innerHTML = "";
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    option.selected = project.id === currentId;
    select.appendChild(option);
  });
  updateProjectSummary();
}

function closeProjectDialog() {
  const dialog = $("#projectDialog");
  if (!dialog) return;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function openProjectDialog(mode = "create") {
  const project = window.HoonProjects?.getCurrent?.();
  state.projectDialogMode = mode;
  $("#projectDialogTitle").textContent = mode === "edit" ? "프로젝트 정보 수정" : "새 녹음 프로젝트";
  $("#projectNameInput").value = mode === "edit" ? project?.name || "" : "";
  $("#projectMemoInput").value = mode === "edit" ? project?.memo || "" : "";
  const dialog = $("#projectDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  window.setTimeout(() => $("#projectNameInput").focus(), 0);
}

async function saveProjectFromDialog(event) {
  event.preventDefault();
  const name = $("#projectNameInput").value.trim();
  const memo = $("#projectMemoInput").value.trim();
  if (!name) {
    $("#projectNameInput").focus();
    return;
  }
  if (state.projectDialogMode === "edit") {
    window.HoonProjects?.update?.(currentProjectId(), { name, memo });
  } else {
    window.HoonProjects?.create?.({ name, memo });
  }
  closeProjectDialog();
  renderProjectUi();
  renderRecordings();
  transportUpdate("녹음실", `${window.HoonProjects?.getCurrent?.()?.name || "프로젝트"} 선택됨`, false, "idle");
}

async function deleteCurrentProject() {
  const project = window.HoonProjects?.getCurrent?.();
  if (!project || project.id === window.HoonProjects?.DEFAULT_ID) return;
  const targets = state.recordings.filter((recording) => normalizedProjectId(recording) === project.id);
  const message = targets.length
    ? `‘${project.name}’을 삭제할까요? 녹음 ${targets.length}개는 기본 녹음 프로젝트로 이동합니다.`
    : `‘${project.name}’ 프로젝트를 삭제할까요?`;
  if (!confirm(message)) return;
  const defaultId = window.HoonProjects.DEFAULT_ID;
  const updates = [];
  state.recordings = state.recordings.map((recording) => {
    if (normalizedProjectId(recording) !== project.id) return recording;
    const updated = { ...recording, projectId: defaultId, updatedAt: Date.now() };
    if (!recording.volatile) updates.push(updated);
    return updated;
  });
  if (updates.length) await Promise.allSettled(updates.map((recording) => putStoredRecording(recording)));
  window.HoonProjects.remove(project.id);
  renderProjectUi();
  renderRecordings();
  $("#recordingMessage").textContent = "프로젝트를 삭제하고 녹음은 기본 프로젝트로 이동했습니다.";
}

function setupProjects() {
  renderProjectUi();
  $("#projectSelect").addEventListener("change", (event) => {
    window.HoonProjects?.setCurrentId?.(event.target.value);
    renderProjectUi();
    renderRecordings();
    window.HoonMixer?.refresh?.();
    transportUpdate("녹음실", `${window.HoonProjects?.getCurrent?.()?.name || "프로젝트"} 선택됨`, false, "idle");
  });
  $("#newProject").addEventListener("click", () => openProjectDialog("create"));
  $("#editProject").addEventListener("click", () => openProjectDialog("edit"));
  $("#deleteProject").addEventListener("click", deleteCurrentProject);
  $("#closeProjectDialog").addEventListener("click", closeProjectDialog);
  $("#cancelProjectDialog").addEventListener("click", closeProjectDialog);
  $("#projectForm").addEventListener("submit", saveProjectFromDialog);
  $("#projectDialog").addEventListener("click", (event) => {
    if (event.target === $("#projectDialog")) closeProjectDialog();
  });
}

async function saveMixerSettings(recording, mixSettings) {
  const latest = state.recordings.find((entry) => entry.id === recording.id) || recording;
  const updated = { ...latest, mixSettings, updatedAt: Date.now() };
  if (!recording.volatile) await putStoredRecording(updated);
  state.recordings = state.recordings.map((entry) => entry.id === recording.id ? updated : entry);
  return updated;
}

function stopAudioForMixer() {
  stopMetronome();
  stopProgression();
  stopTuner();
  stopVocalTune();
  stopMrBufferPlayback({ preservePosition: false });
  const mrAudio = $("#mrAudio");
  if (mrAudio) mrAudio.pause();
  pauseOtherRecordingPlayers(null);
}

function setupMixer() {
  window.HoonMixer?.init?.({
    getRecordings: () => visibleRecordings(),
    getAudioContext: ensureAudioContext,
    saveSettings: saveMixerSettings,
    stopOtherAudio: stopAudioForMixer,
    transportUpdate,
    onStatus: () => {}
  });
}

function setupSidebar() {
  const button = $("#sidebarToggle");
  if (!button) return;
  const collapsed = localStorage.getItem("hoonMusicSidebarCollapsed") === "true";
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const update = () => {
    const isCollapsed = document.body.classList.contains("sidebar-collapsed");
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.setAttribute("aria-label", isCollapsed ? "사이드바 펼치기" : "사이드바 접기");
    button.querySelector("b").textContent = isCollapsed ? "메뉴 펼치기" : "메뉴 접기";
  };
  update();
  button.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("hoonMusicSidebarCollapsed", String(document.body.classList.contains("sidebar-collapsed")));
    update();
  });
}

function activateTab(target, { stopAudio = true } = {}) {
  const tab = $(`.tab[data-tab="${target}"]`);
  if (!tab) return;
  if (target !== "recording" && state.mediaRecorder && state.mediaRecorder.state !== "inactive") stopRecording();
  if (stopAudio) {
    if (target !== "metronome") stopMetronome();
    if (target !== "chords") stopProgression();
    if (target !== "tuner") stopTuner();
    if (target !== "vocalTune") stopVocalTune();
    if (target !== "recording") {
      $("#mrAudio")?.pause();
      pauseOtherRecordingPlayers(null);
    }
    if (target !== "mixer") window.HoonMixer?.stop?.({ preservePosition: true, silent: true });
  }
  state.currentTab = target;
  $$(".tab").forEach((item) => {
    const active = item === tab;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", String(active));
  });
  $$(".panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === target));
  const status = target === "recording"
    ? `${window.HoonProjects?.getCurrent?.()?.name || "기본 프로젝트"} · 준비`
    : target === "mixer"
      ? "2트랙 녹음을 선택하세요"
      : "준비됨";
  transportUpdate(TAB_LABELS[target] || "훈뮤직툴", status, false, "idle");
}

function setupTabs() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
}

function stopAllAudio() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") stopRecording();
  stopMetronome();
  stopProgression();
  stopTuner();
  stopVocalTune();
  window.HoonMixer?.stop?.();
  stopMrBufferPlayback({ preservePosition: false });
  const mrAudio = $("#mrAudio");
  if (mrAudio) mrAudio.pause();
  pauseOtherRecordingPlayers(null);
  transportUpdate(TAB_LABELS[state.currentTab] || "훈뮤직툴", "모든 재생 정지", false, "idle");
}

async function transportPlayPause() {
  if (state.currentTab === "chords") {
    state.progressionPlaying ? stopProgression() : playProgression();
    return;
  }
  if (state.currentTab === "metronome") {
    toggleMetronome();
    return;
  }
  if (state.currentTab === "tuner") {
    toggleTuner();
    return;
  }
  if (state.currentTab === "vocalTune") {
    toggleVocalTune();
    return;
  }
  if (state.currentTab === "mixer") {
    window.HoonMixer?.toggle?.();
    return;
  }
  const recorder = state.mediaRecorder;
  if (recorder && recorder.state !== "inactive") {
    toggleRecordingPause();
    return;
  }
  if (state.activeRecordingAudio) {
    try {
      if (state.activeRecordingAudio.paused) await state.activeRecordingAudio.play();
      else state.activeRecordingAudio.pause();
    } catch (error) {
      transportUpdate("녹음실", error.message, false, "error");
    }
    return;
  }
  const mrAudio = $("#mrAudio");
  if (mrAudio?.src) {
    try {
      if (mrAudio.paused) await mrAudio.play();
      else mrAudio.pause();
      transportUpdate("MR 미리듣기", mrAudio.paused ? "일시정지" : "재생 중", !mrAudio.paused, "playing");
    } catch (error) {
      transportUpdate("MR 미리듣기", error.message, false, "error");
    }
    return;
  }
  transportUpdate("녹음실", "재생할 녹음 또는 MR을 선택하세요.", false, "idle");
}

function transportRecord() {
  activateTab("recording");
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") stopRecording();
  else startRecording();
}

function setupTransport() {
  window.HoonTransport?.configure({
    playPause: transportPlayPause,
    stop: stopAllAudio,
    record: transportRecord
  });
  window.HoonTransport?.init();
  transportUpdate("코드 진행", "준비됨", false, "idle");
}

function isStandaloneMode() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function isMobileDevice() {
  return isIosDevice() || isAndroidDevice() || window.matchMedia?.("(max-width: 760px)").matches;
}

function installStep(number, text) {
  return `<div class="install-step"><strong>${number}</strong><p>${text}</p></div>`;
}

function renderInstallGuide() {
  const content = $("#installGuideContent");
  const nativeButton = $("#nativeInstallBtn");
  const secureOnline = window.isSecureContext && location.protocol !== "file:";
  nativeButton.hidden = !state.deferredInstallPrompt;

  if (isStandaloneMode()) {
    content.innerHTML = `<p class="install-note">훈뮤직툴이 이미 홈 화면 앱으로 실행되고 있습니다.</p>`;
    nativeButton.hidden = true;
    return;
  }

  if (!secureOnline) {
    content.innerHTML = [
      `<p class="install-note">모바일에서 마이크·녹음·홈 화면 설치까지 사용하려면 이 폴더를 GitHub Pages 또는 Netlify에 올려 HTTPS 주소로 열어야 합니다.</p>`,
      installStep(1, "배포용 폴더의 파일을 GitHub Pages 또는 Netlify에 업로드합니다."),
      installStep(2, "생성된 https:// 주소를 스마트폰 Chrome 또는 Safari에서 엽니다."),
      installStep(3, "상단의 설치 버튼을 누르거나 브라우저 메뉴에서 홈 화면에 추가합니다.")
    ].join("");
    nativeButton.hidden = true;
    return;
  }

  if (state.deferredInstallPrompt) {
    content.innerHTML = [
      `<p class="install-note">아래 버튼을 누르면 훈뮤직툴이 홈 화면에 설치됩니다.</p>`,
      installStep(1, "지금 설치를 누릅니다."),
      installStep(2, "설치 확인 창에서 설치를 선택합니다."),
      installStep(3, "다음부터는 홈 화면의 훈뮤직툴 아이콘으로 바로 실행합니다.")
    ].join("");
    nativeButton.hidden = false;
    return;
  }

  if (isIosDevice()) {
    content.innerHTML = [
      installStep(1, "Safari 아래쪽의 공유 버튼(□ 위쪽 화살표)을 누릅니다."),
      installStep(2, "메뉴에서 ‘홈 화면에 추가’를 선택합니다."),
      installStep(3, "오른쪽 위 ‘추가’를 누르면 홈 화면에 아이콘이 생깁니다.")
    ].join("");
  } else {
    content.innerHTML = [
      installStep(1, "브라우저 오른쪽 위의 점 3개 메뉴를 누릅니다."),
      installStep(2, "‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택합니다."),
      installStep(3, "추가 또는 설치를 누르면 홈 화면에서 바로 실행할 수 있습니다.")
    ].join("");
  }
}

function openInstallSheet() {
  renderInstallGuide();
  $("#installSheet").hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => $("#closeInstallSheet")?.focus(), 0);
}

function closeInstallSheet() {
  $("#installSheet").hidden = true;
  document.body.style.overflow = "";
}

async function triggerNativeInstall() {
  if (!state.deferredInstallPrompt) {
    renderInstallGuide();
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  $("#nativeInstallBtn").hidden = true;
  closeInstallSheet();
  updateMobileInstallUi();
}

async function shareAppAddress() {
  const button = $("#shareBtn");
  const original = button.textContent;
  if (location.protocol === "file:") {
    openInstallSheet();
    return;
  }
  const data = {
    title: "훈뮤직툴",
    text: "코드 진행·보컬튠·녹음실·메트로놈·튜너",
    url: location.href.split("#")[0]
  };
  try {
    if (navigator.share) {
      await navigator.share(data);
    } else {
      await navigator.clipboard.writeText(data.url);
      button.textContent = "복사됨";
      window.setTimeout(() => { button.textContent = original; }, 1400);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      try {
        await navigator.clipboard.writeText(data.url);
        button.textContent = "복사됨";
        window.setTimeout(() => { button.textContent = original; }, 1400);
      } catch (_) {
        button.textContent = "실패";
        window.setTimeout(() => { button.textContent = original; }, 1400);
      }
    }
  }
}

function updateMobileInstallUi() {
  const installed = isStandaloneMode();
  const installButton = $("#installBtn");
  installButton.hidden = installed;
  installButton.disabled = installed;
  installButton.textContent = state.deferredInstallPrompt ? "설치" : "설치안내";
  $("#mobileReadyBanner").hidden = installed || !isMobileDevice();
}

function showUpdateToast() {
  if (document.querySelector(".update-toast")) return;
  const toast = document.createElement("div");
  toast.className = "update-toast";
  toast.innerHTML = `<span>새 버전을 사용할 수 있습니다.</span><button type="button">업데이트</button>`;
  toast.querySelector("button").addEventListener("click", () => location.reload());
  document.body.appendChild(toast);
}

function setupPwaInstall() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateMobileInstallUi();
    if (!$("#installSheet").hidden) renderInstallGuide();
  });

  $("#installBtn").addEventListener("click", openInstallSheet);
  $("#mobileGuideBtn").addEventListener("click", openInstallSheet);
  $("#closeInstallSheet").addEventListener("click", closeInstallSheet);
  $("#installSheetBackdrop").addEventListener("click", closeInstallSheet);
  $("#nativeInstallBtn").addEventListener("click", triggerNativeInstall);
  $("#shareBtn").addEventListener("click", shareAppAddress);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#installSheet").hidden) closeInstallSheet();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    closeInstallSheet();
    updateMobileInstallUi();
  });

  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", updateMobileInstallUi);
  updateMobileInstallUi();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").then((registration) => {
    registration.update().catch(() => {});
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateToast();
      });
    });
  }).catch((error) => console.warn("Service worker registration failed", error));
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
  ["#genreSelect", "#moodSelect", "#progressionLength"].forEach((selector) => {
    $(selector).addEventListener("change", generateProgression);
  });
  ["#keySelect", "#modeSelect", "#complexitySelect"].forEach((selector) => {
    $(selector).addEventListener("change", () => {
      if (!state.progressionDegrees.length) state.progressionDegrees = chooseProgressionDegrees();
      rebuildProgressionFromDegrees(true);
    });
  });
  $("#playProgression").addEventListener("click", playProgression);
  $("#stopProgression").addEventListener("click", stopProgression);
  $("#playSelectedChord").addEventListener("click", () => playSingleChord(state.progression[state.selectedChordIndex]));
  $("#copyProgression").addEventListener("click", copyProgression);
  $("#saveProgression").addEventListener("click", saveCurrentProgression);
  ["#chordBpm", "#beatsPerChord", "#playStyle", "#soundPreset", "#loopProgression"].forEach((selector) => {
    $(selector).addEventListener("change", savePlaybackSettings);
  });

  $("#toggleVocalTune").addEventListener("click", toggleVocalTune);
  $("#playVocalTarget").addEventListener("click", playVocalTargetTone);
  $("#toggleRecording").addEventListener("click", startRecording);
  $("#pauseRecording").addEventListener("click", toggleRecordingPause);
  $("#stopRecording").addEventListener("click", stopRecording);
  $("#deleteAllRecordings").addEventListener("click", deleteAllRecordings);
  $("#mrFileInput").addEventListener("change", handleMrFileSelection);
  $("#restartMr").addEventListener("click", restartMrPlayback);
  $("#removeMr").addEventListener("click", () => removeMrFile());
  ["#mrMonitorVolume", "#mrMixVolume", "#vocalMixVolume"].forEach((selector) => {
    $(selector).addEventListener("input", updateMrMixerLabels);
  });
  $("#mrSyncOffset").addEventListener("input", () => updateMrSyncControls($("#mrSyncOffset").value));
  $("#mrSyncNumber").addEventListener("change", () => updateMrSyncControls($("#mrSyncNumber").value));
  $("#mrSyncNumber").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      updateMrSyncControls($("#mrSyncNumber").value);
      $("#mrSyncNumber").blur();
    }
  });
  $("#mrSyncMinus").addEventListener("click", () => adjustMrSyncOffset(-10));
  $("#mrSyncPlus").addEventListener("click", () => adjustMrSyncOffset(10));
  $("#mrSyncReset").addEventListener("click", resetMrSyncOffset);
  ["#autoPlayMr", "#includeMrInRecording", "#autoStopOnMrEnd", "#recordingCountIn"].forEach((selector) => {
    $(selector).addEventListener("change", saveMrSettings);
  });
  $("#mrAudio").addEventListener("loadedmetadata", () => {
    $("#mrDuration").textContent = formatMrDuration($("#mrAudio").duration);
  });
  $("#mrAudio").addEventListener("play", () => {
    try { ensureMrAudioGraph(); } catch (error) { $("#mrMessage").textContent = error.message; }
    if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
      stopMetronome();
      stopProgression();
      stopTuner();
      stopVocalTune();
      pauseOtherRecordingPlayers(null);
      window.HoonMixer?.stop?.({ preservePosition: true, silent: true });
      transportUpdate("MR 미리듣기", state.mrFile?.name || "MR 재생 중", true, "playing");
    }
  });
  $("#mrAudio").addEventListener("pause", () => {
    if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") transportUpdate("MR 미리듣기", "일시정지", false, "idle");
  });
  $("#mrAudio").addEventListener("ended", () => {
    if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") $("#mrMessage").textContent = "MR 미리듣기가 끝났습니다.";
  });
  $("#resetVocalPractice").addEventListener("click", () => {
    resetVocalPracticeStats(false);
    resetVocalDisplay("연습 기록을 초기화했습니다. 다시 한 음을 불러 주세요.");
  });
  ["#vocalKeySelect", "#vocalScaleSelect"].forEach((selector) => {
    $(selector).addEventListener("change", () => {
      ensureValidVocalFixedPitch();
      state.vocalTargetMidi = null;
      resetVocalPracticeStats(false);
      renderVocalScaleNotes();
      resetVocalDisplay("새 키와 스케일에 맞춰 한 음을 불러 주세요.");
    });
  });
  $("#vocalTargetMode").addEventListener("change", () => {
    state.vocalTargetMidi = null;
    resetVocalPracticeStats(false);
    renderVocalScaleNotes();
    resetVocalDisplay("목표음 방식을 변경했습니다. 한 음을 불러 주세요.");
  });
  $("#vocalRangeSelect").addEventListener("change", () => {
    saveVocalSettings();
    state.vocalPitchHistory = [];
    resetVocalDisplay("감지 범위를 변경했습니다. 한 음을 불러 주세요.");
  });
  $("#vocalTargetOctave").addEventListener("change", () => {
    state.vocalTargetMidi = fixedVocalTargetMidi();
    resetVocalPracticeStats(false);
    saveVocalSettings();
    updateVocalIdleTarget();
  });

  $("#toggleTuner").addEventListener("click", toggleTuner);
  $("#a4Minus").addEventListener("click", () => setA4Reference(getA4Reference() - 1));
  $("#a4Plus").addEventListener("click", () => setA4Reference(getA4Reference() + 1));
  $("#a4Reference").addEventListener("change", (event) => setA4Reference(event.target.value));
  $("#tuningMode").addEventListener("change", (event) => {
    const mode = event.target.value;
    localStorage.setItem("hoonMusicTuningMode", mode);
    const savedTargetValue = localStorage.getItem(`hoonMusicTarget_${mode}`);
    const savedTarget = savedTargetValue === null ? -1 : Number(savedTargetValue);
    state.tunerTargetIndex = Number.isInteger(savedTarget) ? savedTarget : -1;
    state.tunerPitchHistory = [];
    renderTuningTargets();
    if (state.tunerRunning) resetTunerDisplay("새 튜닝 모드로 악기 한 음을 연주해 주세요.");
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("pagehide", () => {
    stopRecording({ skipTail: true });
    stopMrBufferPlayback({ preservePosition: false });
    $("#mrAudio").pause();
    if (state.mrObjectUrl) URL.revokeObjectURL(state.mrObjectUrl);
    revokeRecordingObjectUrls();
    stopMetronome();
    stopProgression();
    window.HoonMixer?.stop?.({ preservePosition: false, silent: true });
    stopTuner(false);
    stopVocalTune(false);
  });
}

loadSettings();
setupTabs();
setupProjects();
setupSidebar();
setupTransport();
setupMixer();
renderBeatIndicators();
renderTuningTargets();
renderVocalScaleNotes();
resetVocalPracticeStats();
resetVocalDisplay();
generateProgression();
renderSavedProgressions();
renderRecordings();
updateRecordingIdleText();
loadRecordings();
bindEvents();
setupPwaInstall();
registerServiceWorker();
