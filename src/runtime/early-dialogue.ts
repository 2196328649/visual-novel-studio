/** Keep native say/history/voice handling, with one clock across the intervening stage actions. */
export const earlyDialogueRuntime = `
default vn_line_dialogue = None

python early:
    class VNDialogueText(renpy.text.text.Text):
        def __init__(self, text, **kwargs):
            if getattr(store, "vn_line_dialogue", None) and store.vn_line_dialogue.get("started") is not None:
                kwargs.setdefault("slow", True)
            super(VNDialogueText, self).__init__(text, **kwargs)

        def render(self, width, height, st, at):
            data = getattr(store, "vn_line_dialogue", None)
            if data and data.get("started") is not None and not getattr(renpy.context(), "_menu", False):
                interface = renpy.display.interface
                st = max(0.0, vn_bp_clock() - data["started"] + max(0.0, interface.frame_time - (interface.interact_time or interface.frame_time)))
                if data.get("revealed"):
                    st = max(st, 1e9)
            return super(VNDialogueText, self).render(width, height, st, at)

        def event(self, ev, x, y, st):
            was_slow = self.slow
            try:
                return super(VNDialogueText, self).event(ev, x, y, st)
            finally:
                data = getattr(store, "vn_line_dialogue", None)
                if was_slow and not self.slow and data and data.get("started") is not None:
                    store.vn_line_dialogue = dict(data, revealed=True)
                    renpy.retain_after_load()

    renpy.register_sl_displayable("vn_dialogue_text", VNDialogueText, "text", replaces=True).copy_properties("text")

init python:
    def vn_start_dialogue():
        global vn_line_dialogue, vn_retained_dialogue, vn_current_voice_log
        data = vn_line_dialogue
        if not data or data.get("started") is not None:
            return
        vn_line_dialogue = dict(data, started=vn_bp_clock())
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
