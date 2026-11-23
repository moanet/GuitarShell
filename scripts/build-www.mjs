// 把零构建的 PWA 源文件收进 www/，供 Capacitor 打包
import { cpSync, mkdirSync, rmSync } from 'node:fs';
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

console.log(`www/ ready: ${items.join(', ')}`);
