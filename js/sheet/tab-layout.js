// 六线谱版面（TabView v0.1 的 0.2.x 口径）：只算几何，不画图、不读主题色
// 复用节奏视图的换行与均分策略，纵向改为「和弦行 + 六条弦线」。

import { measuresPerLine } from './layout.js';

export const TAB_LAYER = {
  chordHeight: 22,
  chordToStaffGap: 6,
  padTop: 8,
  padBottom: 8
};

export function tabMetricsFor(width) {
  let stringGap = 14;
  let fretFontSize = 12;
  let chordFontSize = 13;
  let labelWidth = 24;

  if (width < 360) {
    stringGap = 12;
    fretFontSize = 11;
    labelWidth = 0;
  } else if (width > 600) {
    stringGap = 16;
    fretFontSize = 13;
  }

  return {
    stringGap,
    fretFontSize,
    twoDigitFontSize: Math.max(10, fretFontSize - 1),
    chordFontSize,
    chordFontWeight: 700,
    labelWidth,
    labelFontSize: 10,
    edgeGap: 12,
    lineGap: 18,
    fretMinGap: 12,
    modifierFontSize: 9,
    chordRowHeight: TAB_LAYER.chordHeight,
    chordToStaffGap: TAB_LAYER.chordToStaffGap,
    padTop: TAB_LAYER.padTop,
    padBottom: TAB_LAYER.padBottom,
    staffHeight: stringGap * 5,
    systemHeight:
      TAB_LAYER.padTop + TAB_LAYER.chordHeight + TAB_LAYER.chordToStaffGap +
      stringGap * 5 + TAB_LAYER.padBottom
  };
}

export function layoutTab(score, options = {}) {
  const width = Number(options.width) > 0 ? Number(options.width) : 720;
  const metrics = tabMetricsFor(width);
  const measures = score.tracks[0].measures;
  const beatsPerMeasure = Math.max(1, Math.round((measures[0]?.capacity || 1920) / 480));

  const tools = width - metrics.edgeGap * 2 - metrics.labelWidth;
  const baseMeasureWidth = beatsPerMeasure * 48;
  const cap = measuresPerLine(width);
  const maxPerLine = Math.max(1, Math.min(cap, Math.floor(tools / baseMeasureWidth)));

  const lineCount = Math.max(1, Math.ceil(measures.length / maxPerLine));
  const perLine = new Array(lineCount).fill(0);
  for (let i = 0; i < measures.length; i += 1) perLine[i % lineCount] += 1;

  const systems = [];
  let cursor = 0;
  perLine.forEach((count, lineIndex) => {
    if (count === 0) return;
    const totalBeats = count * beatsPerMeasure;
    const lineBeatWidth = Math.min(tools / totalBeats, 48 * 1.35);
    const lineWidth = lineBeatWidth * totalBeats;
    const startX = metrics.edgeGap + metrics.labelWidth + Math.max(0, (tools - lineWidth) / 2);

    const system = {
      index: lineIndex,
      y: 0,
      height: metrics.systemHeight,
      chordTop: 0,
      staffTop: 0,
      measures: [],
      strings: [1, 2, 3, 4, 5, 6]
    };
    const contentX = startX;
    for (let i = 0; i < count; i += 1) {
      const measure = measures[cursor];
      cursor += 1;
      system.measures.push({
        index: measure.index,
        measure,
        x: contentX + i * lineBeatWidth * beatsPerMeasure,
        width: lineBeatWidth * beatsPerMeasure,
        beats: beatsPerMeasure,
        capacity: measure.capacity
      });
    }
    system.x0 = contentX;
    system.x1 = contentX + count * lineBeatWidth * beatsPerMeasure;
    systems.push(system);
  });

  let y = metrics.padTop;
  for (const system of systems) {
    system.y = y;
    system.chordTop = y;
    system.staffTop = y + metrics.chordRowHeight + metrics.chordToStaffGap;
    system.stringY = {};
    for (const k of system.strings) {
      system.stringY[k] = system.staffTop + (k - 1) * metrics.stringGap;
    }
    y += system.height + metrics.lineGap;
  }

  const last = systems[systems.length - 1];
  const height = last ? last.y + metrics.systemHeight : metrics.systemHeight;

  return {
    width,
    height,
    metrics,
    timeSignature: score.metadata.time_signature,
    labelWidth: metrics.labelWidth,
    systems,
    tickToX: (box, tick) => box.x + (Math.min(Math.max(tick, 0), box.capacity) / box.capacity) * box.width
  };
}

export function tabStringY(system, stringNo) {
  return system.stringY[stringNo];
}
