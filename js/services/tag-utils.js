// ==========================================
// js/services/tag-utils.js
// 标签解析 / 去重 / 切换 / 频率统计
// 纯函数，便于书架与批量操作复用
// ==========================================

const keyOf = (tag) => String(tag ?? '').trim().toLowerCase();

export function parseTagInput(value) {
  return uniqueTags(String(value ?? '').split(/[,，]/));
}

export function uniqueTags(tags) {
  const out = [];
  const seen = new Set();
  (Array.isArray(tags) ? tags : []).forEach((raw) => {
    const tag = String(raw ?? '').trim();
    const key = keyOf(tag);
    if (!tag || seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  });
  return out;
}

export function hasTag(tags, tag) {
  const key = keyOf(tag);
  return !!key && uniqueTags(tags).some((item) => keyOf(item) === key);
}

export function toggleTag(tags, tag) {
  const target = String(tag ?? '').trim();
  if (!target) return uniqueTags(tags);
  const key = keyOf(target);
  const current = uniqueTags(tags);
  if (current.some((item) => keyOf(item) === key)) {
    return current.filter((item) => keyOf(item) !== key);
  }
  return current.concat(target);
}

export function applyTagChanges(tags, changes, mode = 'add') {
  let result = uniqueTags(tags);
  const list = uniqueTags(changes);
  if (mode === 'remove') {
    const removeKeys = new Set(list.map(keyOf));
    return result.filter((item) => !removeKeys.has(keyOf(item)));
  }
  list.forEach((tag) => {
    if (!hasTag(result, tag)) result.push(tag);
  });
  return result;
}

export function collectTagStats(scores) {
  const counts = new Map();
  (Array.isArray(scores) ? scores : []).forEach((score) => {
    uniqueTags(score?.tags).forEach((tag) => {
      const key = keyOf(tag);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { tag, count: 1 });
    });
  });
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'))
    .map(({ tag, count }) => ({ tag, count }));
}

export function collectTagsForScores(scores, ids) {
  const wanted = new Set((ids || []).map(String));
  const tags = [];
  (Array.isArray(scores) ? scores : []).forEach((score) => {
    if (!wanted.has(String(score?.id))) return;
    uniqueTags(score.tags).forEach((tag) => {
      if (!hasTag(tags, tag)) tags.push(tag);
    });
  });
  return tags;
}
