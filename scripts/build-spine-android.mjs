import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// Build native support libraries only; this does not export a game or build APKs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ndk = process.argv[2] || process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
if (!ndk) throw new Error('请提供 Android NDK 目录：node scripts/build-spine-android.mjs <NDK 路径>。建议使用 NDK r28 或更新版本。');
const host = { win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' }[process.platform];
if (!host) throw new Error('当前系统没有受支持的 Android NDK 工具链。');
const clang = path.resolve(ndk, 'toolchains/llvm/prebuilt', host, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang');
await fs.access(clang);
const sourceDirectory = path.join(root, 'vendor/spine-c/src/spine');
const sources = (await fs.readdir(sourceDirectory)).filter(name => name.endsWith('.c')).sort().map(name => path.join(sourceDirectory, name));
const architectures = { 'armeabi-v7a': 'armv7a-linux-androideabi21', 'arm64-v8a': 'aarch64-linux-android21', x86_64: 'x86_64-linux-android21' };
const files = {};
for (const [abi, target] of Object.entries(architectures)) {
  const destination = path.join(root, 'resources/spine/android', abi, 'libvns_spine.so');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const args = [`--target=${target}`, '-O2', '-shared', '-fPIC', '-fvisibility=hidden', '-std=c11', '-I', path.join(root, 'vendor/spine-c/include'), path.join(root, 'native/spine/vns_spine.c'), ...sources, '-lm', '-Wl,-z,max-page-size=16384', '-Wl,-soname,libvns_spine.so', '-o', destination];
  await new Promise((resolve, reject) => {
    const child = spawn(clang, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`${abi} 编译失败：${code}`)));
  });
  files[abi] = createHash('sha256').update(await fs.readFile(destination)).digest('hex');
  console.log(`Android Spine 运行库已生成：${abi}`);
}
await fs.copyFile(path.join(root, 'vendor/spine-c/LICENSE'), path.join(root, 'resources/spine/LICENSE-Spine.txt'));
await fs.writeFile(path.join(root, 'resources/spine/android/build.json'), JSON.stringify({ abi: 1, minimumApi: 21, alignment: 16384, upstream: JSON.parse(await fs.readFile(path.join(root, 'vendor/spine-c/UPSTREAM.json'), 'utf8')), files }, null, 2) + '\n');
