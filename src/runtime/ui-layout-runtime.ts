import { allUiComponents, declaredUiComponents, type Project } from '../core/model';
import { uiLayoutDefaults, uiLayoutPropertyFields, uiLayoutObservationProperties } from '../core/ui-layout';
import { pythonLiteral } from './literals';

/** Registered before screen parsing; mutations only happen in the event phase. */
export const uiLayoutEarly = `    class VnUiLayoutChildren(renpy.display.layout.MultiBox):
        def __init__(self, vn_component_id, vn_rows, vn_background=False, **properties):
            super(VnUiLayoutChildren, self).__init__(layout="fixed", **properties)
            self.vn_component_id, self.vn_rows, self.vn_background = vn_component_id, vn_rows, vn_background
            self.vn_task = None

        def per_interact(self):
            # Prediction/rendering never creates a page or a save-state record.
            self.vn_task = vn_bp_task_create(vn_ui_component_pages[self.vn_component_id], create_native=False)

        def vn_clip(self):
            row = self.vn_rows[self.vn_component_id]
            if not row["layout"]["clip"] and row["layout"]["scroll"] == "none": return None
            return (0, 0, row["width"], row["height"]) if self.vn_background else row["content"]

        def render(self, width, height, st, at):
            # An offscreen parent may still have an overflowing visible descendant.
            # Clip the actual render, never discard a whole subtree from its own rect.
            rendered = super(VnUiLayoutChildren, self).render(width, height, st, at)
            clip = self.vn_clip()
            if clip is None: return rendered
            result = renpy.Render(*rendered.get_size())
            if clip[2] > 0 and clip[3] > 0:
                result.blit(rendered.subsurface(clip, focus=True), (clip[0], clip[1]))
            return result

        def event(self, ev, x, y, st):
            if not self.vn_task or not vn_bp_task_alive(self.vn_task): return None
            clip = self.vn_clip()
            inside = clip is None or clip[0] <= x < clip[0] + clip[2] and clip[1] <= y < clip[1] + clip[3]
            pointer = ev.type in (vn_ui_pygame.MOUSEMOTION, vn_ui_pygame.MOUSEBUTTONDOWN, vn_ui_pygame.MOUSEBUTTONUP)
            # Outside clips still deliver an outside release to any captured child,
            # so a drag cannot activate an overflowing child or leave a stuck grab.
            result = super(VnUiLayoutChildren, self).event(ev, x if inside or not pointer else -1e12, y if inside or not pointer else -1e12, st)
            if result is not None: return result
            if not inside or self.vn_background or ev.type != vn_ui_pygame.MOUSEBUTTONDOWN or ev.button not in (4, 5, 6, 7): return None
            row = self.vn_rows[self.vn_component_id]
            if not (0 <= x < row["width"] and 0 <= y < row["height"]): return None
            dx, dy = (0, -40) if ev.button == 4 else (0, 40) if ev.button == 5 else (-40, 0) if ev.button == 6 else (40, 0)
            if vn_ui_pygame.key.get_mods() & vn_ui_pygame.KMOD_SHIFT: dx, dy = dx or dy, 0
            if vn_ui_layout_scroll(self.vn_component_id, dx, dy, self.vn_task):
                raise renpy.IgnoreEvent()

    renpy.register_sl_displayable("vn_layout_children", VnUiLayoutChildren, "fixed", nchildren="many").copy_properties("fixed").add_property("vn_component_id").add_property("vn_rows").add_property("vn_background")
`;

export function createUiLayoutRuntime(project: Project): string {
  const components = declaredUiComponents(project);
  const owners = new Map(project.ui.customPages.flatMap(page => page.components.map(c => [c.id, page.id] as const)));
  const pageFor = (c: (typeof components)[number]) => c.page === 'custom' ? owners.get(c.id)! : 'ui:' + c.page;
  const meta = Object.fromEntries(components.map((c,rank)=>[c.id,{version:c.layout?.version??1,background:c.childLayer==='background',rank,saveMode:c.page==='save'?c.saveMode:undefined}]));
  const pages: Record<string,string[]> = {};
  for (const c of allUiComponents(project)) (pages[pageFor(c)] ??= []).push(c.id);
  return `    vn_ui_layout_meta = ${pythonLiteral(meta)}
    vn_ui_layout_pages = ${pythonLiteral(pages)}
    vn_ui_layout_defaults = ${pythonLiteral(uiLayoutDefaults)}
    vn_ui_layout_fields = ${pythonLiteral(uiLayoutPropertyFields)}
    vn_ui_layout_observations = ${pythonLiteral(uiLayoutObservationProperties)}

    def vn_ui_matrix_multiply(a, b):
        return (a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5])

    def vn_ui_matrix_inverse(m):
        d = m[0]*m[3]-m[1]*m[2]
        if not __import__("math").isfinite(d) or abs(d) < 1e-12: return None
        return (m[3]/d, -m[1]/d, -m[2]/d, m[0]/d, (m[2]*m[5]-m[3]*m[4])/d, (m[1]*m[4]-m[0]*m[5])/d)

    def vn_ui_matrix_point(m, p):
        return (m[0]*p[0]+m[2]*p[1]+m[4], m[1]*p[0]+m[3]*p[1]+m[5])

    def vn_ui_rect_polygon(r):
        x, y, w, h = r
        return [(x,y), (x+w,y), (x+w,y+h), (x,y+h)]

    def vn_ui_polygon_area(p):
        return sum(a[0]*p[(i+1)%len(p)][1]-a[1]*p[(i+1)%len(p)][0] for i,a in enumerate(p)) / 2.0

    def vn_ui_polygon_cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])

    def vn_ui_polygon_clip(subject, clip):
        result = list(subject)
        if len(clip) < 3 or abs(vn_ui_polygon_area(clip)) < 1e-10: return []
        direction = 1 if vn_ui_polygon_area(clip) >= 0 else -1
        for i, a in enumerate(clip):
            if not result: break
            b, points, result = clip[(i+1)%len(clip)], result, []
            previous = points[-1]
            dp = direction * vn_ui_polygon_cross(a, b, previous)
            for current in points:
                dc = direction * vn_ui_polygon_cross(a, b, current)
                if (dc >= -1e-8) != (dp >= -1e-8):
                    t = dp / (dp-dc)
                    result.append((previous[0]+t*(current[0]-previous[0]), previous[1]+t*(current[1]-previous[1])))
                if dc >= -1e-8: result.append(current)
                previous, dp = current, dc
        return result

    def vn_ui_polygon_bounds(points):
        if not points: return (0,0,0,0)
        x, y = min(p[0] for p in points), min(p[1] for p in points)
        return (x, y, max(p[0] for p in points)-x, max(p[1] for p in points)-y)

    def vn_ui_matrix_bounds(m, r):
        return vn_ui_polygon_bounds([vn_ui_matrix_point(m,p) for p in vn_ui_rect_polygon(r)])

    def vn_ui_rect_union(a, b):
        x, y = min(a[0],b[0]), min(a[1],b[1])
        return (x, y, max(a[0]+a[2],b[0]+b[2])-x, max(a[1]+a[3],b[1]+b[3])-y)

    def vn_ui_rect_intersection(a, b):
        x, y = max(a[0],b[0]), max(a[1],b[1])
        return (x, y, max(0,min(a[0]+a[2],b[0]+b[2])-x), max(0,min(a[1]+a[3],b[1]+b[3])-y))

    def vn_ui_layout_values(component_id, get=None):
        get = get or vn_ui_get
        if vn_ui_layout_meta[component_id]["version"] != 1: return dict(vn_ui_layout_defaults)
        return {field: get(component_id, prop, None, True) for prop,field in vn_ui_layout_fields.items()}

    def vn_ui_layout_own_visible(component_id, get=None):
        get = get or vn_ui_get
        if not get(component_id, "visible"): return False
        mode = vn_ui_layout_meta[component_id].get("saveMode")
        return not mode or renpy.get_screen(mode) is not None

    def vn_ui_layout_resolve(identities=None, get=None):
        from math import sin, cos, pi, floor
        get = get or vn_ui_get
        identities = list(identities) if identities is not None else [identity for page in vn_ui_layout_pages.values() for identity in page]
        ids, children, layouts = set(identities), {}, {}
        for identity in identities:
            layouts[identity] = vn_ui_layout_values(identity, get)
            parent = vn_ui_parents.get(identity)
            children.setdefault(parent if parent in ids else None, []).append(identity)
        for group in children.values():
            group.sort(key=lambda identity: (layouts[identity]["order"], vn_ui_layout_meta[identity]["rank"]))
        unit = (1,0,0,1,0,0)
        def make(identity, basis, slot, parent_visible, legacy, seen):
            if identity in seen or len(seen) >= 32: return None
            l = layouts[identity]
            w, h = max(0,get(identity,"width")*basis[2]), max(0,get(identity,"height")*basis[3])
            shown = parent_visible and vn_ui_layout_own_visible(identity, get)
            angle = l["rotation"]*pi/180
            co, si = cos(angle), sin(angle)
            a, b, c, d = co*l["scaleX"], si*l["scaleX"], -si*l["scaleY"], co*l["scaleY"]
            x = basis[0]+(get(identity,"x")+l["anchorX"])*basis[2]+slot[0]
            y = basis[1]+(get(identity,"y")+l["anchorY"])*basis[3]+slot[1]
            local = (a,b,c,d,x-a*l["pivotX"]*w-c*l["pivotY"]*h,y-b*l["pivotX"]*w-d*l["pivotY"]*h)
            sx, sy = min(1,w/(l["paddingLeft"]+l["paddingRight"] or 1)), min(1,h/(l["paddingTop"]+l["paddingBottom"] or 1))
            content = (l["paddingLeft"]*sx,l["paddingTop"]*sy,max(0,w-(l["paddingLeft"]+l["paddingRight"])*sx),max(0,h-(l["paddingTop"]+l["paddingBottom"])*sy))
            outer = (0,0,w,h)
            frame = dict(id=identity,layout=l,width=w,height=h,visible=shown,content=content,basis=basis,slot=slot,local=local,overflow=outer,children=[],legacy=legacy and all(key=="order" or l[key]==value for key,value in vn_ui_layout_defaults.items()))
            cursor, extent = 0, content
            for child in children.get(identity, ()):
                background = vn_ui_layout_meta[child]["background"]
                child_slot = (cursor if not background and l["flow"]=="horizontal" else 0, cursor if not background and l["flow"]=="vertical" else 0)
                nested = make(child, outer if background else content, child_slot, shown, frame["legacy"], seen | {identity})
                if nested is None: continue
                frame["children"].append(nested)
                if nested["visible"] and not background:
                    if l["flow"] != "absolute": cursor += nested["width" if l["flow"]=="horizontal" else "height"] + l["gap"]
                    extent = vn_ui_rect_union(extent, vn_ui_matrix_bounds(nested["local"],nested["overflow"]))
            frame["scrollMinimumX"], frame["scrollMinimumY"] = min(0,extent[0]-content[0]), min(0,extent[1]-content[1])
            frame["scrollMaximumX"] = max(0,extent[0]+extent[2]-content[0]-content[2])
            frame["scrollMaximumY"] = max(0,extent[1]+extent[3]-content[1]-content[3])
            frame["scrollX"] = max(frame["scrollMinimumX"],min(frame["scrollMaximumX"],l["scrollX"])) if l["scroll"] in ("horizontal","both") else 0
            frame["scrollY"] = max(frame["scrollMinimumY"],min(frame["scrollMaximumY"],l["scrollY"])) if l["scroll"] in ("vertical","both") else 0
            frame["contentWidth"] = content[2]+frame["scrollMaximumX"]-frame["scrollMinimumX"]
            frame["contentHeight"] = content[3]+frame["scrollMaximumY"]-frame["scrollMinimumY"]
            for child in frame["children"]:
                background = vn_ui_layout_meta[child["id"]]["background"]
                if not background: child["local"] = vn_ui_matrix_multiply((1,0,0,1,-frame["scrollX"],-frame["scrollY"]),child["local"])
                if not child["visible"]: continue
                overflow = vn_ui_matrix_bounds(child["local"],child["overflow"])
                if l["clip"] or l["scroll"] != "none": overflow = vn_ui_rect_intersection(overflow,outer if background else content)
                if overflow[2]>0 and overflow[3]>0: frame["overflow"] = vn_ui_rect_union(frame["overflow"],overflow)
            return frame
        result = {}
        def place(frame, parent_matrix, parent_render, clips):
            matrix = vn_ui_matrix_multiply(parent_matrix,frame["local"])
            render_matrix = (1,0,0,1,floor(matrix[4]+.5),floor(matrix[5]+.5)) if frame["legacy"] else matrix
            inverse = vn_ui_matrix_inverse(render_matrix)
            outer = (0,0,frame["width"],frame["height"])
            polygon = [vn_ui_matrix_point(render_matrix,p) for p in vn_ui_rect_polygon(outer)]
            for clip in clips: polygon = vn_ui_polygon_clip(polygon,clip)
            row = {key:value for key,value in frame.items() if key != "children"}
            row.update(matrix=matrix,renderMatrix=render_matrix,inverse=inverse,localRenderMatrix=vn_ui_matrix_multiply(vn_ui_matrix_inverse(parent_render) or unit,render_matrix),bounds=vn_ui_matrix_bounds(matrix,outer),clipPolygons=clips,visiblePolygon=polygon,clippedOut=inverse is None or abs(vn_ui_polygon_area(polygon))<1e-8)
            result[frame["id"]] = row
            for child in frame["children"]:
                rect = outer if vn_ui_layout_meta[child["id"]]["background"] else frame["content"]
                next_clips = clips + [[vn_ui_matrix_point(render_matrix,p) for p in vn_ui_rect_polygon(rect)]] if frame["layout"]["clip"] or frame["layout"]["scroll"] != "none" else clips
                place(child,matrix,render_matrix,next_clips)
        for identity in children.get(None, ()):
            frame = make(identity,(0,0,${project.width},${project.height}),(0,0),True,True,set())
            if frame is not None: place(frame,unit,unit,[])
        return result

    def vn_ui_layout_for_components(component_ids, get=None):
        # Media polling needs whole sibling layouts, but not unrelated pages.
        # Resolve each owning page once per call; never retain rows across an
        # event, a parameter write, page replacement, load or rollback.
        pages = dict.fromkeys(vn_ui_component_pages.get(identity) for identity in component_ids)
        identities = [identity for page in pages for identity in vn_ui_layout_pages.get(page, ())]
        return vn_ui_layout_resolve(identities, get) if identities else {}

    def vn_ui_layout_row(component_id):
        page = vn_ui_component_pages.get(component_id)
        identities = vn_ui_layout_pages.get(page, ())
        if component_id not in identities:
            raise Exception("组件不属于当前活动页面方案，无法读取画面布局；请明确选择所属方案。")
        return vn_ui_layout_resolve(identities)[component_id]

    def vn_ui_layout_observe(component_id, prop, rows=None):
        row = rows[component_id] if rows is not None else vn_ui_layout_row(component_id)
        if prop in ("screenX","screenY","screenWidth","screenHeight"):
            return row["bounds"][("screenX","screenY","screenWidth","screenHeight").index(prop)]
        return row[prop]

    def vn_ui_layout_paintable(component_id, rows):
        row = rows[component_id]
        # Zero-area/singular frames have no painted descendants. A merely
        # clipped own rectangle does not imply its overflowing subtree is empty.
        return row["width"] > 0 and row["height"] > 0 and row["inverse"] is not None

    def vn_ui_layout_size(component_id, axis, rows):
        return max(1,int(rows[component_id][axis]+.5))

    def vn_ui_layout_transform(component_id, rows, alpha=1):
        row = rows[component_id]
        l, m = row["layout"], row["localRenderMatrix"]
        px, py = l["pivotX"]*row["width"], l["pivotY"]*row["height"]
        x, y = m[4]+m[0]*px+m[2]*py, m[5]+m[1]*px+m[3]*py
        return Transform(pos=(absolute(x),absolute(y)), anchor=(absolute(px),absolute(py)), transform_anchor=True,
            xzoom=l["scaleX"], yzoom=l["scaleY"], rotate=l["rotation"] or None, rotate_pad=False, subpixel=True, alpha=alpha)

    def vn_ui_layout_prepare_change(rows, get):
        # Decisions use one final candidate. This function never changes focus,
        # a popup, a pointer grab, a page instance or a media record.
        focus = vn_input_prepare_prune(rows, get)
        popup = vn_ui_control_prepare_popup_prune(rows, get)
        buttons = []
        for button in (getattr(vn_ui_cancel_pointer, "source", None), renpy.display.focus.get_grab()):
            identity = getattr(button, "vn_component_id", None)
            if identity and isinstance(button, (VnSkinButton, VnUiBar)) and not vn_ui_component_available(identity, rows, get):
                buttons.append(button)
        return focus, popup, buttons

    def vn_ui_layout_changed(prepared=None):
        # One post-write check, after a complete track/batch update. No retained
        # geometry cache: bindings, load, rollback and each event read live state.
        if prepared is not None:
            focus, popup, buttons = prepared
            vn_input_prune_focus(focus)
            vn_ui_control_prune_popup(popup)
            for button in buttons:
                button.vn_release()
                button.vn_inside = button.vn_pointer_inside = False
            return
        vn_input_prune_focus()
        vn_ui_control_prune_popup()
        for button in (getattr(vn_ui_cancel_pointer, "source", None), renpy.display.focus.get_grab()):
            identity = getattr(button, "vn_component_id", None)
            if identity and isinstance(button, (VnSkinButton, VnUiBar)) and not vn_ui_component_available(identity):
                button.vn_release()
                button.vn_inside = button.vn_pointer_inside = False

    def vn_ui_layout_scroll(component_id, dx, dy, task):
        if not task or task.get("page") != vn_ui_component_pages.get(component_id) or not vn_bp_task_alive(task) or not vn_ui_component_available(component_id): return False
        row = vn_ui_layout_row(component_id)
        if row["clippedOut"]: return False
        mode = row["layout"]["scroll"]
        x = (dx or dy) if mode == "horizontal" else dx if mode == "both" else 0
        y = dy if mode in ("vertical","both") else 0
        if x and not vn_ui_property_user_writable(component_id, "scrollX"): x = 0
        if y and not vn_ui_property_user_writable(component_id, "scrollY"): y = 0
        nx = max(row["scrollMinimumX"],min(row["scrollMaximumX"],row["scrollX"]+x))
        ny = max(row["scrollMinimumY"],min(row["scrollMaximumY"],row["scrollY"]+y))
        if (not x or nx == row["scrollX"]) and (not y or ny == row["scrollY"]): return False
        assignments = []
        if x and nx != row["scrollX"]: assignments.append((component_id, "scrollX", nx))
        if y and ny != row["scrollY"]: assignments.append((component_id, "scrollY", ny))
        changes = vn_ui_property_apply(assignments, notify=False)
        vn_ui_cancel_pointer(vn_ui_layout_descendants(component_id))
        vn_ui_property_changes_applied(changes)
        renpy.retain_after_load()
        renpy.restart_interaction()
        return True

    def vn_ui_layout_descendants(component_id):
        result, pending = set(), [component_id]
        children = {}
        for child,parent in vn_ui_parents.items(): children.setdefault(parent,[]).append(child)
        while pending:
            identity = pending.pop()
            if identity in result: continue
            result.add(identity)
            pending.extend(children.get(identity,()))
        return result
`;
}
