// ==========================================
// js/services/score-dedup.js
// 作用：乐谱导入判重
//
// 判重顺序：
//   1. 两边都有内容哈希 → 只认哈希；
//   2. 旧记录没有哈希 → 名称 + 大小兼容回退；
//   3. 同尺寸旧记录 → 惰性计算哈希并回填，再参与判重。
// 只扫描同尺寸候选，不把所有乐谱 Blob 读一遍。
// ==========================================

import { hashBlob } from './file-hash.js';
import { dbService } from './db.js';

const defaultBackfill = (score, fileHash) => {
  if (score.id === undefined || score.id === null) return Promise.resolve();
  return dbService.updateScore(score.id, { fileHash }, { touch: false });
};

/**
 * @param {Array} existingScores 现有乐谱记录
 * @param {File|Blob} file 待导入文件
 * @param {string} fileHash 待导入文件的内容哈希；为空表示哈希失败
 * @param {{ hashFn?: Function, backfill?: Function }} options 测试注入
 * @returns {Promise<Object|null>} 命中的重复记录，否则 null
 */
export async function findDuplicateScore(existingScores, file, fileHash, options = {}) {
  const hashFn = options.hashFn || hashBlob;
  const backfill = options.backfill || defaultBackfill;

  for (const existing of existingScores) {
    if (!existing.fileBlob) continue;
    if (fileHash && existing.fileHash) {
      if (existing.fileHash === fileHash) return existing;
      continue;
    }
    // 旧记录没有哈希时，保留「名称 + 大小」的兼容回退
    if (existing.name === file.name && existing.fileBlob.size === file.size) return existing;
  }

  if (!fileHash) return null;

  const legacyCandidates = existingScores.filter((existing) => (
    existing.fileBlob && !existing.fileHash && existing.fileBlob.size === file.size
  ));
  for (const existing of legacyCandidates) {
    try {
      const existingHash = await hashFn(existing.fileBlob);
      existing.fileHash = existingHash;
      await backfill(existing, existingHash);
      if (existingHash === fileHash) return existing;
    } catch (err) {
      console.warn('[导入] 旧乐谱哈希回填失败:', existing.name, err.message);
    }
  }
  return null;
}
