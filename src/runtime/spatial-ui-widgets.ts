/** Authored gallery and story-map geometry comes from the same core layout as the editor. */
export function createSpatialUiWidgets() {
  return `
init python:
    import functools

    def vn_gallery_condition(condition):
        kind = condition["kind"]
        if kind == "not":
            return not vn_gallery_condition(condition["condition"])
        if kind in ("all", "any"):
            return (all if kind == "all" else any)(vn_gallery_condition(item) for item in condition["conditions"])
        parameter_id = condition["variableId"]
        if parameter_id not in vn_parameter_info:
            return False
        left, right, operator = vn_parameter_get(parameter_id), condition["value"], condition["operator"]
        if operator == "eq":
            return left == right
        if operator == "ne":
            return left != right
        return left > right if operator == "gt" else left >= right if operator == "gte" else left < right if operator == "lt" else left <= right

    def vn_gallery_unlocked(variant):
        condition = variant.get("unlockWhen")
        return vn_gallery_condition(condition) if condition is not None else variant["id"] in persistent.vn_unlocks

    class VnFlowThumb(renpy.Displayable):
        # Bar supplies the page/extent ratio during rendering, after Viewport has
        # measured its content. Screen evaluation still has the previous page.
        def __init__(self, skin, state, maximum, height, fallback):
            super(VnFlowThumb, self).__init__()
            self.skin, self.state, self.maximum, self.height, self.fallback = skin, state, maximum, height, fallback
            self.child, self.child_width = None, None

        def render(self, width, height, st, at):
            borders = self.skin.get("borders") or {}
            minimum = borders.get("left", 12) + borders.get("right", 12) + 1 if self.skin.get("fit") == "nineSlice" else 16
            width = min(self.maximum, max(minimum, int(width)))
            if self.child_width != width:
                self.child = vn_ui_surface(self.skin, self.state, width, self.height, self.fallback)
                self.child_width = width
            return renpy.render(self.child, width, self.height, st, at)

        def visit(self):
            return [self.child] if self.child is not None else []

    @functools.lru_cache(maxsize=512)
    def vn_flow_font_size(caption, font, size, width, height):
        # Measure the actual font before fitting long, editable node names.
        probe = Text(caption, substitute=False, font=font, size=size, layout="nobreak")
        measured_w, measured_h = renpy.render(probe, 32768, 32768, 0, 0).get_size()
        return max(1, min(size, int(size * min(float(max(1, width - 72)) / max(1, measured_w), float(max(1, height - 16)) / max(1, measured_h)))))

    def vn_gallery_thumbnail(asset_path, width, height, fit):
        source_width, source_height = renpy.image_size(asset_path)
        if fit == "stretch":
            return im.Scale(asset_path, width, height)
        ratio = (max if fit == "cover" else min)(float(width) / source_width, float(height) / source_height)
        scaled_width = max(1, int(source_width * ratio + 0.5))
        scaled_height = max(1, int(source_height * ratio + 0.5))
        scaled = im.Scale(asset_path, scaled_width, scaled_height)
        if fit == "cover":
            return im.Crop(scaled, ((scaled_width - width) // 2, (scaled_height - height) // 2, width, height))
        return Composite((width, height), ((width - scaled_width) // 2, (height - scaled_height) // 2), scaled)

    def vn_gallery_surface(skin, state, width, height, surface, options):
        frame = vn_ui_surface(skin, state, width, height, surface)
        if state == "disabled" and options.get("lockedPath") and options.get("lockedRect"):
            rect = vn_ui_rect(options["lockedRect"], width, height)
            return Composite((width, height), (rect[0], rect[1]), Transform(options["lockedPath"], xysize=(rect[2], rect[3]), fit="fill"), (0, 0), frame)
        return frame

    class VnGalleryThumbnail(renpy.Displayable):
        def __init__(self, asset_path, width, height, fit, brightness):
            super(VnGalleryThumbnail, self).__init__()
            base = vn_gallery_thumbnail(asset_path, width, height, fit)
            self.images = {}
            self.vn_brightness = brightness
            self.vn_state = "idle"
            for state in ("idle", "hover", "pressed", "selected", "disabled"):
                channel = max(0, min(255, int(brightness.get(state, 1.0) * 255 + 0.5)))
                self.images[state] = Transform(base, matrixcolor=TintMatrix("#%02x%02x%02x" % (channel, channel, channel)))

        def set_style_prefix(self, prefix, root):
            super(VnGalleryThumbnail, self).set_style_prefix(prefix, root)
            state = "disabled" if "insensitive" in prefix else "pressed" if "activate" in prefix else "selected" if "selected" in prefix else "hover" if "hover" in prefix else "idle"
            if state != self.vn_state:
                self.vn_state = state
                renpy.redraw(self, 0)

        def render(self, width, height, st, at):
            return renpy.render(self.images[self.vn_state], width, height, st, at)

        def visit(self):
            return list(self.images.values())

screen vn_gallery_grid(area_width, area_height, font_size, text_color, surface, skin, options, component_id, font):
    default gallery_page = 0
    $ geometry = options["galleryGeometry"]
    $ entries = options["galleryEntries"]
    $ cells = geometry["cells"]
    $ page_size = max(1, len(cells))
    $ page_count = max(1, int((len(entries) + page_size - 1) / page_size))
    $ active_page = min(gallery_page, page_count - 1)
    fixed:
        xysize (area_width, area_height)
        for index, entry in enumerate(entries[active_page * page_size:(active_page + 1) * page_size]):
            $ entry_id, caption = entry["id"], entry["name"]
            $ unlocked_paths = [variant["path"] for variant in entry["variants"] if vn_gallery_unlocked(variant)]
            $ entry_path = entry.get("thumbnailPath") or (unlocked_paths[0] if unlocked_paths else None)
            $ cell = vn_ui_rect(cells[index], area_width, area_height)
            $ unlocked = bool(unlocked_paths)
            $ thumbnail = vn_ui_rect(geometry["thumbnail"], cell[2], cell[3])
            $ locked = vn_ui_rect(geometry["locked"], cell[2], cell[3])
            vn_skin_button:
                id ("vn_gallery_%s" % entry_id)
                pos (cell[0], cell[1])
                xysize (cell[2], cell[3])
                padding (0, 0)
                background vn_gallery_surface(skin, "idle", cell[2], cell[3], surface, options)
                hover_background vn_gallery_surface(skin, "hover", cell[2], cell[3], surface, options)
                activate_background vn_gallery_surface(skin, "pressed", cell[2], cell[3], surface, options)
                insensitive_background vn_gallery_surface(skin, "disabled", cell[2], cell[3], surface, options)
                hover_foreground (Transform(options["hoverOverlayPath"], xysize=(cell[2], cell[3])) if options.get("hoverOverlayPath") else None)
                action Show("vn_gallery_image", asset_paths=unlocked_paths, fit=options.get("galleryFit", "contain"), end_action=options.get("galleryEndAction", "close"), show_controls=options.get("galleryShowControls", True))
                sensitive unlocked
                alt (caption if unlocked else "未解锁图片")
                fixed:
                    xysize (cell[2], cell[3])
                    if options.get("thumbnailFramePath"):
                        $ frame = vn_ui_rect(options["thumbnailFrame"], cell[2], cell[3])
                        add Transform(options["thumbnailFramePath"], xysize=(frame[2], frame[3])) pos (frame[0], frame[1])
                    if unlocked:
                        add VnGalleryThumbnail(entry_path, thumbnail[2], thumbnail[3], options.get("thumbnailFit", "contain"), options.get("thumbnailBrightness") or {}) pos (thumbnail[0], thumbnail[1]) id ("vn_gallery_thumb_%s" % entry_id)
                    elif options.get("lockedPath") and not options.get("lockedRect"):
                        add Transform(options["lockedPath"], xysize=(locked[2], locked[3]), fit="contain") pos (locked[0], locked[1])
                    elif not options.get("lockedPath"):
                        text "未解锁" font font size font_size color text_color align (0.5, 0.5)
                    if unlocked and options.get("showLabels", True):
                        text caption substitute False font font size min(font_size, 24) color text_color xalign 0.5 yalign 0.98 xmaximum max(1, cell[2] - 16)
        if not entries:
            text "暂无图片" font font size font_size color text_color align (0.5, 0.4)
        $ nav = vn_ui_rect(geometry["navigation"], area_width, area_height)
        $ page_limit = min(page_count, options.get("galleryPageButtonLimit", 9))
        $ page_start = max(0, min(active_page - page_limit // 2, page_count - page_limit))
        $ page_gap = options.get("pageGap", 8)
        $ page_width = options.get("pageButtonWidth", min(64, max(20, int(nav[2] / page_limit) - page_gap)))
        $ page_height = options.get("pageButtonHeight", min(57, nav[3]))
        fixed:
            pos (nav[0], nav[1])
            xysize (nav[2], nav[3])
            hbox:
                align (0.5, 0.5)
                spacing page_gap
                if page_count > page_limit:
                    textbutton "上一页" action SetLocalVariable("gallery_page", max(0, active_page - 1)) sensitive active_page > 0 text_font font text_size min(font_size, 22) text_color text_color
                for number in range(page_start, page_start + page_limit):
                    use vn_styled_button(str(number + 1), SetLocalVariable("gallery_page", number), component_id + "_page_%d" % number, page_width, page_height, options.get("pageFontSize", min(font_size, 24)), options.get("pageTextColor", text_color), "#00000000", options.get("pageSkin") or {}, options.get("pageFontPath") or font, selected_text_color=options.get("pageSelectedTextColor"), text_bold=options.get("pageBold", False))
                if page_count > page_limit:
                    textbutton "下一页" action SetLocalVariable("gallery_page", min(page_count - 1, active_page + 1)) sensitive active_page < page_count - 1 text_font font text_size min(font_size, 22) text_color text_color

screen vn_story_flow(area_width, area_height, font_size, text_color, surface, skin, options, component_id, font):
    $ graph = options["flowGraph"]
    $ current_id = graph.get("locations", {}).get(vn_current_node, vn_current_node)
    $ current = next((node for node in graph["nodes"] if node["id"] == current_id), graph["nodes"][0] if graph["nodes"] else None)
    $ view = vn_ui_rect(options.get("flowViewport", dict(x=0, y=0, width=1, height=1)), area_width, area_height)
    $ custom_scroll = options.get("flowScrollbar")
    $ show_controls = options.get("flowShowControls", True)
    $ show_vertical = options.get("flowShowVerticalScrollbar", True)
    use vn_story_flow_body(view, area_width, area_height, graph, current, font_size, text_color, surface, skin, options, component_id, font, custom_scroll, show_controls, show_vertical)

screen vn_story_flow_body(view, area_width, area_height, graph, current, font_size, text_color, surface, skin, options, component_id, font, custom_scroll, show_controls, show_vertical):
    default flow_zoom = 1.0
    default flow_x = ui.adjustment()
    default flow_y = ui.adjustment()
    $ line_width = max(1, int(options.get("flowLineWidth", 4) * flow_zoom))
    vbox:
        pos (view[0], view[1])
        xysize (view[2], view[3])
        side ("c" + (" r" if show_vertical else "") + (" b" if not custom_scroll else "")):
            xysize (max(1, view[2] - (0 if options.get("flowViewport") else 32)), max(1, view[3] - (44 if show_controls else 0)))
            xpos (0 if options.get("flowViewport") else 16)
            spacing 8
            viewport:
                style_prefix "vn_flow"
                id (component_id + "_viewport")
                xfill True
                yfill True
                xadjustment flow_x
                yadjustment flow_y
                mousewheel "horizontal"
                draggable True
                fixed:
                    xysize (int(graph["width"] * flow_zoom), int(graph["height"] * flow_zoom))
                    for edge in graph["edges"]:
                        for index in range(len(edge["points"]) - 1):
                            $ a, b = edge["points"][index:index + 2]
                            $ horizontal = a[1] == b[1]
                            $ segment_w = max(line_width, int(abs(b[0] - a[0]) * flow_zoom))
                            $ segment_h = max(line_width, int(abs(b[1] - a[1]) * flow_zoom))
                            $ line_path = options.get("flowLinePath" if horizontal else "flowVerticalLinePath")
                            if a != b:
                                if line_path:
                                    add Transform(line_path, xysize=(segment_w, segment_h)) pos (int(min(a[0], b[0]) * flow_zoom - (0 if horizontal else line_width / 2)), int(min(a[1], b[1]) * flow_zoom - (line_width / 2 if horizontal else 0)))
                                else:
                                    add Solid(options.get("flowLineColor", "#8c7963"), xysize=(segment_w, segment_h)) pos (int(min(a[0], b[0]) * flow_zoom - (0 if horizontal else line_width / 2)), int(min(a[1], b[1]) * flow_zoom - (line_width / 2 if horizontal else 0)))
                    for node in graph["nodes"]:
                        $ node_skin = options.get("flowEndSkin") if node["kind"] == "end" else options.get("flowChapterSkin") if node["kind"] == "chapterTitle" else None
                        $ node_look = options.get("flowLooks", {}).get(node["id"], {})
                        $ node_style = node_look.get("style") or {}
                        $ node_skin = node_look.get("skin") or node_skin or skin
                        $ node_font = node_look.get("font") or font
                        $ node_text_color = node_style.get("textColor", text_color)
                        $ node_locked = not vn_story_unlocked("flowchart", node["id"], options.get("lockUnread", False))
                        $ node_skin = dict(node_skin, hideText=True) if node_locked and node_skin.get("disabled") else node_skin
                        $ node_caption = vn_story_caption("flowchart", node["id"], node["name"], options)
                        $ node_font_size = vn_flow_font_size(node_caption, node_font, node_style.get("fontSize", font_size), node["width"], node["height"])
                        fixed:
                            pos (int(node["x"] * flow_zoom), int(node["y"] * flow_zoom))
                            xysize (int(node["width"] * flow_zoom), int(node["height"] * flow_zoom))
                            if not main_menu and not node_locked and node["id"] == vn_current_node and options.get("flowCurrentMarker", {}).get("path"):
                                $ marker = options["flowCurrentMarker"]
                                $ marker_rect = vn_ui_rect(marker["rect"], int(node["width"] * flow_zoom), int(node["height"] * flow_zoom))
                                add Transform(marker["path"], xysize=(marker_rect[2], marker_rect[3])) pos (marker_rect[0], marker_rect[1]) id (component_id + "_" + node["id"] + "_current_marker")
                            use vn_styled_button(node_caption, VnStoryStart("flowchart", node["id"], "vn_node_" + node["id"], node["name"], options.get("lockUnread", False), options.get("confirmJump", True)), component_id + "_" + node["id"], int(node["width"] * flow_zoom), int(node["height"] * flow_zoom), max(1, int(node_font_size * flow_zoom)), node_text_color, surface, node_skin, node_font, selected_text_color=node_style.get("selectedTextColor", node_text_color), hover_text_color=node_style.get("hoverTextColor", options.get("hoverTextColor")), text_outlines=[(item[0] * flow_zoom, item[1], item[2] * flow_zoom, item[3] * flow_zoom) for item in node_look.get("textOutlines", options.get("textOutlines", []))], appearance=dict(node_style, borderWidth=node_style.get("borderWidth", 0) * flow_zoom, shadowBlur=node_style.get("shadowBlur", 0) * flow_zoom, shadowX=node_style.get("shadowX", 0) * flow_zoom, shadowY=node_style.get("shadowY", 0) * flow_zoom))
            if show_vertical:
                vbar:
                    id (component_id + "_scroll_y")
                    style "vn_flow_vscrollbar"
                    adjustment flow_y
            if not custom_scroll:
                bar:
                    id (component_id + "_scroll_x")
                    style "vn_flow_scrollbar"
                    adjustment flow_x
        hbox:
            ysize (38 if show_controls else 0)
            xpos 24
            spacing 18
            if show_controls:
                if options.get("showProgress", False):
                    text ("已读 %d / %d" % (sum(node["id"] in persistent.vn_seen_nodes for node in graph["nodes"]), len(graph["nodes"]))) font font size min(font_size, 22) color "#f4f0e6" yalign 0.5
                textbutton "−" style "vn_flow_button" id (component_id + "_zoom_out") action SetLocalVariable("flow_zoom", max(0.5, flow_zoom - 0.1)) text_font font text_size 26
                text ("%d%%" % int(flow_zoom * 100 + 0.5)) font font size min(font_size, 22) color "#f4f0e6" yalign 0.5
                textbutton "+" style "vn_flow_button" id (component_id + "_zoom_in") action SetLocalVariable("flow_zoom", min(1.5, flow_zoom + 0.1)) text_font font text_size 26
                textbutton "定位当前位置" style "vn_flow_button" id (component_id + "_locate") action ([Function(flow_x.change, max(0, current["x"] * flow_zoom - view[2] / 3)), Function(flow_y.change, max(0, current["y"] * flow_zoom - view[3] / 3))] if current else NullAction()) sensitive current is not None text_font font text_size min(font_size, 22)
    if custom_scroll:
        $ scroll_rect = vn_ui_rect(custom_scroll["rect"], area_width, area_height)
        $ track_height = max(1, int(min(scroll_rect[3], custom_scroll.get("trackHeight", 5))))
        $ thumb_height = max(1, int(min(scroll_rect[3], custom_scroll.get("thumbHeight", 31))))
        $ thumb_skin = custom_scroll.get("thumb", {})
        if custom_scroll.get("trackPath"):
            add Transform(custom_scroll["trackPath"], xysize=(scroll_rect[2], track_height)) pos (scroll_rect[0], scroll_rect[1] + int((scroll_rect[3] - track_height) / 2))
        else:
            add Solid("#282e2c", xysize=(scroll_rect[2], track_height)) pos (scroll_rect[0], scroll_rect[1] + int((scroll_rect[3] - track_height) / 2))
        bar:
            id (component_id + "_scroll_x")
            pos (scroll_rect[0], scroll_rect[1] + int((scroll_rect[3] - thumb_height) / 2))
            xysize (scroll_rect[2], thumb_height)
            adjustment flow_x
            bar_resizing False
            base_bar None
            left_bar None
            right_bar None
            thumb_offset 0
            thumb_shadow None
            left_gutter 0
            right_gutter 0
            thumb VnFlowThumb(thumb_skin, "idle", scroll_rect[2], thumb_height, "#d4cbb5")
            hover_thumb VnFlowThumb(thumb_skin, "hover", scroll_rect[2], thumb_height, "#fff5de")
            selected_idle_thumb VnFlowThumb(thumb_skin, "pressed", scroll_rect[2], thumb_height, "#c9c0aa")
            selected_hover_thumb VnFlowThumb(thumb_skin, "pressed", scroll_rect[2], thumb_height, "#c9c0aa")
            insensitive_thumb VnFlowThumb(thumb_skin, "disabled", scroll_rect[2], thumb_height, "#626b68")
            unscrollable "insensitive"

style vn_flow_button is button:
    background None
    hover_background "#ffffff18"
    padding (12, 4)
style vn_flow_button_text is button_text:
    color "#f4f0e6"
    hover_color "#ffffff"
style vn_flow_scrollbar is scrollbar:
    ysize 16
    base_bar "#282e2c"
    thumb "#d4cbb5"
    hover_thumb "#fff5de"
    thumb_offset 0
    unscrollable "insensitive"
style vn_flow_vscrollbar is vscrollbar:
    xsize 16
    base_bar "#282e2c"
    thumb "#d4cbb5"
    hover_thumb "#fff5de"
    thumb_offset 0
    unscrollable "insensitive"
`;
}
