import type { Project } from '../core/model';
import type { Commit } from './editor';
import type { AssetUrl } from './StageEditor';
import type { ResourceSelection } from './Inspector';
import { ParameterSets } from './ParameterSets';
import { CharacterLibrary } from './CharacterLibrary';
import type { ParameterUsage } from '../core/parameter-usages';
export function Library({kind,project,resource,select,commit,assetUrl,addResource,openUi,onParameterSelection,initialSetId,locateParameterUsage,onOpenBlueprint}:{initialSetId?:string;kind:'characters'|'variables';project:Project;resource?:ResourceSelection;select:(resource?:ResourceSelection)=>void;commit:Commit;assetUrl:AssetUrl;addResource:(kind:'character'|'variable',folderId?:string)=>void;openUi?:(id:string,pageId?:string)=>void;onParameterSelection?:(selection?:{setId:string;variableId?:string})=>void;locateParameterUsage?:(usage:ParameterUsage)=>void;onOpenBlueprint?:(id:string)=>void}) {
 return kind==='variables'?<ParameterSets initialSetId={initialSetId} onActiveSelection={onParameterSelection} project={project} commit={commit} resource={resource} select={select} openUi={openUi} locate={locateParameterUsage}/>:<CharacterLibrary project={project} commit={commit} assetUrl={assetUrl} resource={resource} select={select} onOpenBlueprint={onOpenBlueprint} add={folderId=>addResource('character',folderId)}/>;
}
