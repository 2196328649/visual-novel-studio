import { promises as fs } from 'node:fs';
import { UnityUi } from './lib/unity-ui';

const ui = await UnityUi.load('artifacts/aihong-ui-inspection/2026-09-10-layout');
const clips: Record<number, string> = { 506: '鼠标滑动', 512: 'Highlight_New' };
const rows = ui.records.filter(r => r.class === 'Utage.UguiButtonSe').map(r => {
  const object = ui.reference(r.file, r.data.m_GameObject)!;
  return { file: r.file, path: ui.hierarchy(object), enabled: r.data.m_Enabled === 1, hover: r.data.highlited.m_PathID, click: r.data.clicked.m_PathID };
});
const evidence = JSON.parse(await fs.readFile('artifacts/aihong-template/layout-evidence.json', 'utf8'));
const mapped = evidence.components.flatMap((c: { componentId: string; original: string }) => {
  const source = rows.find(r => r.file === 'level0' && r.path === c.original);
  return source ? [{ componentId: c.componentId, ...source, clip: source.enabled ? clips[source.hover] ?? null : null }] : [];
});
await fs.mkdir('artifacts/aihong-ui-sounds', { recursive: true });
await fs.writeFile('artifacts/aihong-ui-sounds/source.json', JSON.stringify({ source: 'E:/Game/GAMES/TheLamentingGeese_Data', clips, rows, mapped }, null, 2));
console.log(JSON.stringify(mapped, null, 2));
