// 文本归一化：Unicode 别名 → ASCII 正式符号（GuitarTabMark 附录 A v1）
// 约束：只做字符替换，不改变列数以外的语义；元信息行与 [和弦] 内部不替换。

export const ALIAS_TABLE_VERSION = '1';

const MAP = new Map([
  ['↓', 'd'], ['⇩', 'd'], ['v', 'd'],
  ['↑', 'u'], ['⇧', 'u'], ['^', 'u'],
  ['〜', '~'], ['～', '~'],
  ['×', 'x'], ['✕', 'x'],
  ['｜', '|'], ['‖', '|'],
  ['（', '('], ['）', ')'],
  ['　', ' '], ['\u00A0', ' ']
]);

// 这几个是「休止」的别名，不映射成 0（0 在六线行里是空弦品号，语义不同）
export const REST_ALIASES = new Set(['·', '•', '。']);

export function normalize(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  return lines.map(normalizeLine).join('\n');
}

function normalizeLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) return line; // 元信息行原样保留
  let out = '';
  let inChord = false;
  for (const ch of line) {
    if (ch === '[') { inChord = true; out += ch; continue; }
    if (ch === ']') { inChord = false; out += ch; continue; }
    if (inChord) { out += ch; continue; }
    const mapped = MAP.get(ch);
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}
