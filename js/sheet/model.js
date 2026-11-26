// 乐谱数据模型（DataModel v0.1）：类型构造 + 校验 + JSON 往返
// 约定：只用纯对象 / 数组 / 数字 / 字符串，可直接 JSON 序列化；不存任何视觉字段。

export const PPQ = 480;
export const GRID_TICKS = 240; // unit=8，一个栅格 = 八分音符
export const SCHEMA_VERSION = '1.0';

export const KIND_RANK = { rest: 0, tie: 1, pluck: 2, note: 3, chord: 4, strum: 5 };

export function capacityOf(timeSignature, ppq = PPQ) {
  const { numerator, denominator } = timeSignature;
  return Math.round((ppq * 4 * numerator) / denominator);
}

export function beatsOf(capacity) {
  return Math.round(capacity / PPQ);
}

export function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

// ---------- Fret ----------
export const fret = {
  at: (value) => ({ fret: clampFret(value) }),
  muted: () => ({ muted: {} }),
  harmonic: (value) => ({ harmonic: clampFret(value) }),
  unknown: () => ({ unknown: {} })
};

function clampFret(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 24 ? 24 : Math.round(n);
}

// ---------- Kind ----------
export const kind = {
  strum: ({ direction = 'Down', muted = false, accent = false, from = 6, to = 1 } = {}) => ({
    strum: { direction, muted, accent, strings: { from, to } }
  }),
  pluck: (string, fretValue = null) => ({ pluck: { string, fret: fretValue, fret_from_chord: true } }),
  note: (string, fretValue) => ({ note: { string, fret: fretValue } }),
  chord: (notes) => ({ chord: { notes } }),
  rest: () => ({ rest: {} }),
  tie: (fromTick) => ({ tie: { from_tick: fromTick } })
};

export const modifier = {
  accent: () => ({ accent: {} }),
  cut: () => ({ cut: {} }),
  dotted: (count = 1) => ({ dotted: { count } }),
  hammer: (target) => ({ hammer: { target_fret: target } }),
  pull: (target) => ({ pull: { target_fret: target } }),
  slide: (toFret, direction) => ({ slide: { to_fret: toFret, direction } }),
  tuplet: (num, den) => ({ tuplet: { num, den } })
};

export function kindName(kindObj) {
  return Object.keys(kindObj)[0] || 'rest';
}

// ---------- 构造 ----------
export function makeMetadata({ timeSignature = { numerator: 4, denominator: 4 }, ...rest } = {}) {
  const metadata = {
    tempo_bpm: rest.tempo_bpm ?? 90,
    time_signature: { numerator: timeSignature.numerator, denominator: timeSignature.denominator },
    ppq: PPQ,
    render_mode: rest.render_mode || 'Rhythm',
    source_syntax: rest.source_syntax || 'Compact'
  };
  if (rest.title) metadata.title = rest.title;
  if (rest.subtitle) metadata.subtitle = rest.subtitle;
  if (rest.artist) metadata.artist = rest.artist;
  if (rest.key_signature) metadata.key_signature = rest.key_signature;
  return metadata;
}

export function makeScore({ metadata, measures }) {
  return {
    schema_version: SCHEMA_VERSION,
    metadata,
    tracks: [{
      id: 'guitar-1',
      instrument: 'Guitar',
      tuning: { strings: [64, 59, 55, 50, 45, 40], label: 'Standard EADGBE' },
      measures
    }]
  };
}

export function makeMeasure(index, startTick, capacity, { isPickup = false } = {}) {
  return {
    index,
    start_tick: startTick,
    capacity,
    is_pickup: isPickup,
    chords: [],
    items: [],
    markers: []
  };
}

export function sortItems(items) {
  return items.slice().sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const rankDiff = KIND_RANK[kindName(a.kind)] - KIND_RANK[kindName(b.kind)];
    if (rankDiff) return rankDiff;
    return stringOf(a) - stringOf(b);
  });
}

function stringOf(item) {
  const k = kindName(item.kind);
  const body = item.kind[k];
  if (body && typeof body.string === 'number') return body.string;
  if (body && Array.isArray(body.notes) && body.notes.length) return body.notes[0].string;
  return 0;
}

// ---------- 求解 ----------
export function chordAt(measure, tick) {
  for (const span of measure.chords) {
    if (tick >= span.start_tick && tick < span.end_tick) return span;
  }
  return null;
}

// ---------- 校验（DataModel §4 约束 + §10）----------
export function validate(score) {
  const issues = [];
  const error = (code, message) => issues.push({ level: 'Error', code, message });
  const warn = (code, message) => issues.push({ level: 'Warning', code, message });

  if (!score || typeof score !== 'object') {
    error('schema', 'score 不是对象');
    return issues;
  }
  if (score.schema_version !== SCHEMA_VERSION) {
    error('schema', `schema_version 应为 ${SCHEMA_VERSION}，实际 ${score.schema_version}`);
  }
  const md = score.metadata || {};
  if (md.ppq !== PPQ) error('schema', `ppq 应为 ${PPQ}，实际 ${md.ppq}`);
  if (!(md.tempo_bpm >= 20 && md.tempo_bpm <= 300)) {
    warn('meta', `tempo_bpm=${md.tempo_bpm} 超出 20..300`);
  }
  const ts = md.time_signature;
  if (!ts || !Number.isInteger(ts.numerator) || !isPowerOfTwo(ts.denominator)) {
    error('meta', '拍号非法（分母必须是 2 的幂）');
  }

  const tracks = Array.isArray(score.tracks) ? score.tracks : [];
  for (const track of tracks) {
    let expectedStart = 0;
    (track.measures || []).forEach((measure, position) => {
      const path = `tracks/${track.id}/measures/${measure.index}`;

      // M6 index 连续
      if (measure.index !== position) {
        error('M6', `${path}: index 应为 ${position}，实际 ${measure.index}`);
      }
      // M3 start_tick 链
      if (measure.start_tick !== expectedStart) {
        error('M3', `${path}: start_tick 应为 ${expectedStart}，实际 ${measure.start_tick}`);
      }
      expectedStart = measure.start_tick + measure.capacity;

      const capacity = measure.capacity;

      // M1 排序
      const items = measure.items || [];
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1];
        const cur = items[i];
        if (!isOrdered(prev, cur)) {
          error('M1', `${path}: items[${i}] 未按 (tick, kind_rank, string) 排序`);
        }
      }

      const strumTicks = new Set();
      items.forEach((item, i) => {
        // M2
        if (!(item.duration > 0)) error('M2', `${path}: items[${i}] duration 必须 > 0`);
        if (item.tick < 0) error('M2', `${path}: items[${i}] tick 为负`);
        if (item.tick >= capacity) {
          warn('M2', `${path}: items[${i}] tick=${item.tick} 越出容量 ${capacity}`);
        }
        if (kindName(item.kind) === 'strum') {
          if (strumTicks.has(item.tick)) warn('M5', `${path}: tick=${item.tick} 出现多个 Strum`);
          strumTicks.add(item.tick);
        }
      });

      // M4 和弦区间
      const chords = measure.chords || [];
      for (let i = 0; i < chords.length; i += 1) {
        const span = chords[i];
        if (!(span.end_tick > span.start_tick)) {
          error('M4', `${path}: chords[${i}] 区间非法（${span.start_tick}..${span.end_tick}）`);
        }
        if (span.start_tick >= capacity) {
          warn('M4', `${path}: chords[${i}] 起于 ${span.start_tick}，超出容量 ${capacity}`);
        }
        const next = chords[i + 1];
        if (next && span.end_tick > next.start_tick) {
          error('M4', `${path}: chords[${i}] 与 chords[${i + 1}] 重叠`);
        }
      }
    });
  }
  return issues;
}

function isOrdered(prev, cur) {
  if (prev.tick !== cur.tick) return prev.tick < cur.tick;
  const rankDiff = KIND_RANK[kindName(prev.kind)] - KIND_RANK[kindName(cur.kind)];
  if (rankDiff !== 0) return rankDiff < 0;
  return stringOf(prev) <= stringOf(cur);
}

export function hasErrors(issues) {
  return issues.some((issue) => issue.level === 'Error');
}

// ---------- JSON ----------
export function toJSON(score) {
  return JSON.stringify(score, null, 2);
}

export function fromJSON(text) {
  const score = JSON.parse(text);
  if (score.schema_version !== SCHEMA_VERSION) {
    throw new Error(`schema_version 不匹配：${score.schema_version}`);
  }
  if (!score.metadata || score.metadata.ppq !== PPQ) {
    throw new Error('ppq 与当前模型不匹配');
  }
  return score;
}
