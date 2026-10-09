/** Reusable player widgets used by authored UI components as well as templates. */
import { createSpatialUiWidgets } from './spatial-ui-widgets';
import { defaultVoiceRemoveMessage } from '../core/voice-preview';
import { pythonLiteral } from './literals';
export function createUiWidgets(): string {
  // Ren'Py interprets float sizes and spacing as proportions. Imported pixel
  // measurements can be fractional, so round them before using style properties.
  return createSpatialUiWidgets() + `
init python:
    def vn_voice_button_font(size, width, height):
        # Four-character controls need at most two lines inside a small button.
        return max(1, min(size, 18, int(width / 2), int(height / 2.8)))

    @functools.lru_cache(maxsize=256)
    def vn_voice_excerpt(raw, font, size, width):
        # Measure literal text in the actual font; truncate before escaping so
        # brackets and text-tag characters cannot be split into executable tags.
        raw = " ".join(raw.splitlines())
        def fits(value):
            probe = Text(vn_ui_literal(value), font=font, size=size, layout="nobreak", slow_cps=0, substitute=False)
            return renpy.render(probe, 32768, 32768, 0, 0).get_size()[0] <= width
        if fits(raw):
            return vn_ui_literal(raw)
        low, high = 0, len(raw)
        while low < high:
            middle = (low + high + 1) // 2
            if fits(raw[:middle] + "…"):
                low = middle
            else:
                high = middle - 1
        return vn_ui_literal(raw[:low] + "…") if fits("…") else ""

    @functools.lru_cache(maxsize=128)
    def vn_confirmation_fit(message, font, size, width, height, outlines):
        # Use the same font, wrapping and outlines as the visible message.
        def measure(candidate):
            probe = Text(message, font=font, size=candidate, xsize=width, outlines=list(outlines), slow_cps=0)
            return renpy.render(probe, width, 32768, 0, 0).get_size()[1]
        minimum = min(size, max(18, int(size * 0.65)))
        low, high, fitted = minimum, size, minimum
        while low <= high:
            candidate = (low + high) // 2
            if measure(candidate) <= height:
                fitted, low = candidate, candidate + 1
            else:
                high = candidate - 1
        return fitted, measure(fitted)

screen vn_confirmation_text(message, width, height, font_size, text_color, font, align, identity, text_outlines=[]):
    $ fitted_size, fitted_height = vn_confirmation_fit(message, font, font_size, width, height, tuple(text_outlines))
    if fitted_height <= height:
        text message id (identity + "_text") font font size fitted_size color text_color xsize width min_width width text_align align yalign 0.5 outlines text_outlines slow_cps 0
    else:
        # Long custom/security prompts remain readable and can be scrolled.
        default message_scroll = ui.adjustment()
        $ content_width = max(1, width - 20)
        viewport:
            id (identity + "_viewport")
            xysize (content_width, height)
            yadjustment message_scroll
            mousewheel True
            draggable True
            pagekeys True
            text message id (identity + "_text") font font size fitted_size color text_color xsize content_width min_width content_width text_align align outlines text_outlines slow_cps 0
        vbar:
            id (identity + "_scroll")
            style "vscrollbar"
            adjustment message_scroll
            xalign 1.0
            xysize (16, height)
            base_bar "#55555580"
            thumb text_color
            hover_thumb text_color
            thumb_offset 0

label vn_confirm_prompt(message):
    $ vn_ui_cancel_pointer()
    call screen confirm(message=message, yes_action=Return(True), no_action=Return(False))
    return _return

screen vn_preference_slider(key, character_id, caption, width, height, font_size, text_color, font, options, identity, parameter_id=None, component_id=None):
    $ title_height = min(int(height * 0.45), 32) if options.get("showLabel", True) else 0
    $ thumb_width = max(1, min(width, int(options.get("thumbWidth", 26))))
    $ thumb_height = max(1, min(height - title_height, int(options.get("thumbHeight", 26))))
    $ track_height = max(1, min(thumb_height, int(options.get("trackHeight", 12))))
    $ track_y = title_height + int((height - title_height - track_height) / 2)
    $ bar_y = title_height + int((height - title_height - thumb_height) / 2)
    $ thumb = options.get("thumb") or {}
    $ ratio = vn_parameter_ratio(parameter_id) if parameter_id else vn_preference_ratio(key, character_id)
    $ ratio = 1.0 - ratio if options.get("reverse", False) else ratio
    $ fill_width = max(1, min(width, int(thumb_width / 2 + (width - thumb_width) * ratio)))
    fixed:
        xysize (width, height)
        if title_height:
            text caption substitute False font font size min(font_size, title_height) color text_color xmaximum width
        if options.get("trackPath"):
            add Transform(options["trackPath"], xysize=(width, track_height)) ypos track_y
        else:
            add Solid("#515c60", xysize=(width, track_height)) ypos track_y
        if options.get("fillPath"):
            add Transform(Transform(options["fillPath"], xysize=(width, track_height)), crop=(0, 0, fill_width, track_height)) ypos track_y
        elif not options.get("trackPath"):
            add Solid("#78bbaa", xysize=(fill_width, track_height)) ypos track_y
        vn_ui_bar:
            id (identity + "_control")
            alt caption
            value (VnParameterValue(parameter_id, reverse=options.get("reverse", False), component_id=component_id) if parameter_id else VnPreferenceValue(key, character_id, reverse=options.get("reverse", False), component_id=component_id))
            xysize (width, thumb_height)
            ypos bar_y
            left_bar Null()
            right_bar Null()
            thumb vn_ui_surface(thumb, "idle", thumb_width, thumb_height, "#eef1ef")
            hover_thumb vn_ui_surface(thumb, "hover", thumb_width, thumb_height, "#ffffff")
            selected_idle_thumb vn_ui_surface(thumb, "pressed", thumb_width, thumb_height, "#c9e2d9")
            selected_hover_thumb vn_ui_surface(thumb, "pressed", thumb_width, thumb_height, "#c9e2d9")
            insensitive_thumb vn_ui_surface(thumb, "disabled", thumb_width, thumb_height, "#626b68")
            thumb_shadow None
            thumb_offset 0
            left_gutter 0
            right_gutter 0
            bar_vertical False

screen vn_preference_choice(key, character_id, options, skin, x, y, width, height, font_size, text_color, surface, font, identity, component_id=None):
    $ caption = vn_preference_caption(key, character_id, options["options"])
    vn_skin_button:
        id (identity + "_choice")
        alt caption
        action Show("vn_preference_popup", key=key, character_id=character_id, options=options, x=x, y=y, width=width, button_height=height, font_size=font_size, text_color=text_color, surface=surface, font=font, component_id=component_id)
        sensitive ((not _preferences.fullscreen and renpy.get_renderer_info().get("resizable", False)) if key == "windowSize" else VnSetPreference(key, vn_preference_get(key, character_id), character_id, component_id).get_sensitive())
        xysize (width, height)
        padding (8, 2)
        background vn_ui_surface(skin, "idle", width, height, surface)
        hover_background vn_ui_surface(skin, "hover", width, height, "#586157")
        activate_background vn_ui_surface(skin, "pressed", width, height, "#344638")
        insensitive_background vn_ui_surface(skin, "disabled", width, height, "#393e3b")
        fixed:
            xysize (max(1, width - 16), max(1, height - 4))
            text vn_ui_literal(caption) substitute False font font size font_size color text_color xmaximum max(1, width - 36) xalign 0.5 yalign 0.5 text_align 0.5
            if options.get("arrowPath"):
                add Transform(options["arrowPath"], xysize=(max(1, int(height * 0.55)), max(1, int(height * 0.55)))) xalign 1.0 yalign 0.5
            else:
                text "v" font font size font_size color text_color xalign 1.0 yalign 0.5

screen vn_preference_popup(key, character_id, options, x, y, width, button_height, font_size, text_color, surface, font, component_id=None):
    modal True
    zorder 180
    $ item_height = options.get("itemHeight", 40)
    $ popup_width = min(max(width, font_size * 17) if key == "windowSize" else width, config.screen_width - 16)
    $ popup_height = min(item_height * len(options["options"]) + 8, config.screen_height - 16)
    $ popup_x = max(8, min(x, config.screen_width - popup_width - 8))
    $ popup_y = max(8, min(y + button_height if y + button_height + popup_height < config.screen_height - 8 else y - popup_height, config.screen_height - popup_height - 8))
    button:
        xfill True
        yfill True
        background None
        hover_background None
        action Hide("vn_preference_popup")
    frame:
        pos (popup_x, popup_y)
        xysize (popup_width, popup_height)
        padding (4, 4)
        background (Solid("#262b30") if key == "windowSize" else Transform(options["popupPath"], xysize=(popup_width, popup_height)) if options.get("popupPath") else Solid(surface))
        viewport:
            xysize (popup_width - 8, popup_height - 8)
            mousewheel True
            pagekeys True
            draggable True
            vbox:
                for index, option in enumerate(options["options"]):
                    $ option_action = VnSetPreference(key, option["value"], character_id, component_id)
                    $ option_caption = (("当前 · " if option_action.get_selected() else "") + ("%d × %d" % vn_window_dimensions(option["value"])) + ("（超出屏幕）" if not option_action.get_sensitive() else "")) if key == "windowSize" else option["label"]
                    use vn_styled_button(vn_ui_literal(option_caption), [Hide("vn_preference_popup"), option_action], "vn_preference_option_%d" % index, popup_width - 8, item_height, min(font_size, item_height - 4), ("#ffffff" if key == "windowSize" else text_color), ("#262b30" if key == "windowSize" else surface), ({} if key == "windowSize" else options.get("itemSkin") or {}), font)
    key "game_menu" action Hide("vn_preference_popup")

screen vn_styled_button(caption, action, identity, width, height, font_size, text_color, surface, skin, font, selected_text_color=None, hover_text_color=None, text_outlines=None, text_bold=False, button_padding=(8, 4), appearance=None):
    $ appearance = appearance or {}
    vn_skin_button:
        id identity
        action action
        alt caption
        xysize (width, height)
        padding button_padding
        at Transform(alpha=appearance.get("opacity", 1.0))
        background vn_ui_box(skin, "idle", width, height, surface, appearance)
        hover_background vn_ui_box(skin, "hover", width, height, "#586157", appearance)
        activate_background vn_ui_box(skin, "pressed", width, height, "#344638", appearance)
        selected_background vn_ui_box(skin, "selected", width, height, "#586157", appearance)
        selected_hover_background vn_ui_box(skin, "selected", width, height, "#586157", appearance)
        selected_activate_background vn_ui_box(skin, "pressed", width, height, "#344638", appearance)
        insensitive_background vn_ui_box(skin, "disabled", width, height, "#393e3b", appearance)
        selected_insensitive_background vn_ui_box(skin, "disabled", width, height, "#393e3b", appearance)
        if not skin.get("hideText", False):
            fixed:
                xysize (max(1, width - button_padding[0] * 2), max(1, height - button_padding[1] * 2))
                if appearance.get("shadowBlur", 0) > 0 and appearance.get("shadowOpacity", 0.4) > 0:
                    add vn_ui_text_shadow(caption, font, font_size, text_bold, max(1, width - button_padding[0] * 2), max(1, height - button_padding[1] * 2), appearance) id (identity + "_shadow")
                text caption id (identity + "_label") substitute False font font bold text_bold size font_size color (selected_text_color if selected_text_color and renpy.display.behavior.is_selected(action) else text_color) hover_color (hover_text_color or text_color) activate_color (hover_text_color or text_color) selected_activate_color (hover_text_color or text_color) insensitive_color appearance.get("disabledTextColor", text_color) xalign 0.5 yalign 0.5 text_align 0.5 xmaximum max(1, width - button_padding[0] * 2) outlines (text_outlines or [])

screen vn_skin_slots(area_width, area_height, font_size, text_color, surface, skin, options, font):
    $ columns = options.get("columns", 3)
    $ rows = options.get("rows", 2)
    $ fixed_auto = options.get("fixedAutoSlot", False) and columns * rows > 1
    $ page_count = options.get("pageCount", 6)
    $ manual_page = FileCurrentPage() if str(FileCurrentPage()).isdigit() else "1"
    $ pages = [(str(page), FilePage(str(page)), str(page)) for page in range(1, page_count + 1)]
    $ pages = pages if fixed_auto else [("上一页", FilePagePrevious(), "previous"), ("自动", FilePage("auto"), "auto"), ("快速", FilePage("quick"), "quick")] + pages + [("下一页", FilePageNext(), "next")]
    $ gap_x = min(int(options.get("gapX", 10) + 0.5), max(0, int(area_width / (columns * 2))))
    $ gap_y = min(int(options.get("gapY", 10) + 0.5), max(0, int(area_height / (rows * 3))))
    $ nav_height = max(24, min(40, int(area_height * 0.1)))
    $ nav = vn_ui_rect(options["navigationRect"], area_width, area_height) if options.get("navigationRect") else (0, area_height - nav_height if options.get("navigation") == "bottom" else 0, area_width, nav_height)
    $ nav_gap = max(2, min(8, int(nav[2] / 150)))
    $ nav_width = max(1, int((nav[2] - (len(pages) - 1) * nav_gap) / len(pages)))
    $ nav_font = min(44, nav[3] - 2, nav_width - 12) if fixed_auto else max(8, min(font_size, 20, int((nav_width - 16) / 3)))
    $ grid_top = 0 if options.get("navigation") == "bottom" else nav[1] + nav[3] + gap_y
    $ grid_height = max(1, nav[1] - gap_y if options.get("navigation") == "bottom" else area_height - grid_top)
    $ cell_width = max(1, min(int(options.get("itemWidth", area_width)), int((area_width - (columns - 1) * gap_x) / columns)))
    $ cell_height = max(1, min(int(options.get("itemHeight", area_height)), int((grid_height - (rows - 1) * gap_y) / rows)))
    $ caption_height = max(18, min(32, int(cell_height * 0.2))) if options.get("showDelete", True) or (not options.get("caption") and options.get("showLabels", True)) else 0
    $ body_height = max(1, cell_height - caption_height)
    $ thumbnail = vn_ui_rect(options["thumbnail"], cell_width, body_height) if options.get("thumbnail") else (10, 10, max(1, cell_width - 20), max(1, body_height - 20))
    fixed:
        xysize (area_width, area_height)
        hbox:
            pos (nav[0], nav[1])
            spacing nav_gap
            for caption, page_action, page_id in pages:
                use vn_styled_button(caption, page_action, "vn_file_page_" + page_id, nav_width, nav[3], nav_font, options.get("pageTextColor", text_color), surface, options.get("pageSkin") or {}, font, selected_text_color=options.get("pageSelectedTextColor"))
        grid columns rows:
            xpos int((area_width - (columns * cell_width + (columns - 1) * gap_x)) / 2)
            ypos grid_top
            xspacing gap_x
            yspacing gap_y
            for index in range(columns * rows):
                $ auto_slot = fixed_auto and index == 0
                $ slot = 1 if auto_slot else index if fixed_auto else index + 1
                $ page = "auto" if auto_slot else manual_page if fixed_auto else None
                $ slot_action = FileLoad(slot, page=page) if auto_slot else FileAction(slot, page=page)
                $ slot_identity = "vn_file_slot_auto" if auto_slot else "vn_file_slot_%d" % slot
                $ slot_number = "自动" if auto_slot else "No. %d" % ((int(manual_page) - 1) * (columns * rows - 1) + slot) if fixed_auto else "%02d" % slot
                $ loadable = FileLoadable(slot, page=page)
                $ slot_skin = options.get("autoSlotSkin") or skin if auto_slot else skin
                fixed:
                    xysize (cell_width, cell_height)
                    vn_skin_button:
                        id slot_identity
                        action slot_action
                        alt ("自动存档" if auto_slot else "存档 %d" % slot)
                        xysize (cell_width, body_height)
                        padding (0, 0)
                        background vn_ui_surface(slot_skin, "idle", cell_width, body_height, surface)
                        hover_background vn_ui_surface(slot_skin, "hover", cell_width, body_height, "#586157")
                        activate_background vn_ui_surface(slot_skin, "pressed", cell_width, body_height, "#344638")
                        insensitive_background vn_ui_surface(slot_skin, "disabled", cell_width, body_height, surface)
                        if options.get("hoverOverlayPath"):
                            hover_foreground Transform(options["hoverOverlayPath"], xysize=(cell_width, body_height))
                            activate_foreground Transform(options["hoverOverlayPath"], xysize=(cell_width, body_height))
                        fixed:
                            xysize (cell_width, body_height)
                            if loadable or not options.get("emptyPath"):
                                if options.get("thumbnailFramePath"):
                                    $ frame = vn_ui_rect(options["thumbnailFrame"], cell_width, body_height)
                                    add Transform(options["thumbnailFramePath"], xysize=(frame[2], frame[3])) pos (frame[0], frame[1])
                                add FileScreenshot(slot, page=page) xysize (thumbnail[2], thumbnail[3]) pos (thumbnail[0], thumbnail[1])
                                if options.get("chapter") and options.get("showLabels", True):
                                    $ chapter = vn_ui_rect(options["chapter"], cell_width, body_height)
                                    text vn_ui_literal(vn_ui_slot_heading(slot, page)) substitute False pos (chapter[0], chapter[1]) xsize chapter[2] ysize chapter[3] font font size font_size color text_color
                                if options.get("caption") and options.get("showLabels", True):
                                    $ caption = vn_ui_rect(options["caption"], cell_width, body_height)
                                    viewport:
                                        pos (caption[0], caption[1])
                                        xysize (caption[2], caption[3])
                                        mousewheel True
                                        draggable False
                                        text vn_ui_literal(vn_ui_slot_caption(slot, options.get("captionMode", "time"), page, bool(options.get("chapter")))) substitute False xsize caption[2] font font size options.get("summaryFontSize", font_size) color text_color text_align (0.0 if options.get("chapter") else 0.5)
                            else:
                                add Transform(options["emptyPath"], xysize=(cell_width, body_height))
                            if options.get("number"):
                                $ number = vn_ui_rect(options["number"], cell_width, body_height)
                                add vn_ui_surface(options.get("numberSkin") or {}, "idle", number[2], number[3], "#00000000") pos (number[0], number[1])
                                fixed:
                                    pos (number[0], number[1])
                                    xysize (number[2], number[3])
                                    text slot_number xalign 0.5 yalign 0.5 font font size min(font_size, number[3] - 4) color options.get("numberTextColor", text_color) text_align 0.5
                    if options.get("slotAction") and (loadable or (renpy.get_screen("save") and not auto_slot)):
                        $ control = vn_ui_rect(options["slotAction"], cell_width, body_height)
                        fixed:
                            pos (control[0], control[1])
                            xysize (control[2], control[3])
                            use vn_styled_button("读取存档" if auto_slot or renpy.get_screen("load") else "保存存档", slot_action, slot_identity + "_action", control[2], control[3], min(font_size, control[3] - 8), "#ffffff", "#11121b", (options.get("slotSaveSkin") if renpy.get_screen("save") and not auto_slot else None) or options.get("slotActionSkin") or {}, font)
                    hbox:
                        yalign 1.0
                        xysize (cell_width, caption_height)
                        if options.get("showLabels", True) and not options.get("caption"):
                            text FileTime(slot, page=page, format="%Y-%m-%d %H:%M", empty="空存档") font font size max(8, min(font_size, 20, int(cell_width / 15))) color text_color yalign 0.5 xsize max(1, cell_width - (60 if options.get("showDelete", True) else 0))
                        if options.get("showDelete", True) and not auto_slot:
                            textbutton "删除" action FileDelete(slot, page=page, confirm=True) xysize (min(60, cell_width), caption_height) padding (2, 2) text_font font text_size min(18, font_size) text_color text_color

screen vn_history_voice_controls(filename, identity, size, font_size, text_color, options, font, gap=18, voice_record=None):
    hbox:
        spacing gap
        if filename:
            use vn_styled_button("重播语音", VnReplayVoice(filename, voice_record), identity + "_replay", size, size, vn_voice_button_font(font_size, size, size), text_color, "#00000000", options.get("voiceReplaySkin") or {}, font, button_padding=(0, 0))
            use vn_styled_button("取消收藏" if VnFavoriteVoice(filename, voice_record).get_selected() else "收藏语音", VnFavoriteVoice(filename, voice_record), identity + "_favorite", size, size, vn_voice_button_font(font_size, size, size), text_color, "#00000000", options.get("voiceFavoriteSkin") or {}, font, button_padding=(0, 0))
        else:
            null width (size * 2 + gap) height size

screen vn_voice_collection_item(entry_id, caption, entry_path, width, height, font_size, text_color, surface, skin, options, identity, font, favorites_only):
    $ voice_record = vn_voice_record(entry_path, entry_id)
    $ voice_action = VnReplayVoice(entry_path, voice_record)
    $ favorite_size = min(int(options.get("voiceButtonSize", 49)), int(width / 3))
    $ favorite_rect = vn_ui_rect(options["voiceFavoriteRect"], width, height) if options.get("voiceFavoriteRect") else (width - favorite_size, int((height - favorite_size) / 2), favorite_size, favorite_size)
    $ caption_rect = vn_ui_rect(options["caption"], width, height) if options.get("caption") else (8, 0, max(1, favorite_rect[0] - 16), height)
    $ raw_caption = (voice_record or {}).get("text" if options.get("voiceCaptionMode") == "text" else "caption", caption) if voice_action.get_sensitive() else "未解锁"
    $ shown_caption = vn_voice_excerpt(raw_caption, font, font_size, caption_rect[2]) if options.get("voiceSingleLine", False) else vn_ui_literal(raw_caption)
    fixed:
        xysize (width, height)
        vn_skin_button:
            id (identity + "_" + entry_id)
            action voice_action
            alt raw_caption
            xysize (width, height)
            padding (0, 0)
            background vn_ui_surface(skin, "idle", width, height, surface)
            hover_background vn_ui_surface(skin, "hover", width, height, surface)
            activate_background vn_ui_surface(skin, "pressed", width, height, surface)
            selected_background vn_ui_surface(skin, "selected", width, height, surface)
            selected_hover_background vn_ui_surface(skin, "selected", width, height, surface)
            selected_activate_background vn_ui_surface(skin, "pressed", width, height, surface)
            insensitive_background vn_ui_surface(skin, "disabled", width, height, surface)
            fixed:
                xysize (width, height)
                if not skin.get("hideText", False):
                    viewport:
                        pos (caption_rect[0], caption_rect[1])
                        xysize (caption_rect[2], caption_rect[3])
                        text shown_caption id (identity + "_caption_" + entry_id) substitute False font font size font_size color text_color xsize caption_rect[2] yalign 0.5 layout ("nobreak" if options.get("voiceSingleLine", False) else "tex") slow_cps 0
        fixed:
            pos (favorite_rect[0], favorite_rect[1])
            xysize (favorite_rect[2], favorite_rect[3])
            use vn_styled_button("取消收藏" if VnFavoriteVoice(entry_path, voice_record).get_selected() else "收藏", VnRemoveFavoriteVoice(entry_path, options.get("voiceRemoveConfirm", False), options.get("voiceRemoveMessage", ${pythonLiteral(defaultVoiceRemoveMessage)}), voice_record) if favorites_only else VnFavoriteVoice(entry_path, voice_record), identity + "_favorite_" + entry_id, favorite_rect[2], favorite_rect[3], vn_voice_button_font(font_size, favorite_rect[2], favorite_rect[3]), text_color, "#00000000", options.get("voiceFavoriteSkin") or {}, font, button_padding=(0, 0))

screen vn_collection(kind, area_width, area_height, font_size, text_color, surface, skin, options, component_id, font, heading=""):
    default collection_page = 0
    default collection_favorites = options.get("favoritesOnly", False)
    $ columns = options.get("columns", 3 if kind == "galleryGrid" else 1)
    $ rows = options.get("rows", 0)
    $ gap_x = min(int(options.get("gapX", 12) + 0.5), max(0, int(area_width / (columns * 2))))
    $ gap_y = int(options.get("gapY", 12) + 0.5)
    $ cell_width = max(1, min(int(options.get("itemWidth", area_width)), int((area_width - (columns - 1) * gap_x - (0 if rows else 16)) / columns)))
    $ nav_height = min(40, max(24, int(area_height * 0.1))) if rows and not options.get("navigationRect") else 0
    $ controls_height = min(42, int(area_height * 0.12)) if kind == "voiceCollection" and options.get("showVoiceControls", True) else 0
    $ controls_width = max(1, min(180, int((area_width - 20) / 2)))
    $ view_height = max(1, area_height - nav_height - (gap_y if nav_height else 0) - (controls_height + gap_y if controls_height else 0))
    $ cell_height = max(1, int(options.get("itemHeight", max(32, int((view_height - (rows - 1) * gap_y) / rows)) if rows else max(48, font_size + 28)) + 0.5))
    $ allowed = options.get("assetPaths")
    if kind == "historyList":
        $ history_bar = options.get("historyScrollbar")
        $ history_width = area_width if history_bar else area_width - 20
        viewport:
            id (component_id + "_viewport")
            xysize (area_width, area_height)
            mousewheel True
            draggable True
            scrollbars (None if history_bar else "vertical")
            yinitial 1.0
            vbox:
                xsize max(1, history_width)
                spacing gap_y
                if not _history_list:
                    text "暂无对话记录" font font size font_size color text_color
                for entry_index, entry in enumerate(_history_list):
                    $ filename = getattr(getattr(entry, "voice", None), "filename", None)
                    $ voice_size = int(options.get("voiceButtonSize", 49))
                    $ name_width = min(int(options.get("historyNameWidth", 165)), max(40, int(area_width * 0.25)))
                    frame:
                        xfill True
                        padding (18, int(options.get("historyPaddingY", 12)))
                        background vn_ui_surface(skin, "idle", max(1, area_width - 20), max(64, font_size + 34), surface)
                        if options.get("historyLayout") == "columns":
                            hbox:
                                spacing gap_x
                                yminimum int(options.get("historyRowHeight", voice_size))
                                fixed:
                                    xysize (name_width, voice_size)
                                    text (entry.who or "") substitute False font font bold options.get("historyBold", False) kerning options.get("historyLetterSpacing", 0) size int(options.get("historyNameFontSize", font_size)) color text_color xmaximum name_width text_align 1.0 xalign 1.0 yalign 0.5
                                use vn_history_voice_controls(filename, component_id + "_%d" % entry_index, voice_size, font_size, text_color, options, font, gap_x, vn_capture_history_voice(entry))
                                text entry.what substitute False font font bold options.get("historyBold", False) kerning options.get("historyLetterSpacing", 0) size font_size color text_color xsize max(1, history_width - name_width - voice_size * 2 - 36 - gap_x * 3) yoffset max(0, int((voice_size - font_size) / 2)) line_spacing int(font_size * 0.2)
                        else:
                            vbox:
                                spacing 6
                                if entry.who:
                                    text entry.who substitute False font font bold options.get("historyBold", False) kerning options.get("historyLetterSpacing", 0) size font_size color text_color
                                text entry.what substitute False font font bold options.get("historyBold", False) kerning options.get("historyLetterSpacing", 0) size font_size color text_color xmaximum max(1, area_width - 60)
                                if filename:
                                    use vn_history_voice_controls(filename, component_id + "_%d" % entry_index, voice_size, font_size, text_color, options, font, voice_record=vn_capture_history_voice(entry))
        if history_bar:
            $ bar_rect = tuple(int(history_bar["rect"][key] * dimension + 0.5) for key, dimension in [("x", area_width), ("y", area_height), ("width", area_width), ("height", area_height)])
            $ bar_skin = history_bar.get("thumb") or {}
            fixed:
                pos (bar_rect[0], bar_rect[1])
                xysize (bar_rect[2], bar_rect[3])
                add (Transform(history_bar["trackPath"], xysize=(int(history_bar.get("trackWidth", 5)), bar_rect[3])) if history_bar.get("trackPath") else Solid("#777777", xsize=int(history_bar.get("trackWidth", 5)), ysize=bar_rect[3])) xalign 0.5
                vbar:
                    id (component_id + "_scrollbar")
                    value YScrollValue(component_id + "_viewport")
                    xysize (bar_rect[2], bar_rect[3])
                    base_bar Null()
                    thumb (Frame(bar_skin["idle"], 0, 16, 0, 16) if bar_skin.get("idle") else Solid("#dddddd"))
                    hover_thumb (Frame(bar_skin.get("hover", bar_skin.get("idle")), 0, 16, 0, 16) if bar_skin.get("idle") else Solid("#ffffff"))
                    thumb_shadow None
                    thumb_offset 0
                    top_gutter 0
                    bottom_gutter 0
                    unscrollable "insensitive"
    elif kind == "galleryGrid":
        use vn_gallery_grid(area_width, area_height, font_size, text_color, surface, skin, options, component_id, font)
    elif kind == "flowchart" and options.get("layout") == "flow":
        use vn_story_flow(area_width, area_height, font_size, text_color, surface, skin, options, component_id, font)
    elif kind == "pauseMenu":
        viewport:
            xysize (area_width, area_height)
            mousewheel True
            vbox:
                spacing gap_y
                for index, (caption, action) in enumerate([("继续游戏", Return()), ("保存进度", ShowMenu("save")), ("读取存档", ShowMenu("load")), ("设置", ShowMenu("preferences")), ("返回标题", MainMenu())]):
                    use vn_styled_button(caption, action, component_id + "_%d" % index, area_width, min(cell_height, max(24, int((area_height - 4 * gap_y) / 5))), font_size, text_color, surface, skin, font)
    elif kind == "staffRoll":
        viewport:
            xysize (area_width, area_height)
            mousewheel True
            draggable True
            scrollbars "vertical"
            text heading substitute False font font size font_size color text_color xsize max(1, area_width - 20) text_align 0.5
    else:
        if kind == "galleryGrid":
            $ entries = [entry for entry in vn_gallery_entries if allowed is None or entry[2] in allowed]
        elif kind == "musicTrackList":
            $ track_names = dict((track_path, track_name) for track_name, track_path in vn_music_entries)
            $ entries = [(track_path, track_names[track_path], track_path) for track_path in (allowed if allowed is not None else list(track_names)) if track_path in track_names]
        elif kind == "voiceCollection":
            $ entries = vn_voice_collection_entries(allowed, collection_favorites, options.get("voiceOrder", "source"))
        elif kind == "chapterList":
            $ entries = vn_chapter_entries
        else:
            $ entries = vn_flow_entries
        $ page_size = max(1, rows * columns) if rows else max(1, len(entries))
        $ page_count = max(1, int((len(entries) + page_size - 1) / page_size))
        $ collection_page = min(collection_page, page_count - 1)
        $ active_page = min(collection_page, page_count - 1)
        $ shown_entries = entries[active_page * page_size:(active_page + 1) * page_size]
        vbox:
            xysize (area_width, area_height)
            spacing gap_y
            if controls_height:
                hbox:
                    xalign 1.0
                    ysize controls_height
                    spacing 20
                    use vn_styled_button("仅收藏" if collection_favorites else "全部语音", [SetLocalVariable("collection_favorites", not collection_favorites), SetLocalVariable("collection_page", 0)], component_id + "_filter", controls_width, controls_height, min(font_size, 24), text_color, surface, dict(skin, hideText=False), font)
                    use vn_styled_button("停止试听", Stop("vn_replayvoice"), component_id + "_stop", controls_width, controls_height, min(font_size, 24), text_color, surface, dict(skin, hideText=False), font)
            if not entries:
                text ("暂无图片" if kind == "galleryGrid" else "暂无音乐" if kind == "musicTrackList" else "尚未收藏语音，可在对话历史中点击收藏" if kind == "voiceCollection" and collection_favorites else "暂无语音" if kind == "voiceCollection" else "暂无条目") font font size font_size color text_color
            else:
                vpgrid:
                    cols columns
                    xysize (area_width, view_height)
                    viewport_xysize (max(1, area_width - (0 if rows else 10)), view_height)
                    xspacing gap_x
                    yspacing gap_y
                    scrollbars (None if rows else "vertical")
                    mousewheel (not rows)
                    draggable (not rows)
                    for entry_id, caption, entry_path in shown_entries:
                        if kind == "galleryGrid":
                            $ unlocked = entry_id in persistent.vn_unlocks
                            vn_skin_button:
                                id ("vn_gallery_%s" % entry_id)
                                action Show("vn_gallery_image", asset_path=entry_path)
                                sensitive unlocked
                                alt (caption if unlocked else "未解锁图片")
                                xysize (cell_width, cell_height)
                                padding (0, 0)
                                background vn_ui_surface(skin, "idle", cell_width, cell_height, surface)
                                hover_background vn_ui_surface(skin, "hover", cell_width, cell_height, "#586157")
                                activate_background vn_ui_surface(skin, "pressed", cell_width, cell_height, "#344638")
                                insensitive_background vn_ui_surface(skin, "disabled", cell_width, cell_height, surface)
                                fixed:
                                    xysize (cell_width, cell_height)
                                    if unlocked:
                                        add Transform(entry_path, xysize=(max(1, cell_width - 16), max(1, cell_height - (font_size + 24 if options.get("showLabels", True) else 16))), fit="contain") xalign 0.5 ypos 8
                                    elif options.get("lockedPath"):
                                        add Transform(options["lockedPath"], xysize=(cell_width, cell_height), fit="contain") xalign 0.5 yalign 0.5
                                    else:
                                        text "未解锁" font font size font_size color text_color xalign 0.5 yalign 0.5
                                    if unlocked and options.get("showLabels", True):
                                        text caption substitute False font font size min(font_size, 24) color text_color xalign 0.5 yalign 0.98 xmaximum max(1, cell_width - 16)
                        elif kind == "musicTrackList":
                            use vn_styled_button(caption if vn_music_room.is_unlocked(entry_path) else "未解锁", vn_music_room.Play(entry_path), component_id + "_" + entry_id, cell_width, cell_height, font_size, text_color, surface, skin, font)
                        elif kind == "voiceCollection":
                            if options.get("caption") or options.get("voiceFavoriteRect") or options.get("voiceSingleLine") or options.get("voiceCaptionMode") == "text":
                                use vn_voice_collection_item(entry_id, caption, entry_path, cell_width, cell_height, font_size, text_color, surface, skin, options, component_id, font, collection_favorites)
                            else:
                                $ favorite_size = min(int(options.get("voiceButtonSize", 49)), int(cell_width / 3))
                                hbox:
                                    xysize (cell_width, cell_height)
                                    spacing 8
                                    use vn_styled_button(vn_voice_caption(entry_path, caption, entry_id) if VnReplayVoice(entry_path, entry_id).get_sensitive() else "未解锁", VnReplayVoice(entry_path, entry_id), component_id + "_" + entry_id, cell_width - favorite_size - 8, cell_height, font_size, text_color, surface, skin, font)
                                    vbox:
                                        yalign 0.5
                                        use vn_styled_button("取消收藏" if VnFavoriteVoice(entry_path, entry_id).get_selected() else "收藏", VnRemoveFavoriteVoice(entry_path, options.get("voiceRemoveConfirm", False), options.get("voiceRemoveMessage", ${pythonLiteral(defaultVoiceRemoveMessage)}), entry_id) if collection_favorites else VnFavoriteVoice(entry_path, entry_id), component_id + "_favorite_" + entry_id, favorite_size, favorite_size, vn_voice_button_font(font_size, favorite_size, favorite_size), text_color, "#00000000", options.get("voiceFavoriteSkin") or {}, font, button_padding=(0, 0))
                        else:
                            $ entry_look = options.get("flowLooks", {}).get(entry_id, {})
                            $ entry_style = entry_look.get("style") or {}
                            $ entry_skin = entry_look.get("skin") or skin
                            $ entry_skin = dict(entry_skin, hideText=True) if kind == "flowchart" and not vn_story_unlocked(kind, entry_id, options.get("lockUnread", False)) and entry_skin.get("disabled") else entry_skin
                            use vn_styled_button(vn_story_caption(kind, entry_id, caption, options), VnStoryStart(kind, entry_id, entry_path, caption, options.get("lockUnread", False), options.get("confirmJump", True)), component_id + "_" + entry_id, cell_width, cell_height, entry_style.get("fontSize", font_size), entry_style.get("textColor", text_color), surface, entry_skin, entry_look.get("font") or font, selected_text_color=entry_style.get("selectedTextColor"), hover_text_color=entry_style.get("hoverTextColor"), text_outlines=entry_look.get("textOutlines"), appearance=entry_style)
            if rows and not options.get("navigationRect"):
                hbox:
                    xalign 0.5
                    spacing 12
                    textbutton "上一页" action SetLocalVariable("collection_page", max(0, active_page - 1)) sensitive active_page > 0 text_font font text_size min(font_size, 22) text_color text_color ysize nav_height
                    text ("%d / %d" % (active_page + 1, page_count)) font font size min(font_size, 22) color text_color yalign 0.5
                    textbutton "下一页" action SetLocalVariable("collection_page", min(page_count - 1, active_page + 1)) sensitive active_page < page_count - 1 text_font font text_size min(font_size, 22) text_color text_color ysize nav_height

        if rows and options.get("navigationRect"):
            $ nav_rect = options["navigationRect"]
            $ nav = (int(nav_rect["x"] * area_width), int(nav_rect["y"] * area_height), max(1, int(nav_rect["width"] * area_width)), max(1, int(nav_rect["height"] * area_height)))
            hbox:
                xpos nav[0]
                ypos nav[1]
                xysize (nav[2], nav[3])
                spacing 8
                for number in range(page_count):
                    use vn_styled_button(str(number + 1), SetLocalVariable("collection_page", number), component_id + "_page_%d" % number, min(64, max(20, int(nav[2] / page_count) - 8)), nav[3], font_size, options.get("pageTextColor", text_color), "#00000000", options.get("pageSkin") or {}, font, selected_text_color=options.get("pageSelectedTextColor"))

screen vn_context_component(kind, area_width, area_height, font_size, text_color, caption, title="", subtitle="", font="fonts/SourceHanSansLite.ttf", title_image=None, align=0.5, text_outlines=[]):
    viewport:
        xysize (area_width, area_height)
        mousewheel True
        draggable True
        vbox:
            xsize area_width
            spacing 12
            if caption and kind != "chapterTitle":
                text caption substitute False size font_size color text_color xmaximum area_width text_align 0.5
            if kind == "chapterTitle":
                if title_image:
                    add Transform(title_image, xysize=(area_width, area_height), fit="contain") xalign 0.5
                else:
                    text (title or caption) substitute False font font size font_size color text_color xsize area_width min_width area_width text_align align outlines text_outlines slow_cps 0
                if subtitle and not title_image:
                    text subtitle substitute False font font size min(font_size, 32) color text_color xsize area_width min_width area_width text_align align outlines text_outlines slow_cps 0
            elif kind == "keyboard":
                input value VariableInputValue("vn_minigame_answer") length 128 id "vn_minigame_input" size font_size color text_color
                for row in ("1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"):
                    hbox:
                        spacing 3
                        for key in row:
                            textbutton key action SetVariable("vn_minigame_answer", vn_minigame_answer + key) xsize max(20, int(area_width / 11)) text_size min(font_size, 24)
                textbutton "退格" action SetVariable("vn_minigame_answer", vn_minigame_answer[:-1])
            elif kind == "gameOver":
                textbutton "重新开始" action Start()
                textbutton "返回标题" action MainMenu()
`;
}
