// M2 回归测试：版面 + SVG 输出
// 运行：node tests/sheet-m2.test.mjs

import assert from 'node:assert/strict';
import { parse } from '../js/sheet/parser.js';
import { layoutRhythm, metricsFor, withSystemY, tickToX, laneY } from '../js/sheet/layout.js';
import { renderRhythmSVG } from '../js/sheet/render-svg.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    fail += 1;
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

const STRUM = `# time=4/4
# mode=rhythm

[C] d d u d u d u d
[G] d d u d u d u d
[Am] d d u d u d u d
[F] d d u d u d u d`;

console.log('M2 · 版面');

test('四小节在 720 宽分成两行，每行两小节', () => {
  const { score } = parse(STRUM);
  const layout = layoutRhythm(score, { width: 720 });
  assert.equal(layout.systems.length, 2);
  for (const system of layout.systems) assert.equal(system.measures.length, 2);
});

test('同一行的小节等宽，且不越出画布', () => {
  const { score } = parse(STRUM);
  const layout = layoutRhythm(score, { width: 720 });
  for (const system of layout.systems) {
    const widths = system.measures.map((m) => m.width);
    assert.ok(Math.abs(widths[0] - widths[1]) < 1e-6);
    const last = system.measures[system.measures.length - 1];
    assert.ok(last.x + last.width <= layout.width);
    assert.ok(system.measures[0].x >= 0);
  }
});

test('行首小节不动，行内小节首尾相接', () => {
  const { score } = parse(STRUM);
  const layout = layoutRhythm(score, { width: 720 });
  const system = layout.systems[0];
  assert.ok(Math.abs((system.measures[0].x + system.measures[0].width)
    - system.measures[1].x) < 1e-6);
});

test('窄屏降级：360 一档用 36 拍宽、关拍点虚线', () => {
  const narrow = metricsFor(340);
  assert.equal(narrow.beatWidth, 36);
  assert.equal(narrow.showBeatGuides, false);
  const wide = metricsFor(720);
  assert.equal(wide.beatWidth, 56);
  assert.equal(wide.showBeatGuides, true);
});

test('tickToX 单调且在 [0, width]', () => {
  const { score } = parse(STRUM);
  const layout = layoutRhythm(score, { width: 720 });
  const box = layout.systems[0].measures[0];
  const xs = [0, 480, 960, 1440, 1920].map((t) => tickToX(box, t));
  for (let i = 1; i < xs.length; i += 1) assert.ok(xs[i] >= xs[i - 1]);
  assert.equal(xs[0], box.x);
  assert.ok(Math.abs(xs[4] - (box.x + box.width)) < 1e-6);
});

test('下扫在上轨道、上扫在下轨道', () => {
  const baseline = 100;
  assert.ok(laneY(baseline, 'Down') < baseline);
  assert.ok(laneY(baseline, 'Up') > baseline);
  assert.equal(laneY(baseline, 'Arpeggio'), baseline);
});

test('行高叠加：两行的总高 = 行高 × 2 + 行距', () => {
  const { score } = parse(STRUM);
  const layout = layoutRhythm(score, { width: 720 });
  const m = layout.metrics;
  assert.equal(layout.height, m.systemHeight * 2 + m.lineGap);
  withSystemY(layout);
  assert.equal(layout.systems[0].yTop, 0);
  assert.equal(layout.systems[1].yTop, m.systemHeight + m.lineGap);
});

test('手机一行一小节，宽屏才放宽', () => {
  const make = (count) => {
    const lines = ['# time=4/4', '# mode=rhythm', ''];
    for (let i = 0; i < count; i += 1) lines.push(`[C] d d u d u d u d`);
    return lines.join('\n');
  };
  const four = parse(make(4)).score;
  assert.equal(layoutRhythm(four, { width: 390 }).systems[0].measures.length, 1);
  assert.equal(layoutRhythm(four, { width: 430 }).systems[0].measures.length, 1);
  assert.equal(layoutRhythm(four, { width: 720 }).systems[0].measures.length, 2);
  assert.equal(layoutRhythm(parse(make(6)).score, { width: 1024 }).systems[0].measures.length, 3);
});

console.log('M2 · SVG');

const layout720 = layoutRhythm(parse(STRUM).score, { width: 720 });
const svg = renderRhythmSVG(parse(STRUM).score, layout720, { theme: 'light' });

test('输出是自洽的 SVG 片段', () => {
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('viewBox="0 0 720'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('undefined'));
});

test('小节线条数 = 小节数 + 行数（每行一条终止线）', () => {
  const count = (svg.match(/stroke-width="1.1"/g) || []).length;
  assert.equal(count, 4);
  assert.ok(svg.includes('stroke-width="1.5"'));
});

test('每个扫弦画一组箭头，虚线只用于闷音', () => {
  const groups = (svg.match(/<g stroke=/g) || []).length;
  assert.equal(groups, 32);
  assert.ok(!svg.includes('stroke-dasharray="5 3"'));
});

test('闷音虚线：5 3 且窄屏加粗到 1.8', () => {
  const { score } = parse(`# time=4/4
# mode=rhythm

[C] xd xu`);
  const narrow = renderRhythmSVG(score, layoutRhythm(score, { width: 390 }), {});
  const wide = renderRhythmSVG(score, layoutRhythm(score, { width: 720 }), {});
  assert.ok(narrow.includes('stroke-dasharray="5 3"'));
  assert.ok(narrow.includes('stroke-width="1.8"'));
  assert.ok(!wide.includes('stroke-width="1.8"'));
});

test('和弦名左对齐在区间起点，出现在和弦层', () => {
  assert.ok(svg.includes('text-anchor="start"'));
  assert.ok(svg.includes('>C<'));
  assert.ok(svg.includes('>Am<'));
});

test('休止画点、切音画箭头末端短横线', () => {
  const { score } = parse(`# time=4/4
# mode=rhythm

[C] d o 0 xd`);
  const layout = layoutRhythm(score, { width: 480 });
  const out = renderRhythmSVG(score, layout, { theme: 'light' });
  // 只有 0（休止）画圆点
  assert.equal((out.match(/<circle/g) || []).length, 1);
  // o 与 xd 各一条 7 dp 短横线
  assert.equal((out.match(/stroke-width="1.6" stroke-linecap="round"/g) || []).length, 2);
});

test('深色主题换底色，几何不变', () => {
  const dark = renderRhythmSVG(parse(STRUM).score, layout720, { theme: 'dark' });
  assert.ok(dark.includes('#14171d'));
  const strip = (s) => s.split('fill=')[0];
  assert.equal(strip(dark), strip(svg));
});

test('和弦名里的 XML 特殊字符被转义', () => {
  const { score } = parse(`# time=4/4
# mode=rhythm

[C#m] d d u d u d u d`);
  const out = renderRhythmSVG(score, layoutRhythm(score, { width: 480 }), {});
  assert.ok(out.includes('C#m'));
});

console.log(`\nM2：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
