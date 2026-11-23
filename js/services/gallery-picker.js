const MAX_GALLERY_IMAGES = 20;

const getCapacitor = () => window.Capacitor;

export const isNativeGalleryAvailable = () => {
  const cap = getCapacitor();
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.GalleryPicker);
};

const asError = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * 调原生相册选择，拿到缓存路径后逐个转成 File。
 * 不返回 base64，避免大图穿过 Capacitor bridge；串行 fetch 防止 20 张同时占内存。
 */
export async function pickGalleryImages({ limit = MAX_GALLERY_IMAGES, onPicked } = {}) {
  const cap = getCapacitor();
  if (!isNativeGalleryAvailable()) throw asError('当前环境不支持原生相册', 'GALLERY_UNAVAILABLE');

  const max = Math.max(1, Math.min(Number(limit) || MAX_GALLERY_IMAGES, MAX_GALLERY_IMAGES));
  const result = await cap.Plugins.GalleryPicker.pickImages({ limit: max });
  if (typeof onPicked === 'function') onPicked(result);

  const infos = Array.isArray(result && result.files) ? result.files : [];
  let failed = Number(result && result.failed) || 0;
  let truncated = Math.max(0, infos.length - max);
  const files = [];

  for (const info of infos.slice(0, max)) {
    try {
      if (!info || !info.path) throw new Error('缺少缓存路径');
      const src = cap.convertFileSrc(info.path);
      const response = await fetch(src);
      if (!response.ok) throw new Error(`读取失败 (${response.status})`);
      const blob = await response.blob();
      const name = info.name || `image-${files.length + 1}.jpg`;
      const type = info.mimeType || blob.type || 'image/jpeg';
      files.push(new File([blob], name, { type, lastModified: Date.now() }));
    } catch (err) {
      failed++;
    }
  }

  if (files.length === 0) throw asError('照片读取失败，请重试', 'GALLERY_FETCH_FAILED');
  return { files, failed, truncated };
}

/** Web 回退时统一切前 20 张，并告诉调用方是否发生了截断。 */
export function takeGalleryFiles(fileList, limit = MAX_GALLERY_IMAGES) {
  const all = Array.from(fileList || []);
  const max = Math.max(1, Math.min(Number(limit) || MAX_GALLERY_IMAGES, MAX_GALLERY_IMAGES));
  return { files: all.slice(0, max), truncated: all.length > max };
}
