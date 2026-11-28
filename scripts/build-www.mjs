// 把零构建的 PWA 源文件收进 www/，供 Capacitor 打包
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const items = [
  'index.html',
  'manifest.json',
  'sw.js',
  'css',
  'js',
  'icon-gShell-32.png',
  'icon-gShell-192.png',
  'icon-gShell-512.png',
  'icon-gShell-light-32.png',
  'icon-gShell-light-192.png',
  'icon-gShell-light-512.png'
];

for (const item of items) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}

// dev 版本只写进打包副本，源文件始终保留空的 BUILD_STAMP
const buildStamp = process.env.GS_BUILD_STAMP || '';
const versionFile = join(out, 'js', 'services', 'version.js');
const versionText = readFileSync(versionFile, 'utf8');
const marker = "export const BUILD_STAMP = '';";
if (!versionText.includes(marker)) {
  throw new Error('version.js 缺少 BUILD_STAMP 注入标记');
}
writeFileSync(versionFile, versionText.replace(marker, `export const BUILD_STAMP = ${JSON.stringify(buildStamp)};`));

console.log(`www/ ready: ${items.join(', ')}`);
console.log(`BUILD_STAMP=${buildStamp || '(stable/empty)'}`);
