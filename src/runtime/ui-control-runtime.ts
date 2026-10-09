import { projectGraphs } from '../core/project-resources';
import { declaredUiComponents, type Project } from '../core/model';
import { uiControlValueType, uiTextInput } from '../core/ui-control-events';
import { uiEventInActiveInstance, uiGraphOnPage } from '../core/ui-logic';
import { pythonLiteral } from './literals';

export function createUiControlRuntime(project:Project,pageScreens:Record<string,string[]>) {
 const controls=Object.fromEntries(declaredUiComponents(project).filter(c=>uiControlValueType(project,c)).map(c=>{
  const pageId=c.page==='custom'?project.ui.customPages.find(p=>p.components.some(n=>n.id===c.id))!.id:'ui:'+c.page;
  const handlers=projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,pageId)?g.nodes.filter(n=>n.type==='eventValueChanged'&&n.properties.componentId===c.id&&uiEventInActiveInstance(project,n)).map(n=>[g.id,n.id]):[]);
  const commits=uiTextInput(project,c)?projectGraphs(project).flatMap(g=>uiGraphOnPage(project,g,pageId)?g.nodes.filter(n=>n.type==='eventTextCommitted'&&n.properties.componentId===c.id&&uiEventInActiveInstance(project,n)).map(n=>[g.id,n.id]):[]):[];
  return [c.id,{pageId,parameterId:c.parameterId,preference:c.preference,characterId:c.preferenceCharacterId,screens:pageScreens[c.page]??[],handlers,commits}];
 }));
 return `    vn_ui_controls = ${pythonLiteral(controls)}

    def vn_ui_control_available(component_id):
        if component_id is None:
            return True
        info = vn_ui_controls.get(component_id)
        if not info or not vn_ui_get(component_id, "visible") or not vn_ui_get(component_id, "enabled"):
            return False
        page = info["pageId"]
        if page.startswith("ui:"):
            if not any(renpy.get_screen(name) is not None for name in info["screens"]):
                return False
        elif page not in vn_ui_open_pages and renpy.get_screen("vn_minigame_custom") is None:
            return False
        layers = [p for p, mode in vn_ui_open_pages.items() if mode == "waiting"] + [p for p in vn_custom_pages if vn_ui_open_pages.get(p) == "shown"]
        source_index = layers.index(page) if page in layers else -1
        return not any(vn_custom_pages.get(p, {}).get("modal", True) for p in layers[source_index + 1:])

    def vn_ui_control_get(component_id):
        info = vn_ui_controls[component_id]
        return vn_parameter_get(info["parameterId"]) if info.get("parameterId") else vn_preference_get(info["preference"], info.get("characterId"))

    def vn_ui_control_set(component_id, value):
        if not vn_ui_control_available(component_id):
            return
        info = vn_ui_controls[component_id]
        previous = vn_ui_control_get(component_id)
        if info.get("parameterId"):
            vn_parameter_set(info["parameterId"], value)
        else:
            vn_preference_set(info["preference"], value, info.get("characterId"))
        current = vn_ui_control_get(component_id)
        if vn_preference_equal(previous, current):
            return
        vn_ui_control_emit(component_id, "handlers", {"value": current, "previous": previous})

    def vn_ui_control_commit(component_id, method):
        if method in ("enter", "focusLost") and vn_ui_control_available(component_id):
            vn_ui_control_emit(component_id, "commits", {"value": vn_ui_control_get(component_id), "method": method})

    def vn_ui_control_emit(component_id, handler_key, payload):
        focused = renpy.display.focus.get_focused()
        focus_argument = renpy.display.focus.argument
        focus_screen = renpy.display.focus.screen_of_focused
        for graph_id, node_id in vn_ui_controls[component_id][handler_key]:
            vn_run_blueprint(graph_id, node_id, {node_id: payload})
        # Ren'Py clears parent focus when a callback context returns. Preserve
        # input continuity if the source is still available on the same screen.
        if focused is not None and focus_screen is not None and renpy.display.focus.get_focused() is None and vn_ui_control_available(component_id) and renpy.get_screen(focus_screen.screen_name[0]) is not None:
            renpy.display.focus.set_focused(renpy.display.focus.get_grab() or focused, focus_argument, focus_screen)
`;
}
