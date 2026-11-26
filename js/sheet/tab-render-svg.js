// 六线谱渲染（TabView v0.1）：弦线、品数字、技巧记号、和弦行
// 所有颜色来自 THEMES；几何来自 layoutTab，本文件不重新排版。

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

const THEMES = {
  light: {
    surface: '#ffffff',
    chord: '#1f2328',
    staffLine: '#4b525c',
    stringLabel: '#8a909c',
    fret: '#1f2328',
    modifier: '#5a626d',
    barline: '#2b3037',
    muted: '#6b7280',
    accent: '#c8562a'
  },
  dark: {
    surface: '#14171d',
    chord: '#e8eaee',
    staffLine: '#9aa1ad',
    stringLabel: '#6b7280',
    fret: '#e8eaee',
    modifier: '#9aa1ad',
    barline: '#c3c8d2',
    muted: '#8a909c',
    accent: '#e0784a'
  }
};

const STRING_LABELS = { 1: 'e', 2: 'B', 3: 'G', 4: 'D', 5: 'A', 6: 'E' };

export function renderTabSVG(score, layout, options = {}) {
  const color = THEMES[options.theme || 'light'];
  const metrics = layout.metrics;
  const width = layout.width;
  const height = layout.height;
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">`);
  out.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${color.surface}"/>`);

  for (const system of layout.systems) {
    drawStaffLines(out, system, layout, color);
    drawStringLabels(out, system, layout, color);
    drawBarlines(out, system, color);
    drawChords(out, system, layout, color);
    drawNotes(out, system, layout, color);
  }

  out.push('</svg>');
  return out.join('\n');
}

function drawStaffLines(out, system, layout, color) {
  for (const k of system.strings) {
    const y = system.stringY[k];
    out.push(`<line x1="${round(system.x0)}" y1="${round(y)}" x2="${round(system.x1)}" y2="${round(y)}" stroke="${color.staffLine}" stroke-width="1"/>`);
  }
}

function drawStringLabels(out, system, layout, color) {
  if (!layout.labelWidth) return;
  for (const k of system.strings) {
    out.push(text(system.x0 - 4, system.stringY[k], STRING_LABELS[k], {
      size: layout.metrics.labelFontSize,
      weight: 500,
      fill: color.stringLabel,
      anchor: 'end'
    }));
  }
}

function drawBarlines(out, system, color) {
  // 与节奏视图一致：竖线只覆盖谱体，不穿过和弦名
  const y1 = system.staffTop - 6;
  const y2 = system.stringY[6] + 4;
  system.measures.forEach((box, i) => {
    const x = i === 0 ? box.x : box.x;
    out.push(`<line x1="${round(x)}" y1="${round(y1)}" x2="${round(x)}" y2="${round(y2)}" stroke="${color.barline}" stroke-width="1"/>`);
  });
  out.push(`<line x1="${round(system.x1)}" y1="${round(y1)}" x2="${round(system.x1)}" y2="${round(y2)}" stroke="${color.barline}" stroke-width="1.5"/>`);
}

function drawChords(out, system, layout, color) {
  const metrics = layout.metrics;
  for (const box of system.measures) {
    for (const span of box.measure.chords) {
      const sx = tickToX(box, span.start_tick);
      const ex = tickToX(box, span.end_tick);
      const approx = span.name.length * metrics.chordFontSize * 0.62;
      const overflow = approx > (ex - sx) + 8;
      const x = overflow ? (sx + ex) / 2 : sx + 4;
      out.push(text(x, system.chordTop + 16, span.name, {
        size: metrics.chordFontSize,
        weight: metrics.chordFontWeight,
        fill: color.chord,
        anchor: overflow ? 'middle' : 'start'
      }));
    }
  }
}

function drawNotes(out, system, layout, color) {
  const metrics = layout.metrics;
  const previous = new Map();

  for (const box of system.measures) {
    for (const item of box.measure.items) {
      const name = Object.keys(item.kind)[0];
      if (name !== 'note' && name !== 'pluck') continue;
      const body = item.kind[name];
      const stringNo = body.string;
      if (!stringNo || !system.stringY[stringNo]) continue;

      let x = tickToX(box, item.tick);
      if (item.tick <= 0) x = box.x + 6;
      else if (item.tick >= box.capacity) x = box.x + box.width - 6;

      const y = system.stringY[stringNo];
      const fretObj = body.fret;
      const isMuted = Boolean(fretObj?.muted) || (name === 'pluck' && fretObj?.fret == null);
      const label = isMuted ? 'x' : String(fretObj?.fret ?? '');
      const twoDigit = label.length > 1;
      const size = twoDigit ? metrics.twoDigitFontSize : metrics.fretFontSize;
      const prev = previous.get(stringNo);

      // 技巧记号（画在两音之间）
      if (prev) {
        const dx = x - prev.x;
        const mod = item.modifiers || [];
        if (mod.some((m) => m.hammer) || mod.some((m) => m.pull)) {
          drawArcModifier(out, prev, { x, size }, y, mod, metrics, color);
        }
        if (mod.some((m) => m.slide)) {
          drawSlide(out, prev, { x, size }, y, mod, metrics, color);
        }
      }

      // 品数字底色（遮住弦线）
      const halfW = (twoDigit ? label.length * size * 0.34 : size * 0.34) + 1.5;
      out.push(`<rect x="${round(x - halfW)}" y="${round(y - size / 2 - 1.5)}" width="${round(halfW * 2)}" height="${round(size + 3)}" fill="${color.surface}"/>`);
      out.push(text(x, y, label, {
        size,
        weight: 400,
        fill: isMuted ? color.muted : color.fret,
        anchor: 'middle'
      }));

      // 重音：品数字上方短横线
      if ((item.modifiers || []).some((m) => m.accent)) {
        out.push(`<line x1="${round(x - 4)}" y1="${round(y - size - 3)}" x2="${round(x + 4)}" y2="${round(y - size - 3)}" stroke="${color.accent}" stroke-width="1.5"/>`);
      }
      // 附点：右侧小圆点
      if ((item.modifiers || []).some((m) => m.dotted)) {
        out.push(`<circle cx="${round(x + halfW + 2)}" cy="${round(y - 6)}" r="1" fill="${color.fret}"/>`);
      }

      previous.set(stringNo, { x, y, size });
    }
  }
}

function drawArcModifier(out, prev, next, y, mods, metrics, color) {
  const dx = next.x - prev.x;
  const halfPrev = prev.size * 0.34;
  const halfNext = next.size * 0.34;
  const x1 = prev.x + halfPrev;
  const x2 = Math.max(x1 + 4, next.x - halfNext);
  const baseY = y - 5;
  const arch = dx < 14 ? 2 : Math.min(6, dx * 0.25);
  const midX = (x1 + x2) / 2;
  const isPull = mods.some((m) => m.pull);
  out.push(`<path d="M ${round(x1)} ${round(baseY)} Q ${round(midX)} ${round(baseY - arch)} ${round(x2)} ${round(baseY)}" fill="none" stroke="${color.modifier}" stroke-width="1"/>`);
  out.push(text(midX, baseY - arch - 3, isPull ? 'p' : 'h', {
    size: metrics.modifierFontSize,
    weight: 600,
    fill: color.modifier,
    anchor: 'middle'
  }));
}

function drawSlide(out, prev, next, y, mods, metrics, color) {
  const slide = mods.find((m) => m.slide)?.slide;
  const halfPrev = prev.size * 0.34;
  const halfNext = next.size * 0.34;
  const x1 = prev.x + halfPrev;
  const x2 = Math.max(x1 + 4, next.x - halfNext);
  const baseY = y - 4;
  out.push(`<line x1="${round(x1)}" y1="${round(baseY)}" x2="${round(x2)}" y2="${round(baseY)}" stroke="${color.modifier}" stroke-width="1"/>`);
  out.push(text((x1 + x2) / 2, baseY - 5, slide?.direction === 'Down' ? '\\' : '/', {
    size: metrics.modifierFontSize,
    weight: 600,
    fill: color.modifier,
    anchor: 'middle'
  }));
}

function tickToX(box, tick) {
  return box.x + (Math.min(Math.max(tick, 0), box.capacity) / box.capacity) * box.width;
}

function text(x, y, content, { size, weight, fill, anchor }) {
  const escaped = String(content)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<text x="${round(x)}" y="${round(y)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle">${escaped}</text>`;
}

function round(n) {
  return Math.round(n * 10) / 10;
}
