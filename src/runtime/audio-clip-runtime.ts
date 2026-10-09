/** Saved logical clocks reconstruct clipped audio after load/rollback; media channels are reused. */
export function createAudioClipRuntime(): string {
  return `default vn_audio_clips = {}

init python:
    for _vn_bus, _vn_mixer in (("music", "music"), ("sound", "sfx"), ("voice", "voice")):
        config.auto_channels["vn_clip_" + _vn_bus] = (_vn_mixer, "", "")

    def vn_audio_clip_channel(channel, bus):
        if not renpy.music.channel_defined(channel):
            # Numbered auto-channel names can be allocated on demand by Ren'Py.
            renpy.music.register_channel(channel, mixer={"music": "music", "sound": "sfx", "voice": "voice"}[bus], loop=False, stop_on_mute=False)

    def vn_audio_clip_inputs(template, values):
        data = dict(template)
        for key, value in values.items():
            if key == "assetId":
                if value:
                    data[key] = value
            else:
                data[key] = vn_bp_number(value, 0, 1 if key == "volume" else None, key)
        if data["assetId"] != template["assetId"]:
            data.pop("sourceDuration", None)
        if "sourceDuration" in data:
            data["duration"] = min(data["duration"], max(0.0, data["sourceDuration"] - data["offset"]))
        return data

    def vn_audio_clip_gain(state):
        elapsed, duration = state["elapsed"], state["duration"]
        if elapsed >= duration:
            return 0.0
        enter = min(duration, state["fadeIn"])
        leave = min(duration, state["fadeOut"])
        return state["volume"] * (min(1.0, elapsed / enter) if enter else 1.0) * (min(1.0, (duration - elapsed) / leave) if leave else 1.0)

    def vn_audio_clip_resume(channel, state):
        vn_audio_clip_channel(channel, state["bus"])
        renpy.music.set_volume(vn_audio_clip_gain(state), channel=channel)
        filename = "<from %.9f to %.9f>%s" % (state["offset"] + state["elapsed"], state["offset"] + state["duration"], state["path"])
        renpy.music.play(filename, channel=channel, loop=False, fadeout=0)

    def vn_audio_clip_tick():
        now = renpy.display.core.get_time()
        cached = getattr(vn_audio_clip_tick, "samples", {})
        samples = {}
        for channel in cached:
            if channel not in vn_audio_clips:
                renpy.music.stop(channel=channel, fadeout=0)
        for channel, current in list(vn_audio_clips.items()):
            sample = cached.get(channel)
            restored = not sample or sample[0] is not current
            elapsed = current["elapsed"] + (0.0 if restored else max(0.0, now - sample[1]))
            state = dict(current, elapsed=min(current["duration"], elapsed))
            vn_audio_clip_channel(channel, state["bus"])
            if elapsed >= state["duration"]:
                renpy.music.stop(channel=channel, fadeout=0)
                vn_audio_clips.pop(channel, None)
            else:
                if restored:
                    vn_audio_clip_resume(channel, state)
                renpy.music.set_volume(vn_audio_clip_gain(state), channel=channel)
                vn_audio_clips[channel] = state
                samples[channel] = (state, now)
        vn_audio_clip_tick.samples = samples
        if cached or samples:
            # Timers update between script checkpoints; save the heard position,
            # rather than rolling back to the start of the current pause on load.
            renpy.retain_after_load()

    def vn_audio_clip_play(data):
        global vn_performance_audio_channels
        data = vn_audio_clip_inputs(data, {})
        vn_audio_clip_tick()
        if data["duration"] <= 0:
            return
        prefix = "vn_clip_" + data["bus"] + " "
        index = 0
        while prefix + str(index) in vn_audio_clips:
            index += 1
        channel = prefix + str(index)
        state = dict(data, path=vn_bp_asset(data["assetId"], "audio"), elapsed=0.0)
        vn_audio_clips[channel] = state
        if vn_performance_active:
            vn_performance_audio_channels = vn_performance_audio_channels + [channel]
            vn_performance_extend(data["duration"])
        vn_audio_clip_resume(channel, state)
        samples = getattr(vn_audio_clip_tick, "samples", {})
        samples[channel] = (state, renpy.display.core.get_time())
        vn_audio_clip_tick.samples = samples
        renpy.retain_after_load()

    def vn_audio_clip_restore():
        for channel in getattr(vn_audio_clip_tick, "samples", {}):
            renpy.music.stop(channel=channel, fadeout=0)
        vn_audio_clip_tick.samples = {}

    config.after_load_callbacks.append(vn_audio_clip_restore)

screen vn_audio_clip_clock():
    timer 0.016 repeat True action Function(vn_audio_clip_tick, _update_screens=False)

init python:
    config.always_shown_screens.append("vn_audio_clip_clock")
`;
}
