// ==========================================
// js/services/score-format.js
// 乐谱格式的唯一判定入口：PDF / 图片 / 文本谱
// 旧记录没有 format 字段时，用扩展名与 MIME 惰性推断
// ==========================================

export const SCORE_FORMAT = {
  PDF: 'pdf',
  IMAGE: 'image',
  TEXT: 'text'
};

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'cho', 'chordpro'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'];

export function fileExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function isTextFileName(name = '') {
  return TEXT_EXTENSIONS.includes(fileExtension(name));
}

export function isTextMime(mime = '') {
  const value = String(mime).toLowerCase();
  return value === 'text/plain' || value === 'text/markdown' || value === 'text/x-markdown';
}

/**
 * @param {string} name 文件名
 * @param {string} mime Blob / File 的 type
 * @param {string} storedFormat 记录里已有的 format
 * @returns {'pdf'|'image'|'text'|''}
 */
export function detectScoreFormat(name = '', mime = '', storedFormat = '') {
  if (storedFormat === SCORE_FORMAT.PDF || storedFormat === SCORE_FORMAT.IMAGE || storedFormat === SCORE_FORMAT.TEXT) {
    return storedFormat;
  }

  const ext = fileExtension(name);
  const type = String(mime).toLowerCase();

  if (type === 'application/pdf' || ext === 'pdf') return SCORE_FORMAT.PDF;
  if (type.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return SCORE_FORMAT.IMAGE;
  if (isTextMime(type) || TEXT_EXTENSIONS.includes(ext)) return SCORE_FORMAT.TEXT;
  return '';
}

export function isTextFormat(name, mime, storedFormat) {
  return detectScoreFormat(name, mime, storedFormat) === SCORE_FORMAT.TEXT;
}

export function textFormatLabel(name = '') {
  const ext = fileExtension(name);
  if (ext === 'md' || ext === 'markdown') return 'MD';
  if (ext === 'cho' || ext === 'chordpro') return 'CHO';
  if (ext === 'txt') return 'TXT';
  return 'TEXT';
}

export function formatDisplay(format, name = '', pageCount = 0) {
  if (format === SCORE_FORMAT.PDF) {
    return pageCount > 0 ? `PDF · ${pageCount} 页` : 'PDF';
  }
  if (format === SCORE_FORMAT.IMAGE) return '图片';
  if (format === SCORE_FORMAT.TEXT) return textFormatLabel(name);
  return '未知';
}

export function formatIcon(format, name = '') {
  if (format === SCORE_FORMAT.PDF) return '📄';
  if (format === SCORE_FORMAT.TEXT) return textFormatLabel(name) === 'TXT' ? '📝' : '🎼';
  return '🖼️';
}
