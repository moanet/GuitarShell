// 节奏型图的版面计算（RhythmView v0.1 的几何部分）
// 只算几何，不画：输出每个小节的位置、每层基线、事件锚点。

export const LAYER = {
  chordHeight: 24,
  beatHeight: 14,
  eventHeight: 32,
  layerGap: 6,
  padTop: 8,
  padBottom: 8
};

export function metricsFor(width) {
  let beatWidth = 48;
  let chordFontSize = 15;
  let pluckFontSize = 13;
  let showBeatGuides = true;

  if (width < 360) {
    beatWidth = 36;
    chordFontSize = 14;
    showBeatGuides = false;
  } else if (width > 600) {
    beatWidth = 56;
  }

  return {
    beatWidth,
    chordFontSize,
    pluckFontSize,
    chordFontWeight: 700,
    edgeGap: 12,
    lineGap: 16,
    arrowLength: 18,
    arrowStroke: 1.6,
    mutedStroke: width < 600 ? 1.8 : 1.6,
    accentStroke: 2.2,
    eventMinGap: 10,
    showBeatGuides,
    systemHeight:
      LAYER.padTop + LAYER.chordHeight + LAYER.layerGap +
      LAYER.beatHeight + LAYER.layerGap + LAYER.eventHeight + LAYER.padBottom
  };
}

export function layoutRhythm(score, options = {}) {
  const width = Number(options.width) > 0 ? Number(options.width) : 720;
  const metrics = metricsFor(width);
  const track = score.tracks[0];
  const measures = track.measures;
  const timeSignature = score.metadata.time_signature;

  const tools = width - metrics.edgeGap * 2;
  const beatsPerMeasure = Math.max(1, Math.round((measures[0]?.capacity || 1920) / 480));
  const baseMeasureWidth = beatsPerMeasure * metrics.beatWidth;
  // 手机默认一小节一行；宽屏才放宽（600 起两小节，1024 起三小节）
  const perLineCap = measuresPerLine(width);
  const maxPerLine = Math.max(1, Math.min(perLineCap, Math.floor(tools / baseMeasureWidth)));

  // 行数尽量少，再把小节在行间均分（避免出现「3 + 1」这种孤行）
  const lines = Math.max(1, Math.ceil(measures.length / maxPerLine));
  const perLine = distribute(measures.length, lines);

  const systems = [];
  let cursor = 0;
  perLine.forEach((count, lineIndex) => {
    if (count === 0) return;
    const system = newSystem(lineIndex);
    const totalBeats = count * beatsPerMeasure;
    const lineBeatWidth = Math.min(tools / totalBeats, metrics.beatWidth * 1.35);
    const lineWidth = lineBeatWidth * totalBeats;
    const startX = metrics.edgeGap + Math.max(0, (tools - lineWidth) / 2);

    for (let i = 0; i < count; i += 1) {
      const measure = measures[cursor];
      cursor += 1;
      const boxWidth = lineBeatWidth * beatsPerMeasure;
      system.measures.push({
        index: measure.index,
        measure,
        x: startX + i * boxWidth,
        width: boxWidth,
        beats: beatsPerMeasure,
        capacity: measure.capacity
      });
      system.widthUsed = (i + 1) * boxWidth;
      system.xRight = startX + system.widthUsed;
    }
    systems.push(system);
  });

  const totalHeight = systems.length * metrics.systemHeight +
    (systems.length - 1) * metrics.lineGap;

  return {
    width,
    height: totalHeight,
    systems,
    metrics,
    timeSignature,
    beatsPerMeasure
  };
}

function distribute(total, parts) {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  const list = [];
  for (let i = 0; i < parts; i += 1) {
    list.push(base + (i < extra ? 1 : 0));
  }
  return list;
}

// 一行放几小节：手机竖屏 1 小节；600 以上 2 小节；1024 以上 3 小节
export function measuresPerLine(width) {
  if (width < 600) return 1;
  if (width < 1024) return 2;
  return 3;
}

function newSystem(index) {
  const height = LAYER.padTop + LAYER.chordHeight + LAYER.layerGap +
    LAYER.beatHeight + LAYER.layerGap + LAYER.eventHeight + LAYER.padBottom;
  return { index, yTop: 0, height, measures: [], widthUsed: 0, xRight: 0 };
}

// 小节内 tick → x
export function tickToX(box, tick) {
  const ratio = Math.max(0, Math.min(1, tick / box.capacity));
  return box.x + ratio * box.width;
}

export function laneY(baselineY, direction) {
  if (direction === 'Up') return baselineY + 7;
  if (direction === 'Arpeggio') return baselineY;
  return baselineY - 7;
}

export function withSystemY(layout) {
  let y = 0;
  layout.systems.forEach((system) => {
    system.yTop = y;
    system.yBottom = y + system.height;
    system.chordTop = y + LAYER.padTop;
    system.beatTop = system.chordTop + LAYER.chordHeight + LAYER.layerGap;
    system.eventTop = system.beatTop + LAYER.beatHeight + LAYER.layerGap;
    system.baselineY = system.eventTop + LAYER.eventHeight / 2;
    y += system.height + layout.metrics.lineGap;
  });
  layout.systems.forEach((system) => {
    system.measures.forEach((box) => {
      box.yTop = system.chordTop;
      box.yBottom = system.eventTop + LAYER.eventHeight;
    });
  });
  return layout;
}
