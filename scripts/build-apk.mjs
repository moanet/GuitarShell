// ==========================================
// scripts/build-apk.mjs
// 构建 APK 前自动定位可用 JDK，避免终端缺少 JAVA_HOME 时误用不兼容版本
// 用法：node scripts/build-apk.mjs [debug|--check]
// ==========================================
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const debug = args.includes('debug');
const checkOnly = args.includes('--check');

function javaVersion(javaExe) {
  const out = spawnSync(javaExe, ['-version'], { encoding: 'utf8' });
  const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
  const m = text.match(/version\s+"(?:1\.)?(\d+)/);
  return m ? Number(m[1]) : null;
}

function validJdk(dir) {
  if (!dir || !existsSync(dir)) return null;
  const javaExe = join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(javaExe)) return null;
  const major = javaVersion(javaExe);
  if (!major || major < 17 || major > 21) return null;
  return { home: dir, major };
}

function candidates() {
  const list = [process.env.JAVA_HOME];
  const jdksDir = join(homedir(), '.jdks');
  list.push(join(jdksDir, 'jbr-21.0.11'));
  if (existsSync(jdksDir)) {
    const names = readdirSync(jdksDir)
      .filter((name) => /21/.test(name))
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const name of names) {
      const dir = join(jdksDir, name);
      if (statSync(dir).isDirectory()) list.push(dir);
    }
  }
  return list.filter(Boolean);
}

const jdk = candidates().map(validJdk).find(Boolean);
if (!jdk) {
  console.error('未找到可用 JDK（需要 17–21，推荐 21）。');
  console.error('请安装 JDK 21，或设置用户环境变量 JAVA_HOME 指向 JDK 21。');
  process.exit(1);
}

const env = {
  ...process.env,
  JAVA_HOME: jdk.home,
  PATH: `${join(jdk.home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
};

console.log(`使用 JDK ${jdk.major}: ${jdk.home}`);
if (checkOnly) process.exit(0);

const isWin = process.platform === 'win32';
const runNode = (script, scriptArgs, cwd) => spawnSync(process.execPath, [script, ...scriptArgs], { cwd, env, stdio: 'inherit' });

const www = runNode(join(root, 'scripts', 'build-www.mjs'), [], root);
if (www.status !== 0) process.exit(www.status ?? 1);

const cap = runNode(
  join(root, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'),
  ['sync', 'android'],
  root,
);
if (cap.status !== 0) process.exit(cap.status ?? 1);

const task = debug ? 'assembleDebug' : 'assembleRelease';
const cmd = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
const gradle = isWin
  ? spawnSync(cmd, ['/d', '/s', '/c', `gradlew.bat ${task}`], { cwd: join(root, 'android'), env, stdio: 'inherit' })
  : spawnSync('./gradlew', [task], { cwd: join(root, 'android'), env, stdio: 'inherit' });
process.exit(gradle.status ?? 1);
