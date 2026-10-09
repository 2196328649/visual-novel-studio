import { openStageEditing } from './lib/story-workspace';
import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replaceAll(':', '-');
const output = path.join(studio, 'artifacts', 'desktop-verification', runId);
const input = path.join(output, 'input');
await fs.cp(path.join(studio, 'resources', 'example'), input, { recursive: true });
const example = JSON.parse(await fs.readFile(path.join(input, 'project.vns.json'), 'utf8'));
const errors: string[] = [];
const checks: string[] = [];
const application = await electron.launch({ executablePath: require('electron'), args: [studio], cwd: studio, env: { ...process.env, VNS_PROJECT_PATH: path.join(input, 'project.vns.json'), VNS_TEST_ROOT: output, VNS_USER_DATA: path.join(output, 'user-data'), VNS_RENPY_SDK: path.join(studio, 'resources', 'runtime') } });
try {
  const page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.project-title strong')).toHaveText(example.name, { timeout: 30_000 });
  await expect(page.getByText('检查通过', { exact: true })).toBeVisible();
  checks.push('Bundled renderer opened the actual project through isolated IPC.');
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
    await page.screenshot({ path: path.join(output, `desktop-${width}.png`) });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error(`Horizontal overflow at ${width}`);
  }
  checks.push('Desktop layouts at 1280x720 and 1920x1080 have no page overflow.');
  const text = page.locator('#line-line_opening textarea');
  await text.fill('桌面验收：雨停以后，故事继续。');
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await expect(page.locator('.dirty-dot')).toHaveCount(0);
  const saved = JSON.parse(await fs.readFile(path.join(input, 'project.vns.json'), 'utf8'));
  if (saved.nodes.find((n: { id: string }) => n.id === 'opening').lines[0].text !== '桌面验收：雨停以后，故事继续。') throw new Error('Save did not persist the edited dialogue.');
  await page.reload();
  await expect(page.locator('#line-line_opening textarea')).toHaveValue('桌面验收：雨停以后，故事继续。');
  checks.push('Edited dialogue persisted through native save and renderer reload.');
  await openStageEditing(page);
  await expect.poll(() => page.locator('.text-stage img').evaluateAll(images => images.filter(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0).length)).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(output, 'desktop-stage.png') });
  checks.push('Project images rendered through the restricted asset protocol.');
  await page.getByRole('button', { name: '蓝图', exact: true }).click();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.screenshot({ path: path.join(output, 'desktop-blueprint.png') });
  checks.push('React Flow displayed the actual authored graph.');
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ output, passed: true, checks }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally { await application.close(); }
