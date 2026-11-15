import { uiPage } from '../core/ui-pages';
import type { Project } from '../core/model';
import type { PreviewOptions } from '../core/bridge';
import { gameFlow } from '../core/game-flow';
import { flowEntry, flowStepNodeId, gameFlowConnections, gameFlowRoute } from '../core/game-flow-graph';
import { gameFlowTransition } from '../core/game-flow-transitions';
import type { GameFlowStep } from '../core/game-flow-schema';
import { projectGraphs } from '../core/project-resources';
import { pythonLiteral } from './literals';
import { flowPageOpening } from '../core/ui-page-opening';
import { gameFlowTransitionRuntime } from './game-flow-transition-runtime';

export function createGameFlowRuntime(project: Project, preview?: PreviewOptions): string {
  const flow = gameFlow(project);
  const beforeTitle = gameFlowRoute(project, 'beforeTitle').steps;
  const beforeNewGame = gameFlowRoute(project, 'beforeNewGame').steps;
  const connections = gameFlowConnections(project);
  const transition = (source: string) => connections[source] ? gameFlowTransition(project, source) : undefined;
  // This only decides whether the current source needs a final frame. Runtime
  // branches and effects still execute normally, and choose their real outlet.
  const graphById = new Map(projectGraphs(project).map(graph => [graph.id, graph]));
  const transparentGraph = (graphId: string, ancestors = new Set<string>()): boolean => {
    const graph = graphById.get(graphId);
    if (!graph || ancestors.has(graphId)) return false;
    const visited = new Set([...ancestors, graphId]);
    return graph.nodes.every(node => ['callFunction', 'callMacro'].includes(node.type)
      ? transparentGraph(String(node.properties.graphId), visited)
      : !node.pins.some(pin => pin.dataType === 'exec') || ['event', 'return', 'setVariable', 'branch', 'condition', 'switchValue', 'sequence', 'gate', 'flipFlop', 'doOnce', 'doN'].includes(node.type));
  };
  const transparent = (step: GameFlowStep): boolean => step.kind === 'blueprint' && transparentGraph(step.graphId);
  const nextEffect = (items: GameFlowStep[], index: number) => {
    let spec = transition(index < 0 ? flowEntry[items === beforeTitle ? 'beforeTitle' : 'beforeNewGame'] : flowStepNodeId(items[index].id));
    for (let following = index + 1; following < items.length && transparent(items[following]); following++) {
      spec = transition(flowStepNodeId(items[following].id)) ?? spec;
    }
    return spec;
  };
  const steps = (items: GameFlowStep[]) => items.flatMap((step, index) => {
    const source = flowStepNodeId(step.id);
    const spec = transition(source);
    const pageSettings = step.kind === 'page' ? flowPageOpening(project, step) : undefined;
    const pageLifetime = step.kind === 'page' ? `, page_wait=${pythonLiteral(pageSettings!.wait)}, cancel_to_title=${pythonLiteral(step.cancel === 'title')}` : '';
    const lines = [`    $ vn_flow_begin_step(${pythonLiteral(step.id)}, ${pythonLiteral(step.kind)}, ${pythonLiteral(step.allowSkip)}, ${pythonLiteral(nextEffect(items, index))}, ${pythonLiteral(step.kind === 'page' ? step.pageId : undefined)}, ${pythonLiteral(spec !== undefined)}${pageLifetime})`];
    if (step.kind === 'page') {
      const settings = pageSettings!;
      if (settings.wait) {
        if (uiPage(project, step.pageId)?.template) lines.push(`    call expression vn_bp_page_label(${pythonLiteral(step.pageId)}, True, ${pythonLiteral(step.modal)}, ${pythonLiteral(step.saveMode ?? 'load')}) pass (_vn_modal=${pythonLiteral(step.modal)}, _vn_inputs=${pythonLiteral(step.inputs ?? {})}) from vn_flow_call_${step.id}`);
        else lines.push(`    call vn_bp_page_${step.pageId}(_vn_modal=${pythonLiteral(settings.input === 'block')}, _vn_auto=${step.completion === 'auto' ? step.duration : 0}, _vn_confirm=${pythonLiteral(step.completion === 'confirm')}, _vn_allow_skip=${pythonLiteral(step.allowSkip)}, _vn_inputs=${pythonLiteral(step.inputs ?? {})}, _vn_opening=${pythonLiteral(settings)}) from vn_flow_call_${step.id}`);
        if (step.cancel === 'title') lines.push('    if vn_ui_last_page_reason in ("cancelled", "parentClosed", "navigated"):', '        $ vn_flow_end_step()', '        $ vn_game_flow_transition_reset()', '        return "title"');
      } else lines.push(`    $ vn_ui_open_page(${pythonLiteral(step.pageId)}, ${pythonLiteral(settings.input === 'block')}, ${pythonLiteral(step.inputs ?? {})}, opening=${pythonLiteral(settings)})`, '    if vn_game_flow_transition_request is not None or vn_game_flow_source_scope is not None:', '        $ renpy.checkpoint(hard=False)', '        $ vn_game_flow_transition_flush()', '        $ renpy.pause(0, hard=True)');
    } else if (step.kind === 'video') {
      const asset = project.assets.find(a => a.id === step.assetId && a.kind === 'video');
      lines.push(`    $ vn_flow_video(${pythonLiteral(asset?.path.replaceAll('\\', '/') ?? '')}, ${pythonLiteral(step.allowSkip)})`);
    } else {
      const graph = projectGraphs(project).find(g => g.id === step.graphId);
      const args = graph?.exposedInputs.map(pin => `vn_bp_in_${graph.id}_${pin.id}=${pythonLiteral(step.inputs?.[pin.id] ?? pin.defaultValue)}`).join(', ') ?? '';
      lines.push(`    call vn_blueprint_${step.graphId}${args ? '(' + args + ')' : ''} from vn_flow_call_${step.id}`);
    }
    lines.push('    $ vn_flow_end_step()');
    if (spec !== undefined) lines.push(`    $ vn_game_flow_transition_queue(${pythonLiteral(spec)}, ${pythonLiteral(source)})`);
    return lines;
  }).join('\n');
  const phaseEntry = (source: string) => transition(source) === undefined ? '' : `    $ vn_game_flow_transition_queue(${pythonLiteral(transition(source))}, ${pythonLiteral(source)})\n`;
  return `${gameFlowTransitionRuntime}
default vn_flow_active_step = None
default vn_flow_phase = None
default vn_flow_skip_requested = False
default vn_flow_step_serial = 0
default persistent.vn_game_flow_seen = {}

init python:
    vn_flow_repeat = ${pythonLiteral(flow.beforeTitle.repeat)}
    vn_flow_revision = ${pythonLiteral(flow.beforeTitle.revision)}
    vn_flow_preview = ${pythonLiteral(!!preview)}
    vn_flow_new_game_capture = ${pythonLiteral(nextEffect(beforeNewGame, -1))}
    renpy.session.setdefault("vn_flow_launch_seen", False)
    renpy.session.setdefault("vn_flow_preview_seen", {})
    renpy.session.setdefault("vn_flow_skip_title_once", ${pythonLiteral(preview?.flowStart === 'title')})

    def vn_flow_should_play():
        if renpy.session.pop("vn_flow_skip_title_once", False):
            return False
        if vn_flow_repeat == "title":
            return True
        if vn_flow_repeat == "launch":
            return not renpy.session.get("vn_flow_launch_seen", False)
        seen = renpy.session["vn_flow_preview_seen"] if vn_flow_preview else persistent.vn_game_flow_seen or {}
        key = "profile" if vn_flow_repeat == "profile" else "version:" + vn_flow_revision
        return not seen.get(key, False)

    def vn_flow_mark_seen():
        renpy.session["vn_flow_launch_seen"] = True
        if vn_flow_repeat not in ("profile", "version"):
            return
        key = "profile" if vn_flow_repeat == "profile" else "version:" + vn_flow_revision
        if vn_flow_preview:
            renpy.session["vn_flow_preview_seen"][key] = True
        else:
            persistent.vn_game_flow_seen = dict(persistent.vn_game_flow_seen or {}, **{key: True})
            renpy.save_persistent()

    def vn_flow_begin_step(step_id, kind, allow_skip, outgoing=None, page_id=None, explicit=False, page_wait=True, cancel_to_title=False):
        global vn_flow_active_step, vn_flow_skip_requested, vn_flow_step_serial
        vn_flow_step_serial += 1
        vn_flow_active_step = dict(id=step_id, token=vn_flow_step_serial, kind=kind, allowSkip=allow_skip, cancelled=False, pageId=page_id, pageWait=page_wait, cancelToTitle=cancel_to_title)
        vn_flow_skip_requested = False
        if explicit or outgoing is not None or vn_game_flow_transition_request is not None:
            vn_game_flow_source_begin(vn_flow_active_step, bool(vn_game_flow_transition_seconds(outgoing)))

    def vn_flow_end_step():
        global vn_flow_active_step, vn_flow_skip_requested
        vn_game_flow_source_finish()
        vn_flow_active_step = None
        vn_flow_skip_requested = False

    def vn_flow_start_game():
        vn_game_flow_transition_reset()
        # Start just left the main-menu context. This is deliberately the first
        # statement, while the last actually drawn frame is still that menu.
        if vn_game_flow_transition_seconds(vn_flow_new_game_capture):
            vn_game_flow_transition_capture()

    def vn_flow_request_skip():
        global vn_flow_skip_requested
        if not vn_flow_active_step or not vn_flow_active_step.get("allowSkip"):
            return
        scope = vn_game_flow_source_scope
        if scope and scope.get("preserve") and not scope.get("captured"):
            vn_game_flow_transition_capture()
            scope["captured"] = True
        vn_flow_skip_requested = True
        vn_flow_active_step["cancelled"] = True
        for page_id in list(reversed(vn_ui_page_order)):
            if vn_ui_page_sessions.get(page_id, {}).get("flowToken") == vn_flow_active_step["token"]:
                vn_ui_close_page(page_id, "取消", "cancelled", force=True)
        for record in list(vn_ui_interface_records.values()):
            native = record["task"].get("native")
            if native and (record["task"].get("flow") or {}).get("token") == vn_flow_active_step["token"] and native.get("navigation") is None:
                if record["page"] in vn_bp_page_menus:
                    vn_ui_close_native_page(record["page"], "取消", "cancelled", force=True)
                else:
                    # System prompts unwind through the cancelled flow checkpoint,
                    # never through menu navigation or their yes/no actions.
                    native["closed"] = True
                    vn_ui_interface_end(record, vn_ui_interface_completion(record["page"], "取消", "cancelled", record=record))
        vn_bp_prune_task_resources()
        vn_bp_interrupt_wait()

    def vn_flow_video(filename, allow_skip):
        global vn_game_flow_movie
        if not filename or not renpy.loadable(filename):
            raise Exception("游戏流程引用的视频无法读取。")
        scope = vn_game_flow_source_current()
        if not (vn_game_flow_transition_request is not None or scope and scope.get("preserve")):
            if allow_skip:
                return renpy.movie_cutscene(filename)
            renpy.movie_start_fullscreen(filename, loops=0)
            try:
                renpy.ui.soundstopbehavior("movie")
                return renpy.ui.interact(suppress_overlay=True, roll_forward=None)
            finally:
                renpy.movie_stop()
        # Fullscreen cutscenes bypass Ren'Py's scene tree. A managed Movie uses
        # the same root transition as pages, while keeping its natural last frame.
        target = dict(_vn_flow_hold=vn_game_flow_transition_holding(), _vn_game_flow_movie=True)
        vn_game_flow_movie = Movie(play=filename, loop=False, keep_last_frame=True, play_callback=vn_visual_functools.partial(vn_visual_movie_start, data=target))
        target["_vn_movie"] = vn_game_flow_movie
        vn_game_flow_movie.ensure_channels()
        surface = VNFlowMovieFrame(vn_game_flow_movie, target)
        renpy.show("vn_game_flow_movie", what=Transform(surface, xysize=(config.screen_width, config.screen_height), fit="contain"), layer="master", zorder=190)
        vn_game_flow_transition_flush()
        if target["_vn_flow_hold"]:
            target["_vn_flow_hold"] = False
            vn_visual_resume_flow_movie(target)
        renpy.mode("movie")
        try:
            if allow_skip:
                renpy.ui.saybehavior()
            renpy.ui.soundstopbehavior(vn_game_flow_movie.channel)
            return renpy.ui.interact(suppress_overlay=True, roll_forward=None)
        finally:
            if scope and scope.get("preserve"):
                vn_game_flow_transition_capture()
                scope["captured"] = True
            renpy.hide("vn_game_flow_movie", layer="master")
            vn_game_flow_movie.stop()
            vn_game_flow_movie = None

    config.always_shown_screens.append("vn_game_flow_skip")

screen vn_game_flow_skip():
    # Keep the escape route above confirmation dialogs opened by a blueprint.
    zorder 250
    if vn_flow_active_step and vn_flow_active_step.get("kind") == "blueprint" and vn_flow_active_step.get("allowSkip"):
        textbutton "跳过这一项" action Function(vn_flow_request_skip) xalign 0.95 yalign 0.05

label before_main_menu:
    $ vn_game_flow_transition_reset()
    $ vn_bp_async_clear()
    $ vn_ui_clear_pages()
    $ vn_flow_end_step()
${beforeTitle.length || transition(flowEntry.beforeTitle) !== undefined ? `    if vn_flow_should_play():
${beforeTitle.length ? `        # Enter once, before an authored step can start its own music.
        $ renpy.music.stop(channel="music", fadeout=0)
` : ''}        call vn_game_flow_before_title from vn_game_flow_before_title_entry
        $ vn_flow_mark_seen()` : '    pass'}
    return

label vn_game_flow_before_title(vn_flow_phase="beforeTitle"):
${phaseEntry(flowEntry.beforeTitle)}${steps(beforeTitle)}
    return "completed"

label vn_game_flow_before_new_game(vn_flow_phase="beforeNewGame"):
${phaseEntry(flowEntry.beforeNewGame)}${steps(beforeNewGame)}
    return "completed"

# Ren'Py's documented menu extension points: show the real screen once, then
# reveal it. Its one session/OnShow is also the following ordinary interaction.
label main_menu:
    $ _vn_menu_name = renpy.session.pop("_main_menu_screen", "main_menu")
    $ _vn_menu_args = renpy.session.pop("_main_menu_screen_args", tuple())
    $ _vn_menu_kwargs = renpy.session.pop("_main_menu_screen_kwargs", {})
    if _vn_menu_name != "main_menu":
        $ vn_game_flow_transition_reset()
    $ renpy.show_screen(_vn_menu_name, *_vn_menu_args, **_vn_menu_kwargs)
    # This is the title host even when reload restores its settings screen.
    # Start alongside its reveal, never before the opening. A silent title also
    # clears a music track deliberately authored by the preceding opening.
    if vn_main_menu_music:
        $ renpy.music.play(vn_main_menu_music, channel="music", if_changed=True, fadein=vn_main_menu_music_fadein)
    else:
        $ renpy.music.stop(channel="music", fadeout=0)
    if vn_game_flow_transition_holding():
        $ renpy.checkpoint(hard=False)
    $ vn_game_flow_transition_flush()
    $ ui.interact()
    return

label game_menu:
    if renpy.has_screen(_game_menu_screen):
        $ renpy.show_screen(_game_menu_screen, *args, _transient=True, **kwargs)
        if vn_game_flow_transition_holding():
            $ renpy.checkpoint(hard=False)
        $ vn_game_flow_transition_flush()
        $ ui.interact()
        jump _noisy_return
    jump expression _game_menu_screen
`;
}
