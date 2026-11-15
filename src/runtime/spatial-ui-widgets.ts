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

    def vn_flow_parts(node, caption, locked):
        # A progress note added to the name stays on the last part.
        parts = node.get("parts")
        if locked or not parts or not caption.startswith(node["name"]):
            return [caption]
        return parts[:-1] + [parts[-1] + caption[len(node["name"]):]]

    def vn_flow_markup(parts, slots, font, size, scale=1.0, letter_spacing=0):
        # Parts share one line, so they fit and align as one caption. They pair with
        # the slots from the end: a caption with fewer parts still gets the main one.
        slots = slots or []
        if len(parts) < 2 and not letter_spacing and not (slots and any(slots[-1].values())):
            return parts[0].replace("{", "{{")
        pieces = []
        for index, part in enumerate(parts):
            slot = slots[min(max(0, len(slots) - len(parts) + index), len(slots) - 1)] if slots else {}
            piece = part.replace("{", "{{")
            spacing = slot.get("letterSpacing")
            has_spacing = spacing is not None or letter_spacing != 0
            spacing = letter_spacing if spacing is None else spacing
            if has_spacing:
                piece = "{k=%s}%s{/k}" % (spacing * scale, piece)
            if slot.get("font"):
                piece = "{font=%s}%s{/font}" % (slot["font"], piece)
            if slot.get("size"):
                piece = "{size=%d}%s{/size}" % (max(1, int(slot["size"] * scale)), piece)
            if slot.get("color"):
                piece = "{color=%s}%s{/color}" % (slot["color"], piece)
            if index < len(parts) - 1:
                piece += "{space=%d}" % max(0, int((slot.get("gap") if slot.get("gap") is not None else 16) * scale))
            pieces.append(piece)
        return "".join(pieces)

    @functools.lru_cache(maxsize=512)
    def vn_flow_font_size(caption, font, size, width, height):
        # Measure the actual font before fitting long, editable node names.
        probe = Text(caption, substitute=False, font=font, size=size, layout="nobreak")
        measured_w, measured_h = renpy.render(probe, 32768, 32768, 0, 0).get_size()
        return max(1, min(size, int(size * min(float(max(1, width - 72)) / max(1, measured_w), float(max(1, height - 16)) / max(1, measured_h)))))

    def vn_flow_appearance(style, zoom=1.0):
        # Every length follows map zoom; leaving spread unscaled changes the
        # backing's thickness relative to the glyphs when zooming in or out.
        return dict(style, **{key: style.get(key, 0) * zoom for key in
            ("borderWidth", "shadowBlur", "shadowSpread", "shadowX", "shadowY")})

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

init python:
    def vn_flow_entry(identity, options):
        return options.get("flowLooks", {}).get(identity, {}).get("node") or {"id": identity, "nodeId": identity}

    def vn_flow_members(entry):
        if entry.get("callId"):
            return [entry["callId"]]
        return entry.get("memberIds", []) if entry.get("groupId") else [entry.get("nodeId", entry["id"])]

    def vn_flow_locked(identity, options):
        members = vn_flow_members(dict(vn_flow_entry(identity, options), id=identity))
        return not any(vn_story_unlocked("flowchart", node_id, options.get("lockUnread", False)) for node_id in members)

    def vn_flow_current(identity, options, locations=None):
        if main_menu:
            return False
        if locations and locations.get("_vn_flow_context") is True:
            return locations["current"] == identity
        if locations and locations.get(vn_current_node, vn_current_node) == identity:
            return True
        return vn_current_node in vn_flow_members(dict(vn_flow_entry(identity, options), id=identity))

    def vn_flow_caption(identity, caption, options, locations=None):
        if vn_flow_locked(identity, options):
            return options.get("flowLockedCaption", "未到达")
        if not options.get("showProgress", False):
            return caption
        entry = dict(vn_flow_entry(identity, options), id=identity)
        members = vn_flow_members(entry)
        if vn_flow_current(identity, options, locations):
            return caption + " · 当前"
        if entry.get("groupId"):
            return caption + " · 已读 %d/%d" % (sum(node_id in persistent.vn_seen_nodes for node_id in members), len(members))
        seen = all(node_id in persistent.vn_seen_nodes for node_id in members)
        return caption + (" · 已读" if seen else "")

    def vn_flow_progress(nodes, progress_ids=None):
        members = set(progress_ids) if progress_ids is not None else set(node_id for node in nodes for node_id in vn_flow_members(node))
        return sum(node_id in persistent.vn_seen_nodes for node_id in members), len(members)

    def vn_flow_node_shown(node, options):
        return options.get("flowLockedNode") != "hide" or not vn_flow_locked(node["id"], options)

    def vn_flow_edge_alpha(edge, options):
        # A connector counts as locked while either of its ends is.
        locked = vn_flow_locked(edge["from"], options) or vn_flow_locked(edge["to"], options)
        if "endpoints" in edge:
            # Representative paths are bounded explanations. Only the complete
            # real endpoint pairs can decide whether a grouped edge is reached.
            endpoints = edge["endpoints"]
        else:
            # Older generated data has no endpoint contract. Keep its path rule,
            # falling back to display identities only when no paths are present.
            endpoints = [{"from": path["nodeIds"][0], "to": path["nodeIds"][-1]} for path in edge.get("paths", []) if path.get("nodeIds")]
            if not endpoints:
                endpoints = [{"from": edge["from"], "to": edge["to"]}]
        # A group being browsable does not unlock another unread member's route.
        # Keep display-end protection even for inconsistent imported edge data.
        locked = locked or not any(vn_story_unlocked("flowchart", pair["from"], options.get("lockUnread", False)) and vn_story_unlocked("flowchart", pair["to"], options.get("lockUnread", False)) for pair in endpoints)
        # A hidden endpoint cannot leave a floating line that reveals its route.
        if locked and options.get("flowLockedNode") == "hide":
            return 0.0
        if not locked:
            return 1.0
        return {"hide": 0.0, "dim": 0.35}.get(options.get("flowLockedLine"), 1.0)

    def vn_flow_segment(a, b, options, zoom, line_width, distance):
        if a == b:
            return None
        dx, dy = (b[0] - a[0]) * zoom, (b[1] - a[1]) * zoom
        length = max(1, int(vn_flow_math.ceil(vn_flow_math.hypot(dx, dy))) + 1)
        horizontal, vertical = options.get("flowLinePath"), options.get("flowVerticalLinePath")
        use_vertical = bool(vertical) and (dx == 0 or not horizontal)
        path = vertical if use_vertical else horizontal
        if path:
            native_w, native_h = renpy.image_size(path)
            period = max(1, int(round(line_width * (float(native_h) / native_w if use_vertical else float(native_w) / native_h))))
            tile = Transform(path, xysize=((line_width, period) if use_vertical else (period, line_width)))
            if use_vertical:
                tile = Transform(tile, rotate=-90, rotate_pad=False)
            # Keep the native dot/dash spacing, and carry phase through bends.
            phase = int(round(distance * zoom)) % period
            strip = Crop((phase, 0, length, line_width), Tile(tile, xysize=(length + period, line_width)))
        else:
            strip = Solid(options.get("flowLineColor", "#8c7963"), xysize=(length, line_width))
        return (Transform(strip, rotate=vn_flow_math.degrees(vn_flow_math.atan2(dy, dx)), rotate_pad=False), ((a[0] + b[0]) * zoom / 2, (a[1] + b[1]) * zoom / 2), (0.5, 0.5))

    def vn_flow_edge(edge, options, zoom, line_width, alpha):
        points = edge["points"]
        if len(points) < 2:
            return None
        padding = line_width + 2
        left = int(vn_flow_math.floor(min(point[0] for point in points) * zoom - padding))
        top = int(vn_flow_math.floor(min(point[1] for point in points) * zoom - padding))
        width = max(1, int(vn_flow_math.ceil(max(point[0] for point in points) * zoom - left + padding)))
        height = max(1, int(vn_flow_math.ceil(max(point[1] for point in points) * zoom - top + padding)))
        drawing = Fixed(xysize=(width, height))
        distance = 0.0
        for a, b in zip(points, points[1:]):
            segment = vn_flow_segment(a, b, options, zoom, line_width, distance)
            if segment:
                drawing.add(Transform(segment[0], pos=(absolute(segment[1][0] - left), absolute(segment[1][1] - top)), anchor=segment[2], subpixel=True))
            distance += vn_flow_math.hypot(b[0] - a[0], b[1] - a[1])
        # Dimming once after compositing avoids darker/brighter dots at segment joins.
        return (Transform(Flatten(drawing), alpha=alpha) if alpha < 1 else drawing, (left, top))

    import math as vn_flow_math

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
    default flow_group = None
    default flow_trail = []
    default flow_gesture = {}
    default flow_zoom = 1.0
    default flow_x = ui.adjustment()
    default flow_y = ui.adjustment()
    $ active_group = vn_flow_view(options, flow_trail) if options.get("flowViews") and flow_trail else options.get("flowGroups", {}).get(flow_group, {})
    $ graph = active_group.get("graph", options["flowGraph"])
    $ group_header_height = min(44, max(32, int(view[3] * 0.1))) if active_group else 0
    $ flow_context = vn_flow_context(options, graph, flow_trail) if options.get("flowViews") else graph.get("locations", {})
    $ current_id = flow_context["current"] if options.get("flowViews") else graph.get("locations", {}).get(vn_current_node, vn_current_node)
    $ current = next((node for node in graph["nodes"] if node["id"] == current_id and vn_flow_node_shown(node, options)), next((node for node in graph["nodes"] if vn_flow_node_shown(node, options)), None) if not active_group else None)
    $ line_width = max(1, int(options.get("flowLineWidth", 4) * flow_zoom))
    $ flow_along_y = options.get("flowDirection") == "vertical"
    $ custom_scroll_rect = (custom_scroll or {}).get("rect")
    $ automatic_scroll_height = max(16, int(max(custom_scroll.get("trackHeight", 5), custom_scroll.get("thumbHeight", 31)))) if custom_scroll else 16
    $ automatic_scroll_width = max(1, view[2] - (0 if options.get("flowViewport") else 32) - (24 if show_vertical else 0))
    # The map hides internal nodes; mark the shown node that stands for the
    # player's position, the same one "locate current" scrolls to.
    $ current_location = current_id
    vbox:
        pos (view[0], view[1])
        xysize (view[2], view[3])
        if active_group:
            hbox:
                ysize group_header_height
                spacing 12
                textbutton ("返回上一级" if options.get("flowViews") else "返回总览") id (component_id + "_group_back") action [SetLocalVariable("flow_trail", flow_trail[:-1]), SetLocalVariable("flow_group", None), Function(flow_gesture.clear), Function(flow_x.change, 0), Function(flow_y.change, 0)] text_font font text_size min(font_size, 22) text_color text_color
                text vn_ui_literal(active_group["name"]) substitute False font font size min(font_size, 22) color text_color yalign 0.5 xmaximum max(1, view[2] - 160)
        side ("c" + (" r" if show_vertical else "") + (" b" if not custom_scroll_rect else "")):
            xysize (max(1, view[2] - (0 if options.get("flowViewport") else 32)), max(1, view[3] - (44 if show_controls else 0) - group_header_height))
            xpos (0 if options.get("flowViewport") else 16)
            spacing 8
            viewport:
                style_prefix "vn_flow"
                id (component_id + "_viewport")
                xfill True
                yfill True
                xadjustment flow_x
                yadjustment flow_y
                mousewheel (True if flow_along_y else "horizontal")
                draggable True
                fixed:
                    xysize (int(graph["width"] * flow_zoom), int(graph["height"] * flow_zoom))
                    for edge in graph["edges"]:
                        $ edge_alpha = vn_flow_edge_alpha(edge, options)
                        if edge_alpha:
                            $ connector = vn_flow_edge(edge, options, flow_zoom, line_width, edge_alpha)
                            if connector:
                                add connector[0] pos connector[1] subpixel True
                    for node in [item for item in graph["nodes"] if vn_flow_node_shown(item, options)]:
                        $ node_skin = options.get("flowEndSkin") if node["kind"] == "end" else options.get("flowChapterSkin") if node["kind"] == "chapterTitle" else None
                        $ node_look = options.get("flowLooks", {}).get(node["id"], {})
                        $ node_style = node_look.get("style") or {}
                        $ node_skin = node_look.get("skin") or node_skin or skin
                        $ node_font = node_look.get("font") or font
                        $ node_text_color = node_style.get("textColor", text_color)
                        $ node_locked = vn_flow_locked(node["id"], options)
                        $ node_skin = dict(node_skin, hideText=True) if node_locked and node_skin.get("disabled") else node_skin
                        $ node_caption = vn_flow_caption(node["id"], node["name"], options, flow_context)
                        $ node_base_size = node_style.get("fontSize", font_size)
                        $ node_parts = vn_flow_parts(node, node_caption, node_locked)
                        $ node_slots = node_look.get("captionParts")
                        $ node_letter_spacing = node_style.get("letterSpacing", 0)
                        $ node_font_size = vn_flow_font_size(vn_flow_markup(node_parts, node_slots, node_font, node_base_size, letter_spacing=node_letter_spacing), node_font, node_base_size, node["width"], node["height"])
                        $ node_text = vn_flow_markup(node_parts, node_slots, node_font, node_base_size, float(node_font_size) * flow_zoom / node_base_size, node_letter_spacing)
                        fixed:
                            pos (int(node["x"] * flow_zoom), int(node["y"] * flow_zoom))
                            xysize (int(node["width"] * flow_zoom), int(node["height"] * flow_zoom))
                            if not main_menu and not node_locked and node["id"] == current_location and options.get("flowCurrentMarker", {}).get("path"):
                                $ marker = options["flowCurrentMarker"]
                                $ marker_rect = vn_ui_rect(marker["rect"], int(node["width"] * flow_zoom), int(node["height"] * flow_zoom))
                                add Transform(marker["path"], xysize=(marker_rect[2], marker_rect[3])) pos (marker_rect[0], marker_rect[1]) id (component_id + "_" + node["id"] + "_current_marker")
                            $ enter_actions = [SetLocalVariable("flow_trail", vn_flow_enter_trail(options, flow_trail, node["id"])), Function(flow_gesture.clear), Function(flow_x.change, 0), Function(flow_y.change, 0)] if options.get("flowViews") else [SetLocalVariable("flow_group", node.get("groupId")), Function(flow_x.change, 0), Function(flow_y.change, 0)]
                            use vn_styled_button(node_text, VnFlowEntry(node["id"], options, enter_actions, flow_context, flow_trail, flow_gesture), component_id + "_" + node["id"], int(node["width"] * flow_zoom), int(node["height"] * flow_zoom), max(1, int(node_font_size * flow_zoom)), node_text_color, surface, node_skin, node_font, selected_text_color=node_style.get("selectedTextColor", node_text_color), hover_text_color=node_style.get("hoverTextColor", options.get("hoverTextColor")), text_outlines=[(item[0] * flow_zoom, item[1], item[2] * flow_zoom, item[3] * flow_zoom) for item in node_look.get("textOutlines", options.get("textOutlines", []))], appearance=vn_flow_appearance(node_style, flow_zoom), sounds=options, button_padding=(min(int(36 * flow_zoom), max(0, int(node["width"] * flow_zoom - 1) // 2)), min(int(8 * flow_zoom), max(0, int(node["height"] * flow_zoom - 1) // 2))), caption_align={"left": 0.0, "center": 0.5, "right": 1.0}.get(node_style.get("align"), 0.5), browse_hint=bool(node.get("callId")))
            if show_vertical:
                vbar:
                    id (component_id + "_scroll_y")
                    style "vn_flow_vscrollbar"
                    adjustment flow_y
            if not custom_scroll_rect:
                if custom_scroll:
                    fixed:
                        xysize (automatic_scroll_width, automatic_scroll_height)
                        use vn_story_flow_scrollbar((0, 0, automatic_scroll_width, automatic_scroll_height), flow_y if flow_along_y else flow_x, custom_scroll, component_id)
                else:
                    bar:
                        id (component_id + "_scroll_x")
                        style "vn_flow_scrollbar"
                        adjustment (flow_y if flow_along_y else flow_x)
        hbox:
            ysize (38 if show_controls else 0)
            xpos 24
            spacing 18
            if show_controls:
                if options.get("showProgress", False):
                    text ("已读 %d / %d" % vn_flow_progress(graph["nodes"], graph.get("progressIds"))) font font size min(font_size, 22) color "#f4f0e6" yalign 0.5
                textbutton "−" style "vn_flow_button" id (component_id + "_zoom_out") action SetLocalVariable("flow_zoom", max(0.5, flow_zoom - 0.1)) text_font font text_size 26
                text ("%d%%" % int(flow_zoom * 100 + 0.5)) font font size min(font_size, 22) color "#f4f0e6" yalign 0.5
                textbutton "+" style "vn_flow_button" id (component_id + "_zoom_in") action SetLocalVariable("flow_zoom", min(1.5, flow_zoom + 0.1)) text_font font text_size 26
                textbutton "定位当前位置" style "vn_flow_button" id (component_id + "_locate") action ([Function(flow_x.change, max(0, current["x"] * flow_zoom - view[2] / 3)), Function(flow_y.change, max(0, current["y"] * flow_zoom - view[3] / 3))] if current else NullAction()) sensitive current is not None text_font font text_size min(font_size, 22)
    if options.get("flowViews") and flow_trail:
        key "K_ESCAPE" action [SetLocalVariable("flow_trail", flow_trail[:-1]), Function(flow_gesture.clear), Function(flow_x.change, 0), Function(flow_y.change, 0)]
    if custom_scroll_rect:
        use vn_story_flow_scrollbar(vn_ui_rect(custom_scroll_rect, area_width, area_height), flow_y if flow_along_y else flow_x, custom_scroll, component_id)

screen vn_story_flow_scrollbar(scroll_rect, flow_adjustment, custom_scroll, component_id):
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
        adjustment flow_adjustment
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
