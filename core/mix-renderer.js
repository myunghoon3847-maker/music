"use strict";

(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function createOfflineContext(channels, length, sampleRate) {
    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctor) throw new Error("이 브라우저는 오프라인 믹스 생성을 지원하지 않습니다.");
    return new Ctor(channels, Math.max(1, length), sampleRate);
  }

  function anySolo(tracks, settings) {
    return Object.values(settings || {}).some((value) => Boolean(value && typeof value === "object" && value.solo));
  }

  function effectiveGain(track, settings, soloActive) {
    const value = settings[track.settingsKey || track.key] || {};
    if (value.muted || (soloActive && !value.solo)) return 0;
    return clamp(value.volume ?? 1, 0, 1.5) * clamp(track.clipVolume ?? 1, 0, 1.5);
  }

  function scheduleFade(param, when, duration, fadeIn, fadeOut) {
    const safeDuration = Math.max(0, duration);
    const inTime = clamp(fadeIn, 0, Math.min(10, safeDuration));
    const outTime = clamp(fadeOut, 0, Math.min(10, safeDuration));
    param.cancelScheduledValues(when);
    param.setValueAtTime(inTime > 0 ? 0 : 1, when);
    if (inTime > 0) param.linearRampToValueAtTime(1, when + inTime);
    if (outTime > 0) {
      const fadeStart = Math.max(when, when + safeDuration - outTime);
      param.setValueAtTime(1, fadeStart);
      param.linearRampToValueAtTime(0, when + safeDuration);
    }
  }

  function analyzePeak(buffer) {
    let peak = 0;
    let clippedSamples = 0;
    let sampleCount = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      sampleCount += data.length;
      for (let index = 0; index < data.length; index += 1) {
        const absolute = Math.abs(data[index]);
        if (absolute > peak) peak = absolute;
        if (absolute >= 0.999) clippedSamples += 1;
      }
    }
    return {
      peak,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      clippedSamples,
      clippedRatio: sampleCount ? clippedSamples / sampleCount : 0
    };
  }

  async function render(options = {}) {
    const tracks = (options.tracks || []).filter((track) => track?.buffer && Number.isFinite(track.startSec));
    if (!tracks.length) throw new Error("내보낼 트랙이 없습니다.");
    const settings = options.settings || {};
    const sampleRate = clamp(options.sampleRate || 44100, 22050, 48000);
    const duration = Math.max(0, ...tracks.map((track) => {
      const trimStart = clamp(track.trimStartSec || 0, 0, track.buffer.duration);
      const trimEnd = clamp(track.trimEndSec || 0, 0, Math.max(0, track.buffer.duration - trimStart));
      const playable = Number.isFinite(track.playableDuration) ? clamp(track.playableDuration, 0, track.buffer.duration - trimStart) : Math.max(0, track.buffer.duration - trimStart - trimEnd);
      return Math.max(0, track.startSec) + playable;
    }));
    if (!duration) throw new Error("내보낼 오디오 길이가 없습니다.");

    const maxDuration = Number(options.maxDurationSeconds) || 900;
    if (duration > maxDuration) {
      const minutes = Math.floor(maxDuration / 60);
      throw new Error(`현재 기기에서는 한 번에 ${minutes}분까지 WAV로 만들 수 있습니다.`);
    }

    options.onProgress?.("rendering", 0.15);
    const offline = createOfflineContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const master = offline.createGain();
    master.gain.value = clamp(options.masterVolume ?? 0.9, 0, 1.5);

    let outputNode = master;
    if (options.useLimiter !== false && typeof offline.createDynamicsCompressor === "function") {
      const limiter = offline.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      master.connect(limiter);
      outputNode = limiter;
    }
    outputNode.connect(offline.destination);

    const soloActive = anySolo(tracks, settings);
    tracks.forEach((track) => {
      const trackSettings = settings[track.settingsKey || track.key] || {};
      const trimStart = clamp(track.trimStartSec || 0, 0, track.buffer.duration);
      const trimEnd = clamp(track.trimEndSec || 0, 0, Math.max(0, track.buffer.duration - trimStart));
      const playableDuration = Number.isFinite(track.playableDuration) ? clamp(track.playableDuration, 0, track.buffer.duration - trimStart) : Math.max(0, track.buffer.duration - trimStart - trimEnd);
      if (!playableDuration) return;
      const source = offline.createBufferSource();
      source.buffer = track.buffer;
      const fadeGain = offline.createGain();
      const trackGain = offline.createGain();
      trackGain.gain.value = effectiveGain(track, settings, soloActive);
      const panner = typeof offline.createStereoPanner === "function" ? offline.createStereoPanner() : offline.createGain();
      if (panner.pan) panner.pan.value = clamp(trackSettings.pan || 0, -1, 1);
      source.connect(fadeGain);
      fadeGain.connect(trackGain);
      trackGain.connect(panner);
      panner.connect(master);
      const when = Math.max(0, track.startSec);
      scheduleFade(fadeGain.gain, when, playableDuration, track.clipFadeIn ?? trackSettings.fadeIn ?? 0, track.clipFadeOut ?? trackSettings.fadeOut ?? 0);
      source.start(when, trimStart, playableDuration);
    });

    options.onProgress?.("rendering", 0.35);
    const rendered = await offline.startRendering();
    options.onProgress?.("analyzing", 0.72);
    const analysis = analyzePeak(rendered);
    return { buffer: rendered, duration, sampleRate, analysis };
  }

  function encodeWavInline(audioBuffer) {
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const frames = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const output = new ArrayBuffer(44 + frames * blockAlign);
    const view = new DataView(output);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + frames * blockAlign, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, frames * blockAlign, true);
    const data = [];
    for (let channel = 0; channel < channels; channel += 1) data.push(audioBuffer.getChannelData(channel));
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = clamp(data[channel][frame], -1, 1);
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return output;
  }

  async function encodeWav(audioBuffer, options = {}) {
    options.onProgress?.("encoding", 0.78);
    if (typeof Worker === "function") {
      try {
        const channels = Math.min(2, audioBuffer.numberOfChannels);
        const payload = [];
        const transfer = [];
        for (let channel = 0; channel < channels; channel += 1) {
          const copy = new Float32Array(audioBuffer.getChannelData(channel));
          payload.push(copy.buffer);
          transfer.push(copy.buffer);
        }
        const result = await new Promise((resolve, reject) => {
          const worker = new Worker("core/wav-encoder.worker.js");
          const timeout = window.setTimeout(() => {
            worker.terminate();
            reject(new Error("WAV 변환 시간이 초과되었습니다."));
          }, 120000);
          worker.onmessage = (event) => {
            window.clearTimeout(timeout);
            worker.terminate();
            if (event.data?.error) reject(new Error(event.data.error));
            else resolve(event.data.buffer);
          };
          worker.onerror = (event) => {
            window.clearTimeout(timeout);
            worker.terminate();
            reject(new Error(event.message || "WAV 변환에 실패했습니다."));
          };
          worker.postMessage({ channels: payload, sampleRate: audioBuffer.sampleRate }, transfer);
        });
        options.onProgress?.("done", 1);
        return new Blob([result], { type: "audio/wav" });
      } catch (error) {
        console.warn("WAV Worker fallback:", error);
      }
    }
    const arrayBuffer = encodeWavInline(audioBuffer);
    options.onProgress?.("done", 1);
    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  window.HoonMixRenderer = { render, encodeWav, analyzePeak };
})();
