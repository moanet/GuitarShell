// GuitarTabMark v0.1 → Score（DataModel v0.1）
// 入口：parse(text, { mode?, syntax? }) → { score, issues }

import { normalize, REST_ALIASES } from './normalize.js';
import {
  GRID_TICKS, PPQ, capacityOf, isPowerOfTwo,
  fret, kind, modifier, makeMetadata, makeScore, makeMeasure, sortItems
} from './model.js';

const STRING_LETTERS = { e: 1, B: 2, G: 3, D: 4, A: 5, E: 6 };
const SIX_ROW_RE = /^\s*([eBGDAE])\s*\|/;

const PCT_DURATION = {
  '-': 240,
  '=': 480,
  '+': 960,
  '#': 1920,
  R: 240,
  r: 240
};

export function parse(text, options = {}) {
  const issues = [];
  const ctx = { issues };

  const src = normalize(text);
  const meta = {};
  const body = [];

  src.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*#\s*([A-Za-z_]+)\s*=\s*(.*)$/);
    if (m) {
      meta[m[1].toLowerCase()] = m[2].trim();
      return;
    }
    if (!line.trim()) return;
    body.push({ text: line.replace(/\t/g, '  '), no: i + 1 });
  });

  annotateImplicitTabRows(body, ctx);

  const timeSignature = parseTimeSignature(meta.time, issues);
  const capacity = capacityOf(timeSignature);

  const letterRowCount = body.filter((row) => SIX_ROW_RE.test(row.text)).length;
  const implicitRowCount = body.filter((row) => row.implicitStringNo).length;
  const barRowCount = body.filter((row) => /^\s*\|/.test(row.text) && !SIX_ROW_RE.test(row.text)).length;
  const hasColumnRows = letterRowCount > 0 || implicitRowCount > 0 || barRowCount >= 4;
  const hasSixRows = hasColumnRows;
  const hasChordRow = body.some((row) => /^\s*@/.test(row.text));
  const hasPctRow = body.some((row) => /^\s*%/.test(row.text));
  const hasParen = body.some((row) => /\(/.test(row.text));
  const hasBracket = body.some((row) => /\[\s*\S+\s*\]/.test(row.text));

  const syntaxRequested = String(options.syntax || meta.syntax || 'auto').toLowerCase();
  const modeRequested = String(options.mode || meta.mode || 'auto').toLowerCase();

  const syntax = resolveSyntax();
  const renderMode = resolveMode();

  let measures = [];
  if (hasSixRows) {
    measures = parseColumnBlocks(body, capacity, ctx);
  } else if (syntax === 'aligned' && hasPctRow) {
    measures = parseAlignedOnly(body, capacity, ctx);
  } else {
    measures = parseCompact(body, capacity, ctx);
  }

  const metadata = makeMetadata({
    tempo_bpm: parseTempo(meta.tempo, issues),
    timeSignature,
    title: meta.title,
    render_mode: renderMode,
    source_syntax: syntax === 'aligned' ? 'Aligned' : 'Compact'
  });

  const score = makeScore({ metadata, measures });
  attachStartTicks(score.tracks[0].measures, capacity);

  return { score, issues };

  function resolveSyntax() {
    if (syntaxRequested === 'compact' || syntaxRequested === 'aligned') return syntaxRequested;
    if (syntaxRequested === 'tab') return 'aligned';
    if (hasSixRows) return 'aligned';
    if (hasChordRow && hasPctRow) return 'aligned';
    if (hasParen) return 'compact';
    if (hasBracket) return 'compact';
    if (body.length) {
      ctx.issues.push({ level: 'Warning', code: 'syntax', message: '无法自动判断范式，按 compact 解析；建议显式写 # syntax=' });
    }
    return 'compact';
  }

  function resolveMode() {
    if (modeRequested === 'rhythm') return 'Rhythm';
    if (modeRequested === 'tab') return 'Tab';
    return hasSixRows ? 'Tab' : 'Rhythm';
  }
}

// ---------- 元信息 ----------
function parseTimeSignature(raw, issues) {
  const fallback = { numerator: 4, denominator: 4 };
  if (!raw) return fallback;
  const m = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) {
    issues.push({ level: 'Warning', code: 'time', message: `拍号 "${raw}" 无法识别，按 4/4 处理` });
    return fallback;
  }
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  if (numerator <= 0 || !isPowerOfTwo(denominator)) {
    issues.push({ level: 'Warning', code: 'time', message: `拍号 ${raw} 非法（分母须为 2 的幂），按 4/4 处理` });
    return fallback;
  }
  return { numerator, denominator };
}

function parseTempo(raw, issues) {
  if (!raw) return 90;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    issues.push({ level: 'Warning', code: 'tempo', message: `速度 "${raw}" 无法识别，按 90 处理` });
    return 90;
  }
  if (n < 20 || n > 300) {
    const clamped = Math.min(300, Math.max(20, n));
    issues.push({ level: 'Warning', code: 'tempo', message: `速度 ${n} 超出 20..300，夹取为 ${clamped}` });
    return clamped;
  }
  return n;
}

// ---------- compact ----------
function parseCompact(body, capacity, ctx) {
  const measures = [];
  let pendingChords = [];

  for (const row of body) {
    const text = row.text;
    if (isChordOnlyLine(text)) {
      pendingChords = pendingChords.concat(extractChordNames(text));
      continue;
    }
    const parsed = parseRhythmLine(text, capacity, ctx, row.no);
    if (pendingChords.length) {
      applyChordsByRatio(parsed.measures, pendingChords, capacity, ctx, row.no);
      pendingChords = [];
    }
    measures.push(...parsed.measures);
  }

  if (pendingChords.length) {
    ctx.issues.push({ level: 'Warning', code: 'chord', message: '和弦行之后没有节奏行，和弦被忽略' });
  }
  return measures;
}

function isChordOnlyLine(text) {
  if (!/\[\s*\S+\s*\]/.test(text)) return false;
  const stripped = text.replace(/\[\s*\S+\s*\]/g, ' ');
  return !/[duwo0~\-\.\|\{\}1-6]/.test(stripped);
}

function extractChordNames(text) {
  const names = [];
  for (const m of text.matchAll(/\[\s*(.+?)\s*\]/g)) names.push(m[1]);
  return names;
}

// 纯和弦行没有时值信息：把「小节序列」当成一条连续时间轴，按和弦数等比切分。
// 规则（GuitarTabMark §3.1）：
//   时间轴总长 = 小节数 × capacity；第 i 个和弦占 [i·L/N, (i+1)·L/N)。
//   跨小节的和弦在每一小节各写一次（续段从该小节 0 tick 起），不丢拍。
//   N > M 时一节内会出现多个和弦（按比例落到节内 tick）；N < M 时后面的小节由前一个和弦续上。
function applyChordsByRatio(measures, names, capacity, ctx, no) {
  const M = measures.length;
  const N = names.length;
  if (!M || !N) return;

  if (N !== M) {
    ctx.issues.push({
      level: 'Warning',
      code: 'chord',
      message: `第 ${no} 行：${N} 个和弦对 ${M} 个小节，按整段时间轴等比切分`
    });
  }

  const total = M * capacity;
  names.forEach((name, i) => {
    const segStart = Math.round((i * total) / N);
    const segEnd = Math.round(((i + 1) * total) / N);
    if (segEnd <= segStart) return;

    const firstMeasure = Math.floor(segStart / capacity);
    const lastMeasure = Math.floor((segEnd - 1) / capacity);

    for (let m = firstMeasure; m <= lastMeasure && m < M; m += 1) {
      const from = Math.max(segStart, m * capacity) - m * capacity;
      const to = Math.min(segEnd, (m + 1) * capacity) - m * capacity;
      if (to <= from) continue;
      measures[m].chords.push({
        name,
        start_tick: Math.min(from, capacity - 1),
        end_tick: Math.min(to, capacity)
      });
    }
  });

  measures.forEach((measure) => measure.chords.sort((a, b) => a.start_tick - b.start_tick));
}

function parseRhythmLine(text, capacity, ctx, lineNo) {
  const measures = [];
  const warnings = [];
  let draft = emptyDraft();
  let tick = 0;
  let accent = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === ' ' || ch === '\t') continue;

    if (ch === '[') {
      const close = text.indexOf(']', i);
      if (close < 0) {
        ctx.issues.push({ level: 'Error', code: 'chord', message: `第 ${lineNo} 行：[ 缺少闭合 ]` });
        break;
      }
      const name = text.slice(i + 1, close).trim();
      if (name) draft.chords.push({ name, tick: Math.min(tick, capacity - 1) });
      i = close;
      continue;
    }

    if (ch === '|') {
      closeDraft();
      continue;
    }

    if (ch === '>') { accent = true; continue; }

    if (ch === '.') {
      applyDot(draft, warnings, lineNo);
      tick += GRID_TICKS / 2;
      if (tick >= capacity) closeDraft();
      continue;
    }

    if (ch === '(') {
      let depth = 0;
      let j = i;
      for (; j < text.length; j += 1) {
        if (text[j] === '(') depth += 1;
        else if (text[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j >= text.length) {
        ctx.issues.push({ level: 'Error', code: 'syntax', message: `第 ${lineNo} 行：括号未闭合` });
        break;
      }
      placeGroup(text.slice(i + 1, j), tick, GRID_TICKS);
      accent = false;
      i = j;
      advance(GRID_TICKS);
      continue;
    }

    if (ch === '{') {
      const close = text.indexOf('}', i);
      if (close < 0) {
        ctx.issues.push({ level: 'Error', code: 'syntax', message: `第 ${lineNo} 行：{ 缺少闭合 }` });
        break;
      }
      const inner = text.slice(i + 1, close);
      inner.split(/[\s,]+/).filter(Boolean).forEach((token) => emitAtom(token, tick, GRID_TICKS));
      accent = false;
      i = close;
      advance(GRID_TICKS);
      continue;
    }

    if (ch === 'x' && (text[i + 1] === 'd' || text[i + 1] === 'u')) {
      const direction = text[i + 1] === 'd' ? 'Down' : 'Up';
      draft.items.push(makeStrum(tick, direction, { muted: true, cut: true, accent }));
      accent = false;
      i += 1;
      advance(GRID_TICKS);
      continue;
    }

    if (ch === 'd' || ch === 'u' || ch === 'w' || ch === 'o') {
      if (ch === 'o') {
        // §3.3：o = 切音（正常拨响后立刻止音），不标 muted
        draft.items.push(makeStrum(tick, 'Down', { cut: true, accent }));
      } else {
        const direction = ch === 'd' ? 'Down' : ch === 'u' ? 'Up' : 'Arpeggio';
        draft.items.push(makeStrum(tick, direction, { accent }));
      }
      accent = false;
      advance(GRID_TICKS);
      continue;
    }

    if (ch >= '1' && ch <= '6') {
      const item = {
        tick,
        duration: GRID_TICKS,
        voice: 0,
        kind: kind.pluck(Number(ch)),
        modifiers: accent ? [modifier.accent()] : []
      };
      draft.items.push(item);
      accent = false;
      advance(GRID_TICKS);
      continue;
    }

    if (ch === '0' || REST_ALIASES.has(ch)) {
      draft.items.push(makeRest(tick, GRID_TICKS, accent));
      accent = false;
      advance(GRID_TICKS);
      continue;
    }

    if (ch === '~' || ch === '-') {
      const from = draft.items.length ? draft.items[draft.items.length - 1].tick : tick;
      draft.items.push(makeTie(tick, from));
      advance(GRID_TICKS);
      continue;
    }

    ctx.issues.push({ level: 'Error', code: 'symbol', message: `第 ${lineNo} 行：非法符号 "${ch}"` });
    break;
  }

  closeDraft(true);
  return { measures };

  function emptyDraft() { return { items: [], chords: [] }; }

  function placeGroup(innerText, startTick, totalDuration) {
    const elements = splitElements(innerText);
    if (!elements.length) return;
    const dottedCount = elements.filter((el) => el.dotted).length;
    const denominator = (elements.length - dottedCount) + 1.5 * dottedCount;
    const base = totalDuration / denominator;
    let cursor = startTick;
    for (const el of elements) {
      const duration = Math.round(el.dotted ? base * 1.5 : base);
      if (el.type === 'group') placeGroup(el.inner, cursor, duration);
      else emitAtom(el.token, cursor, duration);
      cursor += duration;
    }
  }

  function splitElements(text) {
    const elements = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t') { i += 1; continue; }
      if (ch === '(') {
        let depth = 0;
        let j = i;
        for (; j < text.length; j += 1) {
          if (text[j] === '(') depth += 1;
          else if (text[j] === ')') { depth -= 1; if (depth === 0) break; }
        }
        elements.push({ type: 'group', inner: text.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      if (ch === '{') {
        const close = text.indexOf('}', i);
        const end = close < 0 ? text.length : close;
        elements.push({ type: 'atom', token: text.slice(i, end + 1), dotted: false });
        i = end + 1;
        continue;
      }
      let token = ch;
      i += 1;
      if (ch === 'x' && (text[i] === 'd' || text[i] === 'u')) {
        token = `x${text[i]}`;
        i += 1;
      }
      const dotted = text[i] === '.';
      if (dotted) i += 1;
      elements.push({ type: 'atom', token, dotted });
    }
    return elements;
  }

  function emitAtom(token, atTick, duration) {
    const withDuration = (item) => ({ ...item, duration });

    if (token === 'd' || token === 'u' || token === 'w' || token === 'o') {
      const direction = token === 'd' ? 'Down' : token === 'u' ? 'Up' : token === 'w' ? 'Arpeggio' : 'Down';
      const opts = token === 'o' ? { cut: true } : {};
      draft.items.push(withDuration(makeStrum(atTick, direction, opts)));
      return;
    }
    if (token === 'xd' || token === 'xu') {
      draft.items.push(withDuration(makeStrum(atTick, token === 'xd' ? 'Down' : 'Up', { muted: true, cut: true })));
      return;
    }
    if (/^[1-6]$/.test(token)) {
      draft.items.push({ tick: atTick, duration, voice: 0, kind: kind.pluck(Number(token)), modifiers: [] });
      return;
    }
    if (token === '0' || REST_ALIASES.has(token)) {
      draft.items.push(makeRest(atTick, duration, false));
      return;
    }
    if (token === '~' || token === '-') {
      const from = draft.items.length ? draft.items[draft.items.length - 1].tick : atTick;
      draft.items.push({ tick: atTick, duration, voice: 0, kind: kind.tie(from), modifiers: [] });
      return;
    }
    if (token.startsWith('{')) {
      const inner = token.slice(1, -1).split(/[\s,]+/).filter(Boolean);
      inner.forEach((part) => {
        if (/^[1-6]$/.test(part)) {
          draft.items.push({ tick: atTick, duration, voice: 0, kind: kind.pluck(Number(part)), modifiers: [] });
        }
      });
      return;
    }
    ctx.issues.push({ level: 'Warning', code: 'group', message: `括号组内的 "${token}" 无法识别，已忽略` });
  }

  function advance(duration) {
    tick += duration;
    if (tick >= capacity) closeDraft();
  }

  function closeDraft(force = false) {
    if (!draft.items.length && !draft.chords.length) {
      tick = 0;
      return;
    }
    const measure = makeMeasure(measures.length, 0, capacity);
    measure.items = sortItems(draft.items);
    measure.chords = buildSpans(draft.chords, capacity);
    measures.push(measure);
    draft = emptyDraft();
    tick = 0;
    if (!force) return;
  }
}

function buildSpans(chords, capacity) {
  const sorted = chords.slice().sort((a, b) => a.tick - b.tick);
  const spans = [];
  sorted.forEach((entry, i) => {
    const next = sorted[i + 1];
    const end = next ? next.tick : capacity;
    if (end <= entry.tick) return;
    spans.push({
      name: entry.name,
      start_tick: entry.tick,
      end_tick: Math.min(capacity, end)
    });
  });
  return spans;
}

function makeStrum(tick, direction, { muted = false, cut = false, accent = false } = {}) {
  const modifiers = [];
  if (cut) modifiers.push(modifier.cut());
  if (accent) modifiers.push(modifier.accent());
  return {
    tick,
    duration: GRID_TICKS,
    voice: 0,
    kind: kind.strum({ direction, muted, accent, from: 6, to: 1 }),
    modifiers
  };
}

function makeRest(tick, duration, accent) {
  return {
    tick,
    duration,
    voice: 0,
    kind: kind.rest(),
    modifiers: accent ? [modifier.accent()] : []
  };
}

function makeTie(tick, fromTick) {
  return { tick, duration: GRID_TICKS, voice: 0, kind: kind.tie(fromTick), modifiers: [] };
}

function applyDot(draft, warnings, lineNo) {
  const last = draft.items[draft.items.length - 1];
  if (!last) {
    warnings.push(`第 ${lineNo} 行：附点前面没有事件，已忽略`);
    return;
  }
  last.duration = Math.round(last.duration * 1.5);
  last.modifiers.push(modifier.dotted(1));
}

// ---------- aligned / tab 的列式解析 ----------
// 无 e| 前缀的六线行：必须连续 6 行成一组（依次 1..6 弦），否则报 Error（GuitarTabMark §6）
function annotateImplicitTabRows(body, ctx) {
  const isBarRow = (row) => /^\s*\|/.test(row.text) && !SIX_ROW_RE.test(row.text);
  let i = 0;
  while (i < body.length) {
    if (!isBarRow(body[i])) { i += 1; continue; }
    let j = i;
    while (j < body.length && isBarRow(body[j])) j += 1;
    const run = body.slice(i, j);
    if (run.length % 6 !== 0) {
      ctx.issues.push({
        level: 'Error',
        code: 'tab',
        message: `第 ${run[0].no}–${run[run.length - 1].no} 行：无 e| 前缀的六线行必须连续 6 行成一组（当前 ${run.length} 行）`
      });
    } else {
      run.forEach((row, k) => { row.implicitStringNo = (k % 6) + 1; });
    }
    i = j;
  }
}

// % 行里 = 与 + 同时出现时提示口径（本规范 = 四分、+ 二分）
function notePctConvention(pctText, ctx, lineNo) {
  if (!pctText) return;
  if (pctText.includes('=') && pctText.includes('+')) {
    ctx.issues.push({
      level: 'Warning',
      code: 'syntax',
      message: `第 ${lineNo} 行：本规范 = 四分、+ 二分，如从外部抄谱请确认约定`
    });
  }
}

function parseColumnBlocks(body, capacity, ctx) {
  const blocks = [];
  let current = { chords: [], pct: null, rows: {} };

  for (const row of body) {
    const six = row.text.match(SIX_ROW_RE);
    const stringNo = six ? STRING_LETTERS[six[1]] : (row.implicitStringNo ?? null);

    if (stringNo !== null) {
      if (current.rows[stringNo] !== undefined) {
        blocks.push(current);
        current = { chords: [], pct: null, rows: {} };
      }
      const firstBar = row.text.indexOf('|');
      current.rows[stringNo] = {
        text: row.text.slice(firstBar + 1),
        no: row.no,
        offset: firstBar + 1
      };
      continue;
    }
    if (/^\s*%/.test(row.text)) {
      const idx = row.text.indexOf('%');
      current.pct = row.text.slice(idx + 1).replace(/^ /, '');
      notePctConvention(current.pct, ctx, row.no);
      continue;
    }
    if (/^\s*@/.test(row.text) || /\[\s*\S+\s*\]/.test(row.text)) {
      if (!/^\s*@/.test(row.text)) {
        ctx.issues.push({
          level: 'Warning',
          code: 'syntax',
          message: `第 ${row.no} 行：aligned 范式的和弦行建议用 @ 开头（[Am] 属于 compact 写法）`
        });
      }
      const idx = row.text.search(/[@[]/);
      current.chords.push(row.text.slice(idx));
      continue;
    }
    ctx.issues.push({ level: 'Warning', code: 'row', message: `第 ${row.no} 行：无法归类的行，已忽略` });
  }
  if (Object.keys(current.rows).length || current.chords.length) blocks.push(current);

  const measures = [];
  for (const block of blocks) {
    measures.push(...parseBlock(block, capacity, ctx));
  }
  return measures;
}

function parseBlock(block, capacity, ctx) {
  const rowEntries = Object.entries(block.rows);
  if (!rowEntries.length) {
    return parseAlignedOnlyBlock(block, capacity, ctx);
  }

  // §4.4：% 行定义列数；六线行超长直接报错，不足则右侧补空
  const pctWidth = block.pct ? block.pct.length : null;
  if (pctWidth !== null) {
    rowEntries.forEach(([, row]) => {
      if (row.text.length > pctWidth) {
        ctx.issues.push({
          level: 'Error',
          code: 'tab/overflow',
          message: `第 ${row.no} 行：六线行 ${row.text.length} 列，比 % 行的 ${pctWidth} 列长`
        });
      }
    });
  }

  const reference = block.pct
    ?? rowEntries.map(([, row]) => row.text).sort((a, b) => b.length - a.length)[0]
    ?? '';

  const bars = [];
  for (let i = 0; i < reference.length; i += 1) if (reference[i] === '|') bars.push(i);

  const segments = [];
  let cursor = 0;
  bars.forEach((pos) => {
    segments.push([cursor, pos]);
    cursor = pos + 1;
  });
  if (cursor < reference.length) segments.push([cursor, reference.length]);

  const allChords = block.chords.flatMap((text) => collectChordNames(text));

  // 和弦行列号是「printed 坐标」，六线正文从 firstBar+1 开始，要减去这个前缀
  const bodyOffset = rowEntries[0]?.[1]?.offset ?? 1;

  const measures = [];
  segments.forEach(([from, to]) => {
    const bodyTexts = {};
    let width = pctWidth !== null ? to - from : to - from;
    for (let s = 1; s <= 6; s += 1) {
      const row = block.rows[s];
      const text = (row?.text || '').slice(from, to);
      bodyTexts[s] = text;
      if (pctWidth === null) width = Math.max(width, text.length);
    }
    const pctText = block.pct ? block.pct.slice(from, to) : null;

    const chordEntries = allChords
      .map((entry) => ({ name: entry.name, col: Math.max(0, entry.col - bodyOffset) }))
      .filter((entry) => entry.col >= from && entry.col < to)
      .map((entry) => ({ name: entry.name, col: entry.col - from }));

    measures.push(buildColumnMeasure({
      bodyTexts,
      pctText,
      width,
      capacity,
      chordEntries,
      ctx
    }));
  });
  return measures;
}

function parseAlignedOnly(body, capacity, ctx) {
  const chords = [];
  let pct = null;
  body.forEach((row) => {
    if (/^\s*@/.test(row.text)) chords.push(row.text.trim().replace(/^@\s*/, ''));
    else if (/\[\s*\S+\s*\]/.test(row.text)) {
      ctx.issues.push({
        level: 'Warning',
        code: 'syntax',
        message: `第 ${row.no} 行：aligned 范式的和弦行建议用 @ 开头（[Am] 属于 compact 写法）`
      });
      chords.push(row.text.trim());
    } else if (/^\s*%/.test(row.text)) {
      pct = row.text.slice(row.text.indexOf('%') + 1).replace(/^ /, '');
      notePctConvention(pct, ctx, row.no);
    }
  });
  if (!pct) return [];
  return parseAlignedOnlyBlock({ chords, pct, rows: {} }, capacity, ctx);
}

function parseAlignedOnlyBlock(block, capacity, ctx) {
  const pct = block.pct || '';
  const segments = [];
  let cursor = 0;
  for (let i = 0; i <= pct.length; i += 1) {
    if (i === pct.length || pct[i] === '|') {
      segments.push([cursor, i]);
      cursor = i + 1;
    }
  }

  const allChords = block.chords.flatMap((text) => collectChordNames(text));

  return segments.map(([from, to]) => {
    const pctText = pct.slice(from, to);
    // % 行的第 0 列在 printed 第 1 列（前面是 %），和弦行同基准
    const chordEntries = allChords
      .map((entry) => ({ name: entry.name, col: Math.max(0, entry.col - 1) }))
      .filter((entry) => entry.col >= from && entry.col < to)
      .map((entry) => ({ name: entry.name, col: entry.col - from }));
    return buildColumnMeasure({
      bodyTexts: {},
      pctText,
      width: pctText.length,
      capacity,
      chordEntries,
      ctx
    });
  });
}

function buildColumnMeasure({ bodyTexts, pctText, width, capacity, chordEntries, ctx }) {
  const slots = buildSlots(pctText, width);

  const items = [];
  for (let s = 1; s <= 6; s += 1) {
    const text = bodyTexts[s] || '';
    items.push(...readStringLine(text, s, slots, ctx));
  }

  const chords = buildSpansFromEntries(chordEntries, slots, capacity);

  const measure = makeMeasure(0, 0, capacity);
  measure.items = sortItems(items);
  measure.chords = chords;
  return measure;
}

function buildSpansFromEntries(entries, slots, capacity) {
  const spans = [];
  entries.forEach((entry, i) => {
    const index = slotIndexAt(slots, entry.col);
    const start = tickAtIndex(slots, index);
    const next = entries[i + 1];
    const end = next ? tickAtIndex(slots, slotIndexAt(slots, next.col)) : capacity;
    if (end <= start) return;
    spans.push({
      name: entry.name,
      start_tick: Math.min(start, capacity - 1),
      end_tick: Math.min(capacity, end)
    });
  });
  return spans;
}

function buildSlots(pctText, width) {
  const slots = [];
  if (pctText && pctText.replace(/ /g, '').length) {
    for (let col = 0; col < width; col += 1) {
      const ch = pctText[col] ?? ' ';
      if (ch === ' ') continue;
      if (ch === '.') {
        if (slots.length) slots[slots.length - 1].duration = Math.round(slots[slots.length - 1].duration * 1.5);
        continue;
      }
      const duration = PCT_DURATION[ch];
      if (duration === undefined) continue;
      slots.push({ col, duration, rest: ch === 'R' || ch === 'r' });
    }
    if (!slots.length) {
      for (let col = 0; col < width; col += 1) slots.push({ col, duration: GRID_TICKS, rest: false });
    }
  } else {
    for (let col = 0; col < width; col += 1) slots.push({ col, duration: GRID_TICKS, rest: false });
  }
  return slots;
}

function slotIndexAt(slots, col) {
  let index = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i].col <= col) index = i;
    else break;
  }
  return index;
}

function tickAtIndex(slots, index) {
  let tick = 0;
  for (let i = 0; i < index; i += 1) tick += slots[i].duration;
  return tick;
}

function durationForRun(slots, startCol, length) {
  let duration = 0;
  for (const slot of slots) {
    if (slot.col >= startCol && slot.col < startCol + length) duration += slot.duration;
  }
  return duration || (slots[slotIndexAt(slots, startCol)]?.duration ?? GRID_TICKS);
}

function readStringLine(text, stringNo, slots, ctx) {
  const items = [];
  let warnedUnknown = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '-' || ch === ' ') continue;
    if (ch === '|') continue;

    if (REST_ALIASES.has(ch)) {
      const index = slotIndexAt(slots, i);
      items.push(makeRest(tickAtIndex(slots, index), slots[index].duration, false));
      continue;
    }

    if (/^\d/.test(ch)) {
      const run = text.slice(i).match(/^\d+/)[0];
      const value = Number(run);
      const index = slotIndexAt(slots, i);
      const tick = tickAtIndex(slots, index);
      const duration = durationForRun(slots, i, run.length);
      const modifiers = [];
      let cursor = i + run.length;
      let tieOnly = false;

      const modMatch = text.slice(cursor).match(/^(h|p|~|\/|\\)(\d+)/);
      if (modMatch) {
        const target = Number(modMatch[2]);
        if (modMatch[1] === 'h') modifiers.push(modifier.hammer(target));
        else if (modMatch[1] === 'p') modifiers.push(modifier.pull(target));
        else if (modMatch[1] === '/') modifiers.push(modifier.slide(target, 'Up'));
        else if (modMatch[1] === '\\') modifiers.push(modifier.slide(target, 'Down'));
        else if (target === value) tieOnly = true; // 同品 → 延音
        else modifiers.push(target > value ? modifier.hammer(target) : modifier.pull(target));
        cursor += modMatch[0].length;
      }

      items.push({
        tick,
        duration,
        voice: 0,
        kind: kind.note(stringNo, fret.at(value)),
        modifiers
      });
      if (tieOnly) {
        items.push({
          tick: tick + duration,
          duration,
          voice: 0,
          kind: kind.tie(tick),
          modifiers: []
        });
      }
      i = cursor - 1;
      continue;
    }

    if (ch === 'x') {
      const index = slotIndexAt(slots, i);
      items.push({
        tick: tickAtIndex(slots, index),
        duration: slots[index].duration,
        voice: 0,
        kind: kind.pluck(stringNo),
        modifiers: []
      });
      continue;
    }

    if (!warnedUnknown) {
      ctx.issues.push({ level: 'Warning', code: 'symbol', message: `六线行出现无法识别的字符 "${ch}"` });
      warnedUnknown = true;
    }
  }
  return items;
}

function collectChordNames(text) {
  const names = [];
  const bracketRe = /\[\s*(.+?)\s*\]/g;
  let matched = false;
  for (const m of text.matchAll(bracketRe)) {
    matched = true;
    names.push({ name: m[1], col: m.index });
  }
  if (matched) return names;

  const cleaned = text.replace(/^@/, '');
  const re = /([^ ]+)/g;
  const offset = text.length - cleaned.length;
  for (const m of cleaned.matchAll(re)) {
    if (/^[|\-]+$/.test(m[1])) continue;
    names.push({ name: m[1], col: m.index + offset });
  }
  return names;
}

// ---------- 收尾 ----------
function attachStartTicks(measures, capacity) {
  let start = 0;
  measures.forEach((measure, i) => {
    measure.index = i;
    measure.capacity = capacity;
    measure.start_tick = start;
    start += capacity;
    measure.chords.forEach((span) => {
      span.end_tick = Math.min(span.end_tick, capacity);
    });
  });
}
