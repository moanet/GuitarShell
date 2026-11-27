// ==========================================
// scripts/check.mjs
// 发布前静态检查：版本同步、JS 语法、静态 import、SW 缓存、原生弹窗
// 用法：npm run check
// ==========================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const fail = (msg) => failures.push(msg);

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function walkJs(dirRel) {
  // 制谱引擎原型是本地实验区，不进 SW 缓存，也不参与发行检查
  if (dirRel === 'js/sheet' || dirRel.startsWith('js/sheet/')) return [];
  const abs = join(root, dirRel);
  const out = [];
  for (const name of readdirSync(abs)) {
    const rel = `${dirRel}/${name}`;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) out.push(...walkJs(rel));
    else if (name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const packageVersion = JSON.parse(read('package.json')).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  fail(`package.json=${packageVersion} 不是合法 semver`);
}
const displayVersion = packageVersion.replace(/-([0-9A-Za-z]+)$/, '$1');
const versionJs = read('js/services/version.js').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const swVersion = read('sw.js').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const gradleVersion = read('android/app/build.gradle').match(/def baseVersionName\s*=\s*["']([^"']+)["']/);

if (!versionJs) fail('js/services/version.js 找不到 APP_VERSION');
else if (versionJs[1] !== displayVersion) fail(`version.js=${versionJs[1]}，展示版本=${displayVersion}`);
if (!swVersion) fail('sw.js 找不到 APP_VERSION');
else if (swVersion[1] !== displayVersion) fail(`sw.js=${swVersion[1]}，展示版本=${displayVersion}`);
if (!gradleVersion) fail('build.gradle 找不到 baseVersionName');
else if (gradleVersion[1] !== displayVersion) fail(`build.gradle=${gradleVersion[1]}，展示版本=${displayVersion}`);

const readme = read('README.md');
if (!readme.includes(`version-${displayVersion}-`)) fail(`README 版本徽标不是 ${displayVersion}`);

const sw = read('sw.js');
const jsFiles = walkJs('js');
for (const rel of jsFiles) {
  const abs = join(root, rel);
  const src = read(rel);

  const syntax = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (syntax.status !== 0) fail(`语法错误：${rel}\n${syntax.stderr.trim()}`);

  const importRe = /(?:from|import)\s*['"](\.[^'"]+\.js)['"]/g;
  for (const m of src.matchAll(importRe)) {
    const target = relative(root, join(root, rel, '..', m[1])).replaceAll('\\', '/');
    try { statSync(join(root, target)); } catch { fail(`${rel} 的静态 import 不存在：${m[1]}`); }
  }

  if (/^\s*(?:window\.)?(?:confirm|alert)\s*\(/m.test(src)) {
    fail(`${rel} 仍直接调用原生 confirm() / alert()`);
  }

  const swPath = `'./${rel}'`;
  if (!sw.includes(swPath)) fail(`sw.js 缓存清单缺少 ${rel}`);
}

if (failures.length) {
  console.error('检查失败：');
  failures.forEach((msg) => console.error(`- ${msg}`));
  process.exit(1);
}

console.log(`检查通过：v${displayVersion}，${jsFiles.length} 个 JS 文件，SW 缓存与版本一致。`);
