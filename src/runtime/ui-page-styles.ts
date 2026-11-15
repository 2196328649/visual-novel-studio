import { effectiveUiTheme, type Project } from '../core/model';
import { uiPageTheme } from '../core/ui-page-settings';
import { pythonLiteral } from './literals';

/** Native menus and authored controls share the same page defaults. */
export function createUiPageStyles(project: Project): string {
  const pages = Object.entries(effectiveUiTheme(project.ui).pages ?? {}).filter(([, settings]) => Object.keys(settings.appearance ?? {}).length);
  const titles: Record<string, number> = {};
  const styles = pages.map(([page]) => {
    const theme = uiPageTheme(project, 'ui:' + page), prefix = 'vn_page_' + page;
    const font = project.assets.find(asset => asset.kind === 'font' && asset.id === theme.fontAssetId)?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
    const sound = project.assets.find(asset => asset.kind === 'audio' && asset.id === theme.hoverSoundId)?.path.replaceAll('\\', '/');
    const clickSound = project.assets.find(asset => asset.kind === 'audio' && asset.id === theme.clickSoundId)?.path.replaceAll('\\', '/');
    titles[page] = Math.min(32, theme.fontSize + 4);
    const text = (name: string, parent: string, size: number, color = theme.textColor) => `style ${prefix}_${name} is ${parent}
style ${prefix}_${name}:
    font ${pythonLiteral(font)}
    size ${size}
    color ${pythonLiteral(color)}
`;
    return `${text('text', 'default', theme.fontSize)}
${text('button_text', 'button_text', Math.min(24, theme.fontSize))}
${text('label_text', 'label_text', Math.min(24, theme.fontSize), theme.accent)}
${text('input', 'input', theme.fontSize)}
style ${prefix}_button is button
style ${prefix}_button:
    hover_background Solid(${pythonLiteral(theme.accent)})
    selected_background Solid(${pythonLiteral(theme.accent)})
    hover_sound ${pythonLiteral(sound)}
    activate_sound ${pythonLiteral(clickSound)}

style ${prefix}_small_button is ${prefix}_button
style ${prefix}_small_button:
    padding (6, 6)
${text('small_button_text', prefix + '_button_text', Math.min(18, theme.fontSize))}
style ${prefix}_bar is bar
style ${prefix}_bar:
    left_bar Solid(${pythonLiteral(theme.accent)})
style ${prefix}_slider is slider
style ${prefix}_slider:
    left_bar Solid(${pythonLiteral(theme.accent)})
style ${prefix}_scrollbar is scrollbar
style ${prefix}_scrollbar:
    thumb Solid(${pythonLiteral(theme.accent)})
style ${prefix}_vscrollbar is vscrollbar
style ${prefix}_vscrollbar:
    thumb Solid(${pythonLiteral(theme.accent)})
`;
  }).join('\n');
  return `init python:
    vn_ui_native_page_titles = ${pythonLiteral(titles)}

    def vn_ui_native_prefix(page, fallback=None):
        # None keeps Ren'Py's default styles. An empty prefix would make it look up
        # "_window", "_text" and so on, which do not exist and crash the menu.
        if page not in vn_ui_native_page_titles:
            return fallback
        return "vn_page_" + page + ("_small" if fallback == "vn_small" else "")

    def vn_ui_native_style(page, name):
        if page not in vn_ui_native_page_titles:
            return name
        return "vn_page_" + page + "_" + ("small_button" if name == "vn_small_button" else name)

    def vn_ui_native_title_size(page, fallback):
        return vn_ui_native_page_titles.get(page, fallback)

${styles}`;
}
