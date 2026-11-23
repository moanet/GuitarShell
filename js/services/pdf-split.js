// ==========================================
// js/services/pdf-split.js
// 按页段从原 PDF 复制页面，生成一份完全独立的新 PDF。
//
// 设计约束：
//   - 新文件自带页面内容，不引用原谱记录或原文件 Blob。
//   - 原谱保留，删除任一方不影响另一方。
//   - pdf-lib 只在用户点击拆分时动态加载，避免进入首屏执行路径。
// ==========================================

let pdfLibPromise = null;

function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import('../lib/pdf-lib.esm.min.js');
  return pdfLibPromise;
}

function parsePage(value, total, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > total) {
    throw new Error(`${label}必须是 1–${total} 之间的整数`);
  }
  return n;
}

export async function splitPdfPages(fileBlob, startPage, endPage, title = '') {
  if (!fileBlob) throw new Error('找不到原 PDF 文件');

  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();
  const start = parsePage(startPage, total, '起始页');
  const end = parsePage(endPage, total, '结束页');
  if (start > end) throw new Error('起始页不能大于结束页');

  const pageIndexes = [];
  for (let page = start; page <= end; page++) pageIndexes.push(page - 1);

  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, pageIndexes);
  copied.forEach((page) => output.addPage(page));

  if (title) output.setTitle(String(title));
  output.setProducer('GuitarShell');
  output.setCreator('GuitarShell');

  const outBytes = await output.save();
  const blob = new Blob([outBytes], { type: 'application/pdf' });
  return { blob, pageCount: pageIndexes.length, byteLength: blob.size, sourcePages: total };
}
