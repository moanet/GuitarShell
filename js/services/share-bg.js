// ==========================================
// js/services/share-bg.js
// 0.1.15 分享卡片第 7、8 套自定义背景：双槽位指针、选图、中心裁切、压缩、资产增删
// 两套自定义背景各自一张图、各自压暗值；内容只存本机 IndexedDB，不上传
// ==========================================

import { dbService } from './db.js';
import { pickGalleryImages } from './gallery-picker.js';

export const SHARE_BG_KEY = 'gs_share_bg';
export const SHARE_BG_ASSET_KEY = 'gs_share_bg_asset';
export const SHARE_BG_ASSET_2_KEY = 'gs_share_bg_asset_2';
export const SHARE_BG_DIM_KEY = 'gs_share_bg_dim';
export const SHARE_BG_DIM_2_KEY = 'gs_share_bg_dim_2';
export const CUSTOM_BG_ID = 'custom';
export const CUSTOM_BG_2_ID = 'custom2';
export const CUSTOM_BG_IDS = Object.freeze([CUSTOM_BG_ID, CUSTOM_BG_2_ID]);
export const DEFAULT_BG_ID = 'walnut';

export const BG_DIM_MIN = 0;
export const BG_DIM_MAX = 90;
export const BG_DIM_DEFAULT = 30;

export const BG_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const BG_STORED_MAX_BYTES = 900 * 1024;
export const BG_WIDTH = 1080;
export const BG_HEIGHT = 1920;

const QUALITY_STEPS = [0.82, 0.72, 0.62];
const ASSET_KIND = 'share-bg';

const asError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('[背景] 写入本地设置失败:', err.message);
  }
};

const removeStorage = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (err) {}
};

/** 当前背景 id；合法性由调用方结合预设列表判断 */
export function getSelectedBackground() {
  return readStorage(SHARE_BG_KEY) || DEFAULT_BG_ID;
}

export function setSelectedBackground(id) {
  writeStorage(SHARE_BG_KEY, String(id || DEFAULT_BG_ID));
}

export function isCustomBgId(id) {
  return CUSTOM_BG_IDS.includes(id);
}

const slotAssetKey = (slotId) => (
  slotId === CUSTOM_BG_2_ID ? SHARE_BG_ASSET_2_KEY : SHARE_BG_ASSET_KEY
);

const slotDimKey = (slotId) => (
  slotId === CUSTOM_BG_2_ID ? SHARE_BG_DIM_2_KEY : SHARE_BG_DIM_KEY
);

/** 指定自定义槽位在 assets 里的背景 id；非法值返回 null 并清指针 */
export function getActiveBackgroundAssetId(slotId = CUSTOM_BG_ID) {
  const key = slotAssetKey(slotId);
  const raw = readStorage(key);
  const id = Number(raw);
  if (!raw || !Number.isFinite(id) || id <= 0) {
    if (raw) removeStorage(key);
    return null;
  }
  return id;
}

/** 两套自定义背景当前引用的资产 id，供孤儿清理使用 */
export function getActiveBackgroundAssetIds() {
  return CUSTOM_BG_IDS
    .map((slotId) => getActiveBackgroundAssetId(slotId))
    .filter((id) => id !== null);
}

export function setActiveBackgroundAssetId(id, slotId = CUSTOM_BG_ID) {
  const key = slotAssetKey(slotId);
  const next = Number(id);
  if (!Number.isFinite(next) || next <= 0) {
    removeStorage(key);
    return;
  }
  writeStorage(key, String(next));
}

export function getBackgroundDim(slotId = CUSTOM_BG_ID) {
  const raw = readStorage(slotDimKey(slotId));
  if (raw === null || raw === '') return BG_DIM_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return BG_DIM_DEFAULT;
  return Math.max(BG_DIM_MIN, Math.min(BG_DIM_MAX, Math.round(n)));
}

export function setBackgroundDim(value, slotId = CUSTOM_BG_ID) {
  const n = Number(value);
  const next = Number.isFinite(n)
    ? Math.max(BG_DIM_MIN, Math.min(BG_DIM_MAX, Math.round(n)))
    : BG_DIM_DEFAULT;
  writeStorage(slotDimKey(slotId), String(next));
  return next;
}

/** 清掉指定自定义槽位指针；若当前正用该槽位，回退默认背景 */
export function clearActiveBackground({ slotId = CUSTOM_BG_ID, keepSelection = false } = {}) {
  removeStorage(slotAssetKey(slotId));
  if (!keepSelection && getSelectedBackground() === slotId) {
    setSelectedBackground(DEFAULT_BG_ID);
  }
}

export function clearCustomBackgroundState() {
  CUSTOM_BG_IDS.forEach((slotId) => {
    removeStorage(slotAssetKey(slotId));
    removeStorage(slotDimKey(slotId));
  });
  removeStorage(SHARE_BG_KEY);
}

function loadImageFromObjectUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(asError('图片解码失败，请换一张', 'BG_DECODE_FAILED'));
    };
    img.src = url;
  });
}

async function decodeSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    } catch (err) {
      // 部分 WebView 不支持 imageOrientation 或 HEIC，回退 Image
    }
  }
  const img = await loadImageFromObjectUrl(file);
  return { image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

/** 供裁切页使用；调用方负责在不用时释放 ImageBitmap */
export function decodeBackgroundSource(file) {
  return decodeSource(file);
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(asError('图片压缩失败，请重试', 'BG_COMPRESS_FAILED'));
    }, 'image/jpeg', quality);
  });
}

/** 把已经画好的 1080×1920 canvas 压成 ≤900 KB 的 JPEG */
export async function encodeBackgroundCanvas(canvas, sourceName = '') {
  let blob = null;
  for (const quality of QUALITY_STEPS) {
    blob = await canvasToJpeg(canvas, quality);
    if (blob.size <= BG_STORED_MAX_BYTES) break;
  }
  if (!blob || blob.size > BG_STORED_MAX_BYTES) {
    throw asError('图片压缩后仍超过 900 KB，请换一张', 'BG_TOO_LARGE');
  }
  return {
    blob,
    bytes: blob.size,
    width: BG_WIDTH,
    height: BG_HEIGHT,
    mime: 'image/jpeg',
    sourceName: String(sourceName || '').slice(0, 120)
  };
}

/**
 * 把用户图片中心裁成 9:16，压成 1080×1920 JPEG。
 * 这是没有进入裁切页时的自动回退；裁切页走 encodeBackgroundCanvas。
 */
export async function processCustomBackground(file) {
  if (!file) throw asError('没有拿到图片', 'BG_EMPTY');
  if (file.size > BG_SOURCE_MAX_BYTES) {
    throw asError('图片超过 20 MB，请换一张', 'BG_SOURCE_TOO_LARGE');
  }
  if (file.type && !String(file.type).startsWith('image/')) {
    throw asError('请选择图片文件', 'BG_NOT_IMAGE');
  }

  const source = await decodeSource(file);
  const sw = Number(source.width) || 0;
  const sh = Number(source.height) || 0;
  if (!sw || !sh) throw asError('图片尺寸无效，请换一张', 'BG_INVALID_SIZE');

  const targetRatio = BG_WIDTH / BG_HEIGHT;
  let cropW = sw;
  let cropH = sh;
  if (sw / sh > targetRatio) {
    cropW = sh * targetRatio;
  } else {
    cropH = sw / targetRatio;
  }
  const sx = (sw - cropW) / 2;
  const sy = (sh - cropH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = BG_WIDTH;
  canvas.height = BG_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw asError('图片处理不可用', 'BG_CANVAS_UNAVAILABLE');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BG_WIDTH, BG_HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.image, sx, sy, cropW, cropH, 0, 0, BG_WIDTH, BG_HEIGHT);

  const result = await encodeBackgroundCanvas(canvas, file.name);
  if (typeof source.image.close === 'function') source.image.close();
  return result;
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
      reject(asError('背景读取失败', 'BG_LOAD_FAILED'));
    };
    img.src = url;
  });
}

/** 读指定自定义槽位的资产；损坏或类型不符时清指针并返回 null */
export async function loadCustomBackground(slotId = CUSTOM_BG_ID) {
  const id = getActiveBackgroundAssetId(slotId);
  if (!id) return null;
  let asset = null;
  try {
    asset = await dbService.getAsset(id);
  } catch (err) {
    console.warn('[背景] 读取资产失败:', err.message);
    return null;
  }
  if (!asset || asset.kind !== ASSET_KIND || !(asset.blob instanceof Blob)) {
    clearActiveBackground({ slotId });
    return null;
  }
  try {
    const image = await loadImage(asset.blob);
    return { id, asset, image };
  } catch (err) {
    console.warn('[背景] 图片损坏:', err.message);
    clearActiveBackground({ slotId });
    return null;
  }
}

async function createAsset(processed) {
  return dbService.addAsset({
    kind: ASSET_KIND,
    blob: processed.blob,
    mime: processed.mime,
    width: processed.width,
    height: processed.height,
    bytes: processed.bytes,
    sourceName: processed.sourceName,
    createdAt: Date.now()
  });
}

/** 裁切页已经压好 1080×1920 JPEG，这里只负责落库和槽位指针 */
export async function saveCustomBackgroundAsset(processed, slotId = CUSTOM_BG_ID) {
  if (!processed || !(processed.blob instanceof Blob)) {
    throw asError('没有可保存的图片', 'BG_EMPTY');
  }
  const previousId = getActiveBackgroundAssetId(slotId);
  const assetId = await createAsset(processed);
  setActiveBackgroundAssetId(assetId, slotId);
  setSelectedBackground(slotId);
  if (previousId && previousId !== assetId) {
    try {
      await dbService.deleteAsset(previousId);
    } catch (err) {
      console.warn('[背景] 旧背景删除失败，留待清理:', err.message);
    }
  }
  const image = await loadImage(processed.blob);
  return {
    id: assetId,
    asset: { ...processed, id: assetId, kind: ASSET_KIND },
    image
  };
}

/** 自动中心裁切并保存；没有裁切页时的回退入口 */
export async function saveCustomBackground(file, slotId = CUSTOM_BG_ID) {
  const processed = await processCustomBackground(file);
  return saveCustomBackgroundAsset(processed, slotId);
}

/** 只清指定槽位指针并回退；删除失败也不阻断界面回退 */
export async function removeCustomBackground(slotId = CUSTOM_BG_ID) {
  const id = getActiveBackgroundAssetId(slotId);
  clearActiveBackground({ slotId });
  if (!id) return { id: null, deleted: true };
  try {
    await dbService.deleteAsset(id);
    return { id, deleted: true };
  } catch (err) {
    console.warn('[背景] 删除失败，留待清理:', err.message);
    return { id, deleted: false };
  }
}

/** 原生相册选 1 张；网页回退由调用方给 File。取消抛 PICK_CANCELLED */
export async function pickCustomBackgroundFile() {
  const result = await pickGalleryImages({ limit: 1 });
  return (result.files && result.files[0]) || null;
}
