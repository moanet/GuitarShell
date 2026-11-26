// ==========================================
// js/services/storage-stats.js
// 0.1.13 存储占用统计与缓存清理；0.1.14b 并入自定义背景资产
// 只算数与清理，不渲染 UI；封面可重建，自定义背景只删失去引用的副本，用户曲谱永不自动删
// ==========================================

import { dbService } from './db.js';
import { getActiveBackgroundAssetIds } from './share-bg.js';

const PERSIST_KEY = 'gs_storage_persist';
const ASSET_KIND_BACKGROUND = 'share-bg';

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit <= 1 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, '')} ${units[unit]}`;
}

export function formatBytesApprox(bytes) {
  return `约 ${formatBytes(bytes)}`;
}

async function readEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      return { usage: Number(est.usage) || 0, quota: Number(est.quota) || 0 };
    }
  } catch (err) {
    console.warn('[存储] estimate 不可用:', err.message);
  }
  return null;
}

/**
 * 汇总当前占用。不读 Blob 内容，只取 size / bytes 元数据。
 * exact=false 表示浏览器没给 estimate，总占用退化为曲谱 + 图片缓存。
 */
export async function collectStorageStats() {
  const [scores, assets, estimate] = await Promise.all([
    dbService.getAllScores(),
    dbService.getAllAssets(),
    readEstimate()
  ]);

  let scoreBytes = 0;
  scores.forEach((score) => {
    scoreBytes += Number(score && score.fileBlob && score.fileBlob.size) || 0;
  });

  const coverAssets = assets.filter((asset) => asset && asset.kind === 'cover');
  const coverBytes = coverAssets.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0);
  const backgroundAssets = assets.filter((asset) => asset && asset.kind === 'share-bg');
  const backgroundBytes = backgroundAssets.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0);
  const imageBytes = coverBytes + backgroundBytes;

  const exact = Boolean(estimate);
  return {
    scoreCount: scores.length,
    assetCount: assets.length,
    coverCount: coverAssets.length,
    scoreBytes,
    coverBytes,
    backgroundCount: backgroundAssets.length,
    backgroundBytes,
    imageCount: coverAssets.length + backgroundAssets.length,
    imageBytes,
    usage: exact ? estimate.usage : scoreBytes + imageBytes,
    quota: exact ? estimate.quota : 0,
    exact
  };
}

/** 申请持久存储；不阻塞、不弹错，结果只用于提示文案 */
export async function ensurePersistentStorage() {
  const cached = localStorage.getItem(PERSIST_KEY);
  if (cached === 'granted') return 'granted';
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      const granted = await navigator.storage.persist();
      if (granted) {
        localStorage.setItem(PERSIST_KEY, 'granted');
        return 'granted';
      }
      return 'denied';
    }
  } catch (err) {
    console.warn('[存储] persist 失败:', err.message);
    return 'unsupported';
  }
  return 'unsupported';
}

/** 删除全部封面缓存与乐谱指针；下次进书架按需重建 */
export async function clearCoverCache() {
  const result = await dbService.clearCoverAssets();
  return result;
}

/** 找出孤儿资产：失效封面、未被任一自定义槽位引用的背景、未知类型 */
export async function findOrphanAssets() {
  const [scores, assets] = await Promise.all([
    dbService.getAllScores(),
    dbService.getAllAssets()
  ]);
  const scoreMap = new Map(scores.map((score) => [score.id, score]));
  const activeBackgroundIds = new Set(getActiveBackgroundAssetIds().map((id) => Number(id)));
  return assets.filter((asset) => {
    if (!asset) return true;
    if (asset.kind === ASSET_KIND_BACKGROUND) {
      return activeBackgroundIds.size === 0 || !activeBackgroundIds.has(Number(asset.id));
    }
    if (asset.kind !== 'cover') return true;
    const owner = scoreMap.get(asset.scoreId);
    if (!owner) return true;
    return owner.coverAssetId !== asset.id;
  });
}

export async function clearOrphanAssets() {
  const orphans = await findOrphanAssets();
  const bytes = orphans.reduce((sum, asset) => sum + (Number(asset.bytes) || 0), 0);
  const count = await dbService.deleteAssetsByIds(orphans.map((asset) => asset.id));
  return { count, bytes };
}
