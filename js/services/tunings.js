// ==========================================
// js/services/tunings.js
// 作用：调音器调弦预设、自定义六弦与目标频率
// 目标弦身份按弦位 slot 0–5（低到高），允许自定义调弦出现重复音高
// ==========================================

import { A4_DEFAULT, midiToFrequency } from './pitch.js';

export const CUSTOM_TUNING_ID = 'custom';
export const TUNING_PRESET_KEY = 'guitar_tuner_preset';
export const TUNING_CUSTOM_KEY = 'guitar_tuner_custom';
export const NOTE_MIN_MIDI = 38; // D2（Drop D / Open G 的低音 D）
export const NOTE_MAX_MIDI = 76; // E5

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_RE = /^([A-G])(#?)([2-5])$/;

export const TUNING_PRESETS = [
  { id: 'standard', name: '标准调弦', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'drop-d', name: 'Drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  { id: 'open-g', name: 'Open G', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
  { id: 'open-d', name: 'Open D', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'] },
  { id: 'dadgad', name: 'DADGAD', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] }
];

export function midiToNoteName(midi) {
  const value = Math.round(Number(midi));
  if (!isFinite(value) || value < 0 || value > 127) return '';
  const pc = ((value % 12) + 12) % 12;
  return `${NOTE_NAMES[pc]}${Math.floor(value / 12) - 1}`;
}

export function parseNote(note) {
  const m = NOTE_RE.exec(String(note || '').trim());
  if (!m) return null;
  const name = `${m[1]}${m[2]}`;
  const octave = Number(m[3]);
  const pc = NOTE_NAMES.indexOf(name);
  if (pc < 0) return null;
  const midi = (octave + 1) * 12 + pc;
  if (midi < NOTE_MIN_MIDI || midi > NOTE_MAX_MIDI) return null;
  return { name, octave, midi };
}

export function noteLabel(note) {
  const parsed = parseNote(note);
  if (!parsed) return '?';
  // 标准调弦的高音 E 保持小写 e，和低音 E 区分；其他音名照常大写。
  return parsed.name === 'E' && parsed.octave >= 4 ? 'e' : parsed.name;
}

export function formatTuningNotes(notes) {
  return (notes || []).map(noteLabel).join(' ');
}

export function normalizeTuningNotes(notes) {
  if (!Array.isArray(notes) || notes.length !== 6) return null;
  const out = [];
  for (const note of notes) {
    const parsed = parseNote(note);
    if (!parsed) return null;
    out.push(`${parsed.name}${parsed.octave}`);
  }
  return out;
}

export function normalizeCustomTuning(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (err) { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const notes = normalizeTuningNotes(value.notes);
  if (!notes) return null;
  const name = String(value.name || '').trim().slice(0, 16) || '自定义调弦';
  return { name, notes };
}

export function getPresetById(id) {
  return TUNING_PRESETS.find(p => p.id === id) || null;
}

export function resolveTuning(presetId, customRaw) {
  const custom = normalizeCustomTuning(customRaw);
  if (presetId === CUSTOM_TUNING_ID && custom) {
    return { id: CUSTOM_TUNING_ID, name: custom.name, notes: custom.notes, custom };
  }
  const preset = getPresetById(presetId) || TUNING_PRESETS[0];
  return { ...preset, custom };
}

export function readTuningState() {
  let presetId = TUNING_PRESETS[0].id;
  let customRaw = null;
  try {
    presetId = localStorage.getItem(TUNING_PRESET_KEY) || presetId;
    customRaw = localStorage.getItem(TUNING_CUSTOM_KEY);
  } catch (err) {}
  return resolveTuning(presetId, customRaw);
}

export function writeTuningState(tuning, custom = null) {
  try {
    localStorage.setItem(TUNING_PRESET_KEY, tuning.id);
    if (custom) localStorage.setItem(TUNING_CUSTOM_KEY, JSON.stringify(custom));
  } catch (err) {}
}

export function createTuningTargets(tuning, a4 = A4_DEFAULT) {
  const notes = normalizeTuningNotes(tuning && tuning.notes) || TUNING_PRESETS[0].notes;
  return notes.map((note, slot) => {
    const parsed = parseNote(note);
    return {
      slot,
      stringNumber: 6 - slot,
      name: `${parsed.name}${parsed.octave}`,
      note: parsed.name,
      label: noteLabel(note),
      midi: parsed.midi,
      frequency: midiToFrequency(parsed.midi, a4)
    };
  });
}

export function guitarNoteOptions() {
  const out = [];
  for (let midi = NOTE_MIN_MIDI; midi <= NOTE_MAX_MIDI; midi++) {
    const note = midiToNoteName(midi);
    out.push({ note, label: noteLabel(note), midi });
  }
  return out;
}
