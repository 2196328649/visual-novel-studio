import { z } from 'zod';
import type { Diagnostic, Project } from './model';

const iconAppearance = {
  iconBackgroundMode: z.enum(['transparent', 'solid']).default('transparent'),
  iconBackground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#202731'),
  iconScale: z.number().min(.1).max(2).default(1),
  iconX: z.number().min(-1).max(1).default(0),
  iconY: z.number().min(-1).max(1).default(0),
};

export const exportSettingsSchema = z.object({
  platform: z.enum(['windows', 'android']).default('windows'),
  fileName: z.string().max(80).default(''),
  directory: z.string().max(2048).default(''),
  iconAssetId: z.string().optional(),
  windows: z.object({ ...iconAppearance, format: z.enum(['zip', 'exe']).default('zip') }).prefault({}),
  android: z.object({
    ...iconAppearance,
    iconBackgroundMode: z.enum(['transparent', 'solid']).default('solid'),
    format: z.enum(['apk', 'aab']).default('apk'),
    packageName: z.string().max(180).default(''),
    versionCode: z.number().finite().default(1),
    orientation: z.enum(['landscape', 'portrait', 'auto']).default('landscape'),
    internet: z.boolean().default(false),
  }).prefault({}),
});
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export type ExportPlatform = ExportSettings['platform'];
export const exportPlatformNames: Record<ExportPlatform, string> = { windows: 'Windows', android: 'Android' };

/** Browser-safe path handling for the combined directory/name control. */
export function joinExportLocation(directory: string, fileName: string): string {
  if (!directory) return fileName;
  const separator = directory.includes('\\') || /^[a-z]:/i.test(directory) && !directory.includes('/') ? '\\' : '/';
  return directory.replace(/[\\/]+$/, '') + separator + fileName;
}

export function splitExportLocation(location: string): Pick<ExportSettings, 'directory' | 'fileName'> {
  const value = location.trim(), at = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (at < 0) return { directory: '', fileName: value };
  let directory = value.slice(0, at);
  if (!directory || /^[a-z]:$/i.test(directory)) directory += value[at];
  return { directory, fileName: value.slice(at + 1) };
}

export function exportSettings(project: Pick<Project, 'id' | 'exportSettings'> & { name?: string }): ExportSettings {
  const settings = exportSettingsSchema.parse(project.exportSettings ?? {});
  const defaultName = (project.name ?? project.id).trim().replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80) || project.id;
  return { ...settings, fileName: settings.fileName.trim() || (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(defaultName) ? '_' + defaultName : defaultName),
    android: { ...settings.android, packageName: settings.android.packageName.trim() || `com.vns.${project.id}` } };
}

const javaKeywords = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' '));
export function exportDiagnostics(project: Project): Diagnostic[] {
  const settings = exportSettings(project), diagnostics: Diagnostic[] = [];
  const error = (message: string) => diagnostics.push({ severity: 'error', message });
  if (!/^\d+\.\d+\.\d+$/.test(project.version)) error('游戏版本请使用三段数字，例如 1.0.0。');
  if (settings.platform === 'windows' && (!/^[\p{L}\p{N}_-]{1,80}$/u.test(settings.fileName) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(settings.fileName))) error('导出名称可使用中文、字母、数字、下划线或短横线，不能使用 Windows 保留名称。');
  if (settings.iconAssetId && !project.assets.some(asset => asset.id === settings.iconAssetId && asset.kind === 'image')) error('游戏图标素材已丢失，请重新选择图片。');
  else if (settings.iconAssetId && !project.assets.some(asset => asset.id === settings.iconAssetId && /\.png$/i.test(asset.path))) error('游戏图标需要 PNG 图片，请重新选择。');
  if (settings.platform === 'android') {
    const parts = settings.android.packageName.split('.');
    if (parts.length < 2 || parts.some(part => !/^[a-z][a-z0-9_]*$/.test(part) || javaKeywords.has(part))) error('Android 包名需包含至少两段小写英文名称，以点分隔，例如 com.example.mystory；每段以字母开头，不能使用 Java 保留字。');
    if (!Number.isSafeInteger(settings.android.versionCode) || settings.android.versionCode < 1 || settings.android.versionCode > 2_100_000_000) error('Android 版本代码下限必须是 1 至 2100000000 的整数。');
  }
  return diagnostics;
}

export function androidConfiguration(project: Project) {
  const settings = exportSettings(project);
  return {
    package: settings.android.packageName, name: project.name, icon_name: project.name,
    version: project.version, numeric_version: settings.android.versionCode,
    orientation: { landscape: 'sensorLandscape', portrait: 'portrait', auto: 'sensor' }[settings.android.orientation],
    permissions: settings.android.internet ? ['VIBRATE', 'INTERNET'] : ['VIBRATE'],
    include_pil: false, include_sqlite: false, source: false, expansion: false, store: 'none',
    update_icons: true, update_always: true, update_keystores: true,
  };
}

/** Ren'Py's two distribution commands use different package switches. */
export function distributionCommand(project: Project, buildDir: string, destination: string): string[] {
  const settings = exportSettings(project);
  return settings.platform === 'windows'
    ? ['distribute', buildDir, '--package', 'win', '--destination', destination]
    : ['android_build', buildDir, ...(settings.android.format === 'aab' ? ['--bundle'] : []), '--destination', destination];
}
