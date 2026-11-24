// ==========================================
// js/services/cover-cache.js
// 书架封面：PDF 只渲染第 1 页，图片等比缩到 320px，结果落 assets store
// 同一份谱只生成一次；打开阅读页不依赖这里，封面失败不能阻塞阅读
// ==========================================

import { dbService } from './db.js';
import { detectScoreFormat, SCORE_FORMAT } from './score-format.js';

const COVER_WIDTH = 320;
const COVER_MAX_HEIGHT = 520;
const COVER_QUALITY = 0.78;

let pdfjsLib = null;
let pdfLoading = null;
const pending = new Map();

function loadPdfjs() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './js/lib/pdf.worker.js';
    pdfjsLib = window.pdfjsLib;
    return Promise.resolve(pdfjsLib);
  }
  if (pdfLoading) return pdfLoading;

  pdfLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './js/lib/pdf.js';
    script.onload = () => {
      if (!window.pdfjsLib) {
        pdfLoading = null;
        reject(new Error('pdf.js 加载未挂载'));
        return;
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './js/lib/pdf.worker.js';
      pdfjsLib = window.pdfjsLib;
      resolve(pdfjsLib);
    };
    script.onerror = () => {
      pdfLoading = null;
      reject(new Error('找不到 pdf.js'));
    };
    document.head.appendChild(script);
  });
  return pdfLoading;
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function canvasToBlob(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', COVER_QUALITY));
  if (blob) return blob;
  const dataUrl = canvas.toDataURL('image/jpeg', COVER_QUALITY);
  return (await fetch(dataUrl)).blob();
}

async function renderPdfCover(fileBlob) {
  const lib = await loadPdfjs();
  const data = await fileBlob.arrayBuffer();
  const pdf = await lib.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = COVER_WIDTH / Math.max(1, base.width);
    const viewport = page.getViewport({ scale });
    const canvas = newCanvas(viewport.width, Math.min(viewport.height, COVER_MAX_HEIGHT));
    const ctx = canvas.getContext('2d');
    // 白底：深色主题下也能看清谱面，透明 PNG 不会变成黑板
    ctx.fillStyle = '#f6f1e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas);
    page.cleanup();
    return { blob, pageCount: pdf.numPages || 1, width: canvas.width, height: canvas.height };
  } finally {
    try { await pdf.destroy(); } catch (err) {}
  }
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片封面解码失败'));
    };
    img.src = url;
  });
}

async function renderImageCover(fileBlob) {
  const img = await loadImage(fileBlob);
  const naturalW = img.naturalWidth || 1;
  const naturalH = img.naturalHeight || 1;
  const scale = Math.min(COVER_WIDTH / naturalW, COVER_MAX_HEIGHT / naturalH, 1);
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f1e8';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await canvasToBlob(canvas);
  return { blob, pageCount: 1, width, height };
}

async function persistCover(score, result) {
  const assetId = await dbService.addAsset({
    scoreId: score.id,
    kind: 'cover',
    blob: result.blob,
    mime: result.blob.type || 'image/jpeg',
    width: result.width,
    height: result.height,
    pageCount: result.pageCount,
    bytes: result.blob.size
  });
  await dbService.updateScore(score.id, {
    coverAssetId: assetId,
    pageCount: result.pageCount,
    format: score.format || detectScoreFormat(score.name, score.fileBlob?.type)
  }, { touch: false });
  score.coverAssetId = assetId;
  score.pageCount = result.pageCount;
  return assetId;
}

/**
 * 保证该乐谱有封面。返回可用于展示的 Blob；文本谱返回 null。
 * 已有的 coverAssetId 会优先复用，不重复渲染。
 */
export async function ensureCoverForScore(score) {
  if (!score || score.id === null || score.id === undefined) return null;
  if (pending.has(score.id)) return pending.get(score.id);

  const task = (async () => {
    if (score.coverAssetId) {
      try {
        const asset = await dbService.getAsset(score.coverAssetId);
        if (asset && asset.blob) {
          if (!score.pageCount && asset.pageCount) score.pageCount = asset.pageCount;
          return asset.blob;
        }
      } catch (err) {
        console.warn('[封面] 读取缓存失败，将重新生成:', err.message);
      }
      // 记录里的资产已经丢了，清掉指针再重生成
      try { await dbService.updateScore(score.id, { coverAssetId: null }, { touch: false }); } catch (err) {}
      score.coverAssetId = null;
    }

    if (!score.fileBlob) return null;
    const format = score.format || detectScoreFormat(score.name, score.fileBlob.type);
    if (format === SCORE_FORMAT.TEXT || !format) return null;

    try {
      const result = format === SCORE_FORMAT.PDF
        ? await renderPdfCover(score.fileBlob)
        : await renderImageCover(score.fileBlob);
      await persistCover(score, result);
      return result.blob;
    } catch (err) {
      console.warn('[封面] 生成失败:', score.name, err.message);
      return null;
    }
  })();

  pending.set(score.id, task);
  try {
    return await task;
  } finally {
    pending.delete(score.id);
  }
}
