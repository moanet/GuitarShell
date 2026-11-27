// ==========================================
// scripts/build-apk.mjs
// 构建 APK；dev 模式自动生成不占稳定版本号的开发包
// 用法：node scripts/build-apk.mjs [dev|debug|--check]
// ==========================================
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const debug = args.includes('debug');
const dev = args.includes('dev');
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

const gradleFile = join(root, 'android', 'app', 'build.gradle');
const gradleText = readFileSync(gradleFile, 'utf8');
const baseNameMatch = gradleText.match(/def baseVersionName\s*=\s*"([^"]+)"/);
const baseCodeMatch = gradleText.match(/def baseVersionCode\s*=\s*(\d+)/);
if (!baseNameMatch || !baseCodeMatch) {
  console.error('无法从 android/app/build.gradle 读取 baseVersionName / baseVersionCode。');
  process.exit(1);
}
const baseVersionName = baseNameMatch[1];
const baseVersionCode = baseCodeMatch[1];

const git = (gitArgs) => spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
const gitHashResult = git(['rev-parse', '--short=7', 'HEAD']);
const gitHash = gitHashResult.status === 0 ? gitHashResult.stdout.trim() : 'nogit';
const gitStatusResult = git(['status', '--porcelain']);
const dirty = gitStatusResult.status !== 0 || gitStatusResult.stdout.trim().length > 0;

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const devVersionName = `${baseVersionName}-dev.${stamp}`;
const devFileName = `GuitarShell-dev-${stamp}-${gitHash}${dirty ? '-dirty' : ''}.apk`;

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
const gradleArgs = [task];
if (dev) {
  gradleArgs.push(`-PgsDevVersionName=${devVersionName}`, `-PgsDevVersionCode=${baseVersionCode}`);
  console.log(`dev 构建：${devVersionName} / versionCode ${baseVersionCode}${dirty ? ' / dirty' : ''}`);
}

const cmd = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
const gradle = isWin
  ? spawnSync(cmd, ['/d', '/s', '/c', `gradlew.bat ${gradleArgs.join(' ')}`], { cwd: join(root, 'android'), env, stdio: 'inherit' })
  : spawnSync('./gradlew', gradleArgs, { cwd: join(root, 'android'), env, stdio: 'inherit' });
if ((gradle.status ?? 1) !== 0) process.exit(gradle.status ?? 1);

if (!debug) {
  const built = join(
    root,
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'app-release.apk',
  );
  const outDir = dev ? join(root, 'dist', 'dev') : join(root, 'dist');
  const outName = dev ? devFileName : `GuitarShell-${baseVersionName}.apk`;
  const outPath = join(outDir, outName);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(built, outPath);
  console.log(`APK 已输出：${outPath}`);
}
