import { targets, type Project, type StoryNode } from '../core/model';
import { storyTransition } from '../core/flow-transitions';

/** A conservative lookahead for deferring legacy performance endings only.
 * Conditions still run in the generated story; this never chooses an exit. */
export function createFlowTransitionLookahead(project: Project): (node: StoryNode) => boolean {
  const byId = new Map(project.nodes.map(node => [node.id, node]));
  const explicit = (node: StoryNode, port: string, target?: string) => !!target && storyTransition(node, port) !== undefined;
  if (!project.nodes.some(node => targets(node).some(exit => explicit(node, exit.port, exit.target)))) return () => false;
  const callers = project.nodes.filter(node => node.kind === 'call');
  const cache = new Map<string, boolean>();
  const transparent = (node: StoryNode) => ['start', 'set', 'condition', 'jump', 'call', 'return'].includes(node.kind)
    || node.kind === 'passage' && !node.lines.length;
  // Only a callee that can return without presenting content allows its caller's
  // continuation to affect this boundary. A normal dialogue stops the search.
  const canReturn = new Set(project.nodes.filter(node => node.kind === 'return').map(node => node.id));
  const parents = new Map<string, StoryNode[]>();
  for (const node of project.nodes.filter(transparent)) for (const exit of targets(node)) {
    if (exit.target) parents.set(exit.target, [...(parents.get(exit.target) ?? []), node]);
  }
  const returning = [...canReturn];
  while (returning.length) for (const parent of parents.get(returning.pop()!) ?? []) {
    if (canReturn.has(parent.id)) continue;
    const returns = parent.kind === 'call'
      ? !!parent.target && canReturn.has(parent.target) && !!parent.next && canReturn.has(parent.next)
      : targets(parent).some(exit => !!exit.target && canReturn.has(exit.target));
    if (returns) { canReturn.add(parent.id); returning.push(parent.id); }
  }
  const mayFollow = (entry: string): boolean => {
    const cached = cache.get(entry);
    if (cached !== undefined) return cached;
    const visited = new Set<string>();
    const pending = [entry];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node || !transparent(node)) continue;
      if (node.kind === 'return') {
        // A performance can end inside a story call. Its actual caller is a
        // runtime stack frame, so only the lookahead considers all continuations.
        for (const caller of callers) {
          if (explicit(caller, 'next', caller.next)) { cache.set(entry, true); return true; }
          if (caller.next) pending.push(caller.next);
        }
      }
      for (const exit of targets(node)) {
        if (node.kind === 'call' && exit.port === 'next' && (!node.target || !canReturn.has(node.target))) continue;
        if (explicit(node, exit.port, exit.target)) { cache.set(entry, true); return true; }
        if (exit.target) pending.push(exit.target);
      }
    }
    cache.set(entry, false);
    return false;
  };
  return node => 'next' in node && !!node.next && (explicit(node, 'next', node.next) || mayFollow(node.next));
}

export function createFlowTransitionRuntime(): string {
  return `default vn_flow_transition_request = None
default vn_flow_transition_fallback = None
default vn_flow_transition_captured = None
default vn_flow_transition_active = None
default vn_flow_transition_legacy_pending = False

init python:
    def vn_stage_sample_frame_clock():
        # Ren'Py visits dynamic displayables before clearing the previous
        # interaction's interact_time. A new origin prevents counting that
        # completed interaction twice after a native with or loaded wait.
        vn_stage_sample_frame_clock.sample = (renpy.game.context(), vn_bp_clock(), renpy.display.interface.frame_time)

    def vn_stage_render_delta(now=None):
        sample = getattr(vn_stage_sample_frame_clock, "sample", None)
        if sample is None or sample[0] is not renpy.game.context() or sample[1] != vn_bp_clock():
            return 0.0
        return max(0.0, (renpy.display.interface.frame_time if now is None else now) - sample[2])

    def vn_stage_retain_wait_clock(now):
        # The task guard already retains the wait's elapsed time. Retain the
        # matching stage position too: Context.runtime is committed only when
        # an interaction ends, so it alone loses the saved part of a long wait.
        # Events can precede the next draw; use the wait's timestamp rather
        # than the older frame timestamp used for normal visual rendering.
        # A copied menu context must not replace the parent's retained record.
        if not vn_bp_wait_owned(vn_bp_wait):
            return
        owner = renpy.context()
        owner.vn_stage_wait_clock = dict(owner=owner, depth=renpy.context_nesting_level(), wait=vn_bp_wait, clock=vn_bp_clock() + vn_stage_render_delta(now))

    def vn_stage_restore_wait_clock():
        # Discard process-local frame samples before any after-load consumer
        # can use them. The serialized info object participates in rollback;
        # a normal rollback must not receive this load-only compensation.
        vn_stage_sample_frame_clock.sample = None
        vn_bp_poll_task.sample = None
        owner = renpy.context()
        owner.vn_bp_active_wait = vn_bp_wait if vn_bp_wait_owned(vn_bp_wait) else None
        saved = getattr(owner, "vn_stage_wait_clock", None)
        if saved is not None and saved.get("owner") is owner and saved.get("depth") == renpy.context_nesting_level() and vn_bp_wait_owned(vn_bp_wait) and saved.get("wait") is vn_bp_wait:
            # A completed wait may leave an older sample. Never subtract time
            # already committed by the engine, or add the offset twice when
            # the same save is loaded again.
            owner.vn_stage_clock_offset = max(getattr(owner, "vn_stage_clock_offset", 0.0), saved["clock"] - renpy.game.context().runtime)

    config.interact_callbacks.append(vn_stage_sample_frame_clock)

    def vn_flow_transition_pending():
        return vn_flow_transition_request is not None or vn_flow_transition_fallback is not None or vn_game_flow_transition_request is not None

    def vn_flow_transition_holding():
        if vn_game_flow_transition_holding():
            return True
        active = vn_flow_transition_active
        if active is not None:
            return active["owner"] is renpy.context() and active["depth"] == renpy.context_nesting_level()
        request = vn_flow_transition_request if vn_flow_transition_request is not None else vn_flow_transition_fallback if vn_flow_transition_fallback is not None else vn_flow_transition_captured
        return request is not None and request.get("owner", renpy.context()) is renpy.context() and request.get("depth", renpy.context_nesting_level()) == renpy.context_nesting_level()

    def vn_flow_transition_render_holding():
        # A native menu inherits stage displayables in a child context. An
        # already held target must stay held there until its own with completes.
        return vn_flow_transition_pending() or vn_flow_transition_active is not None or vn_flow_transition_captured is not None or vn_game_flow_transition_render_holding()

    def vn_flow_transition_source_preserved():
        return vn_flow_transition_holding()

    def vn_flow_transition_release_capture():
        global vn_flow_transition_captured
        if vn_flow_transition_captured is not None and not vn_flow_transition_pending() and vn_flow_transition_active is None and vn_flow_transition_holding():
            vn_flow_transition_captured = None
            vn_flow_transition_resume_targets()

    def vn_flow_transition_atl_gate(trans, st, at):
        # The gate is inserted only at a newly installed transform's first pose.
        # ATL starts its following interpolation at zero when the gate releases.
        if not hasattr(trans, "vn_flow_held"):
            trans.vn_flow_held = vn_flow_transition_render_holding()
        return 0.0 if trans.vn_flow_held and vn_flow_transition_render_holding() else None

    def vn_stage_clock():
        # Only authored stage/timeline deadlines exclude visual transition time.
        # Existing actors, UI animations, tasks and music keep their own clocks.
        owner = renpy.context()
        active = vn_game_flow_transition_active or vn_flow_transition_active
        if active and active["owner"] is owner and active["depth"] == renpy.context_nesting_level():
            return active["clock"]
        return vn_bp_clock() - getattr(owner, "vn_stage_transition_offset", 0.0)

    def vn_flow_transition_resume():
        global vn_flow_transition_active
        active = vn_flow_transition_active
        if active is None:
            return
        owner = renpy.context()
        if active["owner"] is not owner or active["depth"] != renpy.context_nesting_level():
            return
        elapsed = max(0.0, vn_bp_clock() - active["raw"])
        owner.vn_stage_transition_offset = getattr(owner, "vn_stage_transition_offset", 0.0) + elapsed
        vn_flow_transition_active = None
        vn_flow_transition_resume_targets(elapsed)
        renpy.retain_after_load()

    def vn_flow_transition_after_load():
        # A native with interaction can be saved before its Python finally runs.
        # A deferred legacy sequence keeps its target held until the resumed
        # statement finishes the remaining, not-yet-consumed visual phases.
        if not vn_flow_transition_legacy_pending:
            vn_flow_transition_resume()

    config.after_load_callbacks.append(vn_flow_transition_after_load)

    def vn_flow_transition_queue(transition, node_id=None, port=None):
        global vn_flow_transition_request
        if transition is None:
            return
        # Keep Ren'Py's last presented frame. Capturing here would include
        # zero-time scene setup or the source line's already removed objects.
        vn_flow_transition_request = dict(transition=dict(transition), nodeId=node_id, port=port, owner=renpy.context(), depth=renpy.context_nesting_level())

    def vn_flow_transition_defer_performance(transition, node_id=None, port=None):
        global vn_flow_transition_fallback, vn_flow_transition_captured
        if not vn_flow_transition_source_preserved():
            renpy.with_statement(None)
        # This also protects a source without a legacy effect from an intervening
        # scene jump's capture. It is not an explicit none/fallback transition.
        vn_flow_transition_captured = dict(owner=renpy.context(), depth=renpy.context_nesting_level())
        mode = transition.get("mode")
        if mode not in ("color", "dissolve"):
            return
        spec = dict(mode=mode)
        if mode == "dissolve":
            spec["duration"] = transition.get("outDuration", 0.0)
        else:
            spec.update(outDuration=transition.get("outDuration", 0.0), hold=transition.get("hold", 0.0), inDuration=transition.get("inDuration", 0.0), color=transition.get("color", "#000000"))
        vn_flow_transition_fallback = dict(transition=spec, nodeId=node_id, port=port, owner=renpy.context(), depth=renpy.context_nesting_level())

    def vn_flow_transition_play(spec=None):
        global vn_flow_transition_active
        record = vn_flow_transition_active
        if record is None:
            record = dict(owner=renpy.context(), depth=renpy.context_nesting_level(), raw=vn_bp_clock(), clock=vn_stage_clock())
        owner_context = renpy.game.context()
        vn_flow_transition_active = record
        vn_flow_transition_play.owner = owner_context
        renpy.retain_after_load()
        try:
            if spec is None and vn_flow_transition_legacy_pending and (vn_performance_transition is not None or vn_pending_scene_transition is not None) and renpy.game.after_rollback and renpy.game.interface.suppress_transition:
                # The previous phase was consumed before saving. Only the next
                # phase is new, so it must not inherit load's one-shot with skip.
                # Interface.old_scene is not saved; capture the restored stage
                # while its new media is still held, without an extra interaction.
                vn_flow_transition_play.restoring = owner_context
                renpy.with_statement(None)
            if spec is not None:
                mode = spec.get("mode", "none")
                if mode == "dissolve":
                    duration = float(spec.get("duration", 0.0))
                    transition = Dissolve(duration) if duration > 0 else None
                elif mode == "color":
                    out_time = float(spec.get("outDuration", 0.0))
                    hold = float(spec.get("hold", 0.0))
                    in_time = float(spec.get("inDuration", 0.0))
                    duration = out_time + hold + in_time
                    transition = Fade(out_time, hold, in_time, color=spec.get("color", "#000000")) if duration > 0 else None
                else:
                    transition, duration = None, 0.0
                # Clear a scheduled automatic blend too, including explicit none.
                renpy.transition(None, layer="master")
                vn_stage_transition(transition, duration)
            # With no overriding exit, the preserved source ending may still be
            # followed by the old scene-entry effect. Keep new clips held through
            # both interactions and exclude their combined time just once.
            vn_flow_transition_legacy()
        finally:
            # Load/rollback replaces the Context. Never apply an old finally to
            # the restored record or release a later boundary's new resources.
            if renpy.game.context() is owner_context and vn_flow_transition_active is record:
                vn_flow_transition_resume()
            if getattr(vn_flow_transition_play, "owner", None) is owner_context:
                vn_flow_transition_play.owner = None
            if getattr(vn_flow_transition_play, "restoring", None) is owner_context:
                vn_flow_transition_play.restoring = None

    def vn_flow_transition_legacy():
        global vn_flow_transition_legacy_pending
        if vn_flow_transition_legacy_pending:
            vn_performance_reveal()
            vn_apply_scene_transition()
            vn_flow_transition_legacy_pending = False

    def vn_flow_transition_flush(terminal=False):
        global vn_flow_transition_request, vn_flow_transition_fallback, vn_flow_transition_captured, vn_flow_transition_legacy_pending, vn_pending_scene_transition, vn_performance_transition
        if vn_game_flow_transition_flush():
            return True
        if vn_flow_transition_active is not None:
            if not vn_flow_transition_holding() or getattr(vn_flow_transition_play, "owner", None) is renpy.game.context():
                return False
            if vn_flow_transition_legacy_pending:
                # Loaded inside either phase: its pending value was cleared and
                # retained before with, so only unconsumed phases run again.
                vn_flow_transition_play()
                return True
            vn_flow_transition_resume()
        explicit = vn_flow_transition_request is not None
        request = vn_flow_transition_request if explicit else vn_flow_transition_fallback
        if request is not None and not vn_flow_transition_holding():
            return False
        if request is None:
            vn_flow_transition_release_capture()
            if vn_flow_transition_legacy_pending:
                vn_flow_transition_legacy()
                return True
            return False
        vn_flow_transition_request = None
        vn_flow_transition_fallback = None
        vn_flow_transition_captured = None
        vn_flow_transition_legacy_pending = not explicit and not terminal
        if explicit or terminal:
            # Scene entry already consumed its parameters. Only its automatic
            # visual transition is superseded; scene identity is never reset.
            vn_pending_scene_transition = None
            vn_performance_transition = None
            renpy.hide_screen("vn_performance_cover", layer="master")
        # Loading inside the with statement must not replay an already consumed
        # transition or earlier story side effects. Player rollback still works.
        renpy.retain_after_load()
        # Native master-layer transitions carry no persistent cover and honour
        # click-to-dismiss, skipping, transition preferences and rollback.
        vn_flow_transition_play(request["transition"])
        return True

    def vn_flow_transition_prepare_finish():
        global vn_flow_transition_fallback
        if vn_flow_transition_request is not None:
            # End has no next story frame: its transition clears the stage to
            # black before the existing game-over/title navigation.
            renpy.scene(layer="master")
            renpy.show("vn_flow_transition_terminal", what=Solid("#000000"), layer="master")
            renpy.checkpoint(hard=False)
        elif vn_flow_transition_fallback is not None:
            spec = vn_flow_transition_fallback["transition"]
            if spec.get("mode") == "color":
                color = spec.get("color", "#000000")
                renpy.show("vn_flow_transition_legacy_terminal", what=Solid(color), layer="master", zorder=max([199] + [order for tag, order in renpy.get_zorder_list("master")]) + 1)
                vn_flow_transition_fallback = dict(vn_flow_transition_fallback, transition=dict(spec, inDuration=0.0))
                renpy.checkpoint(hard=False)
            else:
                # Legacy dissolve had no departing half and no terminal reveal.
                vn_flow_transition_fallback = None

    def vn_flow_transition_finish():
        # Preparation ends a soft checkpoint, so this separate statement gets
        # the terminal scene list in its resume snapshot. Merely splitting two
        # Python statements lets Ren'Py merge them with the old source frame.
        vn_flow_transition_flush(terminal=True)

    def vn_flow_transition_reset(keep_terminal=False):
        global vn_flow_transition_request, vn_flow_transition_fallback, vn_flow_transition_captured, vn_flow_transition_active, vn_flow_transition_legacy_pending
        vn_flow_transition_resume()
        vn_flow_transition_request = None
        vn_flow_transition_fallback = None
        vn_flow_transition_captured = None
        vn_flow_transition_active = None
        vn_flow_transition_legacy_pending = False
        vn_flow_transition_resume_targets()
        renpy.hide("vn_flow_transition_legacy_terminal", layer="master")
        # An explicit ending resolves to a black stage. An empty master layer
        # is transparent (a checkerboard in developer mode), not that end frame.
        if not keep_terminal:
            renpy.hide("vn_flow_transition_terminal", layer="master")

init 1001 python:
    # Transition and media callbacks must observe the resumed stage position.
    config.after_load_callbacks.insert(0, vn_stage_restore_wait_clock)
`;
}
