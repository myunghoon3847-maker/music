"use strict";

self.onmessage = (event) => {
  try {
    const sourceBuffers = event.data?.channels || [];
    const sampleRate = Number(event.data?.sampleRate) || 44100;
    if (!sourceBuffers.length) throw new Error("변환할 오디오 채널이 없습니다.");
    const channelData = sourceBuffers.slice(0, 2).map((buffer) => new Float32Array(buffer));
    const channels = channelData.length;
    const frames = channelData[0].length;
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
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, frames * blockAlign, true);
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const raw = channelData[channel][frame] || 0;
        const sample = Math.max(-1, Math.min(1, raw));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    self.postMessage({ buffer: output }, [output]);
  } catch (error) {
    self.postMessage({ error: error.message || "WAV 변환에 실패했습니다." });
  }
};
