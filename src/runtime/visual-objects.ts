import { chapterSource } from '../core/chapter';
import { visualTransitionsRuntime } from './visual-transitions';

export const visualObjectRuntime = `
default vn_chapter_visual_tags = []

init python:
    import math as vn_visual_math
    import copy as vn_visual_copy
    import functools as vn_visual_functools
    from builtins import list as vn_visual_list, dict as vn_visual_dict
    vn_visual_glyph_cache = {}
    vn_visual_particle_cache = {}

    class VNVisualStatic(renpy.Displayable):
        """Share immutable artwork without cloning its render tree each frame."""
        def __init__(self, child):
            super(VNVisualStatic, self).__init__()
            self.child = child

        def render(self, width, height, st, at):
            return renpy.render(self.child, width, height, 0, 0)

        def visit(self):
            return [self.child]

    def vn_visual_particle_sprite(size, color, glyph):
        key = (size, color, glyph)
        if key not in vn_visual_particle_cache:
            if len(vn_visual_particle_cache) >= 512:
                vn_visual_particle_cache.pop(next(iter(vn_visual_particle_cache)))
            sprite = Solid(color, xysize=(size, size))
            if glyph:
                sprite = Transform(sprite, mesh=True, shader="vn.chapter_particle")
            vn_visual_particle_cache[key] = VNVisualStatic(sprite)
        return vn_visual_particle_cache[key]

    @vn_visual_functools.lru_cache(maxsize=1)
    def vn_visual_particle_layout():
        layout = renpy.gl2.gl2mesh.AttributeLayout()
        layout.add_attribute("a_vn_particle_uv", 2)
        layout.add_attribute("a_vn_particle_color", 4)
        return layout

    @vn_visual_functools.lru_cache(maxsize=512)
    def vn_visual_particle_color(color):
        return Color(color).rgba

    renpy.register_shader("vn.visual_particles", variables="""
        attribute vec2 a_vn_particle_uv;
        attribute vec4 a_vn_particle_color;
        varying vec2 v_vn_particle_uv;
        varying vec4 v_vn_particle_color;
        uniform float u_vn_particle_glyph;
    """, vertex_300="""
        v_vn_particle_uv = a_vn_particle_uv;
        v_vn_particle_color = a_vn_particle_color;
    """, fragment_200="""
        float falloff = mix(1.0, clamp(1.0 - 2.0 * length(v_vn_particle_uv - vec2(0.5)), 0.0, 1.0), u_vn_particle_glyph);
        gl_FragColor = v_vn_particle_color * falloff;
    """)

    class VNVisualParticles(renpy.Displayable):
        """One ordered triangle batch per emitter; native meshes live only in Render."""
        def __init__(self, particles, width, height, glyph, color):
            super(VNVisualParticles, self).__init__()
            self.width, self.height = width, height
            self.glyph = glyph
            self.particles = vn_visual_list()
            for particle in particles:
                if particle["opacity"] <= 0 or particle["size"] <= 0:
                    continue
                size = max(1, int(particle["size"]))
                self.particles.append((particle["x"] * width - size * .5, particle["y"] * height - size * .5, size, particle.get("color", color), particle["opacity"]))

        def render(self, width, height, st, at):
            result = renpy.Render(self.width, self.height)
            if not self.particles:
                return result
            if renpy.display.render.models:
                geometry, attributes, triangles = vn_visual_list(), vn_visual_list(), vn_visual_list()
                for index, (x, y, size, color, opacity) in enumerate(self.particles):
                    r, g, b, alpha = vn_visual_particle_color(color)
                    alpha *= opacity
                    rgba = (r * alpha, g * alpha, b * alpha, alpha)
                    geometry.extend((x, y, x + size, y, x + size, y + size, x, y + size))
                    for uv in ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)):
                        attributes.extend(uv + rgba)
                    point = index * 4
                    triangles.extend((point, point + 1, point + 2, point, point + 2, point + 3))
                mesh = renpy.gl2.gl2mesh2.Mesh2(vn_visual_particle_layout(), len(self.particles) * 4, len(self.particles) * 2)
                mesh.set_geometry_data(geometry)
                mesh.set_attribute_data(attributes)
                mesh.set_triangle_data(triangles)
                result.mesh = mesh
                result.add_shader("vn.visual_particles")
                result.add_uniform("u_vn_particle_glyph", 1.0 if self.glyph else 0.0)
                return result
            for x, y, size, color, alpha in self.particles:
                sprite = vn_visual_particle_sprite(size, color, self.glyph)
                child = renpy.render(sprite, self.width, self.height, 0, 0)
                if alpha < 1:
                    faded = renpy.Render(*child.get_size())
                    faded.blit(child, (0, 0))
                    faded.alpha = alpha
                    faded.add_shader("renpy.alpha")
                    faded.add_uniform("u_renpy_alpha", alpha)
                    faded.add_uniform("u_renpy_over", 1.0)
                    child = faded
                result.subpixel_blit(child, (x, y))
            return result

        def visit(self):
            return ()

    @vn_visual_functools.lru_cache(maxsize=128)
    def vn_visual_glyph_seeds(emission_start, time_scale, user_seed, count):
        result = vn_visual_list()
        for seed in vn_chapter_seeded_particles(user_seed)[:count]:
            particle = vn_visual_dict(seed)
            particle["delay"] += emission_start * time_scale - ${chapterSource.timing.move + chapterSource.timing.holdTitle}
            result.append(particle)
        return tuple(result)

    @vn_visual_functools.lru_cache(maxsize=32)
    def vn_visual_glyph_motion(time, emission_start, time_scale, user_seed, count):
        # The chapter's text regions use the same motion with different glyph
        # positions. Share that calculation while preserving every authored seed.
        elapsed = time * time_scale / ${chapterSource.timing.duration}
        return tuple((p, vn_chapter_particle_frame(p, elapsed)) for p in vn_visual_glyph_seeds(emission_start, time_scale, user_seed, count))

    def vn_skip_chapter_visuals():
        global vn_chapter_visual_tags
        if renpy.is_skipping():
            for tag in vn_chapter_visual_tags:
                renpy.hide(tag)
            vn_chapter_visual_tags = []
        else:
            vn_chapter_visual_tags = [tag for tag in vn_chapter_visual_tags if renpy.showing(tag)]

    config.interact_callbacks.append(vn_skip_chapter_visuals)

    def vn_visual_retime(data, duration):
        if not vn_visual_math.isfinite(duration) or duration < 0:
            raise ValueError("Visual duration must be finite and nonnegative")
        basis = data["duration"] or data.get("retimeBasisDuration")
        if duration == 0:
            if data["duration"] > 0:
                data["retimeBasisDuration"] = data["duration"]
            data["duration"] = 0
            return
        ratio = duration / basis if basis else 1
        def scale(item, child=False):
            item["duration"] *= ratio
            if "retimeBasisDuration" in item:
                item["retimeBasisDuration"] *= ratio
            if child and "startAt" in item:
                item["startAt"] *= ratio
            for frame in item["keyframes"]:
                frame["duration"] *= ratio
            for rule in (item.get("visualTransitions") or {}).values():
                rule["duration"] = min(60, rule["duration"] * ratio)
            for prop, frames in (item.get("curves") or {}).items():
                for frame in frames:
                    frame["at"] *= ratio
                    if prop == "rippleSpeed":
                        frame["value"] /= ratio
            if item.get("dissolve"):
                item["dissolve"]["start"] *= ratio
                item["dissolve"]["end"] *= ratio
            if item.get("ripple"):
                item["ripple"]["speed"] /= ratio
            if item.get("particles"):
                item["particles"]["lifetime"] *= ratio
                item["particles"]["speed"] /= ratio
                for frame in (item["particles"].get("lifeCurves") or {}).get("speed", []):
                    frame["value"] /= ratio
                for prop in ("forceX", "forceY"):
                    for frame in (item["particles"].get("lifeCurves") or {}).get(prop, []):
                        frame["value"] /= ratio * ratio
            if item.get("glyphParticles"):
                item["glyphParticles"]["emissionStart"] *= ratio
                item["glyphParticles"]["timeScale"] /= ratio
                for prop in ("forceX", "forceY"):
                    for frame in (item["glyphParticles"].get("lifeCurves") or {}).get(prop, []):
                        frame["value"] /= ratio * ratio
            for nested in item.get("children") or []:
                scale(nested, True)
        scale(data)
        data["duration"] = duration
        data.pop("retimeBasisDuration", None)

    def vn_visual_with_inputs(data, paths, values):
        data = vn_visual_copy.deepcopy(data)
        entries = {tuple(paths[key]): value for key, value in values.items()}
        def locate(item, instance_id, path):
            if item["instanceId"] == instance_id:
                return path
            for index, child in enumerate(item.get("children") or []):
                found = locate(child, instance_id, path + ("children", index))
                if found is not None:
                    return found
        def forward(item, prefix):
            for parameter in item.get("parameters") or []:
                path = prefix + ("parameterValues", parameter["id"])
                value = entries.get(path, (item.get("parameterValues") or {}).get(parameter["id"], parameter["defaultValue"]))
                entries[path] = value
                for binding in parameter["targets"]:
                    relative = locate(item, binding["instanceId"], ())
                    if relative is not None:
                        entries[prefix + relative + tuple(binding["path"])] = value
            for index, child in enumerate(item.get("children") or []):
                forward(child, prefix + ("children", index))
        forward(data, ())
        for path, value in sorted(entries.items(), key=lambda pair: -len(pair[0])):
            target = data
            for part in path[:-1]:
                if isinstance(target, dict) and target.get(part) is None:
                    target[part] = {}
                target = target[part]
            if path[-1] == "fontAssetId" and value == "":
                continue
            if value == "" and (path[-1] == "maskAssetId" or path[-1] == "assetId" and target.get("content") != "video"):
                target.pop(path[-1], None)
                continue
            if path[-1] == "assetId" and target.get("content") == "video":
                if value == "":
                    continue
                if value != target.get("assetId"):
                    target.pop("sourceDuration", None)
            if path[-1] == "duration" and "persistent" in target:
                target["persistent"] = value == 0
                if target["persistent"]:
                    target["wait"] = False
            if path[-1] == "duration" and target.get("retimeOnDuration") and value >= 0:
                vn_visual_retime(target, value)
            else:
                target[path[-1]] = value
        def limit_sources(item):
            if item.get("content") == "video" and not item.get("loop") and not item.get("persistent") and item.get("sourceDuration") is not None:
                item["duration"] = max(0.0, min(item["duration"], item["sourceDuration"] - item.get("mediaOffset", 0.0)))
            for child in item.get("children") or []:
                limit_sources(child)
        limit_sources(data)
        return data

    def vn_visual_glyph_particles(data, time, width, height, visible_only=False):
        g = data["glyphParticles"]
        text_mode = g.get("source") == "text"
        path = data.get("glyphPath")
        if not text_mode and not path:
            return []
        tw, th = max(1, int(width * g["rect"]["width"])), max(1, int(height * g["rect"]["height"]))
        key = ("text", data["text"], data.get("fontPath"), data["fontSize"], tw, th, data.get("textAlign"), data.get("textVerticalAlign"), data.get("textItalic", False), tuple(sorted((data.get("textEffects") or {}).items())), tuple(sorted((data.get("textClip") or {}).items()))) if text_mode else ("image", path)
        if key not in vn_visual_glyph_cache:
            surface = renpy.render_to_surface(vn_visual_text(data, tw, th, "#ffffff"), tw, th, resize=True) if text_mode else renpy.load_surface(path)
            sw, sh = surface.get_size()
            step = max(1, int(min(sw, sh) / 80))
            points = [(float(x + .5) / sw, float(y + .5) / sh) for y in range(0, sh, step) for x in range(0, sw, step) if surface.get_at((x, y))[3] > 80]
            if len(vn_visual_glyph_cache) >= 64:
                vn_visual_glyph_cache.pop(next(iter(vn_visual_glyph_cache)))
            vn_visual_glyph_cache[key] = (sw, sh, points)
        sw, sh, points = vn_visual_glyph_cache[key]
        if not text_mode:
            points = vn_emission_mesh_points.get(path, points)
        if not points:
            return []
        rect = g["rect"]
        factor = min(rect["width"] * width / sw, rect["height"] * height / sh)
        iw, ih = sw * factor / width, sh * factor / height
        curves = g.get("lifeCurves") or {}
        force_x, force_y = vn_particle_force_sampler(curves.get("forceX")), vn_particle_force_sampler(curves.get("forceY"))
        # These samples are transient render data, not save/rollback state.
        result = vn_visual_list()
        user_seed = g.get("seed", 0)
        pixels_per_unit = height / ${chapterSource.projection.cameraOrthographicSize * 2}
        motion_x, motion_y = pixels_per_unit / width * g["motionScale"], pixels_per_unit / height * g["motionScale"]
        size_scale = factor * ${chapterSource.projection.spritePixelsPerUnit} * g["sizeScale"]
        origin_x, origin_y = rect["x"] + (rect["width"] - iw) / 2, rect["y"] + (rect["height"] - ih) / 2
        size_curve = {"curves": {"x": curves["size"]}} if curves.get("size") else None
        opacity_curve = {"curves": {"x": curves["opacity"]}} if curves.get("opacity") else None
        color_curve = any(curves.get(key) for key in ("red", "green", "blue"))
        color = data["color"][:7].lower()
        for index, (p, motion) in enumerate(vn_visual_glyph_motion(time, g["emissionStart"], g["timeScale"], user_seed, g["count"])):
            dx, dy, alpha = motion
            if visible_only and alpha <= 0:
                continue
            u, v = points[(index * 7919 + user_seed * 104729) % len(points)]
            age = max(0, min(1, (time * g["timeScale"] - p["delay"]) * ${chapterSource.timing.simulationSpeed} / p["life"])) if curves else 0
            life = p["life"] / (${chapterSource.timing.simulationSpeed} * g["timeScale"]) if curves else 0
            x = force_x(age) * life ** 2 if curves.get("forceX") else dx * motion_x
            y = force_y(age) * life ** 2 if curves.get("forceY") else dy * motion_y
            result.append(vn_visual_dict(x=origin_x + u * iw + x, y=origin_y + v * ih + y,
                size=p["size"] * size_scale * (max(0, vn_visual_curve(size_curve, "x", age, 1)) if size_curve else 1),
                opacity=alpha * (max(0, min(1, vn_visual_curve(opacity_curve, "x", age, 1))) if opacity_curve else 1), color=vn_particle_life_color(data["color"], curves, age) if color_curve else color))
        return result

    def vn_visual_curve(data, key, time, fallback):
        frames = (data.get("curves") or {}).get(key)
        if not frames:
            return fallback
        frames = sorted(frames, key=lambda frame: frame["at"])
        previous = frames[0]
        if time < previous["at"]:
            return previous["value"]
        for frame in frames[1:]:
            if time < frame["at"] and frame["at"] > previous["at"]:
                t = (time - previous["at"]) / (frame["at"] - previous["at"])
                easing = frame["easing"]
                k = 1 - (1 - t) ** 2 if easing == "outquad" else t if easing == "linear" else 1 - vn_visual_math.cos(t * vn_visual_math.pi / 2) if easing == "easein" else vn_visual_math.sin(t * vn_visual_math.pi / 2) if easing == "easeout" else .5 - vn_visual_math.cos(t * vn_visual_math.pi) / 2
                return previous["value"] + (frame["value"] - previous["value"]) * k
            previous = frame
        return previous["value"]

    def vn_visual_media_gain(data, time):
        duration = float("inf") if data.get("persistent") else data["duration"]
        if time < 0 or time >= duration:
            return 0.0
        enter = min(duration, data.get("fadeIn", 0.0))
        leave = min(duration, data.get("fadeOut", 0.0))
        return (min(1.0, time / enter) if enter else 1.0) * (min(1.0, (duration - time) / leave) if leave else 1.0)

    def vn_visual_pose(data, time):
        pose = vn_visual_base_pose(data, time)
        result = {key: vn_visual_curve(data, key, time, pose.get(key, 1.0)) for key in ("x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity")}
        result["opacity"] = max(0.0, min(1.0, result["opacity"]))
        return result

    def vn_visual_base_pose(data, time):
        previous = data["keyframes"][0]
        for frame in data["keyframes"]:
            duration = frame["duration"]
            if duration > 0 and time < duration:
                t = max(0.0, time / duration)
                easing = frame["easing"]
                k = t if easing == "linear" else 1 - vn_visual_math.cos(t * vn_visual_math.pi / 2) if easing == "easein" else vn_visual_math.sin(t * vn_visual_math.pi / 2) if easing == "easeout" else .5 - vn_visual_math.cos(t * vn_visual_math.pi) / 2
                return {key: previous.get(key, 1.0) + (frame.get(key, 1.0) - previous.get(key, 1.0)) * k for key in ("x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity")}
            time -= duration
            previous = frame
        return previous

    def vn_particle_force_sampler(frames, acceleration=True):
        if not frames:
            return lambda age: 0.0
        nodes = (.1834346424956498, .525532409916329, .7966664774136267, .9602898564975363)
        weights = (.362683783378362, .3137066458778873, .2223810344533745, .1012285362903763)
        frames = sorted(frames, key=lambda frame: frame["at"])
        boundaries = sorted(set([0, 1] + [frame["at"] for frame in frames]))
        def integrate(local, left, right):
            half, mid = (right - left) / 2.0, (right + left) / 2.0
            area, moment = 0.0, 0.0
            for node, weight in zip(nodes, weights):
                for sign in (-1, 1):
                    at = mid + sign * half * node
                    value = half * weight * vn_visual_curve({"curves": {"x": local}}, "x", at, 0)
                    area += value
                    moment += at * value
            return area, moment
        segments, area, moment = [], 0.0, 0.0
        for left, right in zip(boundaries, boundaries[1:]):
            previous = next((frame for frame in reversed(frames) if frame["at"] <= left), frames[0])
            following = next((frame for frame in frames if frame["at"] > left), None)
            local = [previous, following] if following is not None and following is not previous else [previous]
            segments.append((left, right, local, area, moment))
            a, m = integrate(local, left, right)
            area += a
            moment += m
        def sample(age):
            if age <= 0:
                return 0.0
            left, right, local, area, moment = next((segment for segment in segments if age <= segment[1]), segments[-1])
            a, m = integrate(local, left, age)
            return age * (area + a) - moment - m if acceleration else area + a
        return sample

    def vn_particle_life_color(color, curves, age):
        if not (curves.get("red") or curves.get("green") or curves.get("blue")):
            return color[:7].lower()
        return "#" + "".join("%02x" % int(vn_visual_math.floor(max(0, min(255, vn_visual_curve({"curves": {"x": curves.get(key)}}, "x", age, int(color[1 + index * 2:3 + index * 2], 16)))) + .5)) for index, key in enumerate(("red", "green", "blue")))

    def vn_visual_particles(data, time):
        p = data.get("particles")
        if not p:
            return []
        def random(index, channel):
            value = (p["seed"] ^ ((index + 1) * 374761393) ^ ((channel + 1) * 668265263)) & 0xffffffff
            value = ((value ^ (value >> 13)) * 1274126177) & 0xffffffff
            return (value ^ (value >> 16)) / 4294967296.0
        curves = p.get("lifeCurves") or {}
        force_x, force_y = vn_particle_force_sampler(curves.get("forceX")), vn_particle_force_sampler(curves.get("forceY"))
        distance = vn_particle_force_sampler(curves["speed"], False) if curves.get("speed") else None
        result = []
        for i in range(p["count"]):
            age = (time + random(i, 0) * p["lifetime"]) % p["lifetime"]
            t = age / p["lifetime"]
            angle = (p["direction"] + (random(i, 1) - .5) * p["spread"]) * vn_visual_math.pi / 180
            travelled = distance(t) * p["lifetime"] if distance else p["speed"] * age
            color = vn_particle_life_color(data["color"], curves, t)
            result.append(dict(x=random(i, 2) + vn_visual_math.cos(angle) * travelled + force_x(t) * p["lifetime"] ** 2,
                y=random(i, 3) + vn_visual_math.sin(angle) * travelled + force_y(t) * p["lifetime"] ** 2, color=color,
                size=max(0, vn_visual_curve({"curves": {"x": curves.get("size")}}, "x", t, p["size"] + (p["endSize"] - p["size"]) * t)),
                opacity=max(0, min(1, vn_visual_curve({"curves": {"x": curves.get("opacity")}}, "x", t, vn_visual_math.sin(vn_visual_math.pi * t))))))
        return result

    def vn_visual_dissolve(data, time):
        d = data.get("dissolve")
        if not d:
            return vn_visual_curve(data, "dissolveStrength", time, 1.0)
        t = min(1.0, max(0.0, (time - d["start"]) / (d["end"] - d["start"]))) if d["end"] > d["start"] else float(time >= d["start"])
        return vn_visual_curve(data, "dissolveStrength", time, d["from"] + (d["to"] - d["from"]) * t)

    def vn_visual_text(data, width, height, color=None):
        effects = {key: value for key, value in (data.get("textEffects") or {}).items() if value is not None}
        outlines = []
        def effect_color(name, opacity, default):
            return Color(effects.get(name, default)).replace_opacity(effects.get(opacity, 1.0 if name == "outlineColor" else 0.7))
        blur = effects.get("shadowBlur", 0)
        if blur:
            steps, covered = min(24, max(2, int(vn_visual_math.ceil(blur * 2)))), 0.0
            for step in range(steps, -1, -1):
                radius = blur * 2.0 * step / steps
                target = effects.get("shadowOpacity", .7) * vn_visual_math.exp(-2 * (radius / blur) ** 2)
                alpha = max(0, (target - covered) / max(.00001, 1 - covered))
                if alpha >= .5 / 255:
                    outlines.append((radius, Color(effects.get("shadowColor", "#000000")).replace_opacity(round(alpha * 255) / 255.0), effects.get("shadowX", 0), effects.get("shadowY", 0)))
                covered = target
        if effects.get("outlineWidth"):
            outlines.append((effects["outlineWidth"], effect_color("outlineColor", "outlineOpacity", "#000000"), 0, 0))
        if not blur and (effects.get("shadowX") or effects.get("shadowY")):
            outlines.append((0, effect_color("shadowColor", "shadowOpacity", "#000000"), effects.get("shadowX", 0), effects.get("shadowY", 0)))
        horizontal = {"left": 0.0, "right": 1.0}.get(data.get("textAlign"), .5)
        vertical = {"top": 0.0, "bottom": 1.0}.get(data.get("textVerticalAlign"), .5)
        text = Text(data["text"].replace("{", "{{"), substitute=False, font=data.get("fontPath", "fonts/SourceHanSansLite.ttf"), size=data["fontSize"], italic=data.get("textItalic", False), color=color or data["color"], text_align=horizontal, xsize=width, slow_cps=0, outlines=outlines)
        box = Fixed(Transform(text, align=(horizontal, vertical)), xysize=(width, height))
        box = Transform(box, crop=(0, 0, width, height))
        clip = data.get("textClip")
        if clip:
            x, y = max(0, min(width, int(round(clip["x"] * width)))), max(0, min(height, int(round(clip["y"] * height))))
            right, bottom = max(0, min(width, int(round((clip["x"] + clip["width"]) * width)))), max(0, min(height, int(round((clip["y"] + clip["height"]) * height))))
            if right <= x or bottom <= y:
                return Null(width, height)
            mask = Fixed(Transform(Solid("#ffffff", xysize=(right - x, bottom - y)), xpos=x, ypos=y), xysize=(width, height))
            box = AlphaMask(box, mask)
        return box

    def vn_stop_visual_media(data):
        movie = data.get("_vn_movie")
        if movie is not None and not data.get("_vn_media_stopped"):
            data["_vn_media_stopped"] = True
            movie.stop()
            # Rebuild Ren'Py's visible-movie registry as well. Otherwise a
            # pending show event can restart the just-stopped looping movie.
            renpy.restart_interaction()
        for child in data.get("children") or []:
            vn_stop_visual_media(child)

    def vn_visual_artwork_key(data, width, height):
        content = data["content"]
        if content == "solid":
            return (content, width, height, data["color"])
        if content == "image":
            return (content, width, height, data.get("path"), data.get("imageFit"), data.get("imageAlign"))
        if content == "text":
            return (content, width, height, data["text"], data.get("fontPath"), data["fontSize"], data["color"], data.get("textAlign"), data.get("textVerticalAlign"), data.get("textItalic", False), tuple(sorted((data.get("textEffects") or {}).items())), tuple(sorted((data.get("textClip") or {}).items())))
        return None

    def vn_visual_display(st, at, data, viewport=None):
        if not data.get("persistent") and (data.get("_vn_expired") or st >= data["duration"]):
            # Interaction restarts can move the sampled render clock back by
            # one frame. Once expired, never recreate/restart the Movie.
            data["_vn_expired"] = True
            # A DynamicDisplayable can remove its Movie during the same
            # interaction. Ren'Py only clears movie registrations at the next
            # interaction, so explicitly stop the decoder at the clip end.
            vn_stop_visual_media(data)
            if not (vn_performance_active and data.get("_vn_performance_end", -1) >= vn_performance_until - 0.03 and (vn_performance_settings.get("transition") or {}).get("mode") in ("color", "dissolve")):
                return Null(), None
            st = max(0.0, data["duration"] - 0.00001)
        pose = vn_visual_pose(data, st)
        duration = float("inf") if data.get("persistent") else data["duration"]
        enter, leave = vn_visual_rule(data, "enter"), vn_visual_rule(data, "exit")
        enter_seconds, leave_seconds = min(duration, vn_visual_seconds(enter)), min(duration, vn_visual_seconds(leave))
        incoming = min(1.0, max(0.0, st / enter_seconds)) if enter_seconds and not data.get("_vn_skip_enter") else 1.0
        outgoing = min(1.0, max(0.0, (duration - st) / leave_seconds)) if leave_seconds and not data.get("persistent") else 1.0
        pose["opacity"] *= incoming * outgoing
        pose["x"] += ((incoming - 1) * .15 if enter["mode"] == "move" else 0) + ((1 - outgoing) * .15 if leave["mode"] == "move" else 0)
        if data["content"] == "video":
            pose["opacity"] *= vn_visual_media_gain(data, st)
        vw, vh = viewport or (config.screen_width, config.screen_height)
        width, height = max(1, int(data["width"] * vw)), max(1, int(data["height"] * vh))
        static_key = vn_visual_artwork_key(data, width, height)
        if static_key is not None and data.get("_vn_static_key") == static_key:
            child = data["_vn_static_displayable"]
        elif data["content"] == "group":
            child = Fixed(xysize=(width, height))
            for item in sorted(data.get("children") or [], key=lambda item: item["layer"]):
                elapsed = st - item.get("startAt", 0)
                if elapsed >= 0 and (item.get("persistent") or elapsed < item["duration"]):
                    display, delay = vn_visual_display(elapsed, elapsed, item, (width, height))
                    child.add(display)
                elif elapsed >= item["duration"]:
                    vn_stop_visual_media(item)
            child = Transform(child, crop=(0, 0, width, height), mesh=True)
        elif data["content"] == "solid":
            child = Solid(data["color"], xysize=(width, height))
        elif data["content"] == "image":
            fit = data.get("imageFit", "stretch")
            fitted = Transform(data["path"], xysize=(width, height), fit=None if fit == "stretch" else fit) if data.get("path") else Null(width, height)
            image_y = 0.0 if data.get("imageAlign") == "top" else 1.0 if data.get("imageAlign") == "bottom" else .5
            child = Transform(Fixed(Transform(fitted, align=(.5, image_y)), xysize=(width, height)), crop=(0, 0, width, height))
        elif data["content"] == "video":
            fit = data.get("imageFit", "stretch")
            start = max(0.0, float(data.get("mediaOffset", 0.0)))
            end = max(start, start + float(data.get("duration", 0.0)))
            source = ("<from %.9f>%s" % (start, data["path"])) if data.get("persistent") else ("<from %.9f to %.9f>%s" % (start, end, data["path"]))
            # Keep the same Movie across redraws. A new instance would restart
            # its decoder whenever replay_movie_sprites is enabled.
            key = (source, width, height, data.get("loop", False))
            if data.get("_vn_movie_key") != key:
                data["_vn_movie"] = Movie(play=source, loop=data.get("loop", False))
                data["_vn_movie_key"] = key
            child = data["_vn_movie"]
            child.ensure_channels()
            volume = 0.0 if data.get("muted", False) else max(0.0, min(1.0, data.get("volume", 1.0))) * vn_visual_media_gain(data, st)
            renpy.music.set_volume(volume, channel=child.channel)
            fitted = Transform(child, xysize=(width, height), fit=None if fit == "stretch" else fit)
            child = Transform(Fixed(Transform(fitted, align=(.5, .5)), xysize=(width, height)), crop=(0, 0, width, height))
        elif data["content"] == "text":
            child = vn_visual_text(data, width, height)
        else:
            glyph = bool(data.get("glyphParticles"))
            particles = vn_visual_glyph_particles(data, st, width, height, visible_only=True) if glyph else vn_visual_particles(data, st)
            child = VNVisualParticles(particles, width, height, glyph, data["color"])
        if static_key is not None and data.get("_vn_static_key") != static_key:
            child = VNVisualStatic(child)
            data["_vn_static_displayable"] = child
            data["_vn_static_key"] = static_key
        if (data.get("ripple") or (data.get("curves") or {}).get("rippleStrength") or (data.get("curves") or {}).get("rippleSpeed")) and data["content"] == "image":
            child = Transform(child, mesh=True, shader="vn.chapter_ripple", u_vn_ripple_time=st, u_vn_ripple_strength=vn_visual_curve(data, "rippleStrength", st, (data.get("ripple") or {}).get("strength", .01)), u_vn_ripple_speed=vn_visual_curve(data, "rippleSpeed", st, (data.get("ripple") or {}).get("speed", 1)))
        if data.get("maskPath"):
            child = AlphaMask(child, Transform(data["maskPath"], xysize=(width, height)))
        d = data.get("dissolve")
        if d or (data.get("curves") or {}).get("dissolveStrength"):
            child = Transform(child, mesh=True, shader="vn.chapter_noise", u_vn_chapter_strength=vn_visual_dissolve(data, st))
        child = Transform(child, xzoom=pose["scaleX"], yzoom=pose["scaleY"], subpixel=True)
        # Animate on the next rendered frame. Waiting another 1/60 second after
        # building a frame misses refreshes even when rendering fits the budget.
        return Transform(child, xpos=pose["x"], ypos=pose["y"], anchor=(.5, .5), zoom=pose["scale"], rotate=pose["rotation"], alpha=pose["opacity"], subpixel=True), 0

    def vn_prepare_visual(data, font=None):
        data = dict(data)
        data.pop("_vn_static_displayable", None)
        data.pop("_vn_static_key", None)
        if font and not data.get("fontPath"):
            data["fontPath"] = font
        if data["content"] in ("image", "video"):
            data["path"] = vn_bp_asset(data.get("assetId"), "video") if data["content"] == "video" else vn_bp_optional_asset(data.get("assetId"), "image")
        if data.get("fontAssetId"):
            data["fontPath"] = vn_bp_asset(data["fontAssetId"], "font")
        if data.get("maskAssetId"):
            data["maskPath"] = vn_bp_asset(data["maskAssetId"], "image")
        if data.get("glyphParticles") and data["glyphParticles"].get("source") != "text":
            data["glyphPath"] = vn_bp_optional_asset(data["glyphParticles"].get("assetId"), "image")
        if data["content"] == "group":
            data["children"] = [vn_prepare_visual(item, data.get("fontPath")) for item in data.get("children") or []]
        return data

    def vn_show_visual(data):
        global vn_chapter_visual_tags, vn_performance_visual_tags
        tag = "vn_visual_" + data["instanceId"]
        if data.get("chapterPresentation"):
            if renpy.is_skipping():
                return
            if tag not in vn_chapter_visual_tags:
                vn_chapter_visual_tags = vn_chapter_visual_tags + [tag]
        data = vn_prepare_visual(data)
        if data.get("persistent") and data.get("lifetime") != "line":
            vn_performance_visual_tags = [item for item in vn_performance_visual_tags if item != tag]
        elif vn_performance_active:
            if tag not in vn_performance_visual_tags:
                vn_performance_visual_tags = vn_performance_visual_tags + [tag]
            if not data.get("persistent"):
                data["_vn_performance_end"] = vn_bp_clock() + data["duration"]
                vn_performance_extend(data["duration"])
        seconds = vn_install_visual(data)
        return data["duration"] if data.get("wait") and not data.get("persistent") else seconds if data.get("transitionWait") else 0.0
${visualTransitionsRuntime}
`;
