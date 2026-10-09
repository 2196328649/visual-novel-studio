import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const installedExecutable = process.env.VNS_INSTALLED_EXE && path.resolve(process.env.VNS_INSTALLED_EXE);
export async function enterFixtureProject(page: Page, projectFile: string) {
  if (installedExecutable) await page.locator('.recent-project-open').filter({ hasText: path.resolve(projectFile) }).click({ timeout: 45000 });
}
const digest = async (file: string) => {
  const hash = createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
};

/** Run the same UI acceptance against development or the actual installed binaries. */
export async function launchDesktopFixture(options: {
  root: string; profile: string; projectFile?: string; devUrl?: string; sdkRoot?: string; timeout?: number; projectHub?: boolean;
}): Promise<ElectronApplication> {
  const profile = path.resolve(options.profile);
  await fs.mkdir(profile, { recursive: true });
  const documents = path.join(profile, 'documents');
  await fs.mkdir(documents, { recursive: true });
  if (installedExecutable && options.projectFile) {
    await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ path: options.projectFile }));
  }
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env,
    VNS_USER_DATA: profile,
    VNS_SKIP_PROJECT_HUB: options.projectHub ? '' : '1',
    VNS_PROJECT_PATH: installedExecutable ? path.join(profile, 'invalid-development-project') : options.projectFile,
    VNS_RENPY_SDK: installedExecutable ? path.join(profile, 'invalid-development-sdk') : options.sdkRoot ?? path.join(options.root, 'resources/runtime'),
    VNS_DEV_URL: installedExecutable ? 'http://127.0.0.1:1' : options.devUrl ?? '',
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: installedExecutable ?? require('electron'),
    args: installedExecutable ? [`--user-data-dir=${profile}`] : [options.root],
    cwd: installedExecutable ? path.dirname(installedExecutable) : options.root,
    env, timeout: options.timeout ?? 120_000,
  });
  try {
    await app.evaluate(({ app }, documents) => app.setPath('documents', documents), documents);
    const actual = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), version: app.getVersion() }));
    expect(path.resolve(actual.profile).toLowerCase()).toBe(profile.toLowerCase());
    expect(actual.packaged).toBe(!!installedExecutable);
    if (installedExecutable) {
      const expected = JSON.parse(await fs.readFile(path.join(options.root, 'package.json'), 'utf8')).version;
      expect(actual.version).toBe(expected);
      await fs.writeFile(path.join(path.dirname(profile), 'tested-app.json'), JSON.stringify({ ...actual,
        executable: installedExecutable,
        binaries: { executable: await digest(installedExecutable), asar: await digest(path.join(path.dirname(installedExecutable), 'resources/app.asar')) },
      }, null, 2));
      if (options.projectFile && !options.projectHub) await enterFixtureProject(await app.firstWindow(), options.projectFile);
    }
    return app;
  } catch (error) { await app.close().catch(() => undefined); throw error; }
}
