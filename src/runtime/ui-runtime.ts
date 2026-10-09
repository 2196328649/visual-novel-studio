import { createUiControlRuntime } from './ui-control-runtime';
import { createUiAnimationRuntime } from './ui-animation-runtime';
import { declaredUiComponents, effectiveUiComponents, effectiveUiTheme, type Project, type UiComponent, type UiSkin } from '../core/model';
import { pythonLiteral } from './literals';
import { uiPageBackgroundOpacity, uiProperties, uiPropertyApplies, type UiProperty } from '../core/ui';
import { conditionExpression } from './expressions';
import { uiHoverSound } from '../core/ui-sound';

export function componentSkinData(project: Project, component: UiComponent) {
  return uiSkinData(project, component.skin);
}
export function uiSkinData(project: Project, source?: UiSkin) {
  const skin = { ...source } as Record<string, unknown>;
  for (const state of ['idle', 'hover', 'pressed', 'selected', 'disabled'] as const) {
    skin[state] = project.assets.find(asset => asset.id === source?.[state] && asset.kind === 'image')?.path.replaceAll('\\', '/');
  }
  return skin;
}

/** A native Ren'Py button with an actual held mouse state and release cancellation. */
export function createUiRuntime(project: Project): string {
  project = { ...project, ui: effectiveUiTheme(project.ui) };
  const pages = Object.fromEntries([...new Set([...Object.keys(project.ui.pages ?? {}), 'history'])].map(page => [page, {
    ...project.ui.pages?.[page as UiComponent['page']],
    backgroundOpacity: uiPageBackgroundOpacity(project.ui, page as UiComponent['page']),
    backgroundPath: project.assets.find(asset => asset.id === project.ui.pages?.[page as UiComponent['page']]?.backgroundId)?.path.replaceAll('\\', '/'),
  }]));
  const replacingKinds = new Set(['galleryGrid', 'musicTrackList', 'voiceCollection', 'chapterList', 'historyList', 'flowchart', 'pauseMenu', 'staffRoll']);
  const replacedPages = [...new Set(effectiveUiComponents(project.ui).filter(c => replacingKinds.has(c.kind)).map(c => c.page))];
  const storyNames = Object.fromEntries(project.nodes.map(node => {
    const scene = project.scenes.find(scene => scene.id === node.sceneId);
    return [node.id, { scene: scene?.name ?? '', chapter: project.chapters.find(chapter => chapter.id === scene?.chapterId)?.name ?? '' }];
  }));
  const components = declaredUiComponents(project);
  const hoverPath = (component?: UiComponent) => project.assets.find(a => a.id === uiHoverSound(project, component))?.path.replaceAll('\\', '/');
  const hoverSounds = Object.fromEntries(components.filter(c => c.hoverSoundId !== undefined).map(c => [c.id, hoverPath(c)]));
  const pageScreens: Record<string, string[]> = { main: ['main_menu'], say: ['say'], choice: ['choice'], save: ['save', 'load'], preferences: ['preferences'], voiceSettings: ['voice_settings'], pause: ['pause_menu'], history: ['history'], gallery: ['gallery'], musicRoom: ['music_room'], voiceCollection: ['voice_collection'], chapterSelect: ['chapter_select'], flowchart: ['flowchart'], staff: ['staff_roll'], messageBox: ['confirm'] };
  const tooltipScreens = [...new Set(components.filter(c => c.binding === 'tooltip').flatMap(c => pageScreens[c.page] ?? []))];
  const tooltipFont = project.assets.find(a => a.id === project.ui.fontAssetId && a.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  const uiDefaults = Object.fromEntries(components.map(c => [c.id, {
    text: c.text, x: c.x, y: c.y, width: c.width, height: c.height,
    opacity: c.style?.opacity ?? 1, value: c.value ?? 0,
  }]));
  const conditions = components.map(c => `        ${pythonLiteral(c.id)}: {"visible": lambda: ${c.visibleWhen ? conditionExpression(project, c.visibleWhen) : 'True'}, "enabled": lambda: ${c.disabled ? 'False' : c.enabledWhen ? conditionExpression(project, c.enabledWhen) : 'True'}, "selected": lambda: ${c.selectedWhen ? conditionExpression(project, c.selectedWhen) : 'False'}},`).join('\n');
  const minigames = Object.fromEntries((project.minigames ?? []).map(game => [game.id, game]));
  const customPages = Object.fromEntries((project.ui.customPages ?? []).map(page => [page.id, {
    name: page.name,
    background: page.background,
    backgroundPath: project.assets.find(asset => asset.id === page.backgroundId && asset.kind === 'image')?.path.replaceAll('\\', '/'),
    modal: page.modal,
    componentIds: page.components.map(component => component.id),
  }]));
  return `default vn_ui_open_pages = {}
default vn_ui_page_results = {}

python early:
    import pygame_sdl2 as vn_ui_pygame

    class VnSkinButton(renpy.display.behavior.Button):
        def __init__(self, replaces=None, vn_component_id=None, vn_events=None, **properties):
            # Use real pointer boundaries below, not focus reconstruction after
            # a blueprint callback, to avoid replaying sounds while stationary.
            properties["hover_sound"] = None
            renpy.display.behavior.Button.__init__(self, **properties)
            self.vn_component_id = vn_component_id
            self.vn_events = vn_events or {}
            same_action = replaces is not None and getattr(replaces, "action", None) == self.action and getattr(replaces, "vn_component_id", None) == vn_component_id
            self.vn_held = getattr(replaces, "vn_held", False) if same_action else False
            self.vn_inside = getattr(replaces, "vn_inside", False) if same_action else False
            self.vn_pointer_inside = getattr(replaces, "vn_pointer_inside", False) if same_action else False
            self.vn_cancelled = getattr(replaces, "vn_cancelled", False) if same_action else False
            self.vn_bounds = getattr(replaces, "vn_bounds", (0, 0))
            if replaces is not None and renpy.display.focus.get_grab() is replaces:
                renpy.display.focus.set_grab(self if self.vn_held else None)

        def render(self, width, height, st, at):
            rendered = renpy.display.behavior.Button.render(self, width, height, st, at)
            self.vn_bounds = rendered.get_size()
            if not self.locked and self.clicked is None and self._get_tooltip():
                rendered.add_focus(self, None, 0, 0, *self.vn_bounds)
            return rendered

        def vn_release(self, cancel=True):
            self.vn_held = False
            if cancel:
                self.vn_cancelled = True
            if renpy.display.focus.get_grab() is self:
                renpy.display.focus.set_grab(None)

        def vn_available(self):
            return not self.locked and self.is_sensitive() and (self.vn_component_id is None or (vn_ui_get(self.vn_component_id, "visible") and vn_ui_get(self.vn_component_id, "enabled")))

        def vn_emit(self, trigger):
            if self.vn_available():
                if trigger == "hover":
                    vn_ui_play_hover(self.vn_component_id)
                previous = getattr(vn_ui_cancel_pointer, "source", None)
                vn_ui_cancel_pointer.source = self
                try:
                    return renpy.display.behavior.run(self.vn_events.get(trigger))
                finally:
                    vn_ui_cancel_pointer.source = previous

        def unfocus(self, default=False):
            if not self.vn_available():
                self.vn_release()
            result = renpy.display.behavior.Button.unfocus(self, default)
            if not self.is_sensitive():
                self.set_style_prefix(self.role + "insensitive_", True)
            return result

        def focus(self, default=False):
            if not self.is_sensitive():
                self.set_style_prefix(self.role + "insensitive_", True)
                return None
            return renpy.display.behavior.Button.focus(self, default)

        def per_interact(self):
            if renpy.game.after_rollback:
                self.vn_release()
                self.vn_pointer_inside = False
            renpy.display.behavior.Button.per_interact(self)
            if not self.locked and self._get_tooltip():
                self.focusable = True
            if self.vn_held and not self.vn_available():
                self.vn_release()
            if self.vn_held:
                self.set_style_prefix(self.role + ("activate_" if self.vn_inside else "idle_"), True)

        def event(self, ev, x, y, st):
            inside = 0 <= x < self.vn_bounds[0] and 0 <= y < self.vn_bounds[1]
            if not self.locked and not self.is_sensitive() and self.is_focused():
                if (inside and ev.type in (vn_ui_pygame.MOUSEBUTTONDOWN, vn_ui_pygame.MOUSEBUTTONUP) and ev.button == 1) or renpy.display.behavior.map_event(ev, "button_select"):
                    raise renpy.IgnoreEvent()
            if ev.type == vn_ui_pygame.MOUSEMOTION and not self.vn_held:
                pointer_inside = inside and self.is_focused() and self.vn_available()
                if pointer_inside != self.vn_pointer_inside:
                    self.vn_pointer_inside = pointer_inside
                    self.vn_emit("hover" if pointer_inside else "unhover")
            if ev.type == vn_ui_pygame.MOUSEBUTTONDOWN and ev.button == 1:
                if self.vn_available() and self.is_focused() and self.clicked is not None and inside:
                    self.vn_cancelled = False
                    self.vn_held = self.vn_inside = self.vn_pointer_inside = True
                    renpy.display.focus.set_grab(self)
                    self.set_style_prefix(self.role + "activate_", True)
                    renpy.redraw(self, 0)
                    self.vn_emit("press")
                    if not self.vn_available():
                        self.vn_release()
                    raise renpy.IgnoreEvent()
            if self.vn_held and ev.type == vn_ui_pygame.MOUSEMOTION:
                previous_inside = self.vn_pointer_inside
                self.vn_inside = self.vn_pointer_inside = inside
                self.set_style_prefix(self.role + ("activate_" if inside else "idle_"), True)
                renpy.redraw(self, 0)
                if inside != previous_inside:
                    self.vn_emit("hover" if inside else "unhover")
                raise renpy.IgnoreEvent()
            if ev.type == vn_ui_pygame.MOUSEBUTTONUP and ev.button == 1:
                held = self.vn_held
                self.vn_release(False)
                if held:
                    self.set_style_prefix(self.role + ("hover_" if inside else "idle_"), True)
                    renpy.redraw(self, 0)
                    self.vn_emit("release")
                    if inside and not self.vn_cancelled and self.vn_available() and self.clicked is not None:
                        renpy.exports.play(self.style.activate_sound)
                        result = renpy.display.behavior.run(self.clicked)
                        if result is not None:
                            return result
                    raise renpy.IgnoreEvent()
                if self.is_focused() and self.clicked is not None:
                    raise renpy.IgnoreEvent()
            if self.is_focused() and self.vn_available() and (renpy.display.behavior.map_event(ev, "button_select") or renpy.display.behavior.map_event(ev, "K_SPACE")):
                self.vn_cancelled = False
                self.vn_held = True
                self.vn_emit("press")
                self.vn_release(False)
                if not self.vn_cancelled:
                    self.vn_emit("release")
                if not self.vn_cancelled and self.vn_available() and self.clicked is not None:
                    renpy.exports.play(self.style.activate_sound)
                    result = renpy.display.behavior.run(self.clicked)
                    if result is not None:
                        return result
                raise renpy.IgnoreEvent()
            return renpy.display.behavior.Button.event(self, ev, x, y, st)

    renpy.register_sl_displayable("vn_skin_button", VnSkinButton, "button", nchildren=1, replaces=True).copy_properties("button").add_property("vn_component_id").add_property("vn_events")

    class VnUiStateFrame(renpy.display.layout.Window):
        def __init__(self, vn_inherit_state=False, **properties):
            self.vn_inherit_state = vn_inherit_state
            super(VnUiStateFrame, self).__init__(**properties)

        def set_style_prefix(self, prefix, root):
            if not self.vn_inherit_state and "insensitive" not in prefix:
                prefix = "idle_"
            super(VnUiStateFrame, self).set_style_prefix(prefix, root)

    renpy.register_sl_displayable("vn_state_frame", VnUiStateFrame, "frame", nchildren=1).copy_properties("frame").add_property("vn_inherit_state")

    class VnUiStateViewport(renpy.display.viewport.Viewport):
        def set_style_prefix(self, prefix, root):
            # A viewport's own focus must not recolor text, but its enclosing
            # component still inherits the parent button's visual state.
            if not root:
                renpy.display.layout.Container.set_style_prefix(self, prefix, False)

    renpy.register_sl_displayable("vn_state_viewport", VnUiStateViewport, "viewport", nchildren=1).copy_properties("viewport")

    class VnUiBar(renpy.display.behavior.Bar):
        def is_focused(self):
            # A value callback may rebuild context focus during a drag. The
            # grabbed bar must still receive the following move/release event.
            return renpy.display.focus.get_grab() is self or super(VnUiBar, self).is_focused()

        def __init__(self, replaces=None, **properties):
            super(VnUiBar, self).__init__(replaces=replaces, **properties)
            self.vn_component_id = getattr(self.value, "component_id", None)
            if replaces is not None and renpy.display.focus.get_grab() is replaces:
                renpy.display.focus.set_grab(self if self.adjustment.adjustable and self.value == replaces.value else None)

        def vn_release(self):
            if renpy.display.focus.get_grab() is self:
                renpy.display.focus.set_grab(None)

        def per_interact(self):
            super(VnUiBar, self).per_interact()
            if not self.adjustment.adjustable or renpy.game.after_rollback:
                self.vn_release()

    renpy.register_sl_displayable("vn_ui_bar", VnUiBar, "bar", replaces=True).copy_properties("bar")

init python:
    vn_ui_hover_sound = ${pythonLiteral(hoverPath())}
    vn_ui_hover_overrides = ${pythonLiteral(hoverSounds)}
    renpy.music.register_channel("vn_ui_feedback", mixer="sfx", loop=False)
    # Ren'Py's style sounds are UI feedback, separate from story sound/voice.
    config.play_channel = "vn_ui_feedback"
    style.button.hover_sound = vn_ui_hover_sound

    def vn_ui_play_hover(component_id=None):
        sound = vn_ui_hover_overrides.get(component_id, vn_ui_hover_sound)
        if sound:
            renpy.play(sound, channel="vn_ui_feedback")

    vn_ui_defaults = ${pythonLiteral(uiDefaults)}
    vn_ui_parents = ${pythonLiteral(Object.fromEntries(components.filter(c => c.parentId).map(c => [c.id, c.parentId])))}
    vn_ui_property_types = ${pythonLiteral(Object.fromEntries(Object.entries(uiProperties).map(([key, entry]) => [key, entry.type])))}
    vn_ui_allowed_properties = ${pythonLiteral(Object.fromEntries(components.map(component => [component.id, Object.keys(uiProperties).filter(key => uiPropertyApplies(component, key as UiProperty))])))}
    vn_ui_conditions = {
${conditions}
    }

    def vn_ui_get(component_id, property, fallback=None):
        if component_id not in vn_ui_defaults or property not in vn_ui_property_types:
            raise Exception("蓝图引用的组件或属性不存在，请重新选择。")
        if property not in vn_ui_allowed_properties[component_id]:
            raise Exception("此组件不支持所选属性；文字用于固定文字与按钮，启用用于按钮和设置控件，选中用于按钮。")
        override = vn_ui_overrides.get(component_id, {})
        if property in override:
            return override[property]
        if fallback is not None:
            return fallback
        if property in vn_ui_conditions[component_id]:
            return vn_ui_conditions[component_id][property]()
        return vn_ui_defaults[component_id].get(property)

    def vn_ui_extent(component_id, property):
        result = 1.0
        seen = set()
        while component_id and component_id not in seen:
            seen.add(component_id)
            result *= vn_ui_get(component_id, property)
            component_id = vn_ui_parents.get(component_id)
        return result

    def vn_ui_origin(component_id, property):
        extent_property = "width" if property == "x" else "height"
        lineage, seen = [], set()
        while component_id and component_id not in seen:
            seen.add(component_id)
            lineage.append(component_id)
            component_id = vn_ui_parents.get(component_id)
        result, extent = 0.0, 1.0
        for identity in reversed(lineage):
            result += vn_ui_get(identity, property) * extent
            extent *= vn_ui_get(identity, extent_property)
        return result

    def vn_ui_position(component_id, property):
        from math import floor
        dimension = ${project.width} if property == "x" else ${project.height}
        # Round world positions before subtracting the parent's pixel origin,
        # matching the preview even for negative offsets and nested children.
        result = floor(vn_ui_origin(component_id, property) * dimension + 0.5)
        parent = vn_ui_parents.get(component_id)
        if parent:
            result -= floor(vn_ui_origin(parent, property) * dimension + 0.5)
        return result

    def vn_ui_ancestor_enabled(component_id):
        seen = set()
        parent = vn_ui_parents.get(component_id)
        while parent and parent not in seen:
            seen.add(parent)
            if "enabled" in vn_ui_allowed_properties.get(parent, ()) and not vn_ui_get(parent, "enabled"):
                return False
            parent = vn_ui_parents.get(parent)
        return True

    def vn_ui_set(component_id, property, value):
        vn_ui_get(component_id, property)
        kind = vn_ui_property_types[property]
        valid = isinstance(value, bool) if kind == "boolean" else isinstance(value, str) if kind == "string" else not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value) and (property not in ("opacity", "value") or 0 <= value <= 1)
        if not valid:
            raise Exception("组件属性值类型不匹配；位置和大小需要数值，不透明度和进度使用 0 至 1。")
        vn_ui_animation_tick(False)
        vn_ui_animations.pop((component_id, property), None)
        override = dict(vn_ui_overrides.get(component_id, {}))
        if property in override and override[property] == value:
            return
        override[property] = value
        vn_ui_overrides[component_id] = override
        if property in ("visible", "enabled") and not value:
            vn_ui_cancel_pointer([component_id])
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_literal(text):
        return str(text).replace("{", "{{")

    def vn_ui_reset(component_id):
        if component_id not in vn_ui_defaults:
            raise Exception("蓝图引用的界面组件不存在。")
        vn_ui_stop_animation(component_id)
        vn_ui_overrides.pop(component_id, None)
        if component_id in getattr(renpy.store, "vn_spine_states", {}):
            vn_spine_states[component_id] = vns_spine.make_states()[component_id]
        renpy.restart_interaction()

    vn_ui_pages = ${pythonLiteral(pages)}
    vn_ui_replaced_pages = ${pythonLiteral(replacedPages)}
    vn_ui_story_names = ${pythonLiteral(storyNames)}
    vn_minigames = ${pythonLiteral(minigames)}
    vn_custom_pages = ${pythonLiteral(customPages)}

${createUiControlRuntime(project,pageScreens)}
    def vn_ui_cancel_pointer(component_ids=None):
        current, active = renpy.get_editable_input_value()
        if active and isinstance(current, VnParameterInput) and current.component_id and (component_ids is None or current.component_id in component_ids):
            renpy.set_editable_input_value(current, False)
        # A page opened from OnPressed must cancel both the dispatching
        # displayable and any replacement currently holding the mouse grab.
        for button in (getattr(vn_ui_cancel_pointer, "source", None), renpy.display.focus.get_grab()):
            if isinstance(button, (VnSkinButton, VnUiBar)) and (component_ids is None or button.vn_component_id in component_ids):
                button.vn_release()
                button.vn_inside = button.vn_pointer_inside = False

    def vn_ui_page_begin(page_id, wait=False):
        if page_id not in vn_custom_pages:
            raise Exception("自定义界面不存在，请重新选择。")
        if page_id in vn_ui_open_pages:
            return ""
        if vn_custom_pages[page_id].get("modal", True):
            vn_ui_cancel_pointer()
        vn_ui_page_results.pop(page_id, None)
        vn_ui_open_pages[page_id] = "waiting" if wait else "shown"
        renpy.restart_interaction()

    def vn_ui_open_page(page_id):
        vn_ui_page_begin(page_id, False)

    def vn_ui_page_cleanup(page_id):
        vn_ui_open_pages.pop(page_id, None)
        vn_ui_page_results.pop(page_id, None)

    def vn_ui_close_page(page_id, result="完成"):
        vn_ui_cancel_pointer(vn_custom_pages.get(page_id, {}).get("componentIds", []))
        vn_ui_page_results[page_id] = str(result)
        if vn_ui_open_pages.get(page_id) == "shown":
            vn_ui_open_pages.pop(page_id, None)
        renpy.restart_interaction()

    def vn_run_ui_show(blueprint_id):
        # Screen reconstruction after load/rollback must retain the restored
        # control state, rather than replaying page-entry side effects.
        if not renpy.game.after_rollback:
            vn_run_blueprint(blueprint_id)

    def vn_ui_cancel_page(page_id):
        if page_id in vn_ui_open_pages:
            vn_ui_close_page(page_id, "取消")
        else:
            vn_finish_minigame("cancel")

    # Authored pages also open from the main menu, where ordinary overlays
    # are suppressed. The host is empty whenever no non-waiting page is open.
    config.always_shown_screens.append("vn_blueprint_pages")
    config.overlay_screens.append("vn_ui_tooltip")
    vn_ui_tooltip_screens = ${pythonLiteral(tooltipScreens)}

    def vn_minigame_definition(minigame_id):
        definition = vn_minigames.get(str(minigame_id))
        if not definition:
            raise Exception("小游戏定义不存在，请重新选择。")
        return definition

    def vn_minigame_begin(run_key, minigame_id, title="", prompt=""):
        global vn_minigame_context, vn_minigame_finished
        definition = vn_minigame_definition(minigame_id)
        previous = vn_minigame_context if isinstance(vn_minigame_context, dict) else {}
        if previous.get("runKey") != str(run_key) or previous.get("minigameId") != str(minigame_id):
            vn_minigame_context = {"runKey": str(run_key), "minigameId": str(minigame_id), "title": str(title), "prompt": str(prompt), "values": {}}
            vn_minigame_finished = None
            for component_id in vn_custom_pages.get(definition.get("uiPageId"), {}).get("componentIds", []):
                vn_ui_reset(component_id)
        else:
            vn_minigame_context = dict(previous)
            vn_minigame_context["title"] = str(title)
            vn_minigame_context["prompt"] = str(prompt)
            vn_minigame_context.setdefault("values", {})
        renpy.retain_after_load()
        return definition

    def vn_minigame_value(value):
        if isinstance(value, bool) or isinstance(value, str):
            return value
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
        raise Exception("小游戏状态只能保存数值、文字或开关。")

    def vn_minigame_set(key, value):
        global vn_minigame_context
        context = dict(vn_minigame_context or {})
        values = dict(context.get("values") or {})
        values[str(key)] = vn_minigame_value(value)
        context["values"] = values
        vn_minigame_context = context
        renpy.retain_after_load()
        renpy.restart_interaction()
        return value

    def vn_minigame_get(key, fallback=None):
        return (vn_minigame_context or {}).get("values", {}).get(str(key), fallback)

    def vn_minigame_status():
        return str(vn_minigame_get("status", ""))

    def vn_minigame_set_status(status):
        return vn_minigame_set("status", str(status))

    def vn_minigame_should_start():
        global vn_minigame_context
        context = dict(vn_minigame_context or {})
        if context.get("started"):
            return False
        context["started"] = True
        vn_minigame_context = context
        renpy.retain_after_load()
        return True

    def vn_minigame_page(minigame_id):
        return vn_minigame_definition(minigame_id).get("uiPageId")

    def vn_minigame_page_modal():
        context = vn_minigame_context or {}
        minigame_id = context.get("minigameId")
        if not minigame_id:
            return True
        page_id = vn_minigame_page(minigame_id)
        return bool(vn_custom_pages.get(page_id, {}).get("modal", True))

    def vn_finish_minigame(result):
        global vn_minigame_finished, vn_minigame_context
        if result not in ("success", "failure", "cancel"):
            raise Exception("小游戏结束结果必须是 success、failure 或 cancel。")
        context = dict(vn_minigame_context or {})
        context["result"] = result
        vn_minigame_context = context
        vn_minigame_finished = result
        renpy.retain_after_load()
        renpy.restart_interaction()
        return result

    def vn_minigame_result_value(value=None):
        if value in ("success", "failure", "cancel"):
            return value
        if vn_minigame_finished in ("success", "failure", "cancel"):
            return vn_minigame_finished
        return "cancel"

    def vn_minigame_close():
        global vn_minigame_context, vn_minigame_finished
        vn_minigame_context = {}
        vn_minigame_finished = None
        renpy.retain_after_load()

    def vn_ui_save_metadata(data):
        names = vn_ui_story_names.get(getattr(renpy.store, "vn_current_node", None), {})
        data["vn_ui_scene"] = names.get("scene", "")
        data["vn_ui_chapter"] = names.get("chapter", "")
        paragraphs = [renpy.filter_text_tags(str(entry.what), allow=[]) for entry in getattr(renpy.store, "_history_list", [])[-8:] if getattr(entry, "what", "")]
        current = renpy.filter_text_tags(str(getattr(renpy.store, "_last_say_what", "") or ""), allow=[])
        if current and (not paragraphs or paragraphs[-1] != current):
            paragraphs.append(current)
        data["vn_ui_excerpt"] = "\\n\\n".join(paragraphs[-8:])[-2400:]

    config.save_json_callbacks.append(vn_ui_save_metadata)

    def vn_ui_slot_heading(slot, page=None):
        return FileJson(slot, "vn_ui_chapter", page=page, empty="") or FileJson(slot, "vn_ui_scene", page=page, empty="") or ""

    def vn_ui_slot_caption(slot, mode, page=None, only_excerpt=False):
        if mode == "story":
            heading = "" if only_excerpt else vn_ui_slot_heading(slot, page)
            excerpt = FileJson(slot, "vn_ui_excerpt", page=page, empty="") or ""
            if heading or excerpt:
                return "\\n\\n".join(text for text in (heading, excerpt) if text)
        return FileTime(slot, page=page, format="%Y-%m-%d\\n%H:%M", empty="空存档")

    def vn_ui_rect(rect, width, height):
        x = int(rect["x"] * width + 0.5)
        y = int(rect["y"] * height + 0.5)
        return (x, y, max(1, min(int(rect["width"] * width + 0.5), width - x)), max(1, min(int(rect["height"] * height + 0.5), height - y)))

    class VnUiStateSurface(renpy.Displayable):
        def __init__(self, skin, width, height, inherit=False, colors=None, **kwargs):
            super(VnUiStateSurface, self).__init__(**kwargs)
            self.skin, self.width, self.height, self.inherit = skin, width, height, inherit
            self.colors = colors or {}
            self.state = "idle"
            self.surface = None

        def set_style_prefix(self, prefix, root):
            super(VnUiStateSurface, self).set_style_prefix(prefix, root)
            state = "disabled" if "insensitive" in prefix else "pressed" if "activate" in prefix else "selected" if "selected" in prefix else "hover" if "hover" in prefix else "idle"
            if not self.inherit and state != "disabled":
                state = "idle"
            if self.state != state:
                self.state, self.surface = state, None
                renpy.redraw(self, 0)

        def render(self, width, height, st, at):
            if self.surface is None:
                self.surface = vn_ui_surface(self.skin, self.state, self.width, self.height, self.colors.get(self.state, "#00000000"))
            return renpy.render(self.surface, self.width, self.height, st, at)

        def visit(self):
            return [self.surface] if self.surface is not None else []

    def vn_ui_text_shadow(caption, font, size, bold, width, height, look):
        color = look.get("shadowColor", "#000000")
        # Blur a separately padded text surface; the sharp glyph face and its
        # single outline remain independent of the shadow's opacity.
        content = Fixed(xysize=(width, height))
        content.add(Text(caption, substitute=False, font=font, size=size, bold=bold,
            color=color, hover_color=color, activate_color=color, selected_color=color,
            insensitive_color=color, outlines=[], slow_cps=0,
            xalign=0.5, yalign=0.5, text_align=0.5, xmaximum=width))
        return Transform(content, blur=look.get("shadowBlur", 0),
            alpha=look.get("shadowOpacity", 0.4),
            xoffset=look.get("shadowX", 0), yoffset=look.get("shadowY", 0))

    def vn_ui_box(skin, state, width, height, color, look=None):
        look = look or {}
        key = "background" if state == "idle" else state + "Background"
        surface = vn_ui_surface(skin, state, width, height, look.get(key, look.get("background", color)))
        border = min(width / 2, height / 2, look.get("borderWidth", 0))
        if not border:
            return surface
        result = Fixed(xysize=(width, height))
        result.add(surface)
        for x, y, w, h in [(0, 0, width, border), (0, height - border, width, border), (0, border, border, height - border * 2), (width - border, border, border, height - border * 2)]:
            result.add(Transform(Solid(look.get("borderColor", "#ffffff")), pos=(int(x), int(y)), xysize=(max(1, int(w)), max(1, int(h)))))
        return result

    def vn_ui_surface(skin, state, width, height, color):
        if state in ("pressed", "selected"):
            image_path = skin.get(state) or skin.get("hover") or skin.get("idle")
        else:
            image_path = skin.get(state) or skin.get("idle")
        if not image_path:
            return Solid(color)
        fit = skin.get("fit", "stretch")
        if fit == "nineSlice":
            borders = skin.get("borders") or dict(left=12, top=12, right=12, bottom=12)
            horizontal = min(1.0, width / max(1.0, borders["left"] + borders["right"]))
            vertical = min(1.0, height / max(1.0, borders["top"] + borders["bottom"]))
            result = Frame(image_path, int(borders["left"] * horizontal), int(borders["top"] * vertical), int(borders["right"] * horizontal), int(borders["bottom"] * vertical), tile=False)
        else:
            result = Transform(image_path, xysize=(width, height), fit="fill" if fit == "stretch" else fit)
            if fit in ("contain", "cover"):
                # Fit changes the image's render size, not its layout box.
                # Center and clip it to the authored box, as CSS object-fit does.
                result.xalign = result.yalign = 0.5
                result = Transform(Fixed(result, xysize=(width, height)), crop=(0, 0, width, height))
        if state == "disabled" and not skin.get("disabled"):
            result = Transform(result, alpha=0.45)
        brightness = skin.get("brightness", {}).get(state, 1.0)
        if brightness != 1.0:
            channel = max(0, min(255, int(brightness * 255 + 0.5)))
            result = Transform(result, matrixcolor=TintMatrix("#%02x%02x%02x" % (channel, channel, channel)))
        return result

${createUiAnimationRuntime(project)}
default vn_ui_overrides = {}
default vn_minigame_context = {}
default vn_minigame_finished = None

label vn_minigame_interact:
    if not vn_minigame_context:
        $ raise Exception("请从自定义小游戏入口调用交互页面。")
    if vn_minigame_finished is None:
        call screen vn_minigame_custom(vn_minigame_context["minigameId"], title=vn_minigame_context.get("title", ""), prompt=vn_minigame_context.get("prompt", ""))
        $ vn_finish_minigame(vn_minigame_result_value(_return))
    return vn_minigame_result_value()

screen vn_page_background(page):
    $ settings = vn_ui_pages.get(page, {})
    add Solid(settings.get("background", ${pythonLiteral(project.ui.background)})) alpha settings.get("backgroundOpacity", 1.0)
    if settings.get("backgroundPath"):
        add Transform(settings["backgroundPath"], xysize=(${project.width}, ${project.height}), fit="cover") alpha settings.get("backgroundOpacity", 1.0)

screen vn_ui_tooltip():
    zorder 200
    if GetTooltip() and not any(renpy.get_screen(name) for name in vn_ui_tooltip_screens):
        frame:
            xalign 0.5
            yalign 0.9
            padding (16, 8)
            background Solid("#171c25ec")
            text vn_ui_literal(GetTooltip()) substitute False font ${pythonLiteral(tooltipFont)} size ${Math.min(30, project.ui.fontSize)} color "#ffffff"
`;
}
