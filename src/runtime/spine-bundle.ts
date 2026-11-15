import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { declaredUiComponents, type Project } from '../core/model';

export const spineRuntimeAbi = 2;
export const spineAndroidAbis = ['armeabi-v7a', 'arm64-v8a', 'x86_64'] as const;
export const requiresSpineRuntime = (project: Project) => project.assets.some(asset => asset.kind === 'spine') || declaredUiComponents(project).some(component => component.kind === 'spine');

/** Read-only package check. The native adapter still checks the actual exported
 * ABI before loading any player; a file's mere existence is not readiness. */
export async function spineRuntimeProblem(directory: string, platform: 'windows' | 'android'): Promise<string | undefined> {
  const label = platform === 'android' ? 'Android' : 'Windows';
  const manifestPath = path.join(directory, platform === 'android' ? 'android/build.json' : 'build.json');
  try {
    const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return label + ' 骨骼运行库构建记录无效，请重新构建运行库。';
    const record = manifest as Record<string, unknown>;
    if (record.abi !== spineRuntimeAbi) return label + ' 骨骼运行库需要 ABI ' + spineRuntimeAbi + '，当前构建记录不匹配；请重新构建对应平台运行库。';
    const adapter = await fs.readFile(path.join(directory, 'vns_spine.py'), 'utf8');
    if (!new RegExp('^SPINE_ABI\\s*=\\s*' + spineRuntimeAbi + '\\s*$', 'm').test(adapter)) return '骨骼 Python 适配器与原生运行库不匹配，请修复编辑器资源。';
    const files = record.files && typeof record.files === 'object' && !Array.isArray(record.files) ? record.files as Record<string, unknown> : {};
    const expected = platform === 'android' ? spineAndroidAbis.map(abi => [path.join('android', abi, 'libvns_spine.so'), files[abi]] as const) : [['vns_spine.dll', record.sha256] as const];
    for (const [relative, hash] of expected) {
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return label + ' 骨骼运行库缺少有效校验记录：' + relative + '。请重新构建运行库。';
      const actual = createHash('sha256').update(await fs.readFile(path.join(directory, relative))).digest('hex');
      if (actual !== hash) return label + ' 骨骼运行库与构建记录不一致：' + relative + '。不会使用混合版本，请重新构建运行库。';
    }
  } catch (error) {
    return label + ' 骨骼运行库或构建记录缺失、损坏：' + (error instanceof Error ? error.message : String(error)) + '。请修复编辑器资源。';
  }
}