import type { Project } from '../core/model';
import { storyVoiceEntries } from '../core/story-menu';
import { defaultVoiceRemoveMessage } from '../core/voice-preview';
import { pythonLiteral } from './literals';

export function createStoryMenuRuntime(project: Project): string {
  const nodes = Object.fromEntries(project.nodes.map(node => [node.id, { chapterId: project.scenes.find(scene => scene.id === node.sceneId)?.chapterId, label: `vn_node_${node.id}` }]));
  const voices = Object.fromEntries(storyVoiceEntries(project).map(asset => [asset.path.replaceAll('\\', '/'), { id: asset.id, assetId: asset.id, speakerId: asset.speakerId, caption: asset.caption, text: asset.text }]));
  const voicePaths = Object.fromEntries(project.assets.filter(asset => asset.kind === 'audio').map(asset => [asset.id, asset.path.replaceAll('\\', '/')]));
  return `default persistent.vn_seen_nodes = []
default persistent.vn_seen_chapters = []
default persistent.vn_favorite_voices = []
default persistent.vn_voice_collection = []
default persistent.vn_voice_favorite_order = []
default vn_current_voice_log = None
default vn_replay_voice_identity = None

init python:
    vn_story_nodes = ${pythonLiteral(nodes)}
    vn_story_first_chapter = ${pythonLiteral(project.chapters[0]?.id)}
    vn_story_entry = ${pythonLiteral(project.entryId)}
    vn_voice_metadata = ${pythonLiteral(voices)}
    vn_voice_asset_paths = ${pythonLiteral(voicePaths)}
    renpy.music.register_channel("vn_replayvoice", mixer="voice", loop=False)

    def vn_cleanup_replayed_voice():
        global vn_replay_voice_identity
        # Returning from a game-menu context restores its parent's audio state.
        # Enforce preview lifetime after that return, including Escape and loads.
        if not renpy.get_screen("history") and not renpy.get_screen("voice_collection") and renpy.music.get_playing(channel="vn_replayvoice"):
            renpy.music.stop(channel="vn_replayvoice")
        if not renpy.music.get_playing(channel="vn_replayvoice"):
            vn_replay_voice_identity = None

    config.interact_callbacks.append(vn_cleanup_replayed_voice)

    @renpy.pure
    class VnSkip(Skip):
        def __init__(self, fast=False, confirm=False, unseen=False):
            super(VnSkip, self).__init__(fast=fast, confirm=confirm)
            self.unseen = unseen

        def get_sensitive(self):
            return config.allow_skipping and _skipping and not main_menu

        def __call__(self):
            if not self.get_sensitive():
                return
            if not config.skipping:
                if self.unseen:
                    _preferences.skip_unseen = True
                elif not Skip(fast=self.fast).get_sensitive():
                    return renpy.display.behavior.run(Confirm("当前为“仅跳过已读”。改为跳过全部并开始跳过吗？", VnSkip(fast=self.fast, unseen=True)))
            return super(VnSkip, self).__call__()

    def vn_mark_story_visit(node_id):
        chapter_id = vn_story_nodes.get(node_id, {}).get("chapterId")
        changed = False
        if node_id not in persistent.vn_seen_nodes:
            persistent.vn_seen_nodes = persistent.vn_seen_nodes + [node_id]
            changed = True
        if chapter_id and chapter_id not in persistent.vn_seen_chapters:
            persistent.vn_seen_chapters = persistent.vn_seen_chapters + [chapter_id]
            changed = True
        if changed:
            renpy.save_persistent()

    def vn_story_unlocked(kind, identity, locked=True):
        if not locked:
            return True
        if kind == "chapterList":
            return identity == vn_story_first_chapter or identity in persistent.vn_seen_chapters
        return identity == vn_story_entry or identity in persistent.vn_seen_nodes

    def vn_story_caption(kind, identity, caption, options):
        if not vn_story_unlocked(kind, identity, options.get("lockUnread", False)):
            return "未解锁章节" if kind == "chapterList" else "未到达"
        if not options.get("showProgress", False):
            return caption
        current = (vn_story_nodes.get(vn_current_node, {}).get("chapterId") == identity) if kind == "chapterList" else vn_current_node == identity
        seen = identity in (persistent.vn_seen_chapters if kind == "chapterList" else persistent.vn_seen_nodes)
        return caption + (" · 当前" if current and not main_menu else " · 已读" if seen else "")

    @renpy.pure
    class VnStoryStart(Action, DictEquality):
        def __init__(self, kind, identity, label, caption, locked=False, confirm=True):
            self.kind, self.identity, self.label, self.caption = kind, identity, label, caption
            self.locked, self.confirm = locked, confirm
        def get_sensitive(self):
            return bool(self.label) and vn_story_unlocked(self.kind, self.identity, self.locked)
        def get_selected(self):
            return not main_menu and (vn_story_nodes.get(vn_current_node, {}).get("chapterId") == self.identity if self.kind == "chapterList" else vn_current_node == self.identity)
        def __call__(self):
            if not self.get_sensitive():
                return
            action = Start(self.label) if main_menu else Function(renpy.full_restart, transition=None, label=self.label)
            if self.confirm and not main_menu:
                action = Confirm("从「" + self.caption + "」重新开始？当前未保存的进度将丢失。", action)
            return renpy.display.behavior.run(action)

    def vn_capture_history_voice(entry, current=False):
        if getattr(entry, "vn_voice_log", None):
            return entry.vn_voice_log
        filename = getattr(getattr(entry, "voice", None), "filename", None)
        info = vn_voice_metadata.get(filename)
        if info is None:
            return None
        source = vn_current_voice_log if current and vn_current_voice_log and vn_current_voice_log.get("filename") == filename else None
        if source is None:
            # Old saves lack statement identities. Give each retained record its
            # own saved key rather than merge different dialogue by audio path.
            import uuid
            source = {"id": "history:" + uuid.uuid4().hex, "assetId": info["assetId"], "speakerId": info["speakerId"]}
        # History stores Ren'Py markup escapes. Snapshot the visible text once;
        # the collection's literal renderer will apply its own escaping later.
        plain = lambda text: renpy.filter_text_tags(str(text or ""), allow=[]).replace("{{", "{")
        record = dict(source, filename=filename, text=plain(entry.what), who=plain(entry.who))
        record["caption"] = (record["who"] or "旁白") + "：" + record["text"][:38]
        entry.vn_voice_log = record
        return record

    def vn_record_history_voice(entry):
        vn_capture_history_voice(entry, current=True)

    def vn_prepare_history_voices():
        for entry in _history_list:
            vn_capture_history_voice(entry)

    config.history_callbacks.append(vn_record_history_voice)
    config.interact_callbacks.append(vn_prepare_history_voices)

    def vn_voice_record(filename, identity=None):
        if isinstance(identity, dict):
            return identity
        if identity is not None:
            for record in persistent.vn_voice_collection:
                if record["id"] == identity:
                    return record
        info = vn_voice_metadata.get(filename)
        if info is None or (identity is not None and identity != info["id"]):
            return None
        return dict(info, filename=filename)

    def vn_voice_favorite_keys():
        keys = list(dict.fromkeys(persistent.vn_favorite_voices + [entry["id"] for entry in persistent.vn_voice_collection]))
        order = list(dict.fromkeys(persistent.vn_voice_favorite_order))
        return [key for key in order if key in keys] + [key for key in keys if key not in order]

    def vn_voice_favorited(record):
        return record is not None and record["id"] in vn_voice_favorite_keys()

    def vn_set_voice_favorite(record, selected):
        identity = record["id"]
        order = [key for key in vn_voice_favorite_keys() if key != identity]
        if identity == record["assetId"]:
            persistent.vn_favorite_voices = [key for key in persistent.vn_favorite_voices if key != identity] + ([identity] if selected else [])
        else:
            persistent.vn_voice_collection = [entry for entry in persistent.vn_voice_collection if entry["id"] != identity] + ([dict(record)] if selected else [])
        persistent.vn_voice_favorite_order = order + ([identity] if selected else [])
        renpy.save_persistent()

    def vn_voice_caption(filename, fallback, identity=None):
        return vn_ui_literal((vn_voice_record(filename, identity) or {}).get("caption", fallback))

    def vn_voice_collection_entries(allowed, favorites_only, order):
        entries = [entry for entry in vn_voice_entries if (allowed is None or entry[2] in allowed) and (not favorites_only or entry[0] in persistent.vn_favorite_voices)]
        entries += [(entry["id"], entry["caption"], vn_voice_asset_paths.get(entry["assetId"], entry["filename"])) for entry in persistent.vn_voice_collection if allowed is None or vn_voice_asset_paths.get(entry["assetId"], entry["filename"]) in allowed]
        if favorites_only and order == "favorites":
            positions = {identity: index for index, identity in enumerate(vn_voice_favorite_keys())}
            entries.sort(key=lambda entry: positions[entry[0]])
        return entries

    @renpy.pure
    class VnReplayVoice(Action, DictEquality):
        def __init__(self, filename, identity=None):
            self.filename, self.record = filename, vn_voice_record(filename, identity)
            if self.record is not None:
                self.filename = vn_voice_asset_paths.get(self.record["assetId"], filename)
        def get_sensitive(self):
            return self.record is not None and self.record["assetId"] in vn_voice_asset_paths and self.record["assetId"] in persistent.vn_unlocks
        def get_selected(self):
            return self.record is not None and vn_replay_voice_identity == self.record["id"] and renpy.music.get_playing(channel="vn_replayvoice") == self.filename
        def __call__(self):
            global vn_replay_voice_identity
            if self.get_sensitive():
                vn_replay_voice_identity = self.record["id"]
                renpy.music.set_volume(vn_preference_get("characterVolume", self.record["speakerId"]), channel="vn_replayvoice")
                renpy.music.play(self.filename, channel="vn_replayvoice")
                renpy.restart_interaction()

    @renpy.pure
    class VnFavoriteVoice(Action, DictEquality):
        def __init__(self, filename, identity=None):
            self.filename, self.record = filename, vn_voice_record(filename, identity)
        def get_sensitive(self):
            return VnReplayVoice(self.filename, self.record).get_sensitive()
        def get_selected(self):
            return vn_voice_favorited(self.record)
        def __call__(self):
            if not self.get_sensitive():
                return
            vn_set_voice_favorite(self.record, not self.get_selected())
            renpy.restart_interaction()

    @renpy.pure
    class VnRemoveFavoriteVoice(Action, DictEquality):
        def __init__(self, filename, confirm=False, message=${pythonLiteral(defaultVoiceRemoveMessage)}, identity=None):
            self.filename, self.confirm, self.message = filename, confirm, message
            self.record = vn_voice_record(filename, identity)
            if self.record is not None:
                self.filename = vn_voice_asset_paths.get(self.record["assetId"], filename)
        def get_sensitive(self):
            return vn_voice_favorited(self.record)
        def __call__(self):
            global vn_replay_voice_identity
            if not self.get_sensitive():
                return
            if self.confirm:
                prompt = vn_ui_literal(self.message).replace("[", "[[")
                return renpy.display.behavior.run(Confirm(prompt, VnRemoveFavoriteVoice(self.filename, identity=self.record)))
            vn_set_voice_favorite(self.record, False)
            if vn_replay_voice_identity == self.record["id"] and renpy.music.get_playing(channel="vn_replayvoice") == self.filename:
                renpy.music.stop(channel="vn_replayvoice")
                vn_replay_voice_identity = None
            renpy.restart_interaction()
`;
}
