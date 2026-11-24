// ==========================================
// js/services/quotes.js
// 60 条练习卡片格言（0.1.14a，内容批次 2026-11-24）
// 卡面只画 text；author / source 只留在数据层，不上卡面
// 抽取：本地日期 FNV-1a 32bit，同一天稳定
// ==========================================

export const QUOTES = [
  { id: 'q001', text: '千里之行，始于足下。', lang: 'zh', author: '老子', source: '《道德经》' },
  { id: 'q002', text: '操千曲而后晓声。', lang: 'zh', author: '刘勰', source: '《文心雕龙·知音》' },
  { id: 'q003', text: '无听之以耳而听之以心。', lang: 'zh', author: '庄子', source: '《庄子·人间世》' },
  { id: 'q004', text: '锲而不舍，金石可镂。', lang: 'zh', author: '荀子', source: '《荀子·劝学》' },
  { id: 'q005', text: '欲速则不达。', lang: 'zh', author: '孔子', source: '《论语·子路》' },
  { id: 'q006', text: '慎终如始，则无败事。', lang: 'zh', author: '老子', source: '《道德经》' },
  { id: 'q007', text: '不怕慢，只怕站。', lang: 'zh', author: '佚名', source: '谚语' },
  { id: 'q008', text: '慢工出细活。', lang: 'zh', author: '佚名', source: '谚语' },
  { id: 'q009', text: '蜗牛不赶路，但它一直在走。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q010', text: '壳是一圈一圈长出来的，手感也是。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q011', text: '琴弦不会说谎，你练过的它都记得。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q012', text: '茧是练琴留下的年轮。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q013', text: '先让弦响，再让弦唱。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q014', text: '余音停在哪里，耳朵要跟到哪里。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q015', text: '今天只改一个毛病。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q016', text: 'Slow is a direction, not a failure.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q017', text: 'One turn of the shell at a time.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q018', text: 'The snail does not rush; it still arrives.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q019', text: 'Let the string ring.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q020', text: 'Where words fail, music speaks.', lang: 'en', author: 'Hans Christian Andersen', source: 'Public domain' },
  { id: 'q021', text: 'If music be the food of love, play on.', lang: 'en', author: 'William Shakespeare', source: 'Twelfth Night' },
  { id: 'q022', text: '大音希声，大象无形。', lang: 'zh', author: '老子', source: '《道德经》第四十一章' },
  { id: 'q023', text: '泠泠七弦上，静听松风寒。', lang: 'zh', author: '刘长卿', source: '《听弹琴》' },
  { id: 'q024', text: '独坐幽篁里，弹琴复长啸。', lang: 'zh', author: '王维', source: '《竹里馆》' },
  { id: 'q025', text: '若言琴上有琴声，放在匣中何不鸣？', lang: 'zh', author: '苏轼', source: '《琴诗》' },
  { id: 'q026', text: '众器之中，琴德最优。', lang: 'zh', author: '嵇康', source: '《琴赋》' },
  { id: 'q027', text: '诗言志，歌永言，声依永，律和声。', lang: 'zh', author: '佚名', source: '《尚书·舜典》' },
  { id: 'q028', text: 'Such harmony is in immortal souls.', lang: 'en', author: 'William Shakespeare', source: 'The Merchant of Venice' },
  { id: 'q029', text: 'Wood, wire, and patience.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q030', text: '手指记住的，比脑子记住的久。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q031', text: '声音是从木头里长出来的，不是用力气逼出来的。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q032', text: '琴不催你，它只等你把手放稳。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q033', text: '跬步而不休，跛鳖千里。', lang: 'zh', author: '荀子', source: '《荀子·修身》' },
  { id: 'q034', text: '合抱之木，生于毫末。', lang: 'zh', author: '老子', source: '《道德经》第六十四章' },
  { id: 'q035', text: '不积跬步，无以至千里。', lang: 'zh', author: '荀子', source: '《荀子·劝学》' },
  { id: 'q036', text: 'Slow and steady wins the race.', lang: 'en', author: 'English proverb', source: 'Proverb' },
  { id: 'q037', text: '慢不是停下来，是把每一步踩实。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q038', text: '一天一圈，壳就这么长成了。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q039', text: '不催自己，只往前挪一点。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q040', text: '伯牙善鼓琴，钟子期善听。', lang: 'zh', author: '佚名', source: '《列子·汤问》' },
  { id: 'q041', text: '凡音之起，由人心生也。', lang: 'zh', author: '佚名', source: '《礼记·乐记》' },
  { id: 'q042', text: '心不在焉，视而不见，听而不闻。', lang: 'zh', author: '佚名', source: '《礼记·大学》' },
  { id: 'q043', text: 'Music, when soft voices die, vibrates in the memory.', lang: 'en', author: 'Percy Bysshe Shelley', source: 'Music, When Soft Voices Die' },
  { id: 'q044', text: 'Listen twice, play once.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q045', text: 'The ear learns faster than the hand.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q046', text: '先把节奏听对，再把手放上去。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q047', text: '弹错了不要紧，先听清错在哪。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q048', text: '练琴不是把曲子过一遍，是把耳朵练尖。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q049', text: '吾日三省吾身。', lang: 'zh', author: '曾子', source: '《论语·学而》' },
  { id: 'q050', text: '不迁怒，不贰过。', lang: 'zh', author: '孔子', source: '《论语·雍也》' },
  { id: 'q051', text: '非淡泊无以明志，非宁静无以致远。', lang: 'zh', author: '诸葛亮', source: '《诫子书》' },
  { id: 'q052', text: '业精于勤，荒于嬉。', lang: 'zh', author: '韩愈', source: '《进学解》' },
  { id: 'q053', text: 'To thine own self be true.', lang: 'en', author: 'William Shakespeare', source: 'Hamlet' },
  { id: 'q054', text: 'One clean note is enough for today.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q055', text: 'Do less, but do it again tomorrow.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q056', text: 'A little, every day, becomes a lot.', lang: 'en', author: 'GuitarShell', source: 'Original' },
  { id: 'q057', text: '状态会坏，日课照旧。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q058', text: '手感是借来的，得每天还回去。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q059', text: '不求今天更快，只求今天更准。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
  { id: 'q060', text: '练完把壳合上，明天再打开。', lang: 'zh', author: 'GuitarShell', source: '自拟' },
];

function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// FNV-1a 32-bit：同一天固定，跨日期变化
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 同一天反复打开不跳句；池里所有条目都参与抽取 */
export function pickQuote(date = new Date(), quotes = QUOTES) {
  const pool = (Array.isArray(quotes) ? quotes : []).filter((quote) => quote && quote.text);
  if (!pool.length) return null;
  const index = hashText(`gs-quote-v1-${dayKey(date)}`) % pool.length;
  return pool[index];
}
