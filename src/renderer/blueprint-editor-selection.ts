import type { AiEditorResult } from '../core/ai-editor-commands';

export interface BlueprintSelectionRequest {
 nodeIds:string[];linkIds:string[];frame:boolean;
 active:()=>boolean;
 finish:(result:AiEditorResult)=>void;
}

/** A mounted canvas must acknowledge the real selection before success is reported. */
export function requestBlueprintSelection(elements:Pick<BlueprintSelectionRequest,'nodeIds'|'linkIds'|'frame'>,open:(request:BlueprintSelectionRequest)=>void,timeout=8000):Promise<AiEditorResult>{
 return new Promise(resolve=>{
  let pending=true;
  const finish=(result:AiEditorResult)=>{if(!pending)return;pending=false;clearTimeout(timer);resolve(result);};
  const timer=setTimeout(()=>finish({status:'failed',message:'画布未完成选择，请检查当前页面后重试。'}),timeout);
  const request={...elements,active:()=>pending,finish};
  try{open(request);}catch(error){finish({status:'failed',message:error instanceof Error?error.message:String(error)});}
 });
}
