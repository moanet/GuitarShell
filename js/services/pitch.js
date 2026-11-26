// ==========================================
// js/services/pitch.js
// 作用：基频检测（YIN）与音高换算（A4 可校准）
// 纯前端 DSP，无平台依赖：浏览器 / Capacitor WebView 共用同一套
// ==========================================

export const A4_DEFAULT = 440;
export const A4_MIN = 430;
export const A4_MAX = 450;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// 吉他标准调弦（MIDI 音高）：E2=40 A2=45 D3=50 G3=55 B3=59 E4=64
export const GUITAR_STRINGS = [
  { name: 'E2', midi: 40, label: 'E' },
  { name: 'A2', midi: 45, label: 'A' },
  { name: 'D3', midi: 50, label: 'D' },
  { name: 'G3', midi: 55, label: 'G' },
  { name: 'B3', midi: 59, label: 'B' },
  { name: 'E4', midi: 64, label: 'e' }
];

export function clampA4(value) {
  const v = Number(value);
  if (!isFinite(v)) return A4_DEFAULT;
  return Math.min(A4_MAX, Math.max(A4_MIN, Math.round(v)));
}

export function midiToFrequency(midi, a4 = A4_DEFAULT) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(freq, a4 = A4_DEFAULT) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function centsBetween(freq, targetFreq) {
  if (!(freq > 0) || !(targetFreq > 0)) return 0;
  return 1200 * Math.log2(freq / targetFreq);
}

// 任意频率 → 最近的十二平均律音（含音名、八度、与标准音的音分差）
export function nearestNote(freq, a4 = A4_DEFAULT) {
  const midiFloat = frequencyToMidi(freq, a4);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  const pc = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES[pc];
  const octave = Math.floor(midi / 12) - 1;
  return {
    midi,
    name,
    octave,
    label: `${name}${octave}`,
    frequency: midiToFrequency(midi, a4),
    cents
  };
}

// 六根弦在当前 A4 校准下的目标频率
export function guitarStringTargets(a4 = A4_DEFAULT) {
  return GUITAR_STRINGS.map(s => ({
    ...s,
    frequency: midiToFrequency(s.midi, a4)
  }));
}

// ==========================================
// YIN 基频检测
// 参考 de Cheveigné & Kawahara (2002)：
//   差分函数 → 累积均值归一化差分（CMNDF）→ 绝对阈值取第一谷 → 抛物线插值
// 返回 { frequency, confidence, rms } 或 null（静音 / 噪声 / 无周期）
// ==========================================
export function detectYin(buffer, sampleRate, options = {}) {
  const {
    threshold = 0.15,
    minFreq = 70,
    maxFreq = 400,
    rmsThreshold = 0.008,
    fallbackThreshold = 0.35
  } = options;

  if (!buffer || buffer.length < 256 || !(sampleRate > 0)) return null;

  const n = buffer.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / n);
  if (rms < rmsThreshold) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const hardMaxTau = Math.min(n - 2, Math.floor(sampleRate / minFreq));
  if (hardMaxTau <= minTau) return null;

  const maxTau = hardMaxTau;
  const W = n - maxTau;
  if (W < 128) return null;

  // 1) 差分函数 d(tau)
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // 2) 累积均值归一化差分 CMNDF
  const cm = new Float32Array(maxTau + 1);
  cm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cm[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3) 取第一个低于绝对阈值的谷（避免跳到低八度）
  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cm[tau] < threshold) {
      while (tau + 1 <= maxTau && cm[tau + 1] < cm[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }

  // 没有明显谷时退到全局最小，但要求足够可信，否则判定为噪声
  if (tauEstimate === -1) {
    let best = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (best === -1 || cm[tau] < cm[best]) best = tau;
    }
    if (best === -1 || cm[best] > fallbackThreshold) return null;
    tauEstimate = best;
  }

  // 4) 抛物线插值，得到亚采样精度的周期
  let shift = 0;
  if (tauEstimate > 1 && tauEstimate < maxTau) {
    const y0 = cm[tauEstimate - 1];
    const y1 = cm[tauEstimate];
    const y2 = cm[tauEstimate + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (denom !== 0) shift = (y2 - y0) / denom;
  }
  shift = Math.max(-0.5, Math.min(0.5, shift));

  const tauRefined = tauEstimate + shift;
  const frequency = sampleRate / tauRefined;
  if (!(frequency >= minFreq && frequency <= maxFreq)) return null;

  return {
    frequency,
    confidence: Math.max(0, Math.min(1, 1 - cm[tauEstimate])),
    rms
  };
}

// 吉他弦上的「谐波折叠」：
// 低音弦衰减到后期，基频变弱、二次谐音占主导时，YIN 会锁到 2 倍频（E2 82.4 → 164.8，
// 自动模式会被误判成 D3）。这里把明显落在弦目标之外的 2/3/4 倍频折回基频。
// 注意：原频率本身已贴近某根弦时不折叠，避免把真正的 E4（329.6）折成 A2（110）。
export function foldToGuitarFundamental(freq, a4 = A4_DEFAULT, targetSlot = null, targets = null) {
  if (!(freq > 0)) return freq;
  const list = targets && targets.length ? targets : guitarStringTargets(a4);

  if (targetSlot !== null && targetSlot !== undefined && targetSlot !== 'auto') {
    const target = list.find(t => t.slot === Number(targetSlot)) ||
      list.find(t => t.name === targetSlot);
    if (!target) return freq;

    if (Math.abs(centsBetween(freq, target.frequency)) <= 60) return freq;

    let best = freq;
    let bestCents = Infinity;
    for (let n = 2; n <= 4; n++) {
      const sub = freq / n;
      const c = Math.abs(centsBetween(sub, target.frequency));
      if (c <= 60 && c < bestCents) { best = sub; bestCents = c; }
    }
    return best;
  }

  let nearestCents = Infinity;
  for (const t of list) {
    nearestCents = Math.min(nearestCents, Math.abs(centsBetween(freq, t.frequency)));
  }
  if (nearestCents <= 60) return freq;

  let best = freq;
  let bestCents = Infinity;
  for (let n = 2; n <= 4; n++) {
    const sub = freq / n;
    for (const t of list) {
      const c = Math.abs(centsBetween(sub, t.frequency));
      if (c <= 60 && c < bestCents) { best = sub; bestCents = c; }
    }
  }
  return best;
}

// 频率历史的中值滤波：抵抗拨弦瞬间的毛刺与八度跳变
export function medianFrequency(values) {
  if (!values || !values.length) return 0;
  const arr = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}
