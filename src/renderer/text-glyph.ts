import type { VisualObject } from '../core/model';
import { uiTextShadow, textClipCss } from '../core/ui-text-effects';
import { chapterGlyphPoints } from '../core/chapter';

const fonts = new Map<string, Promise<string>>();
function embeddedFont(source: string): Promise<string> {
  let pending = fonts.get(source);
  if (!pending) {
    pending = fetch(source).then(response => { if (!response.ok) throw new Error('无法加载字形字体'); return response.blob(); }).then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    }));
    if (fonts.size >= 16) fonts.delete(fonts.keys().next().value!);
    fonts.set(source, pending);
    pending.catch(() => fonts.delete(source));
  }
  return pending;
}
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Rasterize the same centered, wrapped text layout used by the visual preview. */
async function rasterizeTextGlyph(text: string, fontSize: number, width: number, height: number, fontSource?: string, align: 'left' | 'center' | 'right' = 'center', vertical: 'top' | 'center' | 'bottom' = 'center', effects?: VisualObject['textEffects'], clip?: VisualObject['textClip'], italic = false) {
  if (!fontSource) throw new Error('文字字形需要可用的默认字体或导入字体');
  const font = await embeddedFont(fontSource);
  const sw = Math.max(1, Math.floor(width)), sh = Math.max(1, Math.floor(height));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:${vertical === 'top' ? 'flex-start' : vertical === 'bottom' ? 'flex-end' : 'center'};justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};overflow:hidden;clip-path:${textClipCss(clip) ?? 'none'};color:white;text-shadow:${xml(uiTextShadow({ style: effects }, 1) ?? 'none')};font-size:${fontSize}px;font-family:glyph;font-style:${italic ? 'italic' : 'normal'};font-synthesis:style;line-height:normal;white-space:pre-wrap;overflow-wrap:anywhere;text-align:${align}"><style>@font-face {font-family:glyph;src:url(${font})}</style><span>${xml(text)}</span></div></foreignObject></svg>`;
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
  const context = canvas.getContext('2d'); if (!context) throw new Error('无法创建文字字形画布');
  context.drawImage(image, 0, 0);
  return { points: chapterGlyphPoints(context.getImageData(0, 0, sw, sh).data, sw, sh), width: sw, height: sh };
}

const glyphs = new Map<string, ReturnType<typeof rasterizeTextGlyph>>();
/** Moving the playhead or reopening a clip does not change its font rasterization. */
export function textGlyph(...args: Parameters<typeof rasterizeTextGlyph>) {
  const key = JSON.stringify(args);
  const cached = glyphs.get(key);
  if (cached) { glyphs.delete(key); glyphs.set(key, cached); return cached; }
  const pending = rasterizeTextGlyph(...args);
  if (glyphs.size >= 32) glyphs.delete(glyphs.keys().next().value!);
  glyphs.set(key, pending);
  void pending.catch(() => { if (glyphs.get(key) === pending) glyphs.delete(key); });
  return pending;
}
