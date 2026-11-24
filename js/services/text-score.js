// ==========================================
// js/services/text-score.js
// 轻量文本谱解析：TXT / Markdown / ChordPro 子集
//
// 目标：保留原文空格与换行，不做歌词重排、不做自动对齐。
// ChordPro 的 [C] 行内和弦原样保留，只在渲染层上色。
// ==========================================

const SECTION_NAMES = [
  ['start_of_verse', '主歌'],
  ['start_of_chorus', '副歌'],
  ['start_of_bridge', '桥段'],
  ['start_of_tab', 'Tab'],
  ['start_of_grid', '节奏']
];

const CHORD_RE = /^[A-G](#|b)?(?:maj|min|m|dim|aug|sus)?(?:[0-9]+)?(?:(?:sus|add|b|#)?[0-9]+)?(?:\/[A-G](#|b)?)?$/i;

const stripFileExtension = (name) => String(name || '').replace(/\.([a-z0-9]+)$/i, '') || '未命名文本谱';

export function normalizeText(raw = '') {
  return String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '');
}

export async function readTextBlob(blob) {
  if (!blob) return '';
  if (typeof blob.text === 'function') return normalizeText(await blob.text());
  return normalizeText(await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  }));
}

function isChordToken(token = '') {
  const value = token.replace(/[|:;,()[\]{}]/g, '');
  if (!value || value === '-' || value === '—') return false;
  if (value.toUpperCase() === 'N.C.') return true;
  return CHORD_RE.test(value);
}

function looksLikeChordLine(line = '') {
  const tokens = line
    .replace(/[|:;,()[\]{}]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every(isChordToken);
}

function directiveInfo(line = '') {
  const match = line.trim().match(/^\{([^}]+)\}$/);
  if (!match) return null;
  const body = match[1].trim();
  const colon = body.indexOf(':');
  const key = (colon >= 0 ? body.slice(0, colon) : body).trim().toLowerCase();
  const value = colon >= 0 ? body.slice(colon + 1).trim() : '';
  return { key, value };
}

function sectionNameFromDirective(key, value) {
  if (value) return value;
  const found = SECTION_NAMES.find(([name]) => name === key);
  if (found) return found[1];
  if (key === 'section' || key === 'verse' || key === 'chorus' || key === 'bridge') {
    return key === 'section' ? '段落' : { verse: '主歌', chorus: '副歌', bridge: '桥段' }[key];
  }
  return '';
}

/**
 * @param {string} raw 原文
 * @param {string} fileName 文件名，用于标题兜底
 * @returns {{ meta: {title:string, artist:string, capo:string, key:string}, blocks: Array }}
 */
export function parseTextScore(raw = '', fileName = '') {
  const text = normalizeText(raw);
  const meta = {
    title: stripFileExtension(fileName),
    artist: '',
    capo: '',
    key: ''
  };
  const blocks = [];
  const lines = text.split('\n');

  const push = (block) => blocks.push(block);

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');
    const trimmed = line.trim();

    if (!trimmed) {
      push({ type: 'empty', text: '' });
      continue;
    }

    const directive = directiveInfo(line);
    if (directive) {
      const { key, value } = directive;
      if (key === 'title' || key === 't') { meta.title = value || meta.title; continue; }
      if (key === 'artist' || key === 'subtitle' || key === 'st') { meta.artist = value; continue; }
      if (key === 'capo') { meta.capo = value; continue; }
      if (key === 'key') { meta.key = value; continue; }
      if (key === 'section' || key.startsWith('start_of_') || key === 'verse' || key === 'chorus' || key === 'bridge') {
        const name = sectionNameFromDirective(key, value);
        if (name) push({ type: 'section', text: name });
        continue;
      }
      if (key === 'comment' || key === 'c' || key === 'note') {
        if (value) push({ type: 'note', text: value });
        continue;
      }
      // 其他 {define} / {end_of_*} / {new_song} 等指令不进入正文
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      push({ type: 'section', text: heading[2].trim() });
      continue;
    }

    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      push({ type: 'divider', text: '' });
      continue;
    }

    const bracketLine = trimmed.match(/^\[([^\]]+)\]$/);
    if (bracketLine) {
      const inner = bracketLine[1].trim();
      if (isChordToken(inner)) push({ type: 'chord', text: line });
      else push({ type: 'section', text: inner });
      continue;
    }

    if (trimmed.startsWith('【') && trimmed.endsWith('】')) {
      push({ type: 'section', text: trimmed.slice(1, -1) });
      continue;
    }

    if (looksLikeChordLine(trimmed)) {
      push({ type: 'chord', text: line });
      continue;
    }

    push({ type: 'line', text: line });
  }

  // 干掉开头连续空行；结尾最多保留一行空行，避免撑出大片空白
  while (blocks.length && blocks[0].type === 'empty') blocks.shift();
  while (blocks.length > 1 && blocks[blocks.length - 1].type === 'empty' && blocks[blocks.length - 2].type === 'empty') blocks.pop();

  return { meta, blocks };
}

export function hasInlineChords(text = '') {
  return /\[[^\]]+\]/.test(text);
}
