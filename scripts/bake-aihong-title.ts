/** Historical offline comparison experiment, retained for its earlier evidence.
 * Current templates import the original atlas and skeleton into the real-time
 * Spine component; this script is not part of authoring, preview or export. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'artifacts/aihong-spine');
const output = path.join(folder, 'rendered');
const width = 1920, height = 1080, fps = 30;
await fs.mkdir(output, { recursive: true });
const source = JSON.parse(await fs.readFile(path.join(folder, 'source.json'), 'utf8'));
const scale = source.rectangle.m_LocalScale.x;
const manifest = JSON.parse(await fs.readFile(path.join(root, 'artifacts/aihong-ui-assets/manifest.json'), 'utf8'));
const background = manifest.assets.find((asset: any) => asset.name === '封面');
if (!background) throw new Error('Missing the original static title background.');
const routes: Record<string, string> = {
  '/spine.js': path.join(root, 'node_modules/@esotericsoftware/spine-webgl/dist/iife/spine-webgl.js'),
  '/skeleton.json': path.join(folder, 'skeleton.json'), '/skeleton.atlas': path.join(folder, 'skeleton.atlas'), '/1.png': path.join(folder, '1.png'),
  '/background.png': path.join(root, 'artifacts/aihong-ui-assets', background.path),
};
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style><canvas id="animation" width="${width}" height="${height}"></canvas><script src="/spine.js"></script><script>
const canvas = document.getElementById('animation');
const gl = canvas.getContext('webgl', {alpha: false, antialias: true, preserveDrawingBuffer: true});
if (!gl) throw new Error('WebGL is required by this offline converter.');
const renderer = new spine.SceneRenderer(canvas, gl);
renderer.camera.position.set(${width / 2}, ${height / 2}, 0);
renderer.camera.setViewport(${width}, ${height});
renderer.camera.update();
const assets = new spine.AssetManager(gl);
assets.loadTextureAtlas('/skeleton.atlas'); assets.loadJson('/skeleton.json'); assets.loadTexture('/background.png');
window.converterError = null;
function initialize() {
 if (assets.hasErrors()) { window.converterError = JSON.stringify(assets.getErrors()); return; }
 if (!assets.isLoadingComplete()) { requestAnimationFrame(initialize); return; }
 const reader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(assets.get('/skeleton.atlas')));
 const data = reader.readSkeletonData(assets.get('/skeleton.json'));
 const skeleton = new spine.Skeleton(data);
 skeleton.x = ${width / 2}; skeleton.y = ${source.rectangle.m_AnchoredPosition.y};
 skeleton.scaleX = ${scale}; skeleton.scaleY = ${scale};
 const state = new spine.AnimationState(new spine.AnimationStateData(data));
 const entry = state.setAnimation(0, 'idle', true);
 window.animationDuration = entry.animation.duration;
 window.drawAnimationFrame = (delta) => {
  state.update(delta); state.apply(skeleton); skeleton.update(delta); skeleton.updateWorldTransform(spine.Physics.update);
  gl.viewport(0, 0, ${width}, ${height}); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  renderer.begin(); renderer.drawTexture(assets.get('/background.png'), 0, 0, ${width}, ${height}); renderer.drawSkeleton(skeleton, true); renderer.end();
  return canvas.toDataURL('image/png').split(',')[1];
 };
 window.converterReady = true;
}
initialize();
</script>`;
const server = createServer(async (request, response) => {
  try {
    const route = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (route === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
    const file = routes[route];
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', route.endsWith('.png') ? 'image/png' : route.endsWith('.js') ? 'text/javascript' : route.endsWith('.json') ? 'application/json' : 'text/plain');
    response.end(await fs.readFile(file));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No converter address.');
const browser = await chromium.launch({ ...(process.env.VNS_BROWSER_PATH ? { executablePath: process.env.VNS_BROWSER_PATH } : { channel: 'msedge' }), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let encoder: ReturnType<typeof spawn> | undefined;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => (window as any).converterReady || (window as any).converterError, undefined, { timeout: 30_000 });
  const info = await page.evaluate(() => ({ duration: (window as any).animationDuration, error: (window as any).converterError }));
  if (errors.length || info.error || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error(JSON.stringify({ ...info, errors }));
  const frames = Math.ceil(info.duration * fps);
  const started = Date.now();
  const poster = Buffer.from(await page.evaluate(() => (window as any).drawAnimationFrame(0)), 'base64');
  await fs.writeFile(path.join(output, 'title-poster.png'), poster);
  if (process.argv.includes('--poster-only')) { console.log(JSON.stringify({ output, duration: info.duration, frames, posterOnly: true })); }
  else {
    let encoderLog = '';
    encoder = spawn(process.env.VNS_FFMPEG ?? 'ffmpeg', ['-hide_banner', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libvpx-vp9', '-crf', '26', '-b:v', '0', '-pix_fmt', 'yuv420p', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', path.join(output, 'title-idle.webm')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    encoder.stderr!.on('data', chunk => { encoderLog = (encoderLog + String(chunk)).slice(-12_000); });
    const ended = new Promise<void>((resolve, reject) => { encoder!.once('error', reject); encoder!.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${encoderLog}`))); });
    for (let frame = 0; frame < frames; frame++) {
      const png = frame === 0 ? poster : Buffer.from(await page.evaluate((delta) => (window as any).drawAnimationFrame(delta), 1 / fps), 'base64');
      if (frame === Math.floor(frames / 2)) await fs.writeFile(path.join(output, 'title-middle.png'), png);
      await new Promise<void>((resolve, reject) => encoder!.stdin!.write(png, error => error ? reject(error) : resolve()));
      if (frame % 30 === 0) console.log(`Animation frames: ${frame + 1}/${frames}`);
    }
    encoder.stdin!.end(); await ended;
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ source: path.join(folder, 'source.json'), output: path.join(output, 'title-idle.webm'), width, height, fps, duration: info.duration, frames, skeletonScale: scale, milliseconds: Date.now() - started, status: 'passed', comparison: 'Reconstructed from serialized data; not compared against live original-game screenshots.' }, null, 2));
    console.log(JSON.stringify({ output, frames, seconds: info.duration }));
  }
} finally { encoder?.kill(); await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
