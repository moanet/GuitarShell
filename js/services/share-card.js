// ==========================================
// js/services/share-card.js
// 0.1.13 练习卡片：今日统计 + 1080×1440 木质卡片绘制 + 分享 / 下载
// 纯本地 Canvas，不请求远程模板、不上传任何数据
// ==========================================

const CARD_W = 1080;
const CARD_H = 1440;
const FONT_STACK = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif';

const COLOR = {
  bgTop: '#2B2019',
  bgBottom: '#150F0C',
  cream: '#F3E8D6',
  muted: '#B9A995',
  accent: '#B87B4C',
  olive: '#6B8E23'
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

  let maxBpm = 0;
  todayLogs.forEach((log) => {
    [log.bpmEnd, log.bpm, log.bpmStart].forEach((raw) => {
      const n = Number(raw);
      if (Number.isFinite(n) && n > maxBpm && n > 0) maxBpm = n;
    });
  });

  const topLog = todayLogs
    .slice()
    .sort((a, b) => (logMinutes(b) - logMinutes(a)) || (Number(b.createdAt) - Number(a.createdAt)))[0] || null;

  return {
    date: now,
    minutes,
    maxBpm: maxBpm || null,
    count: todayLogs.length,
    topName: topLog ? String(topLog.name || '').trim() : '',
    streak: countStreak(logs, now)
  };
}

function setFont(ctx, size, weight = 700, spacing = 0) {
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  try { ctx.letterSpacing = `${spacing}px`; } catch (err) {}
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

function drawWoodBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, COLOR.bgTop);
  grad.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 木纹：竖向细线，轻微正弦弯曲
  ctx.save();
  ctx.strokeStyle = 'rgba(184, 123, 76, 0.075)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i += 1) {
    const x = 40 + i * 42;
    ctx.beginPath();
    for (let y = 0; y <= CARD_H; y += 24) {
      const offset = Math.sin((y / CARD_H) * Math.PI * 2 + i) * 5;
      if (y === 0) ctx.moveTo(x + offset, y);
      else ctx.lineTo(x + offset, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 四周压暗，避免平铺感
  const vignette = ctx.createRadialGradient(CARD_W / 2, CARD_H / 2, CARD_H * 0.22, CARD_W / 2, CARD_H / 2, CARD_H * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function drawHeader(ctx, summary, logo) {
  if (logo) {
    ctx.drawImage(logo, 96, 92, 112, 112);
  } else {
    ctx.fillStyle = 'rgba(184, 123, 76, 0.22)';
    roundRect(ctx, 96, 92, 112, 112, 24);
    ctx.fill();
    setFont(ctx, 44, 800);
    ctx.fillStyle = COLOR.cream;
    ctx.textAlign = 'center';
    ctx.fillText('GS', 152, 168);
  }

  ctx.textAlign = 'left';
  setFont(ctx, 34, 800, 1);
  ctx.fillStyle = COLOR.cream;
  ctx.fillText('GUITAR SHELL', 240, 148);

  setFont(ctx, 21, 500, 1);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText('练 琴 记 录', 242, 186);

  const d = summary.date;
  ctx.textAlign = 'right';
  setFont(ctx, 28, 600);
  ctx.fillStyle = COLOR.cream;
  ctx.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, 984, 148);
  setFont(ctx, 22, 400);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText(WEEKDAYS[d.getDay()], 984, 186);

  ctx.strokeStyle = 'rgba(184, 123, 76, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(96, 246);
  ctx.lineTo(984, 246);
  ctx.stroke();
}

function drawTodayBlock(ctx, summary) {
  ctx.textAlign = 'left';
  setFont(ctx, 26, 600, 3);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText('今 日 练 习', 96, 402);

  const text = String(summary.minutes);
  let size = 208;
  setFont(ctx, size, 800);
  while (ctx.measureText(text).width > 620 && size > 92) {
    size -= 10;
    setFont(ctx, size, 800);
  }
  ctx.fillStyle = COLOR.cream;
  const baseline = 700;
  ctx.fillText(text, 96, baseline);

  setFont(ctx, 42, 600);
  ctx.fillStyle = COLOR.accent;
  // 量一次大字号宽度，单位紧跟在数字右侧
  setFont(ctx, size, 800);
  const bigWidth = ctx.measureText(text).width;
  setFont(ctx, 42, 600);
  ctx.fillText('分钟', 96 + bigWidth + 22, baseline - 8);

  // 主数字下沿的短装饰线
  ctx.strokeStyle = 'rgba(184, 123, 76, 0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(98, baseline + 34);
  ctx.lineTo(98 + Math.max(180, bigWidth), baseline + 34);
  ctx.stroke();

  setFont(ctx, 22, 400);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText(`今日打卡 ${summary.count} 次 · 累计 ${summary.minutes} 分钟`, 96, 756);
}

function drawTile(ctx, x, y, w, h, label, value, suffix) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  roundRect(ctx, x, y, w, h, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(184, 123, 76, 0.38)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 26);
  ctx.stroke();

  ctx.textAlign = 'left';
  setFont(ctx, 23, 500, 1);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText(label, x + 32, y + 62);

  const valueText = String(value);
  setFont(ctx, 62, 800);
  ctx.fillStyle = COLOR.cream;
  ctx.fillText(valueText, x + 32, y + 154);
  const valueWidth = ctx.measureText(valueText).width;

  if (suffix) {
    setFont(ctx, 24, 500);
    ctx.fillStyle = COLOR.accent;
    ctx.fillText(suffix, x + 32 + valueWidth + 12, y + 152);
  }
}

function drawMeta(ctx, summary, showName) {
  const y = 812;
  drawTile(ctx, 96, y, 424, 208, '今日最高 BPM', summary.maxBpm || '—', summary.maxBpm ? '' : '');
  drawTile(ctx, 560, y, 424, 208, '连续打卡', summary.streak || 0, '天');

  if (showName && summary.topName) {
    ctx.textAlign = 'left';
    setFont(ctx, 24, 500, 2);
    ctx.fillStyle = COLOR.muted;
    ctx.fillText('今 日 主 练', 96, 1112);

    let name = summary.topName;
    setFont(ctx, 46, 700);
    while (name.length > 1 && ctx.measureText(`${name}…`).width > 888) {
      name = name.slice(0, -1);
    }
    if (name !== summary.topName) name = `${name}…`;
    ctx.fillStyle = COLOR.cream;
    ctx.fillText(name, 96, 1192);
  } else {
    ctx.strokeStyle = 'rgba(184, 123, 76, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(96, 1130);
    ctx.lineTo(984, 1130);
    ctx.stroke();
  }
}

function drawFooter(ctx) {
  ctx.textAlign = 'left';
  setFont(ctx, 24, 400);
  ctx.fillStyle = COLOR.muted;
  ctx.fillText('本地练习记录 · 不上传任何数据', 96, 1330);

  ctx.textAlign = 'right';
  setFont(ctx, 22, 700, 2);
  ctx.fillStyle = COLOR.olive;
  ctx.fillText('GUITAR SHELL', 984, 1330);

  ctx.strokeStyle = 'rgba(184, 123, 76, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(96, 1280);
  ctx.lineTo(984, 1280);
  ctx.stroke();
}

/**
 * 把今日摘要画到 canvas；调用方负责 canvas.width/height = 1080/1440
 */
export async function drawShareCard(canvas, summary, options = {}) {
  const showName = Boolean(options.showName);
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const logo = await loadLogo();

  drawWoodBackground(ctx);
  drawHeader(ctx, summary, logo);
  drawTodayBlock(ctx, summary);
  drawMeta(ctx, summary, showName);
  drawFooter(ctx);

  canvas.dataset.rendered = '1';
  canvas.dataset.showName = showName ? '1' : '0';
  canvas.dataset.minutes = String(summary.minutes);
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

function getNativeShare() {
  try {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform()) return null;
    if (cap.Plugins && cap.Plugins.ShareCard) return cap.Plugins.ShareCard;
    if (typeof cap.nativePromise === 'function') {
      return { share: (opts) => cap.nativePromise('ShareCard', 'share', opts) };
    }
  } catch (err) {}
  return null;
}

export function cardFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `GuitarShell-practice-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.png`;
}

/** 原生壳走系统分享面板，网页端下载 PNG；两条通道都不发网络请求 */
export async function exportShareCard(blob, fileName = cardFileName()) {
  const plugin = getNativeShare();
  if (plugin) {
    const dataUrl = await blobToDataUrl(blob);
    const result = await plugin.share({ fileName, dataUrl });
    return { channel: 'native', fileName, result };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { channel: 'web', fileName };
}
