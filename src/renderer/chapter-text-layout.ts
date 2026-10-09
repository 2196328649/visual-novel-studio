import { effectiveUiTheme, orderedUiComponents, type Project } from '../core/model';
import { chapterPresentation, type ChapterContent } from '../core/chapter';
import type { ChapterTextLayout } from '../core/chapter-composition';
import { uiComponentBounds, uiComponentFontSize } from '../core/ui';
import type { AssetUrl } from './StageEditor';

/** Measure the authored UI's stacked title/subtitle using its actual loaded font. */
export async function measureChapterText(project: Project, chapter: ChapterContent, assetUrl: AssetUrl): Promise<ChapterTextLayout> {
  const result: ChapterTextLayout = {}, theme = effectiveUiTheme(project.ui);
  if (theme.pages?.chapterTitle?.layout !== 'custom' || chapterPresentation(project, chapter).titleImageId) return result;
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';document.body.append(host);
  try {
    for (const component of orderedUiComponents(project.ui).filter(c => c.page === 'chapterTitle' && c.kind === 'chapterTitle')) {
      const bounds = uiComponentBounds(component, project.width, project.height), fontSize = uiComponentFontSize(component, theme, project.width, project.height);
      const fontId = component.style?.fontAssetId ?? theme.fontAssetId, source = fontId ? assetUrl(fontId) : window.studio?.defaultFontUrl?.();
      if (!source) throw new Error('无法加载章节字体，未生成组合。');
      const family = 'chapter_measure_' + component.id;
      const face = new FontFace(family, `url(${JSON.stringify(source)})`); await face.load();document.fonts.add(face);
      try {
        const box = document.createElement('div'); box.style.cssText = `width:${bounds.width}px;height:${bounds.height}px;display:flex;flex-direction:column;align-items:stretch;gap:12px;font-family:${family};font-size:${fontSize}px;line-height:normal;white-space:pre-wrap;overflow-wrap:anywhere;`;host.append(box);
        const title = document.createElement('span');title.textContent=chapter.title;box.append(title);
        const subtitle = document.createElement('span');subtitle.textContent=chapter.subtitle ?? '';subtitle.style.fontSize=Math.min(fontSize,32)+'px';if(chapter.subtitle)box.append(subtitle);
        const parent=box.getBoundingClientRect();
        const rect=(element:HTMLElement)=>{const r=element.getBoundingClientRect();return {x:component.x,y:component.y+(r.top-parent.top)/project.height,width:bounds.width/project.width,height:r.height/project.height};};
        result[component.id]={title:rect(title),subtitle:chapter.subtitle?rect(subtitle):undefined};box.remove();
      }finally{document.fonts.delete(face);}
    }
    return result;
  }finally{host.remove();}
}
