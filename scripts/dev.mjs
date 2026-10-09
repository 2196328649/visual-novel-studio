import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const logFile = path.join(root, 'artifacts', 'dev-launcher.log');
let server;
let child;
let logReady = false;
const output = (data, error = false) => {
  (error ? process.stderr : process.stdout).write(data);
  if (logReady) appendFileSync(logFile, data);
};
const stop = () => child?.kill();
function newestChange(file) {
  try {
    const info = statSync(file);
    return info.isDirectory() ? Math.max(info.mtimeMs, ...readdirSync(file).map(name => newestChange(path.join(file, name)))) : info.mtimeMs;
  } catch { return 0; }
}

try {
  process.chdir(root);
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `启动时间：${new Date().toISOString()}\n`);
  logReady = true;
  output(`运行环境：${process.execPath} (${process.version})\n`);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('开发版需要 Node.js 22.12 或更新版本。');

  output('正在准备桌面开发版，不生成安装包…\n');
  await import('./build-desktop.mjs');
  const { build, createServer } = await import('vite');
  const { default: electron } = await import('electron');
  const env = { ...process.env };
  if (process.argv.includes('--hot')) {
    server = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: false } });
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('开发服务没有取得可用端口。');
    env.VNS_DEV_URL = `http://127.0.0.1:${address.port}`;
    output(`热更新调试界面：${env.VNS_DEV_URL}\n`);
  } else {
    // Authors test the same renderer as a regular build. React's per-element
    // development traces are costly in large inspectors; --hot keeps them for coding.
    const sources = ['src', 'public', 'index.html', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts'];
    const newestSource = Math.max(...sources.map(file => newestChange(path.join(root, file))));
    if (newestChange(path.join(root, 'dist/index.html')) <= newestSource) {
      output('正在编译编辑器界面，不打包游戏…\n');
      await build({ root, build: { minify: false } });
    } else output('使用已更新的本地界面。\n');
    delete env.VNS_DEV_URL;
  }
  output('正在打开编辑器窗口…\n');
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, [root], { cwd: root, env, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', data => output(data));
  child.stderr.on('data', data => output(data, true));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      if (signal) reject(new Error(`编辑器进程已被 ${signal} 中断。`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`编辑器退出，错误码 ${code}。`);
  output('编辑器已关闭。\n');
} catch (error) {
  output(`启动失败：${error instanceof Error ? error.stack : String(error)}\n`, true);
  if (logReady) output(`启动记录：${logFile}\n`, true);
  process.exitCode = 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  await server?.close();
}
