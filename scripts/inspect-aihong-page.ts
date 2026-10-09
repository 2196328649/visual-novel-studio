import { UnityUi } from './lib/unity-ui';
const ui = await UnityUi.load('artifacts/aihong-ui-inspection/2026-09-10-layout');
const prefix = process.argv[2] ?? 'Canvas-AdvUI/Config';
const detail = process.argv.includes('--data');
const visible = (node: ReturnType<typeof ui.node>): boolean => {
  let name = ui.hierarchy(node);
  while (name.startsWith(prefix + '/')) {
    if (ui.nodes.get(name)?.data.m_IsActive === false) return false;
    name = name.slice(0, name.lastIndexOf('/'));
  }
  return true;
};
for (const [name, node] of [...ui.nodes].filter(([name]) => name === prefix || name.startsWith(prefix + '/')).sort(([a], [b]) => a.localeCompare(b))) {
  if (process.argv.includes('--self') && name !== prefix) continue;
  const components = ui.components(node);
  const r = ui.rectangle(node);
  if (detail && name === prefix) console.log(JSON.stringify({ name, components: components.filter(c => c.type !== 'RectTransform' && c.class !== 'UnityEngine.UI.Image') }));
  else if (components.some(c => c.type === 'MonoBehaviour')) console.log(JSON.stringify({ name: name.slice(prefix.length + 1), active: visible(node), rect: [r.x, r.y, r.width, r.height].map(n => +n.toFixed(2)), sprite: ui.localizedSprite(node)?.data.m_Name,
    text: components.filter(c => c.data.m_text || c.data.m_Text).map(c => c.data.m_text ?? c.data.m_Text).filter(t => typeof t === 'string'),
    classes: components.filter(c => c.type === 'MonoBehaviour').map(c => c.class),
    slider: components.filter(c => c.class === 'UnityEngine.UI.Slider').map(c => ({ min: c.data.m_MinValue, max: c.data.m_MaxValue, value: c.data.m_Value, methods: c.data.m_OnValueChanged?.m_PersistentCalls?.m_Calls?.map((call: any) => call.m_MethodName) })),
  }));
}
