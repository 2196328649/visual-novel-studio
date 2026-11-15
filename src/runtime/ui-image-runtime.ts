import { declaredUiComponents, type Project } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { pythonLiteral } from './literals';

export const uiImageDefaults = 'default vn_ui_image_loads = {}\ndefault vn_ui_image_revisions = {}\ndefault vn_ui_image_recovery = {}\n';
export function createUiImageRuntime(project: Project): string {
  const images = Object.fromEntries(declaredUiComponents(project).filter(c => c.kind === 'image').map(c => {
    const pageId = c.page === 'custom' ? project.ui.customPages.find(page => page.components.some(item => item.id === c.id))!.id : 'ui:' + c.page;
    const handlers = Object.fromEntries(['loaded', 'failed'].map(trigger => [trigger, projectGraphs(project).flatMap(g => uiGraphOnPage(project, g, pageId) ? g.nodes.filter(n => n.type === 'eventImage' && n.properties.componentId === c.id && n.properties.trigger === trigger && uiEventInActiveInstance(project, n)).map(n => [g.id, n.id]) : [])]));
    return [c.id, { pageId, states: { idle: c.assetId, hover: c.skin?.hover, pressed: c.skin?.pressed, selected: c.skin?.selected, disabled: c.skin?.disabled }, handlers }];
  }));
  return `    vn_ui_images = ${pythonLiteral(images)}

    def vn_ui_image_owner(task):
        if not task or not vn_bp_task_alive(task): return None
        if task.get("native"): return task["native"].get("owner")
        if task.get("minigame") is not None: return vn_minigame_context
        session = vn_ui_page_sessions.get(task.get("page"))
        return session.get("mediaOwner", session) if session is not None else None

    def vn_ui_image_visible(component_id, get=None):
        get = get or vn_ui_get
        current, seen = component_id, set()
        while current and current not in seen:
            seen.add(current)
            if not get(current, "visible"): return False
            current = vn_ui_parents.get(current)
        return True

    def vn_ui_image_record_valid(record):
        return (isinstance(record, dict) and type(record.get("version")) is int and record["version"] == 1
            and type(record.get("revision")) is int and record["revision"] >= 0
            and isinstance(record.get("baseId"), str) and isinstance(record.get("assetId"), str)
            and record.get("status") in ("loaded", "failed") and isinstance(record.get("error"), str)
            and all(type(record.get(key)) is int and record[key] >= 0 for key in ("width", "height"))
            and record.get("owner") is not None)

    def vn_ui_image_live():
        # Function attributes are transient; no Displayable/Surface enters saves.
        if not hasattr(vn_ui_image_poll, "live"): vn_ui_image_poll.live = {}
        return vn_ui_image_poll.live

    def vn_ui_image_pending():
        if not hasattr(vn_ui_image_poll, "pending"): vn_ui_image_poll.pending = {}
        return vn_ui_image_poll.pending

    def vn_ui_image_revision(component_id):
        value = vn_ui_image_revisions.get(component_id, 0)
        return value if type(value) is int and value >= 0 else 0

    def vn_ui_image_invalidate(component_id, recover=False):
        if component_id not in vn_ui_images: return
        old = vn_ui_image_loads.get(component_id)
        if old is not None and not vn_ui_image_record_valid(old):
            if not recover: return
            vn_ui_image_recovery[component_id] = old
        vn_ui_image_loads.pop(component_id, None)
        vn_ui_image_revisions[component_id] = vn_ui_image_revision(component_id) + 1
        vn_ui_image_pending().pop(component_id, None)
        vn_ui_image_live().pop(component_id, None)

    def vn_ui_image_release(component_id):
        vn_ui_image_loads.pop(component_id, None)
        vn_ui_image_revisions.pop(component_id, None)
        vn_ui_image_pending().pop(component_id, None)
        vn_ui_image_live().pop(component_id, None)

    def vn_ui_image_source(skin, state):
        ids = skin.get("imageIds") or {}
        return (ids.get(state) or ids.get("hover") or ids.get("idle") or "") if state in ("pressed", "selected") else (ids.get(state) or ids.get("idle") or "")

    def vn_ui_image_snapshot(component_id):
        base_id = vn_ui_get(component_id, "image") or ""
        task = vn_bp_task_create(vn_ui_images[component_id]["pageId"], create_native=False)
        owner = vn_ui_image_owner(task)
        revision = vn_ui_image_revision(component_id)
        live = vn_ui_image_live().get(component_id)
        source = live.get("assetId", base_id) if live and live.get("owner") is owner and live.get("revision") == revision and live.get("baseId") == base_id else base_id
        record = vn_ui_image_loads.get(component_id)
        if record is not None and not vn_ui_image_record_valid(record):
            return dict(status="failed", assetId=source, error="图片加载记录版本不支持；请明确重置控件。", width=0, height=0)
        if record and record.get("owner") is owner and record.get("revision") == revision and record.get("baseId") == base_id and record.get("assetId") == source:
            return record
        return dict(status="loading" if source and owner is not None else "empty", assetId=source if owner is not None else "", error="", width=0, height=0)

    def vn_ui_image_get(component_id, property):
        snapshot = vn_ui_image_snapshot(component_id)
        return snapshot[{"imageStatus": "status", "imageError": "error", "imageSource": "assetId", "imageSourceWidth": "width", "imageSourceHeight": "height"}[property]]

    def vn_ui_image_poll():
        if getattr(vn_ui_image_poll, "running", False): return
        vn_ui_image_poll.running = True
        try:
            pending = list(vn_ui_image_pending().items())
            vn_ui_image_pending().clear()
            for component_id, report in pending:
                live = vn_ui_image_live().get(component_id)
                task = report.get("task")
                if not live or live.get("marker") is not report.get("marker") or live.get("assetId") != report.get("assetId"): continue
                if not vn_bp_task_alive(task) or report.get("owner") is not vn_ui_image_owner(task) or not vn_ui_image_visible(component_id): continue
                if report.get("revision") != vn_ui_image_revision(component_id) or report.get("baseId") != (vn_ui_get(component_id, "image") or ""): continue
                old = vn_ui_image_loads.get(component_id)
                if old is not None and not vn_ui_image_record_valid(old): continue
                if old and all(old.get(key) == report.get(key) for key in ("revision", "baseId", "assetId")) and old.get("owner") is report.get("owner") and old.get("status") in ("loaded", "failed"): continue
                record = {key: report[key] for key in ("revision", "baseId", "assetId", "owner", "status", "error", "width", "height")}
                record["version"] = 1
                vn_ui_image_loads[component_id] = record
                renpy.retain_after_load()
                payload = {key: record[key] for key in ("assetId", "error", "width", "height")}
                focus = vn_ui_focus_snapshot()
                for graph_id, node_id in vn_ui_images[component_id]["handlers"].get(record["status"], []):
                    if not vn_bp_task_alive(task): break
                    vn_run_blueprint(graph_id, node_id, {node_id: payload}, page_id=vn_ui_images[component_id]["pageId"])
                if vn_bp_task_alive(task): vn_ui_restore_focus(focus)
            for component_id, live in list(vn_ui_image_live().items()):
                if not vn_bp_task_alive(live.get("task")): vn_ui_image_live().pop(component_id, None)
        finally:
            vn_ui_image_poll.running = False

    def vn_ui_images_after_load():
        vn_ui_image_pending().clear()
        vn_ui_image_live().clear()

    config.after_load_callbacks.insert(0, vn_ui_images_after_load)

    def vn_ui_image_crop(width, height, effects):
        from math import floor
        pixel = lambda value: int(floor(value + .5))
        x, y = pixel(width * effects.get("cropX", 0)), pixel(height * effects.get("cropY", 0))
        return (x, y, max(0, pixel(width * min(1, effects.get("cropX", 0) + effects.get("cropWidth", 1))) - x), max(0, pixel(height * min(1, effects.get("cropY", 0) + effects.get("cropHeight", 1))) - y))

    def vn_ui_image_patches(source, width, height, fit, borders):
        from math import floor
        pixel = lambda value: int(floor(value + .5))
        x, y, sw, sh = source
        if sw <= 0 or sh <= 0 or width <= 0 or height <= 0: return []
        if fit != "nineSlice":
            scale = max(float(width) / sw, float(height) / sh) if fit == "cover" else min(float(width) / sw, float(height) / sh)
            w, h = (width, height) if fit == "stretch" else (max(1, pixel(sw * scale)), max(1, pixel(sh * scale)))
            return [(source, (pixel((width - w) / 2.0), pixel((height - h) / 2.0), w, h))]
        def cuts(size, first, last):
            scale = min(1.0, float(size) / max(1.0, first + last))
            left = pixel(first * scale)
            return [0, left, max(left, size - pixel(last * scale)), size]
        sx, sy = cuts(sw, borders["left"], borders["right"]), cuts(sh, borders["top"], borders["bottom"])
        tx, ty = cuts(width, sx[1], sw - sx[2]), cuts(height, sy[1], sh - sy[2])
        result = []
        for iy in range(3):
            for ix in range(3):
                iw, ih = sx[ix + 1] - sx[ix], sy[iy + 1] - sy[iy]
                w, h = tx[ix + 1] - tx[ix], ty[iy + 1] - ty[iy]
                if iw > 0 and ih > 0 and w > 0 and h > 0:
                    result.append(((x + sx[ix], y + sy[iy], iw, ih), (tx[ix], ty[iy], w, h)))
        return result

    class VnUiImageSurface(renpy.Displayable):
        def __init__(self, component_id, skin, width, height, inherit=False, **kwargs):
            super(VnUiImageSurface, self).__init__(**kwargs)
            self.component_id, self.skin, self.width, self.height, self.inherit = component_id, skin, width, height, inherit
            self.state, self.surface, self.result, self.task = "idle", None, None, None
            self.marker = object()
            self.base_id = skin.get("imageIds", {}).get("idle") or ""
            self.revision = vn_ui_image_revision(component_id)

        def identity(self):
            return dict(marker=self.marker, task=self.task, owner=vn_ui_image_owner(self.task), revision=self.revision, baseId=self.base_id, assetId=vn_ui_image_source(self.skin, self.state))

        def per_interact(self):
            # Prediction never calls per_interact. Establish a live surface without
            # creating page state from screen evaluation or rendering.
            self.task = vn_bp_task_create(vn_ui_images[self.component_id]["pageId"], create_native=False)
            vn_ui_image_live()[self.component_id] = self.identity()
            renpy.redraw(self, 0)

        def set_style_prefix(self, prefix, root):
            super(VnUiImageSurface, self).set_style_prefix(prefix, root)
            state = "disabled" if "insensitive" in prefix else "pressed" if "activate" in prefix else "selected" if "selected" in prefix else "hover" if "hover" in prefix else "idle"
            if not self.inherit and state != "disabled": state = "idle"
            if getattr(self, "state", state) != state:
                self.state, self.surface, self.result = state, None, None
                if vn_ui_image_live().get(self.component_id, {}).get("marker") is self.marker:
                    vn_ui_image_live()[self.component_id] = self.identity()
                    vn_ui_image_pending().pop(self.component_id, None)
                renpy.redraw(self, 0)

        def build(self):
            asset_id = vn_ui_image_source(self.skin, self.state)
            if not asset_id:
                self.result = dict(status="empty", error="", width=0, height=0)
                return Null(width=self.width, height=self.height)
            try:
                image_path = vn_bp_optional_asset(asset_id, "image")
                # Read through Ren'Py's texture cache. Requesting a CPU surface
                # just for its size discards the cached texture when
                # cache_surfaces is off, decoding it again on every rebuild.
                image = Image(image_path)
                render_width, render_height = renpy.load_image(image).get_size()
                oversample = image.get_oversample()
                # Load events and cropping retain the source's physical pixels.
                source_width, source_height = int(round(render_width * oversample)), int(round(render_height * oversample))
                if source_width <= 0 or source_height <= 0: raise ValueError("Empty image")
                effects = self.skin.get("imageEffects") or {}
                source = vn_ui_image_crop(source_width, source_height, effects)
                patches = vn_ui_image_patches(source, self.width, self.height, self.skin.get("fit", "contain"), self.skin.get("borders") or dict(left=12, top=12, right=12, bottom=12))
                surface = Fixed(xysize=(self.width, self.height))
                for crop, target in patches:
                    x, y, width, height = target
                    surface.add(Transform(Transform(image_path, crop=crop), xysize=(width, height), fit="fill", xpos=x, ypos=y))
                surface = Transform(surface, crop=(0, 0, self.width, self.height), xzoom=-1.0 if effects.get("flipX") else 1.0, yzoom=-1.0 if effects.get("flipY") else 1.0, matrixcolor=TintMatrix(effects.get("tint", "#ffffff")))
                if self.state == "disabled" and not self.skin.get("disabled"): surface = Transform(surface, alpha=.45)
                brightness = self.skin.get("brightness", {}).get(self.state, 1.0)
                if brightness != 1.0:
                    channel = max(0, min(255, int(brightness * 255 + .5)))
                    surface = Transform(surface, matrixcolor=TintMatrix("#%02x%02x%02x" % (channel, channel, channel)))
                self.result = dict(status="loaded", error="", width=source_width, height=source_height)
                return surface
            except Exception as error:
                renpy.log("UI image load failed (%s): %s" % (asset_id, error))
                self.result = dict(status="failed", error="图片无法读取或解码。", width=0, height=0)
                return Null(width=self.width, height=self.height)

        def render(self, width, height, st, at):
            if self.surface is None: self.surface = self.build()
            try:
                rendered = renpy.render(self.surface, self.width, self.height, st, at)
            except Exception as error:
                renpy.log("UI image render failed (%s): %s" % (self.component_id, error))
                self.result = dict(status="failed", error="图片无法读取或解码。", width=0, height=0)
                self.surface = Null(width=self.width, height=self.height)
                rendered = renpy.render(self.surface, self.width, self.height, st, at)
            if vn_ui_image_live().get(self.component_id, {}).get("marker") is self.marker:
                # Native on-show may establish its token after per_interact.
                if not vn_bp_task_alive(self.task): self.task = vn_bp_task_create(vn_ui_images[self.component_id]["pageId"], create_native=False)
                identity = self.identity()
                vn_ui_image_live()[self.component_id] = identity
                if identity["owner"] is not None and self.result and self.result["status"] != "empty":
                    vn_ui_image_pending()[self.component_id] = dict(identity, **self.result)
                    renpy.timeout(.001)
            return rendered

        def event(self, ev, x, y, st):
            # One surface dispatches the shared decoded reports. Idle siblings
            # must not each rescan every live image on every pointer/timer event;
            # the task guard still performs regular owner/resource pruning.
            if vn_ui_image_pending(): vn_ui_image_poll()
            return None

        def visit(self):
            # Decode through build(), so corrupt images become failure events,
            # not an uncaught predictive Image exception before the page opens.
            return []
`;
}
