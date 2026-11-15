import type { Project } from '../core/model';
import { pythonLiteral } from './literals';

/** Navigation is presentation state. Execution and save/load continue to use
 * Ren'Py's own call stack, including its existing stable return labels. */
export function createPlayerFlowCallRuntime(project: Project): string {
  const calls = Object.fromEntries(project.nodes.flatMap(node => node.kind === 'call' && node.target ? [[node.id, node.target]] : []));
  return `
init python:
    import builtins as vn_flow_builtins
    vn_story_call_targets = ${pythonLiteral(calls)}
    vn_story_call_returns = dict(("vn_return_" + identity, identity) for identity in vn_story_call_targets)
    vn_flow_replay_key = ${pythonLiteral('vn_flow_replay:' + project.id)}

    def vn_flow_call_chain():
        if main_menu:
            return []
        # A game menu has its own context. Read the surviving story context,
        # rather than mistake the menu's unrelated calls for story branches.
        for context in renpy.game.contexts:
            calls = [vn_story_call_returns[name] for name in context.get_return_stack() if isinstance(name, str) and name in vn_story_call_returns]
            if calls:
                return calls
        return []

    def vn_flow_root_view(options):
        return dict(kind="root", entries=options.get("flowEntries", []), graph=options.get("flowGraph", {}))

    def vn_flow_view(options, trail=None):
        return options.get("flowViews", {}).get(trail[-1].get("viewId"), vn_flow_root_view(options)) if trail else vn_flow_root_view(options)

    def vn_flow_valid_trail(options, trail):
        if not isinstance(trail, (vn_flow_builtins.list, vn_flow_builtins.tuple)):
            return None
        views = options.get("flowViews", {})
        if len(trail) > len(views):
            return None
        current = vn_flow_root_view(options)
        seen, result = set(), []
        for step in trail:
            if not isinstance(step, vn_flow_builtins.dict):
                return None
            view_id, call_id = step.get("viewId"), step.get("callId")
            if not isinstance(view_id, str) or view_id in seen or view_id not in views or call_id is not None and not isinstance(call_id, str):
                return None
            card = next((entry for entry in current.get("graph", {}).get("nodes", []) if (entry.get("viewId") or entry.get("groupId")) == view_id and entry.get("callId") == call_id), None)
            if card is None:
                return None
            if call_id is not None and (call_id not in vn_story_call_targets or views[view_id].get("targetId") != vn_story_call_targets[call_id]):
                return None
            seen.add(view_id)
            result.append(dict(viewId=view_id, **(dict(callId=call_id) if call_id is not None else {})))
            current = views[view_id]
        return result

    def vn_flow_enter_trail(options, trail, identity):
        if not (vn_flow_entry(identity, options).get("viewId") or vn_flow_entry(identity, options).get("groupId")):
            return trail or []
        trail = vn_flow_valid_trail(options, trail or [])
        if trail is None:
            return []
        current = vn_flow_view(options, trail)
        card = next((entry for entry in current.get("graph", {}).get("nodes", []) if entry.get("id") == identity), None)
        view_id = (card.get("viewId") or card.get("groupId")) if card else None
        if view_id not in options.get("flowViews", {}):
            return trail
        # Shared and recursive bodies have one view. Re-entering an ancestor
        # returns to that existing level rather than grow an unbounded trail.
        existing = next((index for index, step in enumerate(trail) if step["viewId"] == view_id), None)
        if existing is not None:
            return trail[:existing + 1]
        candidate = trail + [dict(viewId=view_id, **(dict(callId=card["callId"]) if card.get("callId") else {}))]
        return candidate if vn_flow_valid_trail(options, candidate) is not None else trail

    def vn_flow_location(options, graph, trail=None):
        if main_menu:
            return None
        if not options.get("flowViews"):
            return graph.get("locations", options.get("flowLocations", {})).get(vn_current_node, vn_current_node)
        trail = vn_flow_valid_trail(options, trail or [])
        if trail is None:
            return None
        expected = [step["callId"] for step in trail if step.get("callId")]
        actual = vn_flow_call_chain()
        if actual[:len(expected)] != expected:
            return None
        remaining = actual[len(expected):]
        call_locations = graph.get("callLocations", {})
        if remaining:
            return next((call_locations[identity] for identity in remaining if identity in call_locations), None)
        identity = graph.get("locations", {}).get(vn_current_node, vn_current_node)
        return identity if any(node.get("id") == identity for node in graph.get("nodes", [])) else None

    def vn_flow_context(options, graph, trail=None):
        return dict(_vn_flow_context=True, current=vn_flow_location(options, graph, trail), trail=trail or [], graph=graph)

    def vn_flow_open_gesture(gesture, identity):
        # Keyboard activation enters immediately. Only pointer activation of a
        # call card needs the second click; display groups keep their old action.
        event = renpy.game.interface.last_event
        pygame = renpy.display.behavior.pygame
        if event is None or event.type != pygame.MOUSEBUTTONUP or getattr(event, "touch", False):
            gesture.clear()
            return True
        now = renpy.display.core.get_time()
        position = getattr(event, "pos", None)
        previous = gesture.get("position")
        close = position is None or previous is None or (position[0] - previous[0]) ** 2 + (position[1] - previous[1]) ** 2 <= 64
        opened = gesture.get("identity") == identity and 0 <= now - gesture.get("time", -1.0) <= 0.5 and close
        gesture.clear()
        if not opened:
            gesture.update(identity=identity, time=now, position=position)
        return opened

    def vn_flow_replay_plan(options, identity, trail):
        if not isinstance(identity, str):
            return None
        trail = vn_flow_valid_trail(options, trail or [])
        if trail is None:
            return None
        view = vn_flow_view(options, trail)
        entry = next((node for node in view.get("graph", {}).get("nodes", []) if node.get("id") == identity), None)
        if entry is None or entry.get("callId") or entry.get("groupId") or entry.get("viewId") or entry.get("action") == "inspect":
            return None
        node_id = entry.get("nodeId", identity)
        if node_id not in vn_story_nodes or vn_flow_locked(identity, options):
            return None
        calls, body = [], None
        for step in trail:
            if not step.get("callId"):
                continue
            call_id = step["callId"]
            if body is not None and call_id not in body.get("nodeIds", body.get("graph", {}).get("nodeIds", [])):
                return None
            if not vn_story_unlocked("flowchart", call_id, options.get("lockUnread", False)):
                return None
            body = options["flowViews"][step["viewId"]]
            calls.append(call_id)
        if not calls or node_id not in body.get("nodeIds", body.get("graph", {}).get("nodeIds", [])) or node_id not in view.get("nodeIds", view.get("graph", {}).get("nodeIds", [])):
            return None
        returns = ["vn_return_" + call_id for call_id in calls]
        if not all(renpy.has_label(label) for label in returns):
            return None
        return dict(nodeId=node_id, calls=calls, returns=returns)

    @renpy.pure
    class VnFlowRestart(Action, DictEquality):
        def __init__(self, component_id, identity, trail):
            self.component_id, self.identity, self.trail = component_id, identity, trail
        def get_sensitive(self):
            options = globals().get("vn_flow_options_" + str(self.component_id), {})
            return options.get("flowComponentId") == self.component_id and vn_flow_replay_plan(options, self.identity, self.trail) is not None
        def __call__(self):
            if not self.get_sensitive():
                return
            # This action is the confirmation's accepted action. Merely opening
            # or cancelling a confirmation never writes a launch request.
            renpy.session[vn_flow_replay_key] = dict(componentId=self.component_id, identity=self.identity, trail=[dict(step) for step in self.trail])
            if main_menu:
                return renpy.display.behavior.run(Start("vn_flow_replay"))
            renpy.full_restart(transition=None, label="vn_flow_replay")

    def vn_flow_replay_take():
        request = renpy.session.pop(vn_flow_replay_key, None)
        if not isinstance(request, vn_flow_builtins.dict):
            return None
        component_id = request.get("componentId")
        options = globals().get("vn_flow_options_" + str(component_id), {})
        if options.get("flowComponentId") != component_id:
            return None
        return vn_flow_replay_plan(options, request.get("identity"), request.get("trail"))

    def vn_flow_replay_cleanup():
        if not _restart or len(_restart) < 2 or _restart[1] != "vn_flow_replay":
            renpy.session.pop(vn_flow_replay_key, None)

    def vn_flow_replay_after_load():
        renpy.session.pop(vn_flow_replay_key, None)

    config.start_callbacks.append(vn_flow_replay_cleanup)
    config.after_load_callbacks.append(vn_flow_replay_after_load)

label vn_flow_replay:
    python hide:
        request = vn_flow_replay_take()
        if request is None:
            renpy.jump("start")
        context = renpy.game.context()
        # Context.call is the engine operation used by a script call. Unlike
        # set_return_stack, it creates the matching dynamic and abnormal frames
        # as well, so real return, rollback and saved calls remain consistent.
        while context.get_return_stack():
            context.pop_call()
        for call_id in request["calls"]:
            context.goto_label(vn_story_nodes[call_id]["label"])
            context.call(vn_story_nodes[vn_story_call_targets[call_id]]["label"], return_site="vn_return_" + call_id)
            vn_mark_story_visit(call_id)
        renpy.jump(vn_story_nodes[request["nodeId"]]["label"])
`;
}
