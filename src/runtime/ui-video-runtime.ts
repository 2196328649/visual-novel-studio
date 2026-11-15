import { declaredUiComponents, type Project } from '../core/model';
import { projectGraphs } from '../core/project-resources';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { pythonLiteral } from './literals';

export const uiVideoDefaults = 'default vn_ui_video_states = {}\ndefault vn_ui_video_recovery = {}\n';
export function createUiVideoRuntime(project: Project): string {
  const videos = Object.fromEntries(declaredUiComponents(project).filter(c => c.kind === 'video').map((c, index) => {
    const pageId = c.page === 'custom' ? project.ui.customPages.find(page => page.components.some(item => item.id === c.id))!.id : 'ui:' + c.page;
    const handlers = Object.fromEntries(['ended', 'failed'].map(trigger => [trigger, projectGraphs(project).flatMap(g => uiGraphOnPage(project, g, pageId) ? g.nodes.filter(n => n.type === 'eventVideo' && n.properties.componentId === c.id && n.properties.trigger === trigger && uiEventInActiveInstance(project, n)).map(n => [g.id, n.id]) : [])]));
    return [c.id, { pageId, channel: 'vn_ui_video_' + index, handlers }];
  }));
  return `    vn_ui_videos = ${pythonLiteral(videos)}

    for _vn_video in vn_ui_videos.values():
        renpy.music.register_channel(_vn_video["channel"], config.movie_mixer, loop=False, stop_on_mute=False, movie=True)

    def vn_ui_video_live():
        # Decoder objects, textures and displayables never enter save state.
        if not hasattr(vn_ui_video_poll, "live"): vn_ui_video_poll.live = {}
        return vn_ui_video_poll.live

    def vn_ui_video_next(value):
        if type(value) is not int or not 0 <= value < 9007199254740991:
            raise Exception("视频请求序号超出安全范围，请明确重置控件。")
        return value + 1

    def vn_ui_video_problem(record):
        import math
        if not isinstance(record, dict) or type(record.get("version")) is not int or record["version"] != 1:
            return "视频运行记录版本不受支持，请明确重置控件并保留原记录。"
        if any(type(record.get(key)) is not int or not 0 <= record[key] <= 9007199254740991 for key in ("sequence", "sourceSequence", "lastSample", "pageInstance")):
            return "视频运行记录的请求序号无效，请明确重置控件。"
        if (not isinstance(record.get("assetId"), str) or not isinstance(record.get("error"), str) or record.get("owner") is None
            or record.get("mode") not in ("playing", "paused", "stopped") or record.get("status") not in ("empty", "loading", "playing", "paused", "stopped", "ended", "failed")
            or any(type(record.get(key)) is not bool for key in ("loop", "suspended", "durationKnown"))
            or any(type(record.get(key)) not in (int, float) or not math.isfinite(record[key]) or record[key] < 0 for key in ("position", "duration"))):
            return "视频运行记录内容无效，请明确重置控件。"
        if record["durationKnown"] and (record["duration"] <= 0 or record["position"] > record["duration"]) or not record["durationKnown"] and record["duration"] != 0:
            return "视频时间记录无效，请明确重置控件。"
        if type(record.get("eventPending", False)) is not bool or record.get("eventPending", False) and record["status"] not in ("ended", "failed"):
            return "视频事件记录无效，请明确重置控件。"
        return None

    def vn_ui_video_visible(component_id, task, rows=None, get=None):
        if not task or not vn_bp_task_alive(task) or not vn_ui_image_visible(component_id, get): return False
        native = task.get("native")
        if native:
            screen = vn_ui_native_page_screen(native)
            if screen is None or renpy.get_screen(tuple(native["screen"]), layer=native["layer"]) is not screen: return False
        elif task.get("minigame") is None and task.get("page") not in vn_ui_visible_page_order():
            return False
        rows = vn_ui_layout_for_components((component_id,), get) if rows is None else rows
        row = rows.get(component_id)
        return bool(row and not row["clippedOut"])

    def vn_ui_video_fresh(component_id, task, owner, previous=None, get=None):
        get = get or vn_ui_get
        same = previous is not None and previous.get("owner") is owner
        source = get(component_id, "video") or ""
        token = task.get("pageToken")
        return dict(version=1, owner=owner, pageInstance=token if type(token) is int else 0, assetId=source,
            sequence=vn_ui_video_next(previous["sequence"]) if same else 1,
            sourceSequence=vn_ui_video_next(previous["sourceSequence"]) if same else 1, lastSample=0,
            mode="playing" if source else "stopped", status="loading" if source else "empty",
            loop=bool(get(component_id, "videoLoop")), suspended=False, position=0.0, duration=0.0, durationKnown=False, error="", eventPending=False)

    def vn_ui_video_snapshot(component_id, task=None, rows=None, strict=False, get=None):
        get = get or vn_ui_get
        if component_id not in vn_ui_videos: raise Exception("请选择视频组件。")
        task = task or vn_bp_task_create(vn_ui_videos[component_id]["pageId"], create_native=False)
        owner = vn_ui_image_owner(task)
        old = vn_ui_video_states.get(component_id)
        problem = vn_ui_video_problem(old) if old is not None else None
        if problem and strict: raise Exception(problem)
        if owner is None:
            if strict: raise Exception("视频所在页面实例已经关闭或尚未显示。")
            return dict(status="empty", mode="stopped", suspended=False, position=0.0, duration=0.0, durationKnown=False, error=problem or "")
        if problem:
            row = vn_ui_video_fresh(component_id, task, owner, get=get)
            return dict(row, status="failed", mode="stopped", error=problem)
        source = get(component_id, "video") or ""
        row = old if old and old.get("owner") is owner and old.get("assetId") == source else vn_ui_video_fresh(component_id, task, owner, old, get)
        loop = bool(get(component_id, "videoLoop"))
        if row["loop"] != loop: row = dict(row, loop=loop, sequence=vn_ui_video_next(row["sequence"]), lastSample=0)
        suspended = not vn_ui_video_visible(component_id, task, rows, get)
        if row["suspended"] != suspended:
            status = row["status"] if row["mode"] == "stopped" or row["status"] in ("empty", "ended", "failed") else "paused" if suspended or row["mode"] == "paused" else "loading"
            row = dict(row, suspended=suspended, status=status, sequence=vn_ui_video_next(row["sequence"]), lastSample=0)
        return row

    def vn_ui_video_get(component_id, property):
        row = vn_ui_video_snapshot(component_id)
        live = vn_ui_video_live().get(component_id)
        status = row["status"]
        # A restored saved status is not proof that the decoder has restarted.
        if status == "playing" and (not live or not live.get("started") or live.get("assetId") != row.get("assetId") or live.get("sourceSequence") != row.get("sourceSequence")
            or row.get("sequence", 0) <= live.get("sequence", 0) and live.get("record") is not vn_ui_video_states.get(component_id)):
            status = "loading"
        values = dict(videoStatus=status, videoPlaying=status == "playing" and row["mode"] == "playing" and not row["suspended"],
            videoPaused=status == "paused", videoPosition=row["position"], videoDuration=row["duration"], videoDurationKnown=row["durationKnown"],
            videoProgress=min(1.0, max(0.0, row["position"] / row["duration"])) if row["durationKnown"] else 0.0,
            videoError=row["error"], videoCanSeek=False)
        return values[property]

    def vn_ui_video_store(component_id, row):
        if vn_ui_video_states.get(component_id) is not row:
            vn_ui_video_states[component_id] = row
            renpy.retain_after_load()

    def vn_ui_video_sync(component_id):
        if component_id in vn_ui_videos:
            task = vn_bp_task_create(vn_ui_videos[component_id]["pageId"], create_native=False)
            if vn_ui_image_owner(task) is None: return
            row = vn_ui_video_snapshot(component_id, task, strict=True)
            vn_ui_video_store(component_id, row)

    def vn_ui_video_control(component_id, operation, value=None):
        if operation not in ("play", "pause", "stop") or value is not None and type(value) is not bool:
            raise Exception("视频播放操作或开关参数无效。")
        row = vn_ui_video_snapshot(component_id, strict=True)
        if not row["assetId"]:
            if operation == "play": raise Exception("视频控件尚未设置视频素材。")
            return
        original_sequence = row["sequence"]
        live = vn_ui_video_live().get(component_id)
        if live and live.get("started") and live.get("record") is vn_ui_video_states.get(component_id) and row["mode"] == "playing" and not row["suspended"]:
            if operation == "pause" and (value is None or value):
                renpy.music.set_pause(True, channel=vn_ui_videos[component_id]["channel"])
            position = renpy.music.get_pos(channel=vn_ui_videos[component_id]["channel"])
            if position is not None:
                position = max(0.0, float(position))
                row = dict(row, position=min(row["duration"], position) if row["durationKnown"] else position)
        if operation == "stop":
            if row["mode"] != "stopped" or row["status"] != "stopped":
                row = dict(row, mode="stopped", status="stopped", position=0.0, error="", eventPending=False, sequence=vn_ui_video_next(row["sequence"]), lastSample=0)
        elif operation == "pause":
            if row["mode"] != "stopped" and row["status"] not in ("ended", "failed"):
                mode = "paused" if value is None or value else "playing"
                if mode != row["mode"]:
                    row = dict(row, mode=mode, status="paused" if mode == "paused" or row["suspended"] else "loading", sequence=vn_ui_video_next(row["sequence"]), lastSample=0)
        else:
            restart = bool(value) or row["mode"] == "stopped" or row["status"] in ("ended", "failed")
            if restart or row["mode"] != "playing":
                row = dict(row, mode="playing", status="paused" if row["suspended"] else "loading", error="", eventPending=False, sequence=vn_ui_video_next(row["sequence"]), lastSample=0)
                if restart: row.update(sourceSequence=vn_ui_video_next(row["sourceSequence"]), position=0.0, duration=0.0, durationKnown=False)
        old = vn_ui_video_states.get(component_id)
        vn_ui_video_store(component_id, row)
        if live and live.get("record") is old and row["sequence"] == original_sequence == live.get("sequence"):
            live["record"] = row
        renpy.restart_interaction()

    def vn_ui_video_release(component_id):
        old = vn_ui_video_states.get(component_id)
        if old is not None and vn_ui_video_problem(old): vn_ui_video_recovery[component_id] = old
        if component_id in vn_ui_videos:
            renpy.music.stop(channel=vn_ui_videos[component_id]["channel"], fadeout=0)
        vn_ui_video_states.pop(component_id, None)
        vn_ui_video_live().pop(component_id, None)

    def vn_ui_video_reset(component_id):
        if component_id not in vn_ui_videos: return
        old = vn_ui_video_states.get(component_id)
        if old is not None and vn_ui_video_problem(old):
            vn_ui_video_recovery[component_id] = old
            vn_ui_video_release(component_id)
        task = vn_bp_task_create(vn_ui_videos[component_id]["pageId"], create_native=False)
        if vn_ui_image_owner(task) is None:
            vn_ui_video_release(component_id)
            return
        row = vn_ui_video_snapshot(component_id, task, strict=True)
        if row["assetId"]:
            row = dict(row, mode="playing", status="paused" if row["suspended"] else "loading", error="", eventPending=False, position=0.0,
                duration=0.0, durationKnown=False, sequence=vn_ui_video_next(row["sequence"]), sourceSequence=vn_ui_video_next(row["sourceSequence"]), lastSample=0)
        vn_ui_video_store(component_id, row)

    def vn_ui_video_presence(component_id):
        task = vn_bp_task_create(vn_ui_videos[component_id]["pageId"], create_native=False)
        owner = vn_ui_image_owner(task)
        if owner is None: return None
        live = vn_ui_video_live().get(component_id)
        if not live or live.get("owner") is not owner:
            live = dict(owner=owner, task=task, started=False, decoded=False, sequence=0, sourceSequence=0, record=None, queuedLoop=False, error="")
            vn_ui_video_live()[component_id] = live
        return live

    def vn_ui_video_poll():
        import math
        if getattr(vn_ui_video_poll, "running", False): return
        vn_ui_video_poll.running = True
        completions = []
        try:
            rows = vn_ui_layout_for_components(vn_ui_video_live())
            for component_id, live in list(vn_ui_video_live().items()):
                task = live["task"]
                if not vn_bp_task_alive(task) or live["owner"] is not vn_ui_image_owner(task):
                    # A late old-owner cleanup must not clear a newly opened page.
                    current = vn_ui_video_states.get(component_id)
                    if isinstance(current, dict) and current.get("owner") is live["owner"]:
                        vn_ui_video_release(component_id)
                    else:
                        renpy.music.stop(channel=vn_ui_videos[component_id]["channel"], fadeout=0)
                        if vn_ui_video_live().get(component_id) is live: vn_ui_video_live().pop(component_id, None)
                    continue
                old = vn_ui_video_states.get(component_id)
                if old is not None and vn_ui_video_problem(old):
                    renpy.music.stop(channel=vn_ui_videos[component_id]["channel"], fadeout=0)
                    live["started"] = False
                    continue
                row = vn_ui_video_snapshot(component_id, task, rows, strict=True)
                channel = vn_ui_videos[component_id]["channel"]
                terminal_before = row["status"] in ("ended", "failed")
                try:
                    source_changed = live.get("assetId") != row["assetId"] or live.get("sourceSequence") != row["sourceSequence"]
                    restored = live.get("record") is not old and row["sequence"] <= live.get("sequence", 0)
                    if source_changed or restored:
                        renpy.music.stop(channel=channel, fadeout=0)
                        live.update(started=False, decoded=False, queuedLoop=False, error="")
                    if not row["assetId"] or row["mode"] == "stopped" or terminal_before:
                        if live["started"]: renpy.music.stop(channel=channel, fadeout=0)
                        live["started"] = False
                    elif row["suspended"]:
                        if live["started"]:
                            position = renpy.music.get_pos(channel=channel)
                            if position is not None:
                                row = dict(row, position=min(row["duration"], max(0.0, float(position))) if row["durationKnown"] else max(0.0, float(position)))
                            renpy.music.set_pause(True, channel=channel)
                    else:
                        flow_held = vn_game_flow_transition_media_held(task, row["loop"])
                        was_flow_held = live.get("flowHeld", False)
                        if was_flow_held and not flow_held and live["started"]:
                            # Resume this new page's clip from its authored start,
                            # keeping the decoded first texture until replacement.
                            renpy.music.play(live["path"], channel=channel, loop=False, fadeout=0, synchro_start=True)
                            live["queuedLoop"] = False
                        live["flowHeld"] = flow_held
                        if not live["started"]:
                            if renpy.game.preferences.video_image_fallback is True:
                                raise Exception("当前播放器设置禁用了视频解码，已使用封面。")
                            filename = vn_bp_asset(row["assetId"], "video")
                            if not renpy.loadable(filename): raise Exception("视频文件不存在或无法读取。")
                            start = ("<from %.9f>" % row["position"]) + filename if row["position"] > 0 else filename
                            # Do not loop a file until an actual frame is decoded.
                            renpy.music.play(start, channel=channel, loop=False, fadeout=0, synchro_start=True, relative_volume=0.0 if flow_held else 1.0)
                            live.update(started=True, decoded=False, queuedLoop=False, path=filename, error="")
                        renpy.music.set_pause(row["mode"] == "paused" or flow_held and live["decoded"], channel=channel)
                        playing = renpy.music.get_playing(channel=channel)
                        position, duration = renpy.music.get_pos(channel=channel), renpy.music.get_duration(channel=channel)
                        known = type(duration) in (int, float) and math.isfinite(duration) and duration > 0
                        changes = {}
                        if known: changes.update(duration=float(duration), durationKnown=True, position=min(float(duration), row["position"]))
                        # An accepted pause owns its sampled position. A delayed
                        # decoder tick (or a freshly restored paused decoder) must
                        # not overwrite the saved position while author-paused.
                        if not flow_held and row["mode"] != "paused" and position is not None and type(position) in (int, float) and math.isfinite(position):
                            limit = duration if known else row["duration"] if row["durationKnown"] else None
                            changes["position"] = min(limit, max(0.0, float(position))) if limit is not None else max(0.0, float(position))
                        if live.get("error"): raise Exception(live["error"])
                        if flow_held:
                            changes.update(position=0.0, status="paused" if live["decoded"] else "loading")
                        elif playing is None:
                            if live["decoded"]:
                                if row["loop"]:
                                    renpy.music.play(live["path"], channel=channel, loop=False, fadeout=0, synchro_start=True)
                                    live["queuedLoop"] = False
                                    changes.update(position=0.0, status="loading")
                                else:
                                    changes["status"] = "ended"
                                    if known or row["durationKnown"]: changes["position"] = float(duration) if known else row["duration"]
                            else:
                                raise Exception("视频无法读取或解码，没有得到可显示的视频帧。")
                        else:
                            if row["mode"] == "paused": changes["status"] = "paused"
                            elif live["decoded"]: changes["status"] = "playing"
                            if live["queuedLoop"] != row["loop"] and (live["decoded"] or not row["loop"]):
                                renpy.music.queue([live["path"]] if row["loop"] else [], channel=channel, loop=row["loop"], clear_queue=True)
                                live["queuedLoop"] = row["loop"]
                        if any(row.get(key) != value for key, value in changes.items()):
                            row = dict(row, **changes)
                            row["lastSample"] = vn_ui_video_next(row["lastSample"])
                except Exception as error:
                    renpy.music.stop(channel=channel, fadeout=0)
                    live["started"] = False
                    row = dict(row, status="failed", error=str(error)[:2000], lastSample=vn_ui_video_next(row["lastSample"]))
                if not terminal_before and row["status"] in ("ended", "failed"):
                    row = dict(row, eventPending=True)
                if row.get("eventPending", False) and vn_game_flow_transition_media_events_ready(task):
                    completions.append((component_id, task, row))
                vn_ui_video_store(component_id, row)
                live.update(record=row, assetId=row["assetId"], sourceSequence=row["sourceSequence"], sequence=row["sequence"])
            # No author code runs during prediction/render or on the audio thread.
            for component_id, task, row in completions:
                if vn_ui_video_states.get(component_id) is not row or not vn_bp_task_alive(task) or not vn_game_flow_transition_media_events_ready(task): continue
                # Consume only this event, immediately before its callbacks.
                # A save in an earlier callback must retain later pending ones.
                previous, row = row, dict(row, eventPending=False)
                vn_ui_video_store(component_id, row)
                live = vn_ui_video_live().get(component_id)
                if live and live.get("record") is previous: live["record"] = row
                payload = {key: row[key] for key in ("assetId", "position", "duration", "durationKnown", "error")}
                focus = vn_ui_focus_snapshot()
                for graph_id, node_id in vn_ui_videos[component_id]["handlers"].get(row["status"], []):
                    if not vn_bp_task_alive(task): break
                    vn_run_blueprint(graph_id, node_id, {node_id: payload}, page_id=vn_ui_videos[component_id]["pageId"])
                if vn_bp_task_alive(task): vn_ui_restore_focus(focus)
        finally:
            vn_ui_video_poll.running = False

    def vn_ui_videos_after_load():
        for component_id in vn_ui_videos:
            renpy.music.stop(channel=vn_ui_videos[component_id]["channel"], fadeout=0)
        vn_ui_video_live().clear()

    config.after_load_callbacks.insert(0, vn_ui_videos_after_load)

    class VnUiVideoSurface(renpy.Displayable):
        def __init__(self, component_id, width, height, **properties):
            super(VnUiVideoSurface, self).__init__(**properties)
            self.component_id, self.width, self.height = component_id, max(0, int(width)), max(0, int(height))
            self.movie = Movie(channel=vn_ui_videos[component_id]["channel"], size=(self.width, self.height))
            poster = vn_bp_optional_asset(vn_ui_get(component_id, "videoPoster"), "image")
            self.poster = Transform(Image(poster), xysize=(self.width, self.height)) if poster else None

        def visit(self):
            return [self.movie] + ([self.poster] if self.poster is not None else [])

        def per_interact(self):
            renpy.redraw(self, 0)

        def render(self, width, height, st, at):
            result = renpy.Render(self.width, self.height)
            # Presence/decoder flags are transient; no saved state is created.
            live = vn_ui_video_presence(self.component_id)
            row = vn_ui_video_states.get(self.component_id)
            usable = live and row and live.get("record") is row and not vn_ui_video_problem(row) and live["started"] and row["status"] not in ("empty", "stopped", "ended", "failed")
            frame = None
            if usable:
                try:
                    texture, decoded = renpy.display.video.get_movie_texture(vn_ui_videos[self.component_id]["channel"])
                    if decoded: live["decoded"] = True
                    if decoded and vn_game_flow_transition_media_held(live["task"], row["loop"]):
                        renpy.music.set_pause(True, channel=vn_ui_videos[self.component_id]["channel"])
                    if texture is not None and live["decoded"]:
                        frame = renpy.render(self.movie, self.width, self.height, st, at)
                except Exception as error:
                    live["error"] = str(error)[:2000]
            if frame is not None:
                result.blit(frame, (0, 0))
            elif self.poster is not None:
                try: result.blit(renpy.render(self.poster, self.width, self.height, st, at), (0, 0))
                except Exception: pass
            renpy.redraw(self, .05)
            return result

        def event(self, ev, x, y, st):
            vn_ui_video_poll()
            return None
`;
}
