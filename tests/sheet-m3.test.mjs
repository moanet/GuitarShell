// M3 · 六线谱视图（TabView 0.2.x 首版）验收断言

import assert from 'node:assert/strict';
import { parse } from '../js/sheet/parser.js';
import { layoutTab, tabMetricsFor } from '../js/sheet/tab-layout.js';
import { renderTabSVG } from '../js/sheet/tab-render-svg.js';

let pass = 0;
const fail = [];
function test(name, fn) {
  try { fn(); pass += 1; console.log(`  ok   ${name}`); }
  catch (err) { fail.push(name); console.log(`  FAIL ${name}\n       ${err.message}`); }
}

const SRC = `# title=六线谱原型
# tempo=90
# time=4/4
# syntax=tab

@ Am       G
e|0-0-1-0-|3-3-0-3-|
B|1-1-1-1-|0-0-0-0-|
G|2-2-2-2-|0-0-0-0-|
D|2-2-2-2-|0-0-0-0-|
A|0-0-0-0-|2-2-2-2-|
E|--------|3-3-3-3-|`;

const { score, issues } = parse(SRC);
const layout720 = layoutTab(score, { width: 720 });
const svg = renderTabSVG(score, layout720, { theme: 'light' });

console.log('M3 · 版面');

test('解析无错误', () => {
  assert.equal(issues.filter((i) => i.level === 'Error').length, 0, JSON.stringify(issues));
  assert.equal(score.tracks[0].measures.length, 2);
});

test('六条弦线等间距，1 弦在上', () => {
  const system = layout720.systems[0];
  for (let k = 2; k <= 6; k += 1) {
    assert.equal(system.stringY[k] - system.stringY[k - 1], layout720.metrics.stringGap);
  }
  assert.ok(system.stringY[1] < system.stringY[6]);
});

test('手机一小节一行，宽屏两小节', () => {
  assert.equal(layoutTab(score, { width: 390 }).systems[0].measures.length, 1);
  assert.equal(layoutTab(score, { width: 720 }).systems[0].measures.length, 2);
});

test('行高 = 和弦行 + 六弦 + 留白', () => {
  const m = tabMetricsFor(720);
  assert.equal(m.systemHeight, m.padTop + m.chordRowHeight + m.chordToStaffGap + m.stringGap * 5 + m.padBottom);
  assert.equal(layout720.height, layout720.systems[0].y + m.systemHeight);
});

console.log('M3 · SVG');

test('输出是自洽的 SVG 片段', () => {
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('viewBox="0 0 720'));
  assert.ok(!svg.includes('NaN'));
  assert.ok(!svg.includes('undefined'));
});

test('六条弦线 + 弦名 e B G D A E', () => {
  assert.equal((svg.match(/stroke-width="1"/g) || []).length >= 6, true);
  for (const label of ['>e<', '>B<', '>G<', '>D<', '>A<', '>E<']) assert.ok(svg.includes(label), label);
});

test('品数字带底色，先铺底色再画字（不线穿字）', () => {
  const rectIndex = svg.indexOf('<rect x=');
  const textIndex = svg.indexOf('>0<');
  assert.ok(rectIndex > -1 && textIndex > rectIndex);
});

test('和弦名出现在和弦层，且与节奏视图同文本', () => {
  assert.ok(svg.includes('>Am<'));
  assert.ok(svg.includes('>G<'));
});

test('小节线数 = 小节数 + 1', () => {
  const count = (svg.match(/stroke-width="1\.5"/g) || []).length;
  assert.equal(count, 1);
  assert.ok(svg.includes('stroke-width="1"'));
});

test('两位数品数降字号，x 用独立颜色', () => {
  const { score: s2 } = parse(`# syntax=tab
# time=4/4

@ Dm
e|10-12-x-0|
B|--------|
G|--------|
D|--------|
A|--------|
E|--------|`);
  const wide = renderTabSVG(s2, layoutTab(s2, { width: 720 }), {});
  const narrow = renderTabSVG(s2, layoutTab(s2, { width: 320 }), {});
  assert.ok(wide.includes('font-size="13"') && wide.includes('font-size="12"'));
  assert.ok(wide.includes('>x<'));
  assert.ok(narrow.includes('font-size="11"') && narrow.includes('font-size="10"'));
});

test('窄屏隐藏弦名标签，宽屏显示', () => {
  const narrow = renderTabSVG(score, layoutTab(score, { width: 320 }), {});
  assert.ok(!narrow.includes('text-anchor="end">e<'));
});

console.log(`\nM3：${pass} 通过，${fail.length} 失败`);
if (fail.length > 0) process.exit(1);
