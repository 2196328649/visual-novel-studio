import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { nativeBuildWorkspace, runNativeCompiler } from './lib/native-build-workspace.mjs';

// Native support libraries only; this does not export a game or build APKs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ndk = process.argv[2] || process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_ROOT;
if (!ndk) throw new Error('请提供 Android NDK 目录：node scripts/build-spine-android.mjs <NDK 路径>。');
const host = { win32: 'windows-x86_64', linux: 'linux-x86_64', darwin: 'darwin-x86_64' }[process.platform];
if (!host) throw new Error('当前系统没有受支持的 Android NDK 工具链。');
const clang = path.resolve(ndk, 'toolchains/llvm/prebuilt', host, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang'); await fs.access(clang);
const sourceDirectory = path.join(root, 'vendor/spine-c/src/spine');
const sources = (await fs.readdir(sourceDirectory)).filter(name => name.endsWith('.c')).sort().map(name => path.join(sourceDirectory, name));
const architectures = { 'armeabi-v7a': 'armv7a-linux-androideabi21', 'arm64-v8a': 'aarch64-linux-android21', x86_64: 'x86_64-linux-android21' };
const build = await nativeBuildWorkspace(root, 'spine-android-build'), files = {};
try {
  for (const [abi, target] of Object.entries(architectures)) {
    const staged = path.join(build.work, abi, 'libvns_spine.so'); await fs.mkdir(path.dirname(staged), { recursive: true });
    const args = [`--target=${target}`, '-O2', '-shared', '-fPIC', '-fvisibility=hidden', '-std=c11', '-I', path.join(root, 'vendor/spine-c/include'), path.join(root, 'native/spine/vns_spine.c'), ...sources, '-lm', '-Wl,-z,max-page-size=16384', '-Wl,-soname,libvns_spine.so', '-o', staged];
    await runNativeCompiler(clang, args, build, abi); files[abi] = createHash('sha256').update(await fs.readFile(staged)).digest('hex');
  }
  // Do not replace any bundled architecture if one of the builds failed.
  for (const abi of Object.keys(architectures)) {
    const destination = path.join(root, 'resources/spine/android', abi, 'libvns_spine.so'); await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(build.work, abi, 'libvns_spine.so'), destination);
  }
  await fs.copyFile(path.join(root, 'vendor/spine-c/LICENSE'), path.join(root, 'resources/spine/LICENSE-Spine.txt'));
  const manifest = JSON.stringify({ abi: 2, minimumApi: 21, alignment: 16384, upstream: JSON.parse(await fs.readFile(path.join(root, 'vendor/spine-c/UPSTREAM.json'), 'utf8')), files }, null, 2) + '\n';
  await fs.writeFile(path.join(root, 'resources/spine/android/build.json'), manifest); await fs.writeFile(path.join(build.report, 'build.json'), manifest);
  console.log('Android Spine 运行库已全部生成：' + Object.keys(architectures).join('、'));
} finally { await build.cleanup(); }