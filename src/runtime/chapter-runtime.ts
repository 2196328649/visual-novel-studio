import { emissionMeshPoints } from '../core/emission-mesh';
import { effectiveUiTheme, type Project } from '../core/model';
import { chapterForceSampleRate, chapterForceSamples, chapterParticle, chapterParticleCount, chapterSource, chapterTitleRect } from '../core/chapter';
import { pythonLiteral } from './literals';
import { chapterRippleShader } from '../core/chapter-ripple';

export function createChapterRuntime(project: Project) {
  const theme = effectiveUiTheme(project.ui), rect = chapterTitleRect(project);
  const component = theme.components.find(c => c.page === 'chapterTitle' && c.kind === 'chapterTitle');
  const font = project.assets.find(a => a.id === (component?.style?.fontAssetId ?? theme.fontAssetId))?.path.replaceAll('\\', '/') ?? 'fonts/SourceHanSansLite.ttf';
  return `init python:
    vn_emission_mesh_points = ${pythonLiteral(Object.fromEntries(project.assets.filter(asset => asset.emissionMesh).map(asset => [asset.path.replaceAll('\\', '/'), emissionMeshPoints(asset.emissionMesh!)])))}
    import functools as vn_chapter_functools
    import math as vn_chapter_math
    vn_chapter_timing = ${pythonLiteral(chapterSource.timing)}
    vn_chapter_particle_seeds = ${pythonLiteral(Array.from({ length: chapterParticleCount }, (_, index) => chapterParticle(index)))}
    vn_chapter_force_samples = ${pythonLiteral(chapterForceSamples.map(row => row.map(v => Number(v.toFixed(8)))))}
    vn_chapter_particle_cache = {}

    @vn_chapter_functools.lru_cache(maxsize=128)
    def vn_chapter_seeded_particles(user_seed):
        if user_seed == 0:
            return vn_chapter_particle_seeds
        result = []
        for index in range(${chapterParticleCount}):
            seed = ((index + 1729) ^ ((int(user_seed) * 0x9e3779b9) & 0xffffffff)) & 0xffffffff
            seed = ((seed ^ (seed >> 16)) * 0x21f0aaad) & 0xffffffff
            seed = ((seed ^ (seed >> 15)) * 0x735a2d97) & 0xffffffff
            seed = (seed ^ (seed >> 15)) & 0xffffffff
            values = []
            for channel in range(5):
                seed = (seed * 1664525 + 1013904223) & 0xffffffff
                values.append(seed / 4294967296.0)
            result.append(dict(delay=${chapterSource.timing.move + chapterSource.timing.holdTitle} + index / ${chapterSource.particle.rate} / ${chapterSource.timing.simulationSpeed},
                life=${chapterSource.particle.lifetime}, size=${chapterSource.particle.size[0]} + ${chapterSource.particle.size[1] - chapterSource.particle.size[0]} * values[0],
                forceX=values[1], forceY=values[2], noiseX=values[3] * 10, noiseY=values[4] * 10))
        return result

    def vn_chapter_clamp(value):
        return min(1.0, max(0.0, value))

    def vn_chapter_out_quad(value):
        return 1.0 - (1.0 - vn_chapter_clamp(value)) ** 2

    def vn_chapter_frame(time, effect):
        if effect == "none":
            return dict(surface=1.0, alpha=1.0, shift=0.0, strength=1.0)
        if effect != "ink":
            ramp = lambda a, b: vn_chapter_clamp((time - a) / (b - a))
            return dict(surface=ramp(0.0, .22) * (1.0 - ramp(.83, 1.0)), alpha=ramp(.12, .2) * (1.0 - ramp(.73, .95)), shift=0.0, strength=1.0)
        t, seconds = vn_chapter_timing, time * vn_chapter_timing["duration"]
        surface = vn_chapter_out_quad(seconds / t["fadeIn"]) * vn_chapter_clamp(1.0 - t["fadeTarget"] * vn_chapter_out_quad((seconds - t["fadeIn"] - t["holdBackground"]) / t["fadeOut"]))
        erase = vn_chapter_out_quad((seconds - t["move"] - t["holdTitle"]) / t["disappear"])
        return dict(surface=surface, alpha=1.0, shift=vn_chapter_out_quad(seconds / t["move"]) - 1.0, strength=1.0 - 2.0 * erase)

    @vn_chapter_functools.lru_cache(maxsize=4096)
    def vn_chapter_noise_direction(px, py):
        value = ((34 * (px % 289) + 1) * (px % 289)) % 289 + py % 289
        value = (((34 * value + 1) * value) % 289 / 41.0) % 1 * 2 - 1
        dx, dy = value - vn_chapter_math.floor(value + .5), abs(value) - .5
        length = vn_chapter_math.hypot(dx, dy)
        return dx / length, dy / length

    def vn_chapter_gradient_noise(x, y):
        floor = vn_chapter_math.floor
        ix, iy, fx, fy = floor(x), floor(y), x % 1, y % 1
        def dot(dx, dy):
            gx, gy = vn_chapter_noise_direction(ix + dx, iy + dy)
            return gx * (fx - dx) + gy * (fy - dy)
        ux, uy = fx ** 3 * (fx * (fx * 6 - 15) + 10), fy ** 3 * (fy * (fy * 6 - 15) + 10)
        a, b, c, d = dot(0, 0), dot(0, 1), dot(1, 0), dot(1, 1)
        return (a + (b - a) * uy) * (1 - ux) + (c + (d - c) * uy) * ux

    @vn_chapter_functools.lru_cache(maxsize=4096)
    def vn_chapter_noise_origin(x, y):
        return vn_chapter_gradient_noise(x, y)

    def vn_chapter_particle_frame(p, time):
        age = (time * vn_chapter_timing["duration"] - p["delay"]) * vn_chapter_timing["simulationSpeed"]
        if age < 0 or age >= p["life"]:
            return 0.0, 0.0, 0.0
        cursor = age * ${chapterForceSampleRate}
        index = min(len(vn_chapter_force_samples) - 2, int(cursor))
        a, b, f = vn_chapter_force_samples[index], vn_chapter_force_samples[index + 1], cursor - index
        row = [v + (w - v) * f for v, w in zip(a, b)]
        dx, dy = row[0] + (row[1] - row[0]) * p["forceX"], row[2] + (row[3] - row[2]) * p["forceY"]
        def perturb(x, y):
            return (vn_chapter_gradient_noise(x + dx * ${chapterSource.particle.noise.frequency}, y + dy * ${chapterSource.particle.noise.frequency}) - vn_chapter_noise_origin(x, y)) * ${chapterSource.particle.noise.strength / chapterSource.particle.noise.frequency}
        return dx + perturb(p["noiseX"], p["noiseY"]), -dy - perturb(p["noiseY"] + 19, p["noiseX"] + 31), 1.0

    def vn_chapter_particles_for(title_image, title):
        key = (title_image, title)
        if key in vn_chapter_particle_cache:
            return vn_chapter_particle_cache[key]
        source = renpy.load_surface(title_image) if title_image else renpy.render_to_surface(Text(title, font=${pythonLiteral(font)}, size=${component?.style?.fontSize ?? 54}))
        sw, sh = source.get_size()
        step = max(1, int(min(sw, sh) / 80))
        points = [(float(x + 0.5) / sw, float(y + 0.5) / sh) for y in range(0, sh, step) for x in range(0, sw, step) if source.get_at((x, y))[3] > 80]
        points = vn_emission_mesh_points.get(title_image, points)
        factor = min(${rect.width * project.width} / sw, ${rect.height * project.height} / sh)
        iw, ih = sw * factor / ${project.width}, sh * factor / ${project.height}
        ox, oy = ${rect.x} + (${rect.width} - iw) / 2, ${rect.y} + (${rect.height} - ih) / 2
        particles = []
        for index, seed in enumerate(vn_chapter_particle_seeds):
            if not points:
                break
            u, v = points[(index * 7919) % len(points)]
            particle = dict(seed)
            particle.update(x=ox + u * iw, y=oy + v * ih, pixels=seed["size"] * factor * ${chapterSource.projection.spritePixelsPerUnit})
            particles.append(particle)
        vn_chapter_particle_cache[key] = particles
        return particles

    def vn_chapter_elapsed(duration, at):
        # ATL's local st can restart when a screen rebuilds. Animation time
        # belongs to the displayed screen and keeps all its effects in sync.
        return min(duration, max(0.0, at))

    def vn_chapter_presence_update(duration, effect, trans, st, at):
        elapsed = vn_chapter_elapsed(duration, at)
        trans.alpha = vn_chapter_frame(elapsed / duration, effect)["surface"]
        return 0 if elapsed < duration else None

    def vn_chapter_ripple_update(duration, trans, st, at):
        elapsed = vn_chapter_elapsed(duration, at)
        trans.u_vn_ripple_time = elapsed / duration * ${chapterSource.timing.duration}
        return 0 if elapsed < duration else None

    def vn_chapter_letters_update(effect, duration, trans, st, at):
        elapsed = vn_chapter_elapsed(duration, at)
        frame = vn_chapter_frame(elapsed / duration, effect)
        trans.alpha = frame["alpha"]
        trans.xoffset = frame["shift"] * ${project.width * .5}
        trans.u_vn_chapter_strength = frame["strength"]
        return 0 if elapsed < duration else None

    def vn_chapter_particle_update(p, duration, trans, st, at):
        elapsed = vn_chapter_elapsed(duration, at)
        dx, dy, alpha = vn_chapter_particle_frame(p, elapsed / duration)
        trans.xpos = p["x"] + dx * ${project.height / (chapterSource.projection.cameraOrthographicSize * 2) / project.width}
        trans.ypos = p["y"] + dy / ${chapterSource.projection.cameraOrthographicSize * 2}
        trans.alpha = alpha
        return 0 if elapsed < duration else None

    renpy.register_shader("vn.chapter_noise", variables="""
        uniform float u_vn_chapter_strength;
        varying vec2 v_tex_coord;
    """, fragment_functions="""
        vec2 vn_chapter_direction(vec2 p) {
            p = mod(p, 289.0);
            float x = mod((34.0 * p.x + 1.0) * p.x, 289.0) + p.y;
            x = fract(mod((34.0 * x + 1.0) * x, 289.0) / 41.0) * 2.0 - 1.0;
            return normalize(vec2(x - floor(x + 0.5), abs(x) - 0.5));
        }
        float vn_chapter_gradient(vec2 uv) {
            vec2 p = floor(uv), f = fract(uv), u = f*f*f*(f*(f*6.0-15.0)+10.0);
            float a = dot(vn_chapter_direction(p), f);
            float b = dot(vn_chapter_direction(p + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
            float c = dot(vn_chapter_direction(p + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
            float d = dot(vn_chapter_direction(p + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
            return mix(mix(a, b, u.y), mix(c, d, u.y), u.x);
        }
    """, fragment_300="""
        float noise = clamp(vn_chapter_gradient(vec2(v_tex_coord.x, 1.0 - v_tex_coord.y) * ${chapterSource.shaders.title.scale}) + 0.5, 0.0, 1.0);
        gl_FragColor *= clamp(noise + u_vn_chapter_strength, 0.0, 1.0);
    """)
    renpy.register_shader("vn.chapter_particle", variables="""
        varying vec2 v_tex_coord;
    """, fragment_300="""
        gl_FragColor *= clamp(1.0 - 2.0 * length(v_tex_coord - vec2(0.5)), 0.0, 1.0);
    """)
    renpy.register_shader("vn.chapter_ripple", variables="""
        uniform sampler2D tex0;
        varying vec2 v_tex_coord;
        uniform float u_vn_ripple_time;
        uniform float u_vn_ripple_strength;
        uniform float u_vn_ripple_speed;
    """, fragment_functions="""${chapterRippleShader}
    """, fragment_300="""
        gl_FragColor = texture2D(tex0, vn_ripple_uv(v_tex_coord, u_vn_ripple_time, u_vn_ripple_strength, u_vn_ripple_speed));
    """)

transform vn_chapter_presence(duration, effect):
    mesh True
    function vn_chapter_functools.partial(vn_chapter_presence_update, duration, effect)

transform vn_chapter_background(duration, effect):
    xalign 0.5
    yalign 0.5
    xoffset ${Math.round((theme.chapterTransition?.backgroundOffsetX ?? 0) * project.width)}
    yoffset ${Math.round((theme.chapterTransition?.backgroundOffsetY ?? 0) * project.height)}
${theme.chapterTransition?.ripple === false ? '' : `    mesh (effect == "ink")
    shader ("vn.chapter_ripple" if effect == "ink" else None)
    u_vn_ripple_time 0.0
    u_vn_ripple_strength ${theme.chapterTransition?.rippleStrength ?? chapterSource.shaders.ripple.strength}
    u_vn_ripple_speed ${theme.chapterTransition?.rippleSpeed ?? chapterSource.shaders.ripple.speed}
    function vn_chapter_functools.partial(vn_chapter_ripple_update, duration)`}

transform vn_chapter_letters(effect, duration):
    subpixel True
    mesh True
    shader "vn.chapter_noise"
    u_vn_chapter_strength 1.0
    function vn_chapter_functools.partial(vn_chapter_letters_update, effect, duration)

transform vn_chapter_particle_motion(p, duration):
    subpixel True
    mesh True
    shader "vn.chapter_particle"
    xanchor 0.5
    yanchor 0.5
    function vn_chapter_functools.partial(vn_chapter_particle_update, p, duration)

`;
}
