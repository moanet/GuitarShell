// 节奏型图 → SVG（RhythmView v0.1 的符号形态部分）
// 纯字符串输出，不依赖 DOM，便于测试与导出。

import { tickToX, laneY, withSystemY, LAYER } from './layout.js';
import { kindName } from './model.js';

export const THEMES = {
  light: {
    surface: '#ffffff',
    line: '#20242e',
    chord: '#20242e',
    barline: '#5b6270',
    beatline: '#e2e5ea',
    rest: '#8a909c',
    accent: '#c8562a',
    muted: '#7b8291'
  },
  dark: {
    surface: '#14171d',
    line: '#e6e9f0',
    chord: '#f3f5f9',
    barline: '#8f97a3',
    beatline: '#333945',
    rest: '#9aa1ad',
    accent: '#e0784a',
    muted: '#9aa1ad'
  }
};

const FONT = '"Segoe UI", "Helvetica Neue", Arial, "PingFang SC", sans-serif';

export function renderRhythmSVG(score, layout, options = {}) {
  const color = THEMES[options.theme || 'light'];
  const metrics = layout.metrics;
  withSystemY(layout);

  const width = layout.width;
  const height = Math.max(layout.height, metrics.systemHeight);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">`);
  out.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${color.surface}"/>`);

  for (const system of layout.systems) {
    drawBeatGuides(out, system, metrics, color, options);
    drawBarlines(out, system, color);
    drawMeter(out, system, metrics, color, layout);
    drawChords(out, system, metrics, color);
    drawEvents(out, system, metrics, color);
  }

  out.push('</svg>');
  return out.join('\n');
}

function drawBeatGuides(out, system, metrics, color, options) {
  if (options.showBeatGuides === false || !metrics.showBeatGuides) return;
  const top = system.beatTop;
  const bottom = system.eventTop + LAYER.eventHeight;
  for (const box of system.measures) {
    for (let b = 1; b < box.beats; b += 1) {
      const x = box.x + (b * box.width) / box.beats;
      out.push(`<line x1="${round(x)}" y1="${round(top)}" x2="${round(x)}" y2="${round(bottom)}" stroke="${color.beatline}" stroke-width="1" stroke-dasharray="3 5"/>`);
    }
  }
}

function drawBarlines(out, system, color) {
  const y1 = system.beatTop - 4;
  const y2 = system.eventTop + LAYER.eventHeight + 4;
  for (const box of system.measures) {
    out.push(barline(box.x, y1, y2, color.barline, 1.1));
  }
  const last = system.measures[system.measures.length - 1];
  if (last) {
    out.push(barline(last.x + last.width, y1, y2, color.barline, 1.5));
  }
}

function barline(x, y1, y2, stroke, w) {
  return `<line x1="${round(x)}" y1="${round(y1)}" x2="${round(x)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
}

function drawMeter(out, system, metrics, color, layout) {
  const first = system.measures[0];
  if (!first) return;
  const { numerator, denominator } = layout.timeSignature;
  const x = first.x - 7;
  out.push(text(x, system.beatTop + 3, String(numerator), {
    size: 11, weight: 700, fill: color.muted, anchor: 'end', family: FONT
  }));
  out.push(text(x, system.beatTop + 14, String(denominator), {
    size: 11, weight: 700, fill: color.muted, anchor: 'end', family: FONT
  }));
}

function drawChords(out, system, metrics, color) {
  for (const box of system.measures) {
    for (const span of box.measure.chords) {
      const startX = tickToX(box, span.start_tick);
      const endX = tickToX(box, span.end_tick);
      const approxWidth = span.name.length * metrics.chordFontSize * 0.62;
      // 和弦写在其起始位置（乐手习惯），只有区间太窄时才让它溢出居中
      const overflow = approxWidth > (endX - startX) + 8;
      const x = overflow ? (startX + endX) / 2 : startX + 4;
      out.push(text(x, system.chordTop + 18, span.name, {
        size: metrics.chordFontSize,
        weight: metrics.chordFontWeight,
        fill: color.chord,
        anchor: overflow ? 'middle' : 'start',
        family: FONT
      }));
    }
  }
}

function drawEvents(out, system, metrics, color) {
  for (const box of system.measures) {
    const baseline = system.baselineY;
    let previousX = null;
    const stackByTick = new Map();

    for (const item of box.measure.items) {
      let x = tickToX(box, Math.min(item.tick, box.capacity));
      // 小节首尾的事件不要压在线上
      if (item.tick <= 0) x = box.x + 5;
      else if (item.tick >= box.capacity) x = box.x + box.width - 4;
      const kind = kindName(item.kind);
      const body = item.kind[kind];
      const cut = item.modifiers?.some((m) => m.cut);

      if (kind === 'strum') {
        const direction = body.direction;
        const lane = laneY(baseline, direction);
        const accent = Boolean(body.accent) || item.modifiers?.some((m) => m.accent);
        out.push(arrowPath(x, lane, direction, metrics, color, { accent, muted: Boolean(body.muted) }));
        if (cut) out.push(cutMark(x, direction === 'Up' ? baseline - 5 : baseline + 5, color));
        previousX = x;
        continue;
      }

      if (kind === 'pluck') {
        const count = (stackByTick.get(item.tick) || 0) + 1;
        stackByTick.set(item.tick, count);
        const offset = (count - 1) * 5;
        out.push(text(x, baseline + offset, String(body.string), {
          size: metrics.pluckFontSize, weight: 600, fill: color.line, anchor: 'middle', family: FONT
        }));
        previousX = x;
        continue;
      }

      if (kind === 'rest') {
        out.push(dot(x, baseline + 10, 2, color.rest));
        previousX = x;
        continue;
      }

      if (kind === 'tie') {
        const from = previousX === null ? x : previousX;
        out.push(`<line x1="${round(from)}" y1="${round(baseline - 3)}" x2="${round(x)}" y2="${round(baseline - 3)}" stroke="${color.line}" stroke-width="1"/>`);
        previousX = x;
        continue;
      }

      if (kind === 'note') {
        out.push(text(x, baseline, String(body.fret?.fret ?? ''), {
          size: metrics.pluckFontSize, weight: 600, fill: color.line, anchor: 'middle', family: FONT
        }));
        previousX = x;
      }
    }
  }
}

function arrowPath(x, y, direction, metrics, color, { accent, muted }) {
  const halfH = metrics.arrowLength / 2;
  const stroke = accent ? metrics.accentStroke : muted ? (metrics.mutedStroke || metrics.arrowStroke) : metrics.arrowStroke;
  const dash = muted ? ' stroke-dasharray="5 3"' : '';

  if (direction === 'Arpeggio') {
    const half = halfH;
    const top = y - half;
    const bottom = y + half;
    return `<g stroke="${color.line}" stroke-width="${stroke}" fill="none"${dash}>` +
      `<line x1="${round(x)}" y1="${round(bottom)}" x2="${round(x)}" y2="${round(top)}"/>` +
      `<line x1="${round(x)}" y1="${round(top)}" x2="${round(x - 3)}" y2="${round(top + 4.2)}"/>` +
      `<line x1="${round(x)}" y1="${round(top)}" x2="${round(x + 3)}" y2="${round(top + 4.2)}"/>` +
      `</g>`;
  }

  const sign = direction === 'Up' ? -1 : 1;
  const tipY = y + sign * halfH;
  const tailY = y - sign * halfH;
  const head = 6;
  const headHalf = 3.6;

  return `<g stroke="${color.line}" stroke-width="${stroke}" fill="none" stroke-linecap="round"${dash}>` +
    `<line x1="${round(x)}" y1="${round(tailY)}" x2="${round(x)}" y2="${round(tipY)}"/>` +
    `<line x1="${round(x)}" y1="${round(tipY)}" x2="${round(x - headHalf)}" y2="${round(tipY - sign * head)}"/>` +
    `<line x1="${round(x)}" y1="${round(tipY)}" x2="${round(x + headHalf)}" y2="${round(tipY - sign * head)}"/>` +
    `</g>`;
}

function dot(x, y, r, fill) {
  return `<circle cx="${round(x)}" cy="${round(y)}" r="${r}" fill="${fill}"/>`;
}

// 切音：箭头末端的短横线（7 dp），与重音的「加粗箭头」区分
function cutMark(x, y, color) {
  return `<line x1="${round(x - 3.5)}" y1="${round(y)}" x2="${round(x + 3.5)}" y2="${round(y)}" stroke="${color.rest}" stroke-width="1.6" stroke-linecap="round"/>`;
}

function text(x, y, content, { size, weight, fill, anchor, family }) {
  const escaped = String(content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<text x="${round(x)}" y="${round(y)}" font-family="${escapeAttr(family)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle">${escaped}</text>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function round(n) {
  return Math.round(n * 10) / 10;
}
