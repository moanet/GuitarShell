// M1 验收：Parser + Model + validate + JSON 往返
// 运行：node tests/sheet-m1.test.mjs

import assert from 'node:assert/strict';
import { parse } from '../js/sheet/parser.js';
import { capacityOf, validate, hasErrors, toJSON, fromJSON, chordAt, kindName } from '../js/sheet/model.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n  ${err.message}`);
  }
}

const noErrors = (issues) => !hasErrors(issues);

// 1. compact 行内和弦
test('compact 行内和弦：两小节各 8 个事件', () => {
  const { score, issues } = parse(`# mode=rhythm
# syntax=compact
# time=4/4

[C] d o u ~ d u 0 d | [G] d u d o ~ u d u`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 2);
  assert.equal(measures[0].items.length, 8);
  assert.equal(measures[1].items.length, 8);
  assert.equal(measures[0].chords[0].name, 'C');
  assert.equal(measures[0].chords[0].end_tick, 1920);
  assert.equal(measures[1].chords[0].name, 'G');
  assert.equal(measures[0].items[0].tick, 0);
  assert.equal(measures[0].items[7].tick, 1680);
});

// 2. 纯和弦行按小节分配
test('纯和弦行：4 个和弦对 4 个小节', () => {
  const { score, issues } = parse(`# mode=rhythm
# time=4/4

[C]       [G]       [Am]      [F]
d 0 u d | d 0 u d | d u - u | d 0 u d`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 4);
  assert.deepEqual(measures.map((m) => m.chords[0]?.name), ['C', 'G', 'Am', 'F']);
});

// 3. Unicode 别名归一化后与 ASCII 等价
test('别名：↓↑ 与 d u 产出相同 JSON', () => {
  const a = parse('# mode=rhythm\n[C] ↓ ↑ ↓ ↑');
  const b = parse('# mode=rhythm\n[C] d u d u');
  assert.equal(toJSON(a.score), toJSON(b.score));
  assert.ok(noErrors(a.issues));
});

// 4. 括号组：半拍均分
test('括号组：两个事件各 120 tick', () => {
  const { score } = parse('# mode=rhythm\n[C] (d u) (d o)');
  const items = score.tracks[0].measures[0].items;
  assert.deepEqual(items.map((i) => i.tick), [0, 120, 240, 360]);
  assert.deepEqual(items.map((i) => i.duration), [120, 120, 120, 120]);
});

// 5. 嵌套括号组逐层均分
test('嵌套括号组：120/60/60', () => {
  const { score } = parse('# mode=rhythm\n[C] (d (d u))');
  const items = score.tracks[0].measures[0].items;
  assert.deepEqual(items.map((i) => i.duration), [120, 60, 60]);
});

// 6. 附点：duration ×1.5，后续事件顺延
test('附点：d. 时值 360，下一个事件在 360', () => {
  const { score } = parse('# mode=rhythm\n[C] d. u');
  const items = score.tracks[0].measures[0].items;
  assert.equal(items[0].duration, 360);
  assert.equal(items[0].modifiers[0].dotted.count, 1);
  assert.equal(items[1].tick, 360);
});

// 7. aligned：% 行时值映射
test('aligned：= 为 480，- 为 240', () => {
  const { score, issues } = parse(`# time=4/4
# syntax=aligned

@  Am
e|-0--0-------|
B|-0--0-------|
G|-1--1-------|
D|------------|
A|------------|
E|------------|
% =- -- -- -- --`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const items = score.tracks[0].measures[0].items;
  const onE = items.filter((i) => i.kind.note?.string === 1);
  assert.equal(onE.length, 2);
  assert.equal(onE[0].duration, 240);
  assert.equal(onE[0].kind.note.fret.fret, 0);
});

// 8. 老 ASCII tab：品号 + h/p 修饰 + x
test('老 tab：0h2 生成本弦 Note 带 Hammer', () => {
  const { score, issues } = parse(`# mode=tab
# time=4/4

[Am]
e|----0h2-----|
B|--3---------|
G|------------|
D|------------|
A|------------|
E|------------|`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const items = score.tracks[0].measures[0].items;
  assert.equal(items.length, 2);
  const hammered = items.find((i) => i.modifiers.some((m) => m.hammer));
  assert.ok(hammered, '未找到击弦事件');
  assert.equal(hammered.kind.note.string, 1);
  assert.equal(hammered.modifiers[0].hammer.target_fret, 2);
});

// 9. 容量计算
test('capacity：4/4=1920、3/4=1440、2/4=960、6/8=1440、5/4=2400', () => {
  assert.equal(capacityOf({ numerator: 4, denominator: 4 }), 1920);
  assert.equal(capacityOf({ numerator: 3, denominator: 4 }), 1440);
  assert.equal(capacityOf({ numerator: 2, denominator: 4 }), 960);
  assert.equal(capacityOf({ numerator: 6, denominator: 8 }), 1440);
  assert.equal(capacityOf({ numerator: 5, denominator: 4 }), 2400);
});

// 10. 自动换小节
test('3/4：6 个八分位自动断小节', () => {
  const { score } = parse('# time=3/4\n[C] d d d d d d d');
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 2);
  assert.equal(measures[0].items.length, 6);
  assert.equal(measures[1].items.length, 1);
});

// 11. validate 能检出 M1/M3/M4
test('validate：合法谱无 Error', () => {
  const { score } = parse('# mode=rhythm\n[C] d d d d');
  assert.ok(noErrors(validate(score)));
});

test('validate：start_tick 断链报 M3', () => {
  const { score } = parse('# time=4/4\n[C] d | d');
  score.tracks[0].measures[1].start_tick = 0;
  const issues = validate(score);
  assert.ok(issues.some((i) => i.code === 'M3' && i.level === 'Error'));
});

test('validate：items 乱序报 M1', () => {
  const { score } = parse('# time=4/4\n[C] d d d d');
  const items = score.tracks[0].measures[0].items;
  [items[0], items[1]] = [items[1], items[0]];
  const issues = validate(score);
  assert.ok(issues.some((i) => i.code === 'M1' && i.level === 'Error'));
});

test('validate：和弦区间重叠报 M4', () => {
  const { score } = parse('# time=4/4\n[C] d d | [G] d d');
  score.tracks[0].measures[0].chords.push({ name: 'X', start_tick: 0, end_tick: 480 });
  const issues = validate(score);
  assert.ok(issues.some((i) => i.code === 'M4' && i.level === 'Error'));
});

test('validate：item 越出容量只报 Warning', () => {
  const { score } = parse('# time=4/4\n[C] d');
  score.tracks[0].measures[0].items[0].tick = 2000;
  const issues = validate(score);
  const m2 = issues.filter((i) => i.code === 'M2');
  assert.ok(m2.every((i) => i.level === 'Warning'));
});

// 12. chord_at 左闭右开
test('chord_at：start 命中、end 不命中', () => {
  const { score } = parse('# mode=rhythm\n[C] d d | [G] d d');
  const measure = score.tracks[0].measures[0];
  assert.equal(chordAt(measure, 0).name, 'C');
  assert.equal(chordAt(measure, 1919).name, 'C');
  assert.equal(chordAt(measure, 1920), null);
});

// 13. JSON 往返字节稳定
test('JSON 往返：字节稳定', () => {
  const { score } = parse(`# title=往返
# tempo=75
# time=4/4
[C] d o u ~ | [G] d u d`);
  const first = toJSON(score);
  const second = toJSON(fromJSON(first));
  assert.equal(first, second);
  assert.ok(!first.includes('color'));
  assert.ok(!first.includes('"x"'));
});

// 14. 空文本
test('空文本：给出 Error 不崩', () => {
  const { issues } = parse('');
  assert.ok(issues.some((i) => i.level === 'Error') || issues.length === 0);
});

// 15. kind_rank 排序
test('同 tick：Rest 排在 Strum 前', () => {
  const { score } = parse('# mode=rhythm\n[C] {d}0');
  const items = score.tracks[0].measures[0].items;
  assert.deepEqual(items.map((i) => kindName(i.kind)), ['strum', 'rest']);
});

// 16. 规范 §14.2：两小节老 tab，和弦按列位分到各小节
test('§14.2 老 tab：和弦 C→第1节、G→第2节', () => {
  const { score, issues } = parse(`# title=样例旋律
# tempo=75
# time=4/4
# mode=tab
# unit=8

[C]             [G]
e|----0----2---|----3--------|
B|----0----0---|----0--------|
G|----1----0---|----0--------|
D|-------------|-------------|
A|-------------|-------------|
E|-------------|-------------|`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 2);
  assert.equal(measures[0].chords[0].name, 'C');
  assert.equal(measures[1].chords[0].name, 'G');
  assert.equal(measures[0].items.length, 6);
  assert.equal(measures[1].items.length, 3);
});

// 17. 规范 §4.5：aligned 示例（由 parser dump 验证，行宽与 % 行严格同长）
test('§4.5 aligned 示例：无 Error，产出 2 小节', () => {
  const { score, issues } = parse(`# time=4/4
# syntax=aligned

@ Am       G
e|--------|--------|
B|--------|--------|
G|0-2-0-2-|3-0-3-0-|
D|--------|--------|
A|--------|--------|
E|--------|--------|
%--------|--------|`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  assert.equal(score.tracks[0].measures.length, 2);
  const m0 = score.tracks[0].measures[0];
  assert.deepEqual(m0.chords.map((c) => [c.name, c.start_tick, c.end_tick]), [['Am', 0, 1920]]);
  assert.deepEqual(m0.items.map((i) => [i.tick, i.kind.note.fret.fret]), [[0, 0], [480, 2], [960, 0], [1440, 2]]);
  const m1 = score.tracks[0].measures[1];
  assert.equal(m1.chords[0].name, 'G');
});

// 18. o 与 xd/xu 的数据区分（M1 第 3 条决定）
test('o = 切音（不标 muted）；xd/xu = 闷音 + 切音', () => {
  const { score, issues } = parse(`# syntax=compact
# time=4/4
[C] o xd xu d`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const items = score.tracks[0].measures[0].items;
  const [o, xd, xu] = items;
  assert.equal(o.kind.strum.muted, false);
  assert.ok(o.modifiers.some((m) => m.cut), 'o 应带 Cut');
  assert.equal(xd.kind.strum.muted, true);
  assert.ok(xd.modifiers.some((m) => m.cut), 'xd 应带 Cut');
  assert.equal(xu.kind.strum.muted, true);
  assert.ok(xu.modifiers.some((m) => m.cut), 'xu 应带 Cut');
});

// 19. 纯和弦行 N=3 / M=4：按整段时间轴等比切分
test('3 个和弦对 4 小节：跨节和弦逐节续写，不丢小节', () => {
  const { score, issues } = parse(`# syntax=compact
# time=4/4

[C] [G] [Am]
d d d d d d d d | d d d d d d d d | d d d d d d d d | d d d d d d d d`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 4);
  assert.deepEqual(measures[2].chords.map((c) => c.name), ['G', 'Am']);
  assert.deepEqual(measures[3].chords.map((c) => c.name), ['Am']);
  assert.equal(measures[3].chords[0].end_tick, 1920);
  assert.ok(measures.every((m) => m.chords.length >= 1), '每一小节都要有和弦标签');
  assert.equal(measures[1].chords[0].name, 'C');
  assert.equal(measures[1].chords[1].name, 'G');
});

// 20. 纯和弦行 N=4 / M=3：一节内出现两个和弦
test('4 个和弦对 3 小节：小节内按比例落到 tick', () => {
  const { score, issues } = parse(`# syntax=compact
# time=4/4

[C] [G] [Am] [F]
d d d d d d d d | d d d d d d d d | d d d d d d d d`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const measures = score.tracks[0].measures;
  assert.equal(measures.length, 3);
  assert.deepEqual(measures[0].chords.map((c) => [c.name, c.start_tick]), [['C', 0], ['G', 1440]]);
  assert.deepEqual(measures[2].chords.map((c) => [c.name, c.start_tick]), [['Am', 0], ['F', 480]]);
  for (const m of measures) {
    for (let i = 1; i < m.chords.length; i += 1) {
      assert.ok(m.chords[i - 1].end_tick <= m.chords[i].start_tick, '同节和弦不能重叠');
    }
  }
});

// 21. ~ 同品 → 延音（Tie），不是击勾
test('六线行 ~ 同品：生成 Tie，而不是 Hammer/Pull', () => {
  const { score, issues } = parse(`# syntax=aligned
# time=4/4
e|0~0-----|`);
  assert.ok(noErrors(issues), JSON.stringify(issues));
  const items = score.tracks[0].measures[0].items;
  assert.ok(items.some((i) => kindName(i.kind) === 'tie'), '同品应产生 Tie');
  const note = items.find((i) => kindName(i.kind) === 'note');
  assert.ok(!note.modifiers.some((m) => m.hammer || m.pull), '同品不应产生击勾');
});

// 22. 无 e| 前缀的六线行必须连续 6 行
test('无前缀六线行 6 行成组可解析；5 行报 Error', () => {
  const six = ['|--------|', '|--------|', '|-0------|', '|--------|', '|--------|', '|--------|'];
  const ok = parse(`# syntax=tab\n# time=4/4\n${six.join('\n')}`);
  assert.ok(noErrors(ok.issues), JSON.stringify(ok.issues));
  const note = ok.score.tracks[0].measures[0].items.find((i) => kindName(i.kind) === 'note');
  assert.equal(note.kind.note.string, 3, '第 3 行应映射到 G 弦');

  const bad = parse(`# syntax=tab\n# time=4/4\n${six.slice(0, 5).join('\n')}`);
  assert.ok(bad.issues.some((i) => i.level === 'Error' && i.code === 'tab'), JSON.stringify(bad.issues));
});

// 23. % 行列数：超长报 Error，偏短补空不报
test('% 行定义列数：六线行超长报 Error，偏短补空', () => {
  const overflow = parse(`# syntax=aligned\n# time=4/4
e|--------|--------|
B|--------|--------|
G|0-2-0-2-|3-0-3-0-|
D|--------|--------|
A|--------|--------|
E|--------|--------|
%------|------|`);
  assert.ok(overflow.issues.some((i) => i.level === 'Error' && i.code === 'tab/overflow'), JSON.stringify(overflow.issues));

  const short = parse(`# syntax=aligned\n# time=4/4
e|------|------|
B|------|------|
G|0-2-0-|3-0-3-|
D|------|------|
A|------|------|
E|------|------|
%------|------|`);
  assert.ok(noErrors(short.issues), JSON.stringify(short.issues));
});

// 24. aligned 和弦行统一用 @；[Am] 属 compact 写法，只报 Warning
test('aligned 里的 [Am] 报 Warning，@ Am 不报', () => {
  const tab = ['|--------|', '|--------|', '|0-------|', '|--------|', '|--------|', '|--------|'].join('\n');
  const legacy = parse(`# syntax=aligned\n# time=4/4\n[C]\n${tab}`);
  assert.ok(legacy.issues.some((i) => i.level === 'Warning' && i.code === 'syntax'), JSON.stringify(legacy.issues));
  assert.ok(noErrors(legacy.issues), JSON.stringify(legacy.issues));

  const modern = parse(`# syntax=aligned\n# time=4/4\n@ C\n${tab}`);
  assert.ok(!modern.issues.some((i) => i.code === 'syntax'), JSON.stringify(modern.issues));
});

// 25. % 行同时出现 = 与 + 时提示口径
test('% 行 = 与 + 同时出现报 Warning', () => {
  const lines = ['# syntax=tab', '# time=4/4', '', '@ C', 'e|------|', 'B|------|', 'G|------|', 'D|------|', 'A|------|', 'E|------|', '%-=+---|'];
  const out = parse(lines.join('\n'));
  assert.ok(out.issues.some((i) => i.level === 'Warning' && /= 四分/.test(i.message)), JSON.stringify(out.issues));
});

console.log(`\nM1 测试：${passed} 通过，${failures.length} 失败`);
if (failures.length) {
  failures.forEach((f) => console.log(`\n✗ ${f}`));
  process.exit(1);
}
