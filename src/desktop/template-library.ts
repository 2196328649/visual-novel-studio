import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assetFiles, createProject, type Project } from '../core/model';
import { relocateProjectAssets } from '../core/asset-relocation';
import { projectFolderName, type ProjectTemplate, type ProjectTemplateInfo } from '../core/project-templates';
import type { ProjectSession } from '../core/bridge';
import { assetSourcePath, containedPath, loadProject, parseProject, PROJECT_FILENAME, saveProject } from './project-store';

const userId = /^user:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const exists = async (file: string) => fs.stat(file).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) throw new Error('请输入 1 到 200 字的名称。');
  return name.trim();
}

/** User templates are complete projects, separate from shipped resources and recent projects. */
export class TemplateLibrary {
  constructor(readonly root: string, readonly bundledRoot: string) {}
  private folder(id: unknown): string {
    if (id === 'aihong') return containedPath(this.root, 'aihong');
    const match = typeof id === 'string' && userId.exec(id);
    if (!match) throw new Error('模板不存在。');
    return containedPath(this.root, match[1]);
  }
  identify(file: string | null): ProjectSession['template'] {
    if (!file) return undefined;
    const relative = path.relative(path.resolve(this.root), path.resolve(file)).replaceAll('\\', '/');
    const [folder, name, extra] = relative.split('/');
    if (extra || name?.toLowerCase() !== PROJECT_FILENAME) return undefined;
    const id = folder === 'aihong' ? 'aihong' : `user:${folder}`;
    return id === 'aihong' || userId.test(id) ? { id: id as ProjectTemplateInfo['id'] } : undefined;
  }
  private async source(id: unknown): Promise<{ project: Project; directory?: string }> {
    if (id === 'blank') return { project: createProject() };
    const local = this.folder(id);
    const directory = id === 'aihong' && !await exists(path.join(local, PROJECT_FILENAME)) ? this.bundledRoot : local;
    // New projects use the saved template. Recovery drafts are only opened for editing.
    const project = parseProject(JSON.parse(await fs.readFile(path.join(directory, PROJECT_FILENAME), 'utf8'))).project;
    return { project, directory };
  }
  async list(): Promise<ProjectTemplateInfo[]> {
    const folders = await fs.readdir(this.root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const ids: ProjectTemplateInfo['id'][] = ['aihong', ...folders.filter(item => item.isDirectory() && userId.test(`user:${item.name}`)).map(item => `user:${item.name}` as const)];
    return Promise.all(ids.map(async id => {
      const customized = await exists(path.join(this.folder(id), PROJECT_FILENAME));
      const description = id === 'aihong' ? '完整故事与界面示例，包含素材和可编辑蓝图。' : '本机模板，可编辑剧情、界面、参数与素材。';
      try {
        const { project, directory } = await this.source(id);
        const stat = await fs.stat(path.join(directory!, PROJECT_FILENAME));
        return { id, name: id === 'aihong' && !customized ? '哀鸿模板' : project.name, description, builtin: id === 'aihong', customized, updatedAt: stat.mtimeMs, available: true };
      } catch {
        return { id, name: id === 'aihong' ? '哀鸿模板' : '无法读取的模板', description: '模板文件缺失或损坏；打开编辑可尝试恢复自动保存副本。', builtin: id === 'aihong', customized, updatedAt: 0, available: false };
      }
    }));
  }
  private async copyTo(id: unknown, name: string, parent: string, folder: string): Promise<ProjectSession> {
    const { project, directory } = await this.source(id);
    const copy = { ...project, id: createProject().id, name: validName(name) };
    const target = containedPath(parent, folder);
    await fs.mkdir(parent, { recursive: true });
    try { await fs.mkdir(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('此位置已有同名文件夹，请修改名称或选择其他位置。'); throw error; }
    try {
      // Materialize referenced files too, so future edits never depend on the source template.
      const relocations = [];
      for (const [index, asset] of copy.assets.entries()) {
        if (!directory) throw new Error('模板素材缺少来源目录。');
        const files: Record<string, string> = {};
        for (const relative of assetFiles(asset)) {
          const next = `assets/template-${index}/${relative.replaceAll('\\', '/')}`;
          const destination = containedPath(target, next);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(assetSourcePath(directory, asset, relative), destination, fs.constants.COPYFILE_EXCL);
          files[relative] = next;
        }
        relocations.push({ assetId: asset.id, files });
      }
      const localized = relocateProjectAssets(copy, relocations);
      localized.assets = localized.assets.map(({ externalPath: _path, externalFiles: _files, ...asset }) => asset);
      return await saveProject(path.join(target, PROJECT_FILENAME), localized);
    } catch (error) {
      // Only remove the folder this call exclusively created, inside the verified parent.
      if (path.resolve(target) === containedPath(parent, folder)) await fs.rm(target, { recursive: true, force: true });
      throw error;
    }
  }
  async create(name: string, source: ProjectTemplate = 'blank'): Promise<ProjectSession> {
    const id = `user:${randomUUID()}` as const;
    const folder = path.basename(this.folder(id));
    const saved = await this.copyTo(source, name, this.root, folder);
    return { ...saved, template: { id } };
  }
  async open(id: ProjectTemplateInfo['id']): Promise<ProjectSession> {
    const folder = this.folder(id);
    if (id === 'aihong' && !await exists(path.join(folder, PROJECT_FILENAME))) await this.copyTo(id, '哀鸿模板', this.root, 'aihong');
    return { ...await loadProject(path.join(folder, PROJECT_FILENAME)), template: { id } };
  }
  async createProject(name: string, source: ProjectTemplate, directory: string): Promise<ProjectSession> {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('请选择绝对路径的工程位置。');
    return this.copyTo(source, validName(name), path.resolve(directory), projectFolderName(validName(name)));
  }
  async createProjectFile(name: string, source: ProjectTemplate, file: string): Promise<ProjectSession> {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('请选择有效的工程文件位置。');
    if (await exists(file)) throw new Error('此位置已有工程文件，请另选位置。');
    const parent = containedPath(this.root, '.staging'), folder = randomUUID();
    const prepared = await this.copyTo(source, name, parent, folder);
    const temporary = containedPath(parent, folder);
    try { return await saveProject(file, prepared.project, temporary); }
    finally { if (path.resolve(temporary) === containedPath(parent, folder)) await fs.rm(temporary, { recursive: true, force: true }); }
  }
}
