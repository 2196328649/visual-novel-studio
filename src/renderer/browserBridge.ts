import type { ProjectSession, StudioBridge } from "../core/bridge";
import { version as studioVersion } from "../../package.json";
import { exportSettings } from '../core/export-settings';
import { exportText } from '../core/text-exchange';
import { normalizeChapterCompositions } from '../core/chapter-composition';
import { migrateLegacyEndings } from '../core/ending-migration';
import { normalizeGeneratedChapterBlueprints } from '../core/chapter-performances';
import {
  createProject,
  makeId,
  projectSchema,
  type Project,
} from "../core/model";

const key = "visual-novel-studio-browser-project";
const assetDataKey = "visual-novel-studio-browser-assets";
let assetData: Record<string, string> = {};
try { assetData = JSON.parse(localStorage.getItem(assetDataKey) ?? "{}"); } catch { /* Unreadable browser media can be imported again. */ }
async function chooseFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
function session(input: unknown): ProjectSession {
  const project = projectSchema.parse(input);
  const endingsConverted = migrateLegacyEndings(project, input);
  const chaptersConverted = normalizeGeneratedChapterBlueprints(project);
  return { project, path: null, recovered: normalizeChapterCompositions(project) || endingsConverted || chaptersConverted };
}
export const browserBridge: StudioBridge = {
  async create(name, template = 'blank') {
    if (template !== 'blank') throw new Error('此模板需在桌面版中创建。');
    const project = createProject(name);
    localStorage.setItem(key, JSON.stringify(project));
    assetData = {};
    localStorage.removeItem(assetDataKey);
    return session(project);
  },
  async getInitial() {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        return session(JSON.parse(raw));
      } catch {
        /* An invalid browser draft must not stop the editor from opening. */
      }
    }
    return session(createProject());
  },
  async open() {
    const [file] = await chooseFiles(".json,.vns");
    return file
      ? session(JSON.parse(await file.text()))
      : null;
  },
  async save(project) {
    localStorage.setItem(key, JSON.stringify(project));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(project, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name}.vns.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return session(project);
  },
  async autosave(project) {
    localStorage.setItem(key, JSON.stringify(project));
    return { savedAt: Date.now() };
  },
  async importAssets(project, options) {
    const files = await chooseFiles(
      options?.extensions?.map(extension => '.' + extension).join(',') ?? ".png,.jpg,.jpeg,.webp,.avif,.ogg,.opus,.wav,.mp3,.flac,.webm,.mp4,.ogv,.ttf,.otf,.rpy",
      !options?.single,
    );
    if (!files.length) return null;
    const next = structuredClone(project);
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const kind = /\.rpy$/i.test(file.name) ? "script" : /\.(ttf|otf)$/i.test(file.name) ? "font" : /\.(webm|mp4|ogv)$/i.test(file.name) ? "video" : /\.(png|jpe?g|webp|avif)$/i.test(file.name) ? "image" : "audio";
      const id = makeId("asset");
      const extension = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const path = `${kind === 'script' ? 'scripts' : 'browser-assets'}/${id}.${extension}`;
      const asset = {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        kind,
        path,
      } as Project["assets"][number];
      if (kind === "image") {
        const img = new window.Image();
        img.src = dataUrl;
        await img.decode();
        asset.width = img.naturalWidth;
        asset.height = img.naturalHeight;
      }
      assetData[path] = dataUrl;
      next.assets.push(asset);
    }
    localStorage.setItem(assetDataKey, JSON.stringify(assetData));
    return session(next);
  },
  async importText() {
    const [file] = await chooseFiles('.docx,.txt,.md');
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Browser editing accepts plain text/Markdown; DOCX is parsed by the native app.
    if (/\.docx$/i.test(file.name)) throw new Error('浏览器编辑模式暂不解析 DOCX，请使用 Windows 桌面版导入。');
    return { name: file.name, text: new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '') };
  },
  async preview() {
    return {
      ok: false,
      diagnostics: [],
      log: "当前是浏览器编辑模式。实际游戏试玩需要桌面版的 Ren'Py 运行环境。",
    };
  },
  async exportText(project, mode) {
    const result = exportText(project, mode), name = `${project.name}-${mode}.txt`;
    for (const file of [{ name, content: result.text }, ...(result.mapping ? [{ name: name + '.vns-lines.json', content: JSON.stringify(result.mapping, null, 2) }] : [])]) {
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return name;
  },
  async exportGame() {
    return {
      ok: false,
      diagnostics: [],
      log: "当前是浏览器编辑模式。独立游戏导出需要桌面版的 Ren'Py 运行环境。",
    };
  },
  async checkExport(project) {
    const message = '游戏导出需要桌面编辑器的运行环境；当前可以编辑和保存导出设置。';
    return { platform: exportSettings(project).platform, ready: false, checks: [{ id: 'desktop', label: '桌面导出环境', status: 'missing', detail: message }], diagnostics: [{ severity: 'error', message }] };
  },
  assetUrl(path) {
    return assetData[path] ?? path;
  },
  async environment() {
    return { sdkPath: null, appVersion: `${studioVersion}-web` };
  },
  onRuntimeEvent() {
    return () => {};
  },
};
