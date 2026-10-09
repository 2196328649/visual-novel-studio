import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface UnityObject { file: string; pathId: number; type: string; class?: string; data: Record<string, any> }
export interface UnityRect { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number }

/** Read-only adapter for the recovered scene data. Unity's bottom-left anchors
 * are converted to a top-left rectangle at the original canvas resolution. */
export class UnityUi {
  private objects: Map<string, UnityObject>;
  private rectangles: Map<string, UnityObject>;
  private pathCache = new Map<string, string>();
  private rectCache = new Map<string, UnityRect>();
  readonly nodes: Map<string, UnityObject>;
  constructor(readonly records: UnityObject[], readonly files: Record<string, { externals: string[] }>, readonly width = 1920, readonly height = 1080) {
    this.objects = new Map(records.map(record => [this.key(record), record]));
    this.rectangles = new Map(records.filter(record => record.type === 'RectTransform').map(record => [`${record.file}:${record.data.m_GameObject.m_PathID}`, record]));
    this.nodes = new Map(records.filter(record => record.type === 'GameObject' && record.file === 'level0').map(record => [this.hierarchy(record), record]));
  }
  static async load(directory: string) {
    const [records, summary] = await Promise.all([fs.readFile(path.join(directory, 'objects.json'), 'utf8'), fs.readFile(path.join(directory, 'summary.json'), 'utf8')]);
    return new UnityUi(JSON.parse(records), JSON.parse(summary).files);
  }
  key(record: Pick<UnityObject, 'file' | 'pathId'>) { return `${record.file}:${record.pathId}`; }
  reference(file: string, pointer: { m_FileID: number; m_PathID: number } | undefined): UnityObject | undefined {
    if (!pointer?.m_PathID) return;
    if (pointer.m_FileID) {
      const external = this.files[file]?.externals[pointer.m_FileID - 1];
      if (!external) return;
      file = external.replaceAll('\\', '/').split('/').pop()!;
    }
    return this.objects.get(`${file}:${pointer.m_PathID}`);
  }
  components(node: UnityObject): UnityObject[] {
    return (node.data.m_Component ?? []).map((item: any) => this.reference(node.file, item.component)).filter(Boolean);
  }
  hierarchy(node: UnityObject): string {
    const key = this.key(node);
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    const rect = this.rectangles.get(key);
    const parentRect = rect && this.reference(rect.file, rect.data.m_Father);
    const parent = parentRect && this.reference(parentRect.file, parentRect.data.m_GameObject);
    const value = (parent ? this.hierarchy(parent) + '/' : '') + node.data.m_Name;
    this.pathCache.set(key, value);
    return value;
  }
  node(name: string) {
    const node = this.nodes.get(name);
    if (!node) throw new Error(`Original UI object is missing: ${name}`);
    return node;
  }
  includePrefab(name: string, file: string): string {
    const prefix = `Prefab/${file}/`;
    let found = false;
    for (const record of this.records) {
      if (record.type !== 'GameObject' || record.file !== file) continue;
      const hierarchy = this.hierarchy(record);
      if (hierarchy !== name && !hierarchy.startsWith(name + '/')) continue;
      this.nodes.set(prefix + hierarchy, record);
      if (hierarchy === name) found = true;
    }
    if (!found) throw new Error(`Original UI prefab is missing: ${file}/${name}`);
    return prefix + name;
  }
  rectangle(node: UnityObject): UnityRect {
    const key = this.key(node);
    const cached = this.rectCache.get(key);
    if (cached) return cached;
    const rect = this.rectangles.get(key);
    if (!rect) return { x: 0, y: 0, width: this.width, height: this.height, scaleX: 1, scaleY: 1 };
    const parentRect = this.reference(rect.file, rect.data.m_Father);
    const parentNode = parentRect && this.reference(parentRect.file, parentRect.data.m_GameObject);
    if (!parentNode) return { x: 0, y: 0, width: this.width, height: this.height, scaleX: 1, scaleY: 1 };
    const parent = this.rectangle(parentNode);
    const d = rect.data;
    const pivot = d.m_Pivot;
    const scaleX = parent.scaleX * Math.abs(d.m_LocalScale?.x ?? 1);
    const scaleY = parent.scaleY * Math.abs(d.m_LocalScale?.y ?? 1);
    const width = (parent.width / parent.scaleX * (d.m_AnchorMax.x - d.m_AnchorMin.x) + d.m_SizeDelta.x) * scaleX;
    const height = (parent.height / parent.scaleY * (d.m_AnchorMax.y - d.m_AnchorMin.y) + d.m_SizeDelta.y) * scaleY;
    const anchorX = d.m_AnchorMin.x + (d.m_AnchorMax.x - d.m_AnchorMin.x) * pivot.x;
    const anchorY = d.m_AnchorMin.y + (d.m_AnchorMax.y - d.m_AnchorMin.y) * pivot.y;
    const result = { x: parent.x + parent.width * anchorX + d.m_AnchoredPosition.x * parent.scaleX - width * pivot.x,
      y: parent.y + parent.height * (1 - anchorY) - d.m_AnchoredPosition.y * parent.scaleY - height * (1 - pivot.y), width, height, scaleX, scaleY };
    this.rectCache.set(key, result);
    return result;
  }
  localizedSprite(node: UnityObject, state: 'normal' | 'highlighted' | 'Pressed' | 'selected' | 'disabled' = 'normal') {
    const components = this.components(node);
    const adapter = components.find(component => component.class?.includes('Language') && component.data.SC);
    const sc = adapter?.data.SC;
    const localized = sc && this.reference(adapter.file, sc.m_PathID !== undefined ? sc : sc[state]);
    if (localized) return localized;
    if (state === 'normal') {
      const image = components.find(component => component.class === 'UnityEngine.UI.Image');
      return image && this.reference(image.file, image.data.m_Sprite);
    }
    const button = components.find(component => component.data.m_SpriteState);
    const key = { highlighted: 'm_HighlightedSprite', Pressed: 'm_PressedSprite', selected: 'm_SelectedSprite', disabled: 'm_DisabledSprite' }[state];
    return button && this.reference(button.file, button.data.m_SpriteState?.[key]);
  }
}
