// ==========================================
// js/services/share-card.js
// 0.1.14a 练习卡片：今日统计 + 1080×1440 参数化背景卡片 + 页脚题记
// 纯本地 Canvas，不请求远程模板、不上传任何数据
// ==========================================

import { pickQuote } from './quotes.js';

const CARD_W = 1080;
const CARD_H = 1440;
const FONT_STACK = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif';
const QUOTE_FONT_STACK = '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", serif';

export const DEFAULT_SHARE_BG = 'walnut';

function withAlpha(hex, alpha) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function makePalette(strong, muted, accent) {
  return {
    strong,
    muted,
    accent,
    lineStrong: withAlpha(accent, 0.45),
    lineSoft: withAlpha(accent, 0.30),
    quote: withAlpha(strong, 0.55),
    tileFill: withAlpha(accent, 0.20)
  };
}

/** 六套背景只换参数，不写六份绘制代码 */
export const SHARE_BACKGROUNDS = [
  {
    id: 'walnut', name: '深胡桃木', light: false, texture: 'none',
    top: '#2B2019', bottom: '#150F0C', vignette: 'rgba(0,0,0,0.42)',
    palette: makePalette('#F3E8D6', '#B9A995', '#B87B4C')
  },
  {
    id: 'oak', name: '浅橡木', light: true, texture: 'wood',
    top: '#EAD9BD', bottom: '#C9AC83', vignette: 'rgba(70,44,20,0.20)',
    palette: makePalette('#2B2117', '#55412D', '#6E3B1A')
  },
  {
    id: 'linen', name: '亚麻纸', light: true, texture: 'paper',
    top: '#F2E8D6', bottom: '#DACBB3', vignette: 'rgba(80,60,35,0.16)',
    palette: makePalette('#2C2720', '#5F5546', '#7A4725')
  },
  {
    id: 'felt', name: '墨绿台呢', light: false, texture: 'felt',
    top: '#1B3A2F', bottom: '#091B15', vignette: 'rgba(0,0,0,0.38)',
    palette: makePalette('#F0E8D7', '#A8B5A5', '#C99A5E')
  },
  {
    id: 'brass', name: '炭黑黄铜', light: false, texture: 'metal',
    top: '#1D1B18', bottom: '#090807', vignette: 'rgba(0,0,0,0.40)',
    palette: makePalette('#F2E8D5', '#B9AC96', '#D2A451')
  },
  {
    id: 'midnight', name: '午夜蓝', light: false, texture: 'grain',
    top: '#1A2433', bottom: '#070B13', vignette: 'rgba(0,0,0,0.42)',
    palette: makePalette('#ECE9DF', '#A7B0C2', '#9EB2CF')
  }
];

export const CUSTOM_SHARE_BG_IDS = Object.freeze(['custom', 'custom2']);

export function getShareBackground(id) {
  if (id === CUSTOM_SHARE_BG.id) return CUSTOM_SHARE_BG;
  if (id === CUSTOM_SHARE_BG_2.id) return CUSTOM_SHARE_BG_2;
  return SHARE_BACKGROUNDS.find((bg) => bg.id === id) || SHARE_BACKGROUNDS[0];
}

/** 第 7 套自定义背景：图片 + 压暗蒙版，固定深色文字 */
export const CUSTOM_SHARE_BG = {
  id: 'custom', name: '自定义 1', light: false, texture: 'photo',
  top: '#000000', bottom: '#000000', vignette: 'rgba(0,0,0,0.38)',
  palette: makePalette('#FBF4E9', '#F1E9DE', '#F0B67A')
};

/** 第 8 套自定义背景：与第 7 套同版式同配色，只换图片与独立压暗值 */
export const CUSTOM_SHARE_BG_2 = {
  ...CUSTOM_SHARE_BG,
  id: 'custom2', name: '自定义 2'
};

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

let logoPromise = null;

function loadLogo() {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = './icon-gShell-192.png';
  });
  return logoPromise;
}

const logMinutes = (log) => {
  const sec = Number(log && log.durationSec);
  if (Number.isFinite(sec) && sec > 0) return sec / 60;
  return parseInt(log && log.minutes, 10) || 0;
};

const dayKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function countStreak(logs, now) {
  const keys = new Set();
  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const at = Number(log && log.createdAt);
    if (Number.isFinite(at) && at > 0) keys.add(dayKey(at));
  });
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (keys.has(dayKey(cursor)) && streak < 3650) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 今日口径：本地 00:00 → 次日 00:00；连续打卡含今天向前算 */
export function getTodayPracticeSummary(logs = [], now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const todayLogs = (Array.isArray(logs) ? logs : []).filter((log) => {
    const at = Number(log && log.createdAt);
    return Number.isFinite(at) && at >= start && at < end;
  });

  const minutes = Math.round(todayLogs.reduce((sum, log) => sum + logMinutes(log), 0));

  const topLog = todayLogs
    .slice()
    .sort((a, b) => (logMinutes(b) - logMinutes(a)) || (Number(b.createdAt) - Number(a.createdAt)))[0] || null;

  return {
    date: now,
    minutes,
    count: todayLogs.length,
    topName: topLog ? String(topLog.name || '').trim() : '',
    streak: countStreak(logs, now)
  };
}

function setFont(ctx, size, weight = 700, spacing = 0) {
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (err) {}
}

function setQuoteFont(ctx, size, lang = 'zh') {
  ctx.font = `${lang === 'en' ? 'italic ' : ''}${size}px ${QUOTE_FONT_STACK}`;
  try { ctx.letterSpacing = lang === 'en' ? '0.4px' : '1px'; } catch (err) {}
}

function truncateLine(ctx, line, maxWidth, isEnglish) {
  let text = line;
  if (isEnglish) {
    while (text && ctx.measureText(`${text}…`).width > maxWidth) {
      text = text.replace(/\s*\S+$/, '');
    }
  } else {
    while (text && ctx.measureText(`${text}…`).width > maxWidth) {
      text = text.slice(0, -1);
    }
  }
  return text ? `${text}…` : '…';
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const textureCache = new Map();

function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成可重复的噪点瓦片，避免每次切背景都逐像素重算整张卡 */
function noiseTile(key, size, density, alpha, light) {
  const cacheKey = `${key}:${size}:${density}:${alpha}:${light ? 1 : 0}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(size, size);
  const data = img.data;
  const rnd = mulberry32(hashSeed(cacheKey));
  const tone = light ? 0 : 255;
  for (let i = 0; i < size * size; i += 1) {
    if (rnd() < density) {
      const a = Math.round(alpha * 255 * (0.35 + rnd() * 0.65));
      const p = i * 4;
      data[p] = tone;
      data[p + 1] = tone;
      data[p + 2] = tone;
      data[p + 3] = a;
    }
  }
  tctx.putImageData(img, 0, 0);
  textureCache.set(cacheKey, tile);
  return tile;
}

function fillNoise(ctx, key, { size = 160, density = 0.34, alpha = 0.05, light = false } = {}) {
  const pattern = ctx.createPattern(noiseTile(key, size, density, alpha, light), 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}

function drawWoodTexture(ctx, preset) {
  const rnd = mulberry32(hashSeed(`${preset.id}-wood`));
  ctx.save();
  for (let i = 0; i < 80; i += 1) {
    const x = rnd() * CARD_W;
    const amp = 2 + rnd() * 5;
    const dark = preset.light ? '90,60,35' : '255,242,222';
    ctx.strokeStyle = `rgba(${dark},${(preset.light ? 0.012 : 0.02) + rnd() * 0.022})`;
    ctx.lineWidth = 0.5 + rnd() * 1.0;
    ctx.beginPath();
    ctx.moveTo(x - amp, -20);
    ctx.bezierCurveTo(x + amp * 0.7, CARD_H * 0.3, x - amp * 0.9, CARD_H * 0.72, x + amp, CARD_H + 20);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPaperTexture(ctx, preset) {
  const rnd = mulberry32(hashSeed(`${preset.id}-paper`));
  fillNoise(ctx, `${preset.id}-paper`, { size: 180, density: 0.30, alpha: 0.04, light: true });
  ctx.save();
  for (let i = 0; i < 260; i += 1) {
    const x = rnd() * CARD_W;
    const y = rnd() * CARD_H;
    const angle = (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.35;
    const len = 16 + rnd() * 58;
    ctx.strokeStyle = `rgba(110,85,55,${0.03 + rnd() * 0.045})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLinenTexture(ctx, preset) {
  const rnd = mulberry32(hashSeed(`${preset.id}-linen`));
  fillNoise(ctx, `${preset.id}-linen`, { size: 140, density: 0.30, alpha: 0.03, light: true });
  ctx.save();
  ctx.lineWidth = 1;
  for (let y = 0; y < CARD_H; y += 5) {
    ctx.strokeStyle = `rgba(78,66,50,${0.018 + rnd() * 0.020})`;
    ctx.beginPath();
    ctx.moveTo(0, y + (rnd() - 0.5) * 1.2);
    ctx.lineTo(CARD_W, y + (rnd() - 0.5) * 1.2);
    ctx.stroke();
  }
  for (let x = 0; x < CARD_W; x += 5) {
    ctx.strokeStyle = `rgba(110,95,75,${0.014 + rnd() * 0.016})`;
    ctx.beginPath();
    ctx.moveTo(x + (rnd() - 0.5) * 1.2, 0);
    ctx.lineTo(x + (rnd() - 0.5) * 1.2, CARD_H);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFeltTexture(ctx, preset) {
  const rnd = mulberry32(hashSeed(`${preset.id}-felt`));
  fillNoise(ctx, `${preset.id}-felt`, { size: 150, density: 0.38, alpha: 0.045 });
  ctx.save();
  for (let i = 0; i < 22; i += 1) {
    const x = rnd() * CARD_W;
    const y = rnd() * CARD_H;
    const r = 70 + rnd() * 190;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(220,235,220,${0.006 + rnd() * 0.012})`);
    g.addColorStop(1, 'rgba(220,235,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

function drawMetalTexture(ctx, preset) {
  const rnd = mulberry32(hashSeed(`${preset.id}-metal`));
  fillNoise(ctx, `${preset.id}-metal`, { size: 160, density: 0.26, alpha: 0.035 });
  ctx.save();
  for (let i = 0; i < 120; i += 1) {
    const y = rnd() * CARD_H;
    ctx.strokeStyle = `rgba(214,176,108,${0.006 + rnd() * 0.016})`;
    ctx.lineWidth = 0.5 + rnd() * 0.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CARD_W, y + (rnd() - 0.5) * 1.2);
    ctx.stroke();
  }
  const sheen = ctx.createRadialGradient(CARD_W * 0.86, CARD_H * 0.10, 0, CARD_W * 0.86, CARD_H * 0.10, CARD_W * 0.74);
  sheen.addColorStop(0, 'rgba(214,170,92,0.12)');
  sheen.addColorStop(0.55, 'rgba(214,170,92,0.030)');
  sheen.addColorStop(1, 'rgba(214,170,92,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();
}

function drawGrainTexture(ctx, preset) {
  fillNoise(ctx, `${preset.id}-grain`, { size: 170, density: 0.32, alpha: 0.045 });
  const rnd = mulberry32(hashSeed(`${preset.id}-grain-bands`));
  ctx.save();
  for (let i = 0; i < 8; i += 1) {
    const x = rnd() * CARD_W;
    const w = 80 + rnd() * 180;
    const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
    g.addColorStop(0, 'rgba(160,185,220,0)');
    g.addColorStop(0.5, 'rgba(160,185,220,0.018)');
    g.addColorStop(1, 'rgba(160,185,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w, 0, w * 2, CARD_H);
  }
  ctx.restore();
}

function drawBackground(ctx, preset) {
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, preset.top);
  grad.addColorStop(1, preset.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  if (preset.texture === 'wood') drawWoodTexture(ctx, preset);
  else if (preset.texture === 'paper') drawPaperTexture(ctx, preset);
  else if (preset.texture === 'linen') drawLinenTexture(ctx, preset);
  else if (preset.texture === 'felt') drawFeltTexture(ctx, preset);
  else if (preset.texture === 'metal') drawMetalTexture(ctx, preset);
  else if (preset.texture === 'grain') drawGrainTexture(ctx, preset);

  const vignette = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, CARD_H * 0.22, CARD_W / 2, CARD_H / 2, CARD_H * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, preset.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function normalizeDimPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 30;
  return Math.max(0, Math.min(90, Math.round(n)));
}

function drawCustomBackground(ctx, image, dimPercent) {
  const dim = normalizeDimPercent(dimPercent) / 100;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (image) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, CARD_W, CARD_H);
  }

  ctx.fillStyle = `rgba(0,0,0,${dim})`;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 上下轻微压暗，避免页眉/题记压到亮部
  const shade = ctx.createLinearGradient(0, 0, 0, CARD_H);
  shade.addColorStop(0, 'rgba(0,0,0,0.10)');
  shade.addColorStop(0.28, 'rgba(0,0,0,0)');
  shade.addColorStop(0.72, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const vignette = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, CARD_H * 0.22, CARD_W / 2, CARD_H / 2, CARD_H * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawHeader(ctx, logo, date, p) {
  if (logo) {
    ctx.drawImage(logo, 96, 96, 48, 48);
  } else {
    ctx.fillStyle = p.tileFill;
    roundRect(ctx, 96, 96, 48, 48, 12);
    ctx.fill();
    setFont(ctx, 20, 800);
    ctx.fillStyle = p.strong;
    ctx.textAlign = 'center';
    ctx.fillText('GS', 120, 128);
  }

  ctx.textAlign = 'left';
  setFont(ctx, 26, 600, 0.5);
  ctx.fillStyle = p.strong;
  ctx.fillText('Guitar Shell', 160, 128);

  ctx.textAlign = 'right';
  setFont(ctx, 24, 500, 0.6);
  ctx.fillStyle = p.muted;
  ctx.fillText(
    `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} · ${WEEKDAYS[date.getDay()]}`,
    984,
    128
  );
}

/** 页脚蜗牛：细线壳与触角，身体只留外侧曲线与头部弧线 */
function drawFooterSnail(ctx, p) {
  const ink = withAlpha(p.accent, p.light ? 0.62 : 0.55);
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 用 24×24 的细线蜗牛轮廓，按横线左端等比放大
  const s = 4;
  ctx.save();
  ctx.translate(392, 1158);
  ctx.scale(s, s);
  ctx.lineWidth = 1 / s;

  // 身体只保留外侧曲线和头部弧线；原来那道竖线已去掉，不再填充
  const bodyCurve = new Path2D('M14 21c4.4 0 8-3.6 8-8');
  const headArc = new Path2D();
  headArc.arc(20, 13, 2, Math.PI, 0, false);

  // 尾部贴地线、身体外侧线与头部弧线
  ctx.beginPath();
  ctx.moveTo(2, 21);
  ctx.lineTo(14, 21);
  ctx.stroke();
  ctx.stroke(bodyCurve);
  ctx.stroke(headArc);

  const shell = new Path2D('M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0');
  const shellRing = new Path2D();
  shellRing.arc(10, 13, 8, 0, Math.PI * 2);
  const antennae = new Path2D('M19 11.3Q17.9 10.2 17.8 8.8M21 11.3Q22.1 10.2 22.2 8.8');

  ctx.stroke(shellRing);
  ctx.stroke(shell);
  ctx.stroke(antennae);
  ctx.restore();

  ctx.restore();
}

function drawTodayBlock(ctx, summary, p) {
  ctx.textAlign = 'left';
  setFont(ctx, 32, 500, 2);
  ctx.fillStyle = p.muted;
  ctx.fillText('今日练习时长', 96, 420);

  const text = String(summary.minutes);
  let size = 190;
  setFont(ctx, size, 800);
  while (ctx.measureText(text).width > 470 && size > 92) {
    size -= 10;
    setFont(ctx, size, 800);
  }
  ctx.fillStyle = p.strong;
  const baseline = 620;
  ctx.fillText(text, 96, baseline);

  setFont(ctx, size, 800);
  const bigWidth = ctx.measureText(text).width;
  setFont(ctx, 40, 600);
  ctx.fillStyle = p.accent;
  ctx.fillText('分钟', 96 + bigWidth + 24, baseline - Math.round(size * 0.35));
}

/** 右侧上下两行统计：标签与数值分开，数值用强调色后缀 */
function drawStatBlock(ctx, x, labelBaseline, label, value, suffix, p) {
  ctx.textAlign = 'left';
  setFont(ctx, 32, 500, 3);
  ctx.fillStyle = p.muted;
  ctx.fillText(label, x, labelBaseline);
  const labelWidth = ctx.measureText(label).width;
  const tx = x + labelWidth + 14;

  const valueText = String(value);
  let valueSize = 48;
  setFont(ctx, valueSize, 800);
  const suffixSize = 24;
  const suffixWidth = (() => {
    const current = ctx.font;
    setFont(ctx, suffixSize, 500);
    const width = ctx.measureText(suffix).width;
    ctx.font = current;
    return width;
  })();

  while (valueSize > 32) {
    setFont(ctx, valueSize, 800);
    if (tx + ctx.measureText(valueText).width + 8 + suffixWidth <= 984) break;
    valueSize -= 2;
  }

  ctx.fillStyle = p.strong;
  ctx.fillText(valueText, tx, labelBaseline + 56);
  const valueWidth = ctx.measureText(valueText).width;

  setFont(ctx, suffixSize, 500);
  ctx.fillStyle = p.accent;
  ctx.fillText(suffix, tx + valueWidth + 8, labelBaseline + 50);
}

function drawStatsBlock(ctx, summary, p) {
  drawStatBlock(ctx, 750, 540, '今日打卡', summary.count || 0, '次', p);
  drawStatBlock(ctx, 750, 706, '连续打卡', summary.streak || 0, '天', p);
}

function drawName(ctx, summary, showName, p) {
  if (!showName || !summary.topName) return;

  ctx.textAlign = 'left';
  setFont(ctx, 32, 500, 2);
  ctx.fillStyle = p.muted;
  ctx.fillText('今日主练', 96, 900);

  let name = summary.topName;
  setFont(ctx, 50, 700);
  while (name.length > 1 && ctx.measureText(`${name}…`).width > 888) {
    name = name.slice(0, -1);
  }
  if (name !== summary.topName) name = `${name}…`;
  ctx.fillStyle = p.strong;
  ctx.fillText(name, 96, 974);
}

function stripTrailingStop(text) {
  return String(text || '').replace(/[。.]+$/u, '').trimEnd();
}

function drawFooter(ctx, quote, p) {
  ctx.strokeStyle = p.lineSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(400, 1242);
  ctx.lineTo(984, 1242);
  ctx.stroke();

  drawFooterSnail(ctx, p);

  const text = stripTrailingStop(quote && quote.text);
  if (!text) return;

  const lang = quote.lang === 'en' ? 'en' : 'zh';
  const isEnglish = lang === 'en';
  const maxWidth = 640;
  let size = 26;
  setQuoteFont(ctx, size, lang);
  while (size > 20 && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    setQuoteFont(ctx, size, lang);
  }
  const fitted = ctx.measureText(text).width > maxWidth ? truncateLine(ctx, text, maxWidth, isEnglish) : text;

  ctx.textAlign = 'right';
  ctx.fillStyle = p.quote;
  ctx.fillText(fitted, 984, 1338);
}

/**
 * 把今日摘要画到 canvas；调用方负责 canvas.width/height = 1080/1440
 */
export async function drawShareCard(canvas, summary, options = {}) {
  const showName = Boolean(options.showName);
  const quote = options.quote === undefined ? pickQuote(summary.date) : options.quote;
  const customImage = options.customImage || null;
  const requested = String(options.background || '');
  const requestedCustom = CUSTOM_SHARE_BG_IDS.includes(requested);
  const useCustom = requestedCustom && Boolean(customImage);
  const preset = useCustom
    ? getShareBackground(requested)
    : getShareBackground(requestedCustom ? DEFAULT_SHARE_BG : requested);
  const dimPercent = normalizeDimPercent(options.customDim);
  const p = preset.palette;
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const logo = await loadLogo();

  if (useCustom) drawCustomBackground(ctx, customImage, dimPercent);
  else drawBackground(ctx, preset);
  drawHeader(ctx, logo, summary.date, p);
  drawTodayBlock(ctx, summary, p);
  drawStatsBlock(ctx, summary, p);
  drawName(ctx, summary, showName, p);
  drawFooter(ctx, quote, p);

  canvas.dataset.rendered = '1';
  canvas.dataset.background = useCustom ? requested : preset.id;
  canvas.dataset.customDim = useCustom ? String(dimPercent) : '';
  canvas.dataset.showName = showName ? '1' : '0';
  canvas.dataset.minutes = String(summary.minutes);
  canvas.dataset.quoteId = quote ? String(quote.id || '') : '';
  canvas.dataset.quoteLang = quote ? String(quote.lang || 'zh') : '';
  canvas.dataset.quoteText = quote ? stripTrailingStop(quote.text) : '';
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('卡片导出失败'));
    }, 'image/png');
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('卡片读取失败'));
    reader.readAsDataURL(blob);
  });
}

function getNativeShareCard() {
  try {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    const plugin = cap.Plugins && cap.Plugins.ShareCard;
    if (plugin) {
      return {
        share: (opts) => plugin.share(opts),
        saveToGallery: typeof plugin.saveToGallery === 'function'
          ? (opts) => plugin.saveToGallery(opts)
          : null
      };
    }
    if (typeof cap.nativePromise === 'function') {
      return {
        share: (opts) => cap.nativePromise('ShareCard', 'share', opts),
        saveToGallery: (opts) => cap.nativePromise('ShareCard', 'saveToGallery', opts)
      };
    }
  } catch (err) {}
  return null;
}

export function cardFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `GuitarShell-practice-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { channel: 'web-download', fileName };
}

/** 原生壳保存到系统相册；网页端沿用下载 */
export async function saveShareCard(blob, fileName = cardFileName()) {
  const plugin = getNativeShareCard();
  if (plugin && typeof plugin.saveToGallery === 'function') {
    const dataUrl = await blobToDataUrl(blob);
    const result = await plugin.saveToGallery({ fileName, dataUrl });
    return { channel: 'native-gallery', fileName, result };
  }
  return downloadBlob(blob, fileName);
}

function canSharePngFile(file) {
  try {
    return typeof navigator !== 'undefined'
      && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] });
  } catch (err) {
    return false;
  }
}

/** 网页端是否具备分享 PNG 文件的能力（决定预览底栏是否显示分享按钮） */
export function canWebShareCard() {
  if (typeof navigator === 'undefined'
    || typeof File === 'undefined'
    || typeof navigator.share !== 'function'
    || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'card-probe.png', { type: 'image/png' });
    return canSharePngFile(probe);
  } catch (err) {
    return false;
  }
}

/** 原生壳走系统分享面板；网页优先 Web Share，失败或不可用时回退下载 */
export async function shareShareCard(blob, fileName = cardFileName()) {
  const plugin = getNativeShareCard();
  if (plugin && typeof plugin.share === 'function') {
    const dataUrl = await blobToDataUrl(blob);
    const result = await plugin.share({ fileName, dataUrl });
    return { channel: 'native', fileName, result };
  }

  const file = new File([blob], fileName, { type: 'image/png' });
  const canWebShare = canSharePngFile(file);

  if (canWebShare) {
    try {
      await navigator.share({ files: [file], title: '练习卡片' });
      return { channel: 'web-share', fileName };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { channel: 'web-share', fileName, cancelled: true };
      }
      throw err;
    }
  }

  return downloadBlob(blob, fileName);
}
