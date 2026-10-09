import { expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { launchDesktopFixture } from './lib/desktop-fixture';

const root = path.resolve('.');
const output = path.join(root, 'artifacts/ai-model-picker', new Date().toISOString().replaceAll(':', '-'));
await fs.mkdir(output, { recursive: true });
let status = 200, requests = 0;
const server = createServer((request, response) => {
  if (request.url !== '/v1/models' || request.method !== 'GET') { response.writeHead(404).end(); return; }
  requests++;
  expect(request.headers.authorization).toBe('Bearer model-picker-test');
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(status === 200 ? { data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'alpha' }] } : { error: { message: 'Model discovery unavailable.' } }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const apiRoot = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
const app = await launchDesktopFixture({ root, profile: path.join(output, 'profile') });
const metrics: Record<string, unknown> = {};
try {
  const page = await app.firstWindow();
  await expect(page.locator('.project-title strong')).not.toBeEmpty({ timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 800));
  await page.getByRole('button', { name: '作品设置', exact: true }).click();
  await page.getByRole('button', { name: 'AI 服务', exact: true }).click();
  const button = page.getByRole('button', { name: '获取模型列表', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(page.getByRole('combobox', { name: '可用模型', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '可用模型', exact: true })).toBeDisabled();
  expect(await button.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(30);
  metrics.button = await button.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return { text: element.textContent, color: style.color, background: style.backgroundColor, border: style.border, width: rect.width, height: rect.height };
  });
  await page.screenshot({ path: path.join(output, 'settings-initial.png') });
  const fetchModels = async (target: Page) => {
    await target.getByLabel('API 地址', { exact: true }).fill(apiRoot);
    await target.getByLabel('API 密钥', { exact: true }).fill('model-picker-test');
    await target.getByRole('button', { name: '获取模型列表', exact: true }).click();
    const picker = target.getByRole('combobox', { name: '可用模型', exact: true });
    await expect(picker).toBeEnabled();
    await expect(picker.locator('option')).toHaveText(['选择模型（2 个）', 'alpha', 'zeta']);
    await picker.selectOption('alpha');
    await expect(target.getByLabel('模型名称', { exact: true })).toHaveValue('alpha');
  };
  await fetchModels(page);
  expect(requests).toBe(1);
  expect((await page.evaluate(() => window.studio!.getAiConfig!())).model).toBe('');
  await page.screenshot({ path: path.join(output, 'settings-models.png') });
  status = 404;
  await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
  await expect(page.locator('.ai-settings [role="alert"]')).toContainText('404');
  await expect(page.getByRole('combobox', { name: '可用模型', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '可用模型', exact: true }).locator('option')).toHaveCount(1);
  await page.getByLabel('模型名称', { exact: true }).fill('manual-model');
  await expect(page.getByRole('button', { name: '保存 AI 配置', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  const opened = app.waitForEvent('window');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  const assistant = await opened;
  await assistant.getByRole('button', { name: 'AI 服务设置', exact: true }).first().click();
  await expect(assistant.getByRole('button', { name: '获取模型列表', exact: true })).toBeVisible();
  status = 200;
  await fetchModels(assistant);
  expect(requests).toBe(3);
  await assistant.screenshot({ path: path.join(output, 'assistant-models.png') });
  metrics.checks = ['模型获取入口可见可用', '未保存地址和密钥可取列表', '去重排序并选择模型', '获取不保存配置', '404 后可手填', '作品设置与独立助手入口均通过'];
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ output, ...metrics }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, 'error.txt'), String(error));
  console.error('Verification output:', output);
  throw error;
} finally {
  await app.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
