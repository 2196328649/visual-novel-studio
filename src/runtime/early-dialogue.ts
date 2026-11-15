/** Keep native say/history/voice handling, with one clock across the intervening stage actions. */
export const earlyDialogueRuntime = `
default vn_line_dialogue = None
default vn_retained_look = None
default vn_showing_retained = False
default vn_text_exiting = False

python early:
    from builtins import list as vn_native_list
    from renpy.text.textsupport import TAG as vn_text_tag_kind, TEXT as vn_text_word_kind, PARAGRAPH as vn_text_paragraph_kind

    def vn_text_fill_empty_lines(tokens):
        # Preserve the SDK's blank-line height without charging a character's
        # time for its invisible placeholder. This happens after exit filtering.
        result, has_text = [], False
        filler = [(vn_text_tag_kind, "cps=0"), (vn_text_word_kind, "\u200b"), (vn_text_tag_kind, "/cps")]
        for kind, value in tokens:
            if kind == vn_text_paragraph_kind:
                if not has_text:
                    result.extend(filler)
                has_text = False
            elif kind == vn_text_word_kind and value:
                has_text = True
            result.append((kind, value))
        if not has_text:
            result.extend(filler)
        return result

    def vn_text_is_retained(text):
        retained = getattr(store, "vn_retained_dialogue", None)
        return bool(getattr(store, "vn_showing_retained", False) and retained is not None and text == retained[1])

    def vn_text_look(text=None):
        # Between lines the previous words stay on screen with their own look.
        if vn_text_is_retained(text):
            return getattr(store, "vn_retained_look", None)
        data = getattr(store, "vn_line_dialogue", None)
        return (data or {}).get("presentation") or None

    def vn_text_anim(spec, glyphs, spread, begin=0.0, name="vn_anim"):
        # "x,y,scaleX,scaleY,radians,opacity,seconds,easing,order": see animationSpec in the editor.
        x, y, sx, sy, rotation, opacity, seconds, easing, order = spec.split(",")
        return "%s:u__offset=(%s,%s):u__scale=(%s,%s):u__rotation=%s:u__alpha=%s:u__duration=%s:u__ease=%s:u__order=%s:u__glyphs=%.4f:u__spread=%.4f:u__begin=%.4f" % (name, x, y, sx, sy, rotation, opacity, seconds, easing, order, glyphs, spread, begin)

    def vn_text_order_position(order, place, index):
        # Keep all integer intermediates below 2^24, exactly as in the shader
        # and the editor's orderPosition. Sine hashes disagree across GPUs.
        if order > 3.5:
            value = (int(index) % 4093 * 109 + 37) % 4093
            return ((value * value + 17) % 4093) / 4093.0
        if order > 2.5:
            return 1.0 - abs(2.0 * place - 1.0)
        if order > 1.5:
            return abs(2.0 * place - 1.0)
        if order > 0.5:
            return 1.0 - place
        return place

    def vn_text_layout_seconds(layout):
        # The SDK adds the longest shader entrance after the last glyph even
        # when that entrance belongs to an earlier word. Use the actual glyph
        # times and their own shader instead. Layouts are transient and scoped
        # to one Text, so this never caches clocks or progress in the store.
        cached = getattr(layout, "_vn_reveal_seconds", None)
        if cached is not None:
            return cached
        if not layout.cps:
            return 0.0
        shaders = {}
        finish = 0.0
        for paragraph in layout.paragraph_glyphs:
            for glyph in paragraph:
                if glyph.time < 0:
                    continue
                if glyph.character in (0xfeff, 0xfffc):
                    # The nestled continue indicator adds a joiner and a
                    # displayable after the words. It is not another word.
                    continue
                finish = max(finish, glyph.time)
                # Authored pauses are zero-width space glyphs. They preserve
                # their wait, but have no visible entrance to wait for.
                if glyph.character in (0, 0x200b) or not layout.cps or glyph.shader is None:
                    continue
                shader = glyph.shader
                if shader not in shaders:
                    shaders[shader] = dict(shader.uniforms)
                uniforms = shaders[shader]
                for name in ("vn_anim", "vn_anim_out"):
                    prefix = "u_textshader_" + name + "_"
                    if prefix + "duration" not in uniforms:
                        continue
                    total = uniforms.get(prefix + "glyphs", 0.0)
                    place = min(1.0, max(0.0, glyph.time / total)) if total > 0 else 0.0
                    sequence = vn_text_order_position(uniforms.get(prefix + "order", 0.0), place, glyph.index)
                    start = uniforms.get(prefix + "begin", 0.0) + sequence * uniforms.get(prefix + "spread", 0.0)
                    finish = max(finish, start + uniforms[prefix + "duration"])
        layout._vn_reveal_seconds = finish
        return finish

    class VnTimedText(renpy.text.text.Text):
        vn_reveal_timing = False

        def vn_prepare_tokens(self, tokens):
            return tokens

        def tokenize(self, text):
            tokens = self.vn_prepare_tokens(super(VnTimedText, self).tokenize(text))
            return vn_text_fill_empty_lines(tokens) if self.vn_reveal_timing or getattr(self, "vn_text_leaving", False) else tokens

        def vn_time_layout(self, layout, st=None):
            if layout is None or not self.vn_reveal_timing:
                return layout
            layout.max_time = vn_text_layout_seconds(layout)
            if not getattr(layout, "_vn_ctc_timed", False):
                # A nestled continue indicator is a child displayable, whose
                # native glyph time ignores long/ordered entrances. Delay only
                # this Text's own indicator until the words are complete;
                # clicking to complete still draws it immediately (slow=False).
                ctc = self.ctc if isinstance(self.ctc, vn_native_list) else [self.ctc]
                layout.displayable_blits = [(*blit[:-1], layout.max_time) if any(blit[0] is item for item in ctc) else blit for blit in layout.displayable_blits]
                layout._vn_ctc_timed = True
            if st is not None and getattr(self, "_vn_frame_was_slow", False):
                # Text.render may already have ended slow using the SDK's
                # estimate on a newly-created layout. Correct that before any
                # drawing. Never revive a clicked, skipped or replaced Text.
                was_slow = self.slow
                self.slow = bool(layout.cps) and st <= layout.max_time
                if was_slow and not self.slow:
                    renpy.game.interface.timeout(0)
            return layout

        def get_layout(self):
            return self.vn_time_layout(super(VnTimedText, self).get_layout())

        def render(self, width, height, st, at):
            self._vn_frame_was_slow = self.slow if self.slow is not None else bool(self.style.slow_cps)
            try:
                return super(VnTimedText, self).render(width, height, st, at)
            finally:
                self._vn_frame_was_slow = False

        def render_textshader(self, render, layout, st, at):
            self.vn_time_layout(layout, st)
            if not layout.cps:
                # Explicit pause tags retain absolute times even when the
                # player chooses instant text. The words and local loops must
                # still be fully shown; get_time remains zero.
                maximum = layout.max_time
                layout.max_time = max(maximum, 1e9)
                try:
                    return super(VnTimedText, self).render_textshader(render, layout, st, at)
                finally:
                    layout.max_time = maximum
            return super(VnTimedText, self).render_textshader(render, layout, st, at)

        def render_blits(self, render, layout, st):
            self.vn_time_layout(layout, st)
            return super(VnTimedText, self).render_blits(render, layout, st)

    def vn_text_shader(look, cps):
        parts = []
        anim = look.get("anim") if cps else None
        if anim:
            # Starts spread over the reveal itself; VnTimedText waits for the
            # latest actual entrance in the selected order, including spans.
            waits, weight = look.get("reveal") or (0.0, 0.0)
            glyphs = waits + (weight / float(cps) if cps else 0.0)
            parts.append(vn_text_anim(anim, glyphs, glyphs))
        loop = look.get("loop")
        strength = float(look.get("loopStrength", 0.0))
        speed = float(look.get("loopSpeed", 1.0))
        if loop == "shake":
            parts.append("jitter:u__jitter=(%.2f, %.2f)" % (strength, strength))
        elif loop == "wave":
            parts.append("wave:u__amplitude=%.2f:u__frequency=%.3f" % (strength, speed))
        elif loop == "pulse":
            parts.append("vn_pulse:u__depth=%.3f:u__frequency=%.3f" % (min(1.0, strength / 100.0), speed))
        if parts and not anim:
            # Once a line uses text shaders, slow text needs one to reveal it.
            parts.insert(0, "vn_typewriter")
        return "|".join(parts) or None

    def vn_apply_text_look(text, kwargs, timing_only=False):
        look = vn_text_look(text)
        # Words kept on screen between lines are already fully shown; they must not type out again.
        retained = vn_text_is_retained(text)
        if retained:
            kwargs["slow"] = False
        leaving = retained and getattr(store, "vn_text_exiting", False) and (look or {}).get("exit")
        if not look:
            return
        if timing_only:
            # The hidden carrier paces the same entrances as visible words.
            # Its colour stays transparent; its shader contributes timing.
            if "cps" in look:
                kwargs["slow_cps"] = look["cps"]
            shader = vn_text_shader(look, look["cps"] if "cps" in look else renpy.game.preferences.text_cps)
            if shader:
                kwargs["textshader"] = shader
            return
        if look.get("font"):
            kwargs["font"] = look["font"]
        if "scale" in look and "size" in kwargs:
            kwargs["size"] = max(1, int(round(kwargs["size"] * look["scale"])))
        for key in ("color", "bold", "italic"):
            if key in look:
                kwargs[key] = look[key]
        if "align" in look:
            kwargs["text_align"] = look["align"]
        if "outlines" in look:
            kwargs["outlines"] = [tuple(outline) for outline in look["outlines"]]
        if "cps" in look and not retained:
            kwargs["slow_cps"] = look["cps"]
        shader = vn_text_shader(look, look["cps"] if "cps" in look else renpy.game.preferences.text_cps)
        if shader:
            kwargs["textshader"] = shader
        if leaving:
            # The words play once more as slow text, driving the exit clock; the line's loop keeps running.
            seconds = float(leaving["anim"].split(",")[6])
            still = vn_text_shader(dict(look, anim=None), 1000.0)
            out = vn_text_anim(leaving["anim"], leaving["count"] / 1000.0, max(0.0, leaving["total"] - seconds), name="vn_anim_out")
            kwargs["slow"], kwargs["slow_cps"] = True, 1000.0
            kwargs["textshader"] = out + ("|" + still.replace("vn_typewriter|", "") if still else "")

    def vn_text_fx_shader(value, look, cps):
        # "entrance@seconds|loop@strength@speed"; "-" follows the line, "none" turns its effect off.
        entrance, _, loop = value.partition("|")
        merged = dict(look or {})
        if entrance != "-":
            merged["anim"] = None if entrance == "none" else entrance
        if loop != "-":
            parts = loop.split("@")
            merged["loop"] = parts[0]
            if len(parts) == 3:
                merged["loopStrength"], merged["loopSpeed"] = float(parts[1]), float(parts[2])
        return vn_text_shader(merged, cps) or "vn_typewriter"

    def vn_text_has_fx(text):
        return any("{vn_fx=" in item for item in (text if isinstance(text, list) else [text]) if isinstance(item, str))

    class VnTypeSound(object):
        # Class attributes are transient: reveal progress never enters a save or a rollback record.
        line = None
        played_to = 0
        last_time = 0.0
        played = 0

    def vn_text_type_sound(sound, st, cps):
        if cps is True or cps is None:
            cps = renpy.game.preferences.text_cps
        if not cps or renpy.config.skipping or getattr(renpy.context(), "_menu", False):
            return
        line = getattr(store, "vn_current_line", None)
        if line != VnTypeSound.line or st + 0.001 < VnTypeSound.last_time:
            VnTypeSound.line, VnTypeSound.played_to = line, 0
        VnTypeSound.last_time = st
        reached = VnTypeSound.played_to
        marks = sound["marks"]
        while reached < len(marks) and marks[reached][0] + marks[reached][1] / float(cps) <= st:
            reached += 1
        # One sound per frame, even when several characters came due together.
        if reached > VnTypeSound.played_to:
            VnTypeSound.played_to = reached
            VnTypeSound.played += 1
            renpy.sound.play(sound["path"], channel="vn_typing", relative_volume=sound["volume"])

    class VNDialogueText(VnTimedText):
        def __init__(self, text, vn_line_style=False, **kwargs):
            if getattr(store, "vn_line_dialogue", None) and store.vn_line_dialogue.get("started") is not None:
                kwargs.setdefault("slow", True)
            self.vn_fx_context = None
            self.vn_type_sound = None
            self.vn_text_leaving = False
            self.vn_timing_only = vn_line_style == "timing"
            self.vn_reveal_timing = bool(vn_line_style and not vn_text_is_retained(text))
            # Visible dialogue takes the line's whole look; the hidden carrier only its timing.
            if vn_line_style:
                vn_apply_text_look(text, kwargs, timing_only=vn_line_style == "timing")
                self.vn_text_leaving = bool(vn_line_style is True and vn_text_is_retained(text) and getattr(store, "vn_text_exiting", False) and (vn_text_look(text) or {}).get("exit"))
                if vn_text_has_fx(text) and not self.vn_text_leaving:
                    # Part-line loops are shader tags, which need the text to use shaders.
                    kwargs["textshader"] = kwargs.get("textshader") or "vn_typewriter"
                    look = vn_text_look(text) or {}
                    self.vn_fx_context = (look, look["cps"] if "cps" in look else renpy.game.preferences.text_cps)
                if vn_line_style is True and not vn_text_is_retained(text):
                    self.vn_type_sound = (vn_text_look(text) or {}).get("typeSound")
            super(VNDialogueText, self).__init__(text, **kwargs)

        def vn_prepare_tokens(self, tokens):
            # Expand {vn_fx} here, not in the string, so Ren'Py still finds its own say text.
            # A part's effect replaces the line's on those words; what it leaves unset follows the line.
            if getattr(self, "vn_text_leaving", False):
                # Leaving words have no waits or speed changes, and share one shader.
                return [(kind, value) for kind, value in tokens if kind != vn_text_tag_kind or value.partition("=")[0] not in ("cps", "/cps", "space", "vn_fx", "/vn_fx")]
            context = getattr(self, "vn_fx_context", None)
            if not context:
                return tokens
            result = []
            for kind, value in tokens:
                if kind == vn_text_tag_kind and value.startswith("vn_fx="):
                    result.append((kind, "shader=" + vn_text_fx_shader(value[6:], context[0], context[1])))
                elif kind == vn_text_tag_kind and value == "/vn_fx":
                    result.append((kind, "/shader"))
                else:
                    result.append((kind, value))
            return result

        def render(self, width, height, st, at):
            data = getattr(store, "vn_line_dialogue", None)
            if data and data.get("started") is not None and not getattr(renpy.context(), "_menu", False):
                interface = renpy.display.interface
                st = max(0.0, vn_bp_clock() - data["started"] + max(0.0, interface.frame_time - (interface.interact_time or interface.frame_time)))
                if data.get("revealed"):
                    st = max(st, 1e9)
            rendered = super(VNDialogueText, self).render(width, height, st, at)
            if getattr(self, "vn_type_sound", None):
                if self.slow:
                    vn_text_type_sound(self.vn_type_sound, st, self.style.slow_cps)
                else:
                    vn_stop_type_sound()
            if getattr(self, "vn_timing_only", False):
                # Local colour tags can override transparent text colour.
                # Preserve layout/timing but expose no ink from this carrier.
                return renpy.display.render.Render(*rendered.get_size())
            return rendered

        def event(self, ev, x, y, st):
            was_slow = self.slow
            try:
                return super(VNDialogueText, self).event(ev, x, y, st)
            finally:
                data = getattr(store, "vn_line_dialogue", None)
                if was_slow and not self.slow and data and data.get("started") is not None:
                    store.vn_line_dialogue = dict(data, revealed=True)
                    renpy.retain_after_load()
                if was_slow and not self.slow and getattr(self, "vn_type_sound", None):
                    vn_stop_type_sound()

    renpy.register_sl_displayable("vn_dialogue_text", VNDialogueText, "text", replaces=True).add_property("vn_line_style").copy_properties("text")

init python:
    renpy.music.register_channel("vn_typing", mixer="sfx", loop=False, stop_on_mute=True)

    def vn_stop_type_sound():
        if renpy.music.get_playing(channel="vn_typing"):
            renpy.music.stop(channel="vn_typing")

    def vn_cleanup_type_sound():
        # Menu contexts can restore their parent's audio on return. Stop the
        # old pulse at interaction boundaries; live reveal starts the next one.
        if getattr(renpy.context(), "_menu", False) or renpy.config.skipping or not getattr(store, "vn_line_dialogue", None) or getattr(store, "vn_current_line", None) != VnTypeSound.line:
            vn_stop_type_sound()

    config.interact_callbacks.append(vn_cleanup_type_sound)

    # History, save excerpts and other plain text show a part-line loop's words without it.
    def vn_text_fx_tag(tag, argument, contents):
        return contents

    config.custom_text_tags["vn_fx"] = vn_text_fx_tag

    # Native typewriter shaders start at the beginning of a glyph's time
    # interval. Our preview, sounds and ordinary unshaded text reveal at its
    # end; keep locally-disabled entrances on that same clock.
    renpy.register_textshader(
        "vn_typewriter",
        include_default=False,
        variables="""
        uniform float u_text_slow_time;
        attribute float a_text_max_time;
        varying float v__time;
        """,
        vertex_200="""
        v__time = a_text_max_time;
        """,
        fragment_350="""
        gl_FragColor *= v__time <= u_text_slow_time ? 1.0 : 0.0;
        """,
    )

    def vn_text_anim_entrance_time(ts, u__duration=0.0, **kwargs):
        ts.extra_slow_time = u__duration

    def vn_text_anim_exit_time(ts, u__duration=0.0, u__spread=0.0, u__begin=0.0, **kwargs):
        ts.extra_slow_time = u__begin + u__spread + u__duration

    # Every entrance and exit: each character moves between its animated state and normal,
    # starting in the chosen order. Mirrors textCharacterFrame and textExitFrame in the editor.
    def vn_text_register_anim(name, leaving):
        renpy.register_textshader(
            name,
            include_default=False,
            adjust_function=vn_text_anim_exit_time if leaving else vn_text_anim_entrance_time,
            variables="""
            uniform vec2 u__offset;
            uniform vec2 u__scale;
            uniform float u__rotation;
            uniform float u__alpha;
            uniform float u__duration;
            uniform float u__ease;
            uniform float u__order;
            uniform float u__glyphs;
            uniform float u__spread;
            uniform float u__begin;
            uniform float u_text_slow_time;
            uniform float u_text_to_drawable;
            attribute vec2 a_text_center;
            attribute float a_text_max_time;
            attribute float a_text_index;
            varying float v__alpha;
            """,
            vertex_25="""
            float l__place = u__glyphs > 0.0 ? clamp(a_text_max_time / u__glyphs, 0.0, 1.0) : 0.0;
            float l__seq = l__place;
            if (u__order > 3.5) {
                float l__hash = mod(mod(floor(a_text_index), 4093.0) * 109.0 + 37.0, 4093.0);
                l__seq = mod(l__hash * l__hash + 17.0, 4093.0) / 4093.0;
            }
            else if (u__order > 2.5) l__seq = 1.0 - abs(2.0 * l__place - 1.0);
            else if (u__order > 1.5) l__seq = abs(2.0 * l__place - 1.0);
            else if (u__order > 0.5) l__seq = 1.0 - l__place;
            float l__start = u__begin + l__seq * u__spread;
            float l__t = u__duration > 0.0 ? clamp((u_text_slow_time - l__start) / u__duration, 0.0, 1.0) : (u_text_slow_time >= l__start ? 1.0 : 0.0);
            float l__e = l__t;
            if (u__ease > 5.5) l__e = l__t <= 0.0 ? 0.0 : l__t >= 1.0 ? 1.0 : pow(2.0, -10.0 * l__t) * sin((l__t * 10.0 - 0.75) * 2.0943951) + 1.0;
            else if (u__ease > 4.5) {
                if (l__t < 0.36363636) l__e = 7.5625 * l__t * l__t;
                else if (l__t < 0.72727273) { float l__u = l__t - 0.54545455; l__e = 7.5625 * l__u * l__u + 0.75; }
                else if (l__t < 0.90909091) { float l__u = l__t - 0.81818182; l__e = 7.5625 * l__u * l__u + 0.9375; }
                else { float l__u = l__t - 0.95454545; l__e = 7.5625 * l__u * l__u + 0.984375; }
            }
            else if (u__ease > 3.5) { float l__u = l__t - 1.0; l__e = 1.0 + 2.70158 * l__u * l__u * l__u + 1.70158 * l__u * l__u; }
            else if (u__ease > 2.5) l__e = l__t < 0.5 ? 2.0 * l__t * l__t : 1.0 - pow(2.0 - 2.0 * l__t, 2.0) / 2.0;
            else if (u__ease > 1.5) l__e = l__t * l__t;
            else if (u__ease > 0.5) l__e = 1.0 - (1.0 - l__t) * (1.0 - l__t);
            """ + ("""
            float l__amount = 1.0 - l__e;
            float l__shown = l__t >= 1.0 ? 0.0 : 1.0;
            """ if leaving else """
            float l__amount = l__e;
            float l__shown = u_text_slow_time >= l__start ? 1.0 : 0.0;
            """) + """
            float l__left = 1.0 - l__amount;
            vec2 l__part = (gl_Position.xy - a_text_center) * mix(u__scale, vec2(1.0, 1.0), l__amount);
            float l__angle = u__rotation * l__left;
            float l__cos = cos(l__angle);
            float l__sin = sin(l__angle);
            gl_Position.xy = a_text_center + vec2(l__part.x * l__cos - l__part.y * l__sin, l__part.x * l__sin + l__part.y * l__cos) + u__offset * l__left * u_text_to_drawable;
            v__alpha = clamp(mix(u__alpha, 1.0, l__amount), 0.0, 1.0) * l__shown;
            """,
            fragment_350="""
            gl_FragColor = gl_FragColor * v__alpha;
            """,
            u__offset=(0.0, 0.0),
            u__scale=(1.0, 1.0),
            u__rotation=0.0,
            u__alpha=0.0,
            u__duration=0.25,
            u__ease=0.0,
            u__order=0.0,
            u__glyphs=0.0,
            u__spread=0.0,
            u__begin=0.0,
        )

    vn_text_register_anim("vn_anim", False)
    vn_text_register_anim("vn_anim_out", True)

    # The whole line brightens and dims; depth is the share of opacity that varies.
    renpy.register_textshader(
        "vn_pulse",
        variables="""
        uniform float u__depth;
        uniform float u__frequency;
        uniform float u_time;
        """,
        fragment_400="""
        gl_FragColor = gl_FragColor * (1.0 - u__depth * (0.5 - 0.5 * cos(6.28318530718 * u_time * u__frequency)));
        """,
        u__depth=0.4,
        u__frequency=1.0,
        redraw=0.0,
    )

    def vn_text_play_exit():
        # The player has advanced: play the words' exit before the next statement. A click cuts it short.
        global vn_retained_dialogue
        leaving = (store.vn_retained_look or {}).get("exit")
        if not leaving or vn_retained_dialogue is None or not vn_interface_visible or vn_performance_active or renpy.is_skipping() or renpy.game.after_rollback:
            return
        store.vn_showing_retained, store.vn_text_exiting = True, True
        renpy.show_screen("say", who=vn_retained_dialogue[0], what=vn_retained_dialogue[1], _transient=True)
        renpy.pause(leaving["total"])
        store.vn_text_exiting = False
        # The words have gone; nothing stays on screen for the next statement to retain.
        vn_retained_dialogue = None

    def vn_line_text_place(what=None):
        look = vn_text_look(what)
        return look.get("place") if look else None

    def vn_start_dialogue():
        global vn_line_dialogue, vn_retained_dialogue, vn_current_voice_log
        data = vn_line_dialogue
        if not data or data.get("started") is not None:
            return
        vn_line_dialogue = dict(data, started=vn_bp_clock())
        store.vn_showing_retained = False
        character = getattr(store, "vn_character_" + data["speaker"], narrator) if data["speaker"] else narrator
        vn_current_voice_log = data.get("voiceLog")
        if data.get("voice"):
            vn_unlock(data["voice"])
            voice(vn_bp_asset(data["voice"], "audio"))
        renpy.say(character, data["text"], interact=False, _call_done=False)
        vn_retained_dialogue = (character.name, data["text"])

    def vn_early_voice_sustain():
        if vn_line_dialogue and vn_line_dialogue.get("started") is not None and not getattr(renpy.context(), "_menu", False):
            voice_sustain()

    config.start_interact_callbacks.insert(0, vn_early_voice_sustain)
`;
