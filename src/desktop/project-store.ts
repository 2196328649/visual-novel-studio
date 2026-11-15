import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assetFiles, blueprintNodeSchema, projectSchema, type Asset, type AssetCategory, type Project } from '../core/model';
import { assetCategoryNames, ensureAssetAssignments, ensureResourceFolders, inferAssetCategory } from '../core/asset-library';
import type { ProjectRecoveryOptions, ProjectSession } from '../core/bridge';
import { projectDraftSchema } from '../core/project-draft-schema';
import { applyUiDraft } from '../core/ui-draft';
import { sameProjectValue } from '../core/project-history';
import { pngMetadataAsync, withPortraitMetadata } from './image-metadata';
import { legacyTemplateFlowText, repairTemplateFlow, repairTemplateFlowDraft, repairTemplateVoiceCollection, templateFlowFontId, legacyTemplateVoiceArtwork, templateVoiceArtworkAssetIds, restoreTemplateVoiceArtwork } from '../core/template-repairs';
import { legacyTemplateHistory, repairTemplateHistory, historyTemplateAssets } from '../core/template-history';
import { migrateStandaloneNames, normalizeChapterPerformances } from '../core/standalone-performance';
import { normalizeChapterCompositions } from '../core/chapter-composition';
import { migrateLegacyEndings } from '../core/ending-migration';
import { normalizeGeneratedChapterBlueprints, normalizeChapterBlueprintEntrypoints } from '../core/chapter-performances';
import { migrateLegacyChapters } from '../core/chapter-migration';
import { migrateImplicitPerformances } from '../core/performance-syntax-migration';
import { migratePlaybackSyntax } from '../core/playback-syntax-migration';
import { prepareResourceLayout } from './resource-layout';
import { relativeResourcePath, resolveResourcePath } from './resource-paths';
import { relocateProjectAssets } from '../core/asset-relocation';
import { upgradeChapterPresetSlots } from '../core/chapter-preset-slots';
import { upgradeChapterPresetTypography } from '../core/chapter-preset-typography';
import { consolidateChapterPresets } from '../core/chapter-preset-catalog';
import { normalizeProjectResources } from '../core/project-resources';

const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const PROJECT_FILENAME = 'project.vns.json';

export function containedPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes('\0')) throw new Error('资源必须使用项目内的相对路径。');
  const segments = relative.replaceAll('\\', '/').split('/');
  if (segments.some(part => part === '..' || part.includes(':'))) throw new Error('资源路径不能离开项目目录。');
  const resolved = path.resolve(root, ...segments);
  const boundary = path.resolve(root) + path.sep;
  if (!resolved.toLowerCase().startsWith(boundary.toLowerCase())) throw new Error('资源路径无效。');
  return resolved;
}

/** External paths are explicitly recorded on imported assets, never supplied by a URL. */
export function assetSourcePath(root: string, asset: Asset, relative = asset.path): string {
  if (!assetFiles(asset).includes(relative)) throw new Error('文件不属于此素材。');
  containedPath(root, relative);
  const external = asset.externalFiles?.[relative] ?? (relative === asset.path ? asset.externalPath : undefined);
  if (!external) return resolveResourcePath(root, relative, asset.id);
  if (!path.isAbsolute(external) || external.includes('\0')) throw new Error('引用素材需要有效的绝对路径。');
  return path.resolve(external);
}

export async function atomicWrite(file: string, contents: string, createDirectory = true): Promise<void> {
  if (createDirectory) await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Windows readers can briefly hold the destination without delete sharing.
    // Keep the old complete file until replacement succeeds; never unlink it.
    const retryDelays = [10, 25, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, file); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= retryDelays.length) throw error;
        await delay(retryDelays[attempt]);
      }
    }
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

/** A readable but unsupported document is not a crashed write. Falling back to
 * an older autosave/previous file could silently erase its unknown nodes. */
export class UnsupportedProjectFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedProjectFormatError'; }
}
const supportedBlueprintNodeTypes = new Set<string>(blueprintNodeSchema.shape.type.options);
function checkBlueprintFormat(source: Record<string, unknown>) {
  for (const collection of ['blueprints', 'timelinePresets']) {
    const graphs = source[collection]; if (!Array.isArray(graphs)) continue;
    for (const [graphIndex, graph] of graphs.entries()) {
      if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes)) continue;
      for (const [nodeIndex, node] of graph.nodes.entries()) {
        if (node && typeof node === 'object' && typeof node.type === 'string' && !supportedBlueprintNodeTypes.has(node.type)) {
          throw new UnsupportedProjectFormatError(`项目包含暂不支持的蓝图节点类型“${node.type}”（${collection}.${graphIndex}.nodes.${nodeIndex}）。原文件保持不变，不会自动用旧备份替换，请使用支持该节点的编辑器。`);
        }
      }
    }
  }
}

/** Never overwrite the first recovery copy; a later distinct migration keeps
 * its own content-addressed copy, including autosave/previous-file envelopes. */
async function preserveMigrationSource(file: string) {
  const source = await fs.readFile(file), first = `${file}.before-migration`;
  const preserve = async (destination: string) => {
    try { await fs.writeFile(destination, source, { flag: 'wx' }); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return (await fs.readFile(destination)).equals(source); }
  };
  if (await preserve(first)) return;
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16);
  if (!await preserve(`${first}-${digest}`)) throw new Error('迁移恢复副本标识冲突，请先手动备份原工程。');
}
function checkProjectFormat(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new Error('项目文件不是有效的对象。');
  const source = input as Record<string, unknown>;
  if (source.schemaVersion !== 0 && source.schemaVersion !== 1) throw new UnsupportedProjectFormatError('项目由不兼容的版本创建，请使用支持该格式的编辑器；原文件保持不变，不会自动使用旧备份。');
  checkBlueprintFormat(source);
  return source;
}
export function parseProject(input: unknown): { project: Project; migrated: boolean } {
  const source = checkProjectFormat(input);
  const migrated = source.schemaVersion === 0;
  const candidate = migrated ? { ...source, schemaVersion: 1, name: source.name ?? source.title, version: source.version ?? '1.0.0' } : source;
  const result = projectSchema.safeParse(candidate);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`项目数据无效：${first.path.join('.')} ${first.message}`);
  }
  repairTemplateFlow(result.data);
  repairTemplateVoiceCollection(result.data);
  restoreTemplateVoiceArtwork(result.data);
  repairTemplateHistory(result.data);
  const endingsConverted = migrateLegacyEndings(result.data, candidate);
  const chaptersConverted = normalizeChapterPerformances(result.data).length > 0;
  const standaloneNamesConverted = migrateStandaloneNames(result.data);
  const performanceSyntaxConverted = migrateImplicitPerformances(result.data);
  const chapterCompositionsConverted = normalizeChapterCompositions(result.data);
  const chapterBlueprintsConverted = normalizeGeneratedChapterBlueprints(result.data);
  const chapterCallsConverted = migrateLegacyChapters(result.data);
  const chapterEntrypointsConverted = normalizeChapterBlueprintEntrypoints(result.data);
  const chapterSlotsConverted = upgradeChapterPresetSlots(result.data);
  const chapterTypographyConverted = upgradeChapterPresetTypography(result.data);
  const chapterCatalogConverted = consolidateChapterPresets(result.data);
  const playbackSyntaxConverted = migratePlaybackSyntax(result.data);
  const resourcesSeparated = normalizeProjectResources(result.data);
  return { project: result.data, migrated: migrated || endingsConverted || chaptersConverted || standaloneNamesConverted || performanceSyntaxConverted || chapterCompositionsConverted || chapterBlueprintsConverted || chapterCallsConverted || chapterEntrypointsConverted || chapterSlotsConverted || chapterTypographyConverted || chapterCatalogConverted || playbackSyntaxConverted || resourcesSeparated };
}

async function readJson(file: string, limit = MAX_PROJECT_BYTES): Promise<unknown> {
  const stat = await fs.stat(file);
  if (stat.size > limit) throw new Error(`项目文件超过 ${Math.floor(limit / 1024 / 1024)} MB，请拆分过大的内容。`);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function loadProject(file: string, templateRoot?: string): Promise<ProjectSession> {
  let project: Project | undefined;
  let originalError: unknown;
  let migrated = false, migrationSource = file;
  try { ({ project, migrated } = parseProject(await readJson(file))); }
  catch (error) { if (error instanceof UnsupportedProjectFormatError) throw error; originalError = error; }
  let recovered = false;
  let recoveredDraft: { base: Project; value: Project } | undefined;
  let recoveredProjectDirty: boolean | undefined;
  const autoFile = `${file}.autosave`;
  try {
    const auto = await readJson(autoFile, MAX_PROJECT_BYTES * 2 + 4096) as { savedAt: number; project: unknown; uiDraft?: unknown; projectDirty?: boolean };
    const savedMtime = (await fs.stat(file).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
    const sameProject = !project || !!auto.project && typeof auto.project === 'object' && (auto.project as { id?: unknown }).id === project.id;
    // Old or unrelated recovery data must not block the valid primary file.
    if (sameProject && typeof auto.savedAt === 'number' && Number.isFinite(auto.savedAt) && auto.savedAt > savedMtime) {
      const candidate = parseProject(auto.project);
      // Validate the complete envelope before accepting either half. Incomplete
      // UI bindings are recoverable, but cannot weaken normal save validation.
      if (auto.uiDraft !== undefined) checkProjectFormat(auto.uiDraft);
      const draft = auto.uiDraft === undefined ? undefined : projectDraftSchema.parse(auto.uiDraft);
      if (draft && draft.id !== candidate.project.id) throw new Error('界面恢复草稿不属于此工程。');
      const repairedDraft = draft ? repairTemplateFlowDraft(projectDraftSchema.parse(auto.project), draft) : undefined;
      recoveredProjectDirty = auto.projectDirty !== false || !project || !sameProjectValue(project, candidate.project) || candidate.migrated;
      recoveredDraft = repairedDraft ? { base: candidate.project, value: repairedDraft } : undefined;
      project = candidate.project; migrated = candidate.migrated; migrationSource = autoFile; recovered = true;
    }
  } catch (error) {
    if (error instanceof UnsupportedProjectFormatError) throw error;
    // A partial recovery file never replaces valid project data.
  }
  if (!project) {
    try { const candidate = parseProject(await readJson(`${file}.previous`)); project = candidate.project; migrated = candidate.migrated; migrationSource = `${file}.previous`; recovered = true; }
    catch (error) { if (error instanceof UnsupportedProjectFormatError) throw error; throw originalError ?? new Error('无法读取项目及其备份。'); }
  }
  if (migrated) await preserveMigrationSource(migrationSource);
  if (templateRoot && legacyTemplateFlowText(project).length && !project.assets.some(asset => asset.id === templateFlowFontId)) {
    const template = projectSchema.parse(await readJson(path.join(templateRoot, PROJECT_FILENAME)));
    const font = template.assets.find(asset => asset.id === templateFlowFontId && asset.kind === 'font');
    if (font) {
      const source = containedPath(templateRoot, font.path), destination = containedPath(path.dirname(file), font.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      try { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await fs.readFile(source)).equals(await fs.readFile(destination))) throw new Error('模板字体路径已被其他文件使用，请保留该文件后调整资源路径。');
      }
      project.assets.push(font);
      repairTemplateFlow(project);
    }
  }
  if (templateRoot && (legacyTemplateHistory(project).length || legacyTemplateVoiceArtwork(project))) {
    const template = projectSchema.parse(await readJson(path.join(templateRoot, PROJECT_FILENAME)));
    const missing = [...(legacyTemplateHistory(project).length ? historyTemplateAssets : []), ...(legacyTemplateVoiceArtwork(project) ? templateVoiceArtworkAssetIds : [])];
    for (const id of new Set(missing)) {
      if (project.assets.some(a => a.id === id)) continue;
      const asset = template.assets.find(a => a.id === id);
      if (!asset) continue;
      const source = containedPath(templateRoot, asset.path), destination = containedPath(path.dirname(file), asset.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      try { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await fs.readFile(source)).equals(await fs.readFile(destination))) continue;
      }
      project.assets.push(asset);
    }
    repairTemplateHistory(project);
    restoreTemplateVoiceArtwork(project);
  }
  const root = path.dirname(file);
  project = relocateProjectAssets(project, project.assets.filter(asset => !asset.externalPath && !Object.keys(asset.externalFiles ?? {}).length).map(asset => ({ assetId: asset.id, files: Object.fromEntries(assetFiles(asset).map(relative => [relative, relativeResourcePath(root, resolveResourcePath(root, relative, asset.id))])) })));
  ensureAssetAssignments(project);
  project = await withPortraitMetadata(project, root);
  return { project, path: file, recovered: recovered || migrated,
    ...(recoveredDraft ? { uiDraft: applyUiDraft(project, recoveredDraft) } : {}),
    ...(recoveredProjectDirty !== undefined ? { recoveredProjectDirty } : {}),
  };
}

async function fileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyProjectFiles(project: Project, sourceDir: string, destinationDir: string): Promise<void> {
  const signing = ['android.keystore', 'bundle.keystore', 'signing-manifest.json']
    .map(name => `.studio/${project.id}/android-signing/${name}`);
  const plan: { source: string; destination: string; conflict: string }[] = [];
  // Validate the entire copy before touching destination content. A template or
  // save-as can share a directory with another work's assets and signing keys.
  for (const relative of new Set([...signing, ...project.assets.flatMap(asset => assetFiles(asset).filter(relative => !asset.externalFiles?.[relative] && !(relative === asset.path && asset.externalPath)))])) {
    const source = resolveResourcePath(sourceDir, relative), destination = containedPath(destinationDir, relative);
    const optional = signing.includes(relative);
    const stat = await fs.stat(source).catch(error => {
      if (optional && error.code === 'ENOENT') return undefined;
      throw new Error(`无法复制工程文件“${relative}”：${error.message}`);
    });
    if (!stat) continue;
    if (!stat.isFile()) throw new Error(`工程文件“${relative}”不是普通文件。`);
    const conflict = optional ? '目标文件夹已存在不同的 Android 签名，请另选工程保存目录。'
      : `目标文件夹中存在内容不同的同名素材“${relative}”，请另选工程保存目录。`;
    const existing = await fs.stat(destination).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (existing) {
      if (!existing.isFile() || existing.size !== stat.size || await fileDigest(source) !== await fileDigest(destination)) throw new Error(conflict);
    } else plan.push({ source, destination, conflict });
  }
  for (const { source, destination, conflict } of plan) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try { await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Another process may create a file after preflight; never overwrite it.
      if (await fileDigest(source) !== await fileDigest(destination)) throw new Error(conflict);
    }
  }
}

export async function saveProject(file: string, project: Project, sourceDir?: string): Promise<ProjectSession> {
  let valid = parseProject(project).project;
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  if (sourceDir && path.resolve(sourceDir) !== path.resolve(dir)) {
    valid = relocateProjectAssets(valid, valid.assets.filter(asset => !asset.externalPath && !Object.keys(asset.externalFiles ?? {}).length).map(asset => ({ assetId: asset.id, files: Object.fromEntries(assetFiles(asset).map(relative => [relative, relativeResourcePath(sourceDir, resolveResourcePath(sourceDir, relative, asset.id))])) })));
    await copyProjectFiles(valid, sourceDir, dir);
  }
  await ensureResourceDirectories(dir, valid);
  const layout = valid.resourceSettings?.syncFolders === false ? undefined : await prepareResourceLayout(dir, valid);
  if (layout) valid = layout.project;
  try { await fs.copyFile(file, `${file}.previous`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await atomicWrite(file, JSON.stringify(valid, null, 2) + '\n');
  await fs.rm(`${file}.autosave`, { force: true });
  const retained = await layout?.finish() ?? [];
  return { project: valid, path: file, recovered: false, ...(layout?.relocations.length || layout?.skipped.length ? { assetRelocations: layout.relocations, resourceReport: { moved: layout.relocations.length, skipped: layout.skipped, retained } } : {}) };
}

export async function autosaveProject(file: string, project: Project, createDirectory = true, options: ProjectRecoveryOptions = {}): Promise<{ savedAt: number }> {
  const valid = parseProject(project).project;
  const uiDraft = options.uiDraft === undefined ? undefined : projectDraftSchema.parse(options.uiDraft);
  if (uiDraft && uiDraft.id !== valid.id) throw new Error('界面恢复草稿不属于此工程。');
  const savedAt = Date.now();
  await atomicWrite(`${file}.autosave`, JSON.stringify({ savedAt, project: valid, ...(uiDraft ? { uiDraft } : {}), ...(options.projectDirty !== undefined ? { projectDirty: options.projectDirty } : {}) }), createDirectory);
  return { savedAt };
}

export async function ensureResourceDirectories(dir: string, project: Project) {
  ensureAssetAssignments(project);
  for (const name of Object.values(assetCategoryNames)) await fs.mkdir(containedPath(dir, `${project.resourceSettings?.directory ?? 'assets'}/${name}`), { recursive: true });
}

export function assetKindForFile(source: string): Asset['kind'] {
  const extension = path.extname(source).toLowerCase();
  const image = ['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(extension);
  const audio = ['.ogg', '.opus', '.wav', '.mp3', '.flac'].includes(extension);
  const font = ['.ttf', '.otf'].includes(extension);
  const video = ['.webm', '.mp4', '.ogv'].includes(extension);
  const script = extension === '.rpy';
  if (!image && !audio && !font && !video && !script) throw new Error(`不支持的素材格式：${extension}`);
  return image ? 'image' : font ? 'font' : video ? 'video' : script ? 'script' : 'audio';
}

export async function importAsset(dir: string, source: string, options: { mode?: 'copy' | 'reference'; directory?: string; subdirectory?: string; category?: AssetCategory } = {}): Promise<Asset> {
  const extension = path.extname(source).toLowerCase(), kind = assetKindForFile(source);
  const category = options.category ?? inferAssetCategory({ kind, name: path.basename(source), sourcePath: source });
  const contents = await fs.readFile(source);
  const digest = createHash('sha256').update(contents).digest('hex').slice(0, 24);
  const id = `asset_${digest}`;
  const relative = `${options.directory ?? 'assets'}/${options.subdirectory ?? assetCategoryNames[category]}/${id}${extension}`;
  const destination = containedPath(dir, relative);
  // Reject unreadable images before copying so metadata failures cannot leave
  // an unregistered asset on disk. Decode without rewriting the original bytes.
  const dimensions = extension === '.png' && contents.length >= 24 && contents.subarray(1, 4).toString() === 'PNG'
    ? await pngMetadataAsync(contents) : {};
  if (options.mode !== 'reference') {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try { await fs.writeFile(destination, contents, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; if (!(await fs.readFile(destination)).equals(contents)) throw new Error('目标路径已被不同的文件使用。'); }
  }
  return { id, name: path.basename(source, extension), kind, category, path: relative, ...(options.mode === 'reference' ? { externalPath: path.resolve(source) } : {}), ...dimensions };
}

export class WriteQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const current = this.pending.then(action, action);
    this.pending = current.catch(() => undefined);
    return current;
  }
}
