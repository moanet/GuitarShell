// ==========================================
// js/services/file-hash.js
// 作用：计算乐谱文件的内容哈希，用于导入去重
//
// 优先使用 Web Crypto 的 SHA-256；非安全上下文 / 老 WebView 不支持时，
// 回退到 FNV-1a 64。哈希带算法前缀，避免两种算法结果被误判为相同。
// FNV-1a 只用于本机判重，不作为安全校验。
// ==========================================

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

function toHex(bytes) {
  const table = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += table[(b >>> 4) & 15] + table[b & 15];
  }
  return out;
}

function fnv1a64(bytes) {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * 计算 Blob / File 的内容哈希。
 * @param {Blob} blob
 * @returns {Promise<string>} `sha256:<hex>` 或 `fnv1a64:<hex>`
 */
export async function hashBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') {
    throw new Error('无法读取文件内容');
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return `sha256:${toHex(new Uint8Array(digest))}`;
    }
  } catch (err) {
    console.warn('[文件哈希] SHA-256 不可用，回退 FNV-1a:', err.message);
  }

  return `fnv1a64:${fnv1a64(bytes)}`;
}

export function hasHash(value) {
  return typeof value === 'string' && /^(sha256|fnv1a64):[0-9a-f]+$/.test(value);
}
