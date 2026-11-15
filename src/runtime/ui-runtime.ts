import { uiSaveMigrationRuntime } from './ui-save-migration-runtime';
import { uiPageHostScreens } from '../core/ui-pages';
import { createUiVideoRuntime, uiVideoDefaults } from './ui-video-runtime';
import { createUiLayoutRuntime, uiLayoutEarly } from './ui-layout-runtime';
import { createUiImageRuntime, uiImageDefaults } from './ui-image-runtime';
import { createUiControlRuntime } from './ui-control-runtime';
import { createUiAnimationRuntime } from './ui-animation-runtime';
import { createUiPropertyControlRuntime } from './ui-property-control-runtime';
import { uiPropertyBatchRuntime } from './ui-property-batch-runtime';
import { declaredUiComponents, effectiveUiComponents, effectiveUiTheme, type Project, type UiComponent, type UiSkin } from '../core/model';
import { pythonLiteral } from './literals';
import { uiPageBackgroundOpacity, uiProperties, type UiProperty } from '../core/ui';
import { conditionExpression } from './expressions';
import { uiClickSound, uiHoverSound } from '../core/ui-sound';
import { uiPropertyDefaults, uiPropertyFallbacks } from '../core/ui-properties';
import { uiAssetBinding } from '../core/ui-asset-binding';
import { uiPageDefaults, uiPageRuntime, uiPageWaitScreen } from './ui-page-runtime';
import { uiNativePageDefaults, uiNativePageRuntime } from './ui-native-page-runtime';

export function componentSkinData(project: Project, component: UiComponent) {
  return uiSkinData(project, component.skin);
}
export function uiSkinData(project: Project, source?: UiSkin) {
  const skin: Record<string, unknown> = Object.fromEntries(Object.entries(source ?? {}).filter(([, value]) => value !== undefined));
  if (source?.brightness && Object.values(source.brightness).some(value => value === undefined)) skin.brightness = Object.fromEntries(Object.entries(source.brightness).filter(([, value]) => value !== undefined));
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
  const hoverSounds = Object.fromEntries(components.map(c => [c.id, hoverPath(c)]));
  const clickPath = project.assets.find(a => a.id === uiClickSound(project))?.path.replaceAll('\\', '/');
  const pageScreens: Partial<Record<UiComponent['page'], readonly string[]>> = uiPageHostScreens;
  const tooltipScreens = [...new Set(components.filter(c => c.binding === 'tooltip').flatMap(c => pageScreens[c.page] ?? []))];
  const tooltipFont = project.assets.find(a => a.id === project.ui.fontAssetId && a.kind === 'font')?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  const uiDefaults = uiPropertyDefaults(project, components);
  const assetBindings = Object.fromEntries(components.flatMap(c => { const variable = uiAssetBinding(project, c); return variable ? [[c.id, { parameterId: variable.id, kind: c.kind, property: c.kind === 'video' ? 'video' : 'image' }]] : []; }));
  const propertyFallbacks = Object.fromEntries(components.map(c => [c.id, Object.fromEntries((Object.keys(uiProperties) as UiProperty[]).map(key => [key, uiPropertyFallbacks(c, key)]))]));
  const componentPages = Object.fromEntries(components.map(c => [c.id, c.page === 'custom' ? project.ui.customPages.find(page => page.components.some(item => item.id === c.id))?.id ?? '' : 'ui:' + c.page]));
  const conditions = components.map(c => `        ${pythonLiteral(c.id)}: {"visible": lambda: ${c.visibleWhen ? conditionExpression(project, c.visibleWhen) : 'True'}, "enabled": lambda: ${c.disabled ? 'False' : c.enabledWhen ? conditionExpression(project, c.enabledWhen) : 'True'}, "selected": lambda: ${c.selectedWhen ? conditionExpression(project, c.selectedWhen) : 'False'}},`).join('\n');
  const minigames = Object.fromEntries((project.minigames ?? []).map(game => [game.id, game]));
  const customPages = Object.fromEntries((project.ui.customPages ?? []).map(page => [page.id, {
    name: page.name,
    background: page.background,
    backgroundPath: project.assets.find(asset => asset.id === page.backgroundId && asset.kind === 'image')?.path.replaceAll('\\', '/'),
    modal: page.modal,
    opening: page.opening,
    componentIds: page.components.map(component => component.id),
  }]));
  return `default vn_ui_open_pages = {}
default vn_ui_page_results = {}
${uiPageDefaults}
${uiNativePageDefaults}

python early:
    import pygame_sdl2 as vn_ui_pygame

${uiLayoutEarly}

    class VnUiInputGate(renpy.display.layout.Container):
        def __init__(self, vn_interactive=True, **properties):
            super(VnUiInputGate, self).__init__(**properties)
            self.vn_interactive = vn_interactive

        def render(self, width, height, st, at):
            rendered = super(VnUiInputGate, self).render(width, height, st, at)
            result = renpy.Render(*rendered.get_size())
            # Disabling Transform.events alone leaves child focus rectangles
            # above the lower page, so even ignored clicks cannot reach it.
            result.blit(rendered, (0, 0), focus=self.vn_interactive)
            return result

        def find_focusable(self, callback, focus_name):
            if self.vn_interactive:
                super(VnUiInputGate, self).find_focusable(callback, focus_name)

        def event(self, ev, x, y, st):
            # Input policy does not stop the page's clocks or animations.
            if self.vn_interactive or ev.type == renpy.display.core.TIMEEVENT:
                return super(VnUiInputGate, self).event(ev, x, y, st)
            return None

    renpy.register_sl_displayable("vn_ui_input_gate", VnUiInputGate, "fixed", nchildren=1).add_property("vn_interactive")

    class VnSkinButton(renpy.display.behavior.Button):
        def __init__(self, replaces=None, vn_component_id=None, vn_events=None, vn_hover_sound=False, vn_click_sound=False, **properties):
            # Use real pointer boundaries below, not focus reconstruction after
            # a blueprint callback, to avoid replaying sounds while stationary.
            properties["hover_sound"] = None
            renpy.display.behavior.Button.__init__(self, **properties)
            self.vn_component_id = vn_component_id
            self.vn_events = vn_events or {}
            # False follows the defaults; None or a path comes from the collection that owns this item.
            self.vn_hover_sound, self.vn_click_sound = vn_hover_sound, vn_click_sound
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
            return not self.locked and self.is_sensitive() and (self.vn_component_id is None or vn_ui_component_available(self.vn_component_id))

        def vn_emit(self, trigger):
            if trigger != "hover" and not self.vn_events.get(trigger):
                return None
            if self.vn_available():
                if trigger == "hover":
                    if self.vn_hover_sound is False:
                        vn_ui_play_hover(self.vn_component_id)
                    elif self.vn_hover_sound:
                        renpy.exports.play(self.vn_hover_sound, channel="vn_ui_feedback")
                previous = getattr(vn_ui_cancel_pointer, "source", None)
                vn_ui_cancel_pointer.source = self
                try:
                    return renpy.display.behavior.run(self.vn_events.get(trigger))
                finally:
                    vn_ui_cancel_pointer.source = previous

        def unfocus(self, default=False):
            # Unfocused, released buttons have no gesture to cancel. Resolving
            # every button's full page layout here makes focus refresh quadratic.
            if self.vn_held and not self.vn_available():
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
                if inside and self.clicked is not None and self.is_focused() and self.vn_available():
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
                        renpy.exports.play(self.style.activate_sound if self.vn_click_sound is False else self.vn_click_sound)
                        result = renpy.display.behavior.run(self.clicked)
                        if result is not None:
                            return result
                    raise renpy.IgnoreEvent()
                if self.is_focused() and self.clicked is not None:
                    raise renpy.IgnoreEvent()
            if self.is_focused() and (renpy.display.behavior.map_event(ev, "button_select") or renpy.display.behavior.map_event(ev, "K_SPACE")) and self.vn_available():
                self.vn_cancelled = False
                self.vn_held = True
                self.vn_emit("press")
                self.vn_release(False)
                if not self.vn_cancelled:
                    self.vn_emit("release")
                if not self.vn_cancelled and self.vn_available() and self.clicked is not None:
                    renpy.exports.play(self.style.activate_sound if self.vn_click_sound is False else self.vn_click_sound)
                    result = renpy.display.behavior.run(self.clicked)
                    if result is not None:
                        return result
                raise renpy.IgnoreEvent()
            return renpy.display.behavior.Button.event(self, ev, x, y, st)

    renpy.register_sl_displayable("vn_skin_button", VnSkinButton, "button", nchildren=1, replaces=True).copy_properties("button").add_property("vn_component_id").add_property("vn_events").add_property("vn_hover_sound").add_property("vn_click_sound")

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
    style.button.activate_sound = ${pythonLiteral(clickPath)}

    def vn_ui_play_hover(component_id=None):
        sound = vn_ui_hover_overrides.get(component_id, vn_ui_hover_sound)
        if "hoverSound" in vn_ui_overrides.get(component_id, {}) or vn_ui_property_control(component_id, "hoverSound") is not None:
            sound = vn_bp_optional_asset(vn_ui_get(component_id, "hoverSound"), "audio")
        if sound:
            renpy.play(sound, channel="vn_ui_feedback")

    def vn_ui_play_click(component_id):
        sound = vn_bp_optional_asset(vn_ui_get(component_id, "clickSound"), "audio")
        if sound:
            renpy.play(sound, channel="vn_ui_feedback")

    vn_ui_defaults = ${pythonLiteral(uiDefaults)}
    vn_ui_property_fallbacks = ${pythonLiteral(propertyFallbacks)}
    vn_ui_component_pages = ${pythonLiteral(componentPages)}
    vn_ui_parents = ${pythonLiteral(Object.fromEntries(components.filter(c => c.parentId).map(c => [c.id, c.parentId])))}
    vn_ui_property_types = ${pythonLiteral(Object.fromEntries(Object.entries(uiProperties).map(([key, entry]) => [key, entry.type])))}
    vn_ui_property_info = ${pythonLiteral(uiProperties)}
    vn_ui_component_kinds = ${pythonLiteral(Object.fromEntries(components.map(c => [c.id, c.kind])))}
    vn_ui_text_bindings = ${pythonLiteral(Object.fromEntries(components.filter(c => c.binding).map(c => [c.id, c.binding])))}
    vn_ui_asset_bindings = ${pythonLiteral(assetBindings)}
    vn_ui_text_effects = ${pythonLiteral(Object.fromEntries(components.filter(c => ['text', 'button'].includes(c.kind)).map(c => [c.id, { outlineOpacity: c.style?.outlineOpacity ?? 1, shadowOpacity: c.style?.shadowOpacity ?? .7, shadowBlur: c.style?.shadowBlur ?? 0 }])))}
    # Supported-property metadata is read only; property values still resolve
    # live. Every lookup is membership-only, so avoid scanning a list per read.
    vn_ui_allowed_properties = {identity: frozenset(properties) for identity, properties in ${pythonLiteral(Object.fromEntries(components.map(component => [component.id, Object.keys(uiDefaults[component.id])])))}.items()}
    vn_ui_conditions = {
${conditions}
    }
    vn_ui_condition_definitions = ${pythonLiteral(Object.fromEntries(components.map(c => [c.id, { visible: c.visibleWhen, enabled: c.disabled ? false : c.enabledWhen, selected: c.selectedWhen }])))}

    def vn_ui_get(component_id, property, fallback=None, raw_layout=False):
        if component_id not in vn_ui_defaults or property not in vn_ui_property_types:
            raise Exception("蓝图引用的组件或属性不存在，请重新选择。")
        if property not in vn_ui_allowed_properties[component_id]:
            raise Exception("此组件不支持所选属性；文字用于固定文字与按钮，启用用于按钮和设置控件，选中用于按钮。")
        if (property in vn_ui_layout_fields or property in vn_ui_layout_observations) and vn_ui_layout_meta[component_id]["version"] != 1:
            raise Exception("控件布局版本暂不支持；请在编辑器明确恢复原始布局数据。")
        if not raw_layout and property in vn_ui_layout_observations:
            return vn_ui_layout_observe(component_id, property)
        if property in ("spineAnimation", "spineStatus", "spinePlaying", "spinePaused", "spinePosition", "spineDuration", "spineDurationKnown", "spineProgress", "spineError"):
            return vns_spine.get(component_id, property)
        if property in ("videoStatus", "videoPlaying", "videoPaused", "videoPosition", "videoDuration", "videoDurationKnown", "videoProgress", "videoError", "videoCanSeek"):
            return vn_ui_video_get(component_id, property)
        if property in ("imageStatus", "imageError", "imageSource", "imageSourceWidth", "imageSourceHeight"):
            return vn_ui_image_get(component_id, property)
        if property in ("hovered", "pressed"):
            return vn_ui_button_observation(component_id, property)
        if component_id in vn_ui_controls and property in ("numberValue", "stringValue", "booleanValue", "normalizedValue", "minimum", "maximum", "step", "sourceMinimum", "sourceMaximum", "sourceStep", "optionCount", "optionIndex", "optionLabel", "focused"):
            return vn_ui_control_property(component_id, property)
        control = vn_ui_property_control(component_id, property)
        if control is not None:
            return vn_ui_property_control_read(component_id, property, control)
        # Most fields use their authored defaults. Avoid allocating rollback-
        # tracked empty dictionaries/lists for every property of every control.
        override = vn_ui_overrides.get(component_id)
        if override and property in override:
            return override[property]
        fallbacks = vn_ui_property_fallbacks.get(component_id)
        for inherited in fallbacks.get(property, ()) if fallbacks else ():
            inherited_control = vn_ui_property_control(component_id, inherited)
            if inherited_control is not None:
                return vn_ui_property_control_read(component_id, inherited, inherited_control)
            if override and inherited in override:
                return override[inherited]
        if property == "spineSkin" and vn_ui_get(component_id, "spineAsset") != vn_spine_components[component_id].get("assetId"):
            return ""
        if fallback is not None:
            return fallback
        binding = vn_ui_asset_bindings.get(component_id)
        if binding and property == binding["property"]:
            # A parameter-bound image or video follows its parameter; an empty or
            # unknown value shows the component's own asset.
            value = vn_parameter_get(binding["parameterId"])
            asset = vn_bp_assets.get(value) if isinstance(value, str) and value else None
            if asset and asset["kind"] == binding["kind"]:
                return value
        if property in vn_ui_conditions[component_id]:
            return vn_ui_conditions[component_id][property]()
        if property == "text" and component_id in vn_ui_text_bindings:
            binding = vn_ui_text_bindings[component_id]
            if binding == "title":
                return ${pythonLiteral(project.name)}
            if binding == "tooltip":
                return GetTooltip() or ""
            screen = renpy.get_screen("say" if binding in ("speaker", "dialogue") else "confirm")
            field = {"speaker": "who", "dialogue": "what", "confirmation": "message"}.get(binding)
            if screen is not None and field:
                return screen.scope.get(field) or ""
        return vn_ui_defaults[component_id].get(property)

    def vn_ui_default(component_id, property):
        if property not in vn_ui_allowed_properties.get(component_id, ()):
            raise Exception("此组件不支持所选属性。")
        return vn_ui_defaults[component_id][property]

    def vn_ui_bound_display(component_id, source):
        override = vn_ui_overrides.get(component_id, {})
        return vn_ui_literal(vn_ui_get(component_id, "text")).replace("[", "[[") if "text" in override or vn_ui_property_control(component_id, "text") is not None else source

    def vn_ui_font(component_id):
        return vn_bp_optional_asset(vn_ui_get(component_id, "font"), "font") or "fonts/SourceHanSansLite.ttf"

    def vn_ui_font_size(component_id, height):
        return max(12, min(int(vn_ui_get(component_id, "fontSize")), int(height * .7)))

    def vn_ui_skin(component_id, source, image=False):
        skin = dict(source)
        if image:
            skin["idle"] = vn_bp_optional_asset(vn_ui_get(component_id, "image"), "image")
            skin["fit"] = vn_ui_get(component_id, "imageFit")
            skin["imageIds"] = dict(vn_ui_images[component_id]["states"], idle=vn_ui_get(component_id, "image"))
            skin["imageEffects"] = {field: vn_ui_get(component_id, prop) for prop, field in (("imageCropX", "cropX"), ("imageCropY", "cropY"), ("imageCropWidth", "cropWidth"), ("imageCropHeight", "cropHeight"), ("imageFlipX", "flipX"), ("imageFlipY", "flipY"), ("imageTint", "tint"))}
        else:
            for state in ("idle", "hover", "pressed", "selected", "disabled"):
                skin[state] = vn_bp_optional_asset(vn_ui_get(component_id, state + "Image"), "image")
        return skin

    def vn_ui_outlines(component_id):
        info = vn_ui_text_effects.get(component_id, {})
        def alpha(color, opacity):
            rgba = Color(color)
            return rgba.replace_opacity(rgba.alpha * opacity)
        result = []
        x, y = vn_ui_get(component_id, "shadowX"), vn_ui_get(component_id, "shadowY")
        blur = vn_ui_get(component_id, "shadowBlur")
        spread = vn_ui_get(component_id, "shadowSpread")
        if blur:
            import math
            steps, covered = min(24, max(2, int(math.ceil(blur * 2)))), 0
            shadow = Color(vn_ui_get(component_id, "shadowColor"))
            effective_opacity = shadow.alpha * vn_ui_get(component_id, "shadowOpacity")
            for step in range(steps, -1, -1):
                radius = blur * 2 * step / steps
                target = effective_opacity * math.exp(-2 * (radius / blur) ** 2)
                opacity = max(0, (target - covered) / max(.00001, 1 - covered))
                if opacity >= .5 / 255:
                    result.append((spread + radius, shadow.replace_opacity(opacity), x, y))
                covered = target
        width = vn_ui_get(component_id, "outlineWidth")
        if width:
            result.append((width, alpha(vn_ui_get(component_id, "outlineColor"), vn_ui_get(component_id, "outlineOpacity")), 0, 0))
        if not blur and (x or y or spread):
            result.append((spread, alpha(vn_ui_get(component_id, "shadowColor"), vn_ui_get(component_id, "shadowOpacity")), x, y))
        return result

    def vn_ui_layer_order(identities):
        # Python's stable sort preserves author order for equal layer values.
        return sorted(identities, key=lambda identity: vn_ui_get(identity, "layer"))

    def vn_ui_appearance(component_id):
        return {key: vn_ui_get(component_id, key) for key in ("borderColor", "borderWidth", "radius")}

    def vn_ui_state_colors(component_id):
        return {state: vn_ui_get(component_id, "background" if state == "idle" else state + "Background") for state in ("idle", "hover", "pressed", "selected", "disabled")}

    def vn_ui_component_available(component_id, layout_rows=None, get=None):
        get = get or vn_ui_get
        page = vn_ui_component_pages.get(component_id)
        if not page:
            return False
        current, seen = component_id, set()
        while current and current not in seen:
            seen.add(current)
            if not get(current, "visible") or ("enabled" in vn_ui_allowed_properties.get(current, ()) and not get(current, "enabled")):
                return False
            current = vn_ui_parents.get(current)
        if page.startswith("ui:"):
            if not any(renpy.get_screen(name) is not None for name in vn_ui_native_page_screens.get(page, [])):
                return False
        elif page not in vn_ui_open_pages and (not vn_minigame_owns_page(page) or renpy.get_screen("vn_minigame_custom") is None):
            return False
        row = layout_rows.get(component_id) if layout_rows is not None else None
        if component_id not in vn_ui_layout_pages.get(page, ()) or vn_ui_layout_meta[component_id]["version"] != 1:
            return False
        if layout_rows is not None and row is None or (row if row is not None else vn_ui_layout_row(component_id))["clippedOut"]:
            return False
        layers = vn_ui_visible_page_order()
        if page in vn_ui_open_pages and (page not in layers or vn_ui_page_sessions.get(page, {}).get("opening", {}).get("input") == "none"):
            return False
        source_index = layers.index(page) if page in layers else -1
        return not any(vn_ui_page_modal(identity) for identity in layers[source_index + 1:])

    def vn_ui_button_observation(component_id, property):
        if not vn_ui_component_available(component_id):
            return False
        # Observe only the current dispatch/grab/focus. Never keep widgets from
        # prediction, a replaced screen or an earlier page instance in saves.
        candidates = (getattr(vn_ui_cancel_pointer, "source", None), renpy.display.focus.get_grab(), renpy.display.focus.get_focused())
        button = next((item for item in candidates if isinstance(item, VnSkinButton) and item.vn_component_id == component_id and item.vn_available()), None)
        return bool(button and button.vn_pointer_inside and (property == "hovered" or button.vn_held))

    def vn_ui_extent(component_id, property):
        return vn_ui_layout_row(component_id)[property] / (${project.width} if property == "width" else ${project.height})

    def vn_ui_origin(component_id, property):
        row = vn_ui_layout_row(component_id)
        return row["matrix"][4 if property == "x" else 5] / (${project.width} if property == "x" else ${project.height})

    def vn_ui_position(component_id, property):
        return vn_ui_layout_row(component_id)["localRenderMatrix"][4 if property == "x" else 5]

    def vn_ui_ancestor_enabled(component_id):
        seen = set()
        parent = vn_ui_parents.get(component_id)
        while parent and parent not in seen:
            seen.add(parent)
            if "enabled" in vn_ui_allowed_properties.get(parent, ()) and not vn_ui_get(parent, "enabled"):
                return False
            parent = vn_ui_parents.get(parent)
        return True

    def vn_ui_set(component_id, property, value, write_mode="override"):
        vn_ui_property_validate_value(component_id, property, value)
        if write_mode not in ("override", "source"):
            raise Exception("请选择临时覆盖或修改绑定源。")
        if property in vn_ui_control_value_properties:
            vn_ui_control_assign(component_id, property, value, write_mode)
            renpy.retain_after_load()
            renpy.restart_interaction()
            return
        if write_mode == "source" and vn_ui_property_control(component_id, property) is None:
            raise Exception("此属性没有可写的控件值绑定源。")
        # Validate the complete write before ticking another live animation.
        vn_ui_property_prepare([(component_id, property, value)])
        vn_ui_animation_tick(False)
        vn_ui_property_apply([(component_id, property, value)])
        vn_parameter_flush_animations()
        renpy.retain_after_load()
        renpy.restart_interaction()

    def vn_ui_literal(text):
        return str(text).replace("{", "{{")

    def vn_ui_reset(component_id):
        if component_id not in vn_ui_defaults:
            raise Exception("蓝图引用的界面组件不存在。")
        previous_image = vn_ui_get(component_id, "image") if component_id in vn_ui_images else None
        # Reset removes this control's temporary drivers; it never advances or
        # restores a shared parameter, nor cancels another control's driver.
        for key in list(vn_ui_animations):
            if key[0] == component_id: vn_ui_animations.pop(key, None)
        vn_parameter_flush_animations()
        vn_ui_overrides.pop(component_id, None)
        if component_id in vn_ui_images and (previous_image != vn_ui_get(component_id, "image") or component_id in vn_ui_image_loads and not vn_ui_image_record_valid(vn_ui_image_loads[component_id])):
            vn_ui_image_invalidate(component_id, recover=True)
        vn_ui_control_reset_options(component_id)
        vn_ui_video_reset(component_id)
        vn_ui_spine_reset(component_id)
        vn_ui_layout_changed()
        renpy.restart_interaction()

    def vn_ui_reset_property(component_id, property):
        vn_ui_default(component_id, property)
        if not vn_ui_property_info[property].get("writable", False):
            raise Exception("只读的运行观察值不能重置。")
        key = vn_ui_controls[component_id]["primary"] if property in vn_ui_control_value_properties else property
        vn_ui_animations.pop((component_id, key), None)
        vn_parameter_flush_animations()
        override = dict(vn_ui_overrides.get(component_id, {}))
        previous_image = vn_ui_get(component_id, "image") if property == "image" else None
        if property in ("video", "videoLoop"):
            video_record = vn_ui_video_states.get(component_id)
            if video_record is not None and vn_ui_video_problem(video_record): raise Exception(vn_ui_video_problem(video_record))
        vn_ui_spine_validate_change(component_id, property, "")
        if property == "spineAsset": override.pop("spineSkin", None)
        override.pop(key, None)
        if property in vn_ui_control_range_fields:
            vn_ui_control_validate_range(component_id, vn_ui_control_range(component_id, override))
        vn_ui_overrides[component_id] = override
        if property == "image" and (previous_image != vn_ui_get(component_id, "image") or component_id in vn_ui_image_loads and not vn_ui_image_record_valid(vn_ui_image_loads[component_id])):
            vn_ui_image_invalidate(component_id, recover=True)
        if property in ("video", "videoLoop"): vn_ui_video_sync(component_id)
        if property in ("spineAsset", "spineSkin", "spineLoop", "spineSpeed"): vn_ui_spine_sync(component_id)
        vn_ui_layout_changed()
        renpy.restart_interaction()

    vn_ui_pages = ${pythonLiteral(pages)}
    vn_ui_replaced_pages = ${pythonLiteral(replacedPages)}
    vn_ui_story_names = ${pythonLiteral(storyNames)}
    vn_minigames = ${pythonLiteral(minigames)}
    vn_custom_pages = ${pythonLiteral(customPages)}
    vn_ui_native_page_screens = ${pythonLiteral(Object.fromEntries(Object.entries(pageScreens).map(([page, screens]) => ['ui:' + page, screens])))}
    vn_ui_native_page_components = ${pythonLiteral(Object.fromEntries(Object.keys(pageScreens).map(page => ['ui:' + page, components.filter(c => c.page === page).map(c => c.id)])))}

${createUiControlRuntime(project,pageScreens)}
${createUiPropertyControlRuntime(project)}
${uiPropertyBatchRuntime}
${createUiImageRuntime(project)}
${createUiVideoRuntime(project)}
${createUiLayoutRuntime(project)}
    def vn_ui_focus_snapshot():
        focused = renpy.display.focus.get_focused()
        screen = renpy.display.focus.screen_of_focused
        if focused is None or screen is None:
            return None
        pages = tuple((page, vn_ui_page_token(page)) for page in vn_ui_page_order)
        return (focused, renpy.display.focus.argument, screen, vn_input_page_state(), pages)

    def vn_ui_restore_focus(snapshot):
        if snapshot is None or renpy.display.focus.get_focused() is not None:
            return
        focused, argument, screen, state, pages = snapshot
        # A timer may run in the middle of dispatching a mouse-down event.
        # Its synchronous callback clears focus, but must not eat that click.
        # Never restore a closed/reopened page, changed modal stack, hidden
        # control or replaced native screen after an actual navigation.
        if renpy.get_screen(screen.screen_name[0]) is not screen or vn_input_page_state() != state:
            return
        if tuple((page, vn_ui_page_token(page)) for page in vn_ui_page_order) != pages:
            return
        if isinstance(focused, VnSkinButton) and not focused.vn_available():
            return
        if not renpy.display.behavior.is_sensitive(getattr(focused, "action", None)):
            return
        renpy.display.focus.set_focused(renpy.display.focus.get_grab() or focused, argument, screen)

    def vn_ui_cancel_pointer(component_ids=None):
        vn_input_clear_focus(component_ids)
        # A page opened from OnPressed must cancel both the dispatching
        # displayable and any replacement currently holding the mouse grab.
        for button in (getattr(vn_ui_cancel_pointer, "source", None), renpy.display.focus.get_grab()):
            if isinstance(button, (VnSkinButton, VnUiBar)) and (component_ids is None or button.vn_component_id in component_ids):
                button.vn_release()
                button.vn_inside = button.vn_pointer_inside = False

${uiPageRuntime}
${uiNativePageRuntime}

    def vn_run_ui_show(blueprint_id, page_id=None):
        # Screen reconstruction after load/rollback must retain the restored
        # control state, rather than replaying page-entry side effects.
        if not renpy.game.after_rollback:
            vn_run_blueprint(blueprint_id, page_id=page_id, show=True)

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
        global vn_minigame_context, vn_minigame_finished, vn_minigame_serial
        definition = vn_minigame_definition(minigame_id)
        previous = vn_minigame_context if isinstance(vn_minigame_context, dict) else {}
        if previous.get("runKey") != str(run_key) or previous.get("minigameId") != str(minigame_id):
            vn_minigame_serial += 1
            vn_minigame_context = {"runKey": str(run_key), "minigameId": str(minigame_id), "token": vn_minigame_serial, "didShow": False, "title": str(title), "prompt": str(prompt), "values": {}}
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

    def vn_minigame_owns_page(page_id):
        context = vn_minigame_context or {}
        definition = vn_minigames.get(context.get("minigameId"), {})
        return vn_minigame_finished is None and definition.get("uiPageId") == page_id

    def vn_minigame_page_shown(page_id, token, blueprint_ids):
        # A legacy minigame uses the authored screen under an input transform;
        # native show events do not reach it. Persist one dispatch per game run.
        global vn_minigame_context
        context = vn_minigame_context or {}
        if not vn_minigame_owns_page(page_id) or context.get("token") != token or context.get("didShow", True):
            return
        vn_minigame_context = dict(context, didShow=True)
        renpy.retain_after_load()
        task = vn_bp_task_create(page_id)
        if vn_ui_interface_key(task) not in vn_ui_interface_records:
            vn_ui_interface_prepare(page_id, system=True, task=task)
        vn_ui_interface_created(page_id)
        for blueprint_id in blueprint_ids:
            if not vn_bp_task_alive(task):
                break
            vn_run_blueprint(blueprint_id, page_id=page_id, show=True)

    def vn_finish_minigame(result):
        global vn_minigame_finished, vn_minigame_context
        if result not in ("success", "failure", "cancel"):
            raise Exception("小游戏结束结果必须是 success、failure 或 cancel。")
        # The first completion wins even when a timer and a click race.
        if vn_minigame_finished is not None:
            return vn_minigame_finished
        page_id = vn_minigames.get((vn_minigame_context or {}).get("minigameId"), {}).get("uiPageId")
        record = vn_ui_interface_for_close(page_id) if page_id else None
        context = dict(vn_minigame_context or {})
        context["result"] = result
        vn_minigame_context = context
        vn_minigame_finished = result
        page_id = vn_minigames.get(context.get("minigameId"), {}).get("uiPageId")
        if page_id:
            vn_ui_page_release(page_id)
        if record:
            vn_ui_interface_end(record, vn_ui_interface_completion(page_id, result, "cancelled" if result == "cancel" else "completed", record=record))
        vn_bp_prune_task_resources()
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
        page_id = vn_minigames.get((vn_minigame_context or {}).get("minigameId"), {}).get("uiPageId")
        vn_minigame_context = {}
        vn_minigame_finished = None
        if page_id:
            vn_ui_page_release(page_id)
        vn_bp_prune_task_resources()
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
        def __init__(self, skin, width, height, inherit=False, colors=None, look=None, **kwargs):
            super(VnUiStateSurface, self).__init__(**kwargs)
            self.skin, self.width, self.height, self.inherit = skin, width, height, inherit
            self.colors = colors or {}
            self.look = look or {}
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
                self.surface = vn_ui_box(self.skin, self.state, self.width, self.height, self.colors.get(self.state, "#00000000"), self.look)
            return renpy.render(self.surface, self.width, self.height, st, at)

        def visit(self):
            return [self.surface] if self.surface is not None else []

    def vn_ui_uncolored(caption):
        # A shadow copy takes one color, including any part of the caption tagged with its own.
        import re
        return re.sub(r"\\{/?color[^}]*\\}", "", caption)

    def vn_ui_text_shadow(caption, font, size, bold, width, height, look, align=0.5):
        source = Color(look.get("shadowColor", "#000000"))
        color = source.replace_opacity(1.0)
        # Blur a separately padded text surface; the sharp glyph face and its
        # single outline remain independent of the shadow's opacity.
        spread = look.get("shadowSpread", 0)
        content = Fixed(xysize=(width, height))
        content.add(Text(vn_ui_uncolored(caption), substitute=False, font=font, size=size, bold=bold,
            color=color, hover_color=color, activate_color=color, selected_color=color,
            insensitive_color=color, outlines=[(spread, color, 0, 0)] if spread else [], slow_cps=0,
            xalign=align, yalign=0.5, text_align=align, xmaximum=width))
        blur = look.get("shadowBlur", 0)
        padding = int(blur * 2 + spread + 1)
        padded = Fixed(xysize=(width + padding * 2, height + padding * 2))
        padded.add(Transform(content, pos=(padding, padding)))
        return Transform(padded, blur=blur,
            alpha=look.get("shadowOpacity", 0.7) * source.alpha,
            xoffset=look.get("shadowX", 0) - padding, yoffset=look.get("shadowY", 0) - padding)

    renpy.register_shader("vn.ui_round", variables="""
        uniform vec2 u_vn_ui_round_size;
        uniform float u_vn_ui_round_radius;
        uniform float u_vn_ui_round_border;
        varying vec2 v_tex_coord;
    """, fragment_functions="""
        float vn_ui_round_distance(vec2 point, vec2 half_size, float radius) {
            vec2 q = abs(point) - half_size + vec2(radius);
            return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - radius;
        }
    """, fragment_300="""
        vec2 vn_ui_half = u_vn_ui_round_size * 0.5;
        vec2 vn_ui_point = (v_tex_coord - vec2(0.5)) * u_vn_ui_round_size;
        float vn_ui_radius = min(u_vn_ui_round_radius, min(vn_ui_half.x, vn_ui_half.y));
        float vn_ui_coverage = 1.0 - smoothstep(-0.5, 0.5, vn_ui_round_distance(vn_ui_point, vn_ui_half, vn_ui_radius));
        if (u_vn_ui_round_border >= 0.0) {
            vec2 vn_ui_inner = vn_ui_half - vec2(u_vn_ui_round_border);
            if (min(vn_ui_inner.x, vn_ui_inner.y) > 0.0) {
                float vn_ui_inner_radius = max(0.0, vn_ui_radius - u_vn_ui_round_border);
                float vn_ui_hole = 1.0 - smoothstep(-0.5, 0.5, vn_ui_round_distance(vn_ui_point, vn_ui_inner, vn_ui_inner_radius));
                vn_ui_coverage = clamp(vn_ui_coverage - vn_ui_hole, 0.0, 1.0);
            }
        }
        // The input texture uses premultiplied alpha, including translucent borders.
        gl_FragColor *= vn_ui_coverage;
    """)

    def vn_ui_round(surface, width, height, look=None):
        radius = max(0.0, min(width / 2, height / 2, (look or {}).get("radius", 0)))
        if not radius:
            return surface
        # Only the component's own pixels are clipped. Text effects and authored
        # child controls remain outside this surface and retain their input area.
        return Transform(surface, xysize=(width, height), mesh=True, shader="vn.ui_round",
            u_vn_ui_round_size=(float(width), float(height)), u_vn_ui_round_radius=float(radius), u_vn_ui_round_border=-1.0)

    def vn_ui_border(width, height, look=None):
        look = look or {}
        border = max(0.0, min(width / 2, height / 2, look.get("borderWidth", 0)))
        if not border:
            return None
        radius = max(0.0, min(width / 2, height / 2, look.get("radius", 0)))
        # One ring avoids overlapping corners changing the alpha of a border.
        return Transform(Solid(look.get("borderColor", "#ffffff")), xysize=(width, height), mesh=True, shader="vn.ui_round",
            u_vn_ui_round_size=(float(width), float(height)), u_vn_ui_round_radius=float(radius), u_vn_ui_round_border=float(border))

    def vn_ui_box(skin, state, width, height, color, look=None, with_border=True):
        look = look or {}
        key = "background" if state == "idle" else state + "Background"
        surface = vn_ui_round(vn_ui_surface(skin, state, width, height, look.get(key, look.get("background", color))), width, height, look)
        border = vn_ui_border(width, height, look) if with_border else None
        if border is None:
            return surface
        return Fixed(surface, border, xysize=(width, height))

    def vn_ui_progress_surface(value, width, height, color, fill_color, look=None):
        result = Fixed(Solid(color, xysize=(width, height)), xysize=(width, height))
        fill_width = int(max(0.0, min(1.0, value)) * width)
        if fill_width:
            result.add(Solid(fill_color, xysize=(fill_width, height)))
        return vn_ui_round(result, width, height, look)

    def vn_ui_nine_slice(borders, image_path):
        # Edges that meet leave no middle to stretch, so keep one source pixel for it.
        def fit(start, end, size):
            if size < 2 or start + end < size:
                return start, end
            kept = min(start, size - 1)
            return kept, min(end, size - 1 - kept)
        image_width, image_height = renpy.image_size(image_path)
        left, right = fit(borders["left"], borders["right"], image_width)
        top, bottom = fit(borders["top"], borders["bottom"], image_height)
        return dict(borders, left=left, right=right, top=top, bottom=bottom)

    def vn_ui_surface(skin, state, width, height, color):
        if state in ("pressed", "selected"):
            image_path = skin.get(state) or skin.get("hover") or skin.get("idle")
        else:
            image_path = skin.get(state) or skin.get("idle")
        if not image_path:
            return Solid(color)
        fit = skin.get("fit", "stretch")
        if fit == "nineSlice":
            borders = vn_ui_nine_slice(skin.get("borders") or dict(left=12, top=12, right=12, bottom=12), image_path)
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
default vn_ui_control_option_overrides = {}
default vn_ui_control_option_recovery = {}
${uiImageDefaults}
${uiVideoDefaults}
default vn_minigame_context = {}
default vn_minigame_serial = 0
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

${uiSaveMigrationRuntime}
${uiPageWaitScreen}
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
