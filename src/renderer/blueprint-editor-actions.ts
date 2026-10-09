import type { AiEditorResult } from '../core/ai-editor-commands';
import type { BlueprintGraph } from '../core/model';

export const blueprintEditorCommands = ['arrangeBlueprint','frameBlueprint','collapseBlueprintNodes','expandBlueprintNodes','showBlueprintConnections','showBlueprintInterface','showBlueprintNodeProperties'] as const;
export type BlueprintEditorCommand = typeof blueprintEditorCommands[number];
export const isBlueprintEditorCommand = (command:string):command is BlueprintEditorCommand => (blueprintEditorCommands as readonly string[]).includes(command);
type Handler = (command:BlueprintEditorCommand)=>Promise<AiEditorResult>;
const editors = new Map<symbol,{projectId:string;graphId:string;run:Handler}>();

/** Only a currently mounted editor may acknowledge an action. */
export function registerBlueprintEditor(projectId:string,graphId:string,run:Handler) {
 const key=Symbol();editors.set(key,{projectId,graphId,run});return ()=>{editors.delete(key);};
}
export async function runBlueprintEditorAction(projectId:string,graphId:string,command:BlueprintEditorCommand):Promise<AiEditorResult> {
 const matches=[...editors.values()].filter(editor=>editor.projectId===projectId&&editor.graphId===graphId);
 if(matches.length!==1)return {status:'failed',message:'请先打开要操作的节点蓝图；时间轴视图不能执行此操作。'};
 return matches[0].run(command);
}

/** Reject stale positions after edits, undo, graph switches or project changes. */
export function blueprintLayoutIsCurrent(source:{projectId:string;graph:BlueprintGraph},current:{projectId:string;graph?:BlueprintGraph}) {
 return source.projectId===current.projectId&&JSON.stringify(source.graph)===JSON.stringify(current.graph);
}
