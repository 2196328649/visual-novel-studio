import type { PreviewPhase, StudioBridge } from '../core/bridge';
import type { AiEditorResult } from '../core/ai-editor-commands';

/** Wait for native runtime acknowledgement rather than treating an IPC write as completion. */
export async function controlAiPreview(bridge: Pick<StudioBridge, 'controlPreview' | 'onRuntimeEvent'>, phase: PreviewPhase, command: 'pause' | 'resume', timeoutMs = 10000): Promise<AiEditorResult> {
 const desired = command === 'pause' ? 'paused' : 'running';
 if (!bridge.controlPreview) return {status:'failed',message:'当前运行环境不支持试玩控制。'};
 if (phase === desired) return {status:'completed',message:command === 'pause' ? '试玩已经暂停。' : '试玩已经在运行。'};
 if (phase !== 'running' && phase !== 'paused') return {status:'cancelled',message:'试玩尚未运行，请先启动试玩。'};
 return new Promise(resolve => {
  let done = false;
  let unsubscribe = () => {};
  const finish = (result: AiEditorResult) => { if(done)return;done=true;clearTimeout(timer);unsubscribe();resolve(result); };
  const timer = setTimeout(() => finish({status:'failed',message:'未收到试玩状态确认，请检查游戏窗口。'}),timeoutMs);
  unsubscribe = bridge.onRuntimeEvent(event => {
   if(event.kind !== 'preview')return;
   if(event.phase === desired)finish({status:'completed',message:command === 'pause' ? '试玩已暂停。' : '试玩已继续。'});
   else if(event.phase === 'failed')finish({status:'failed',message:event.message || '试玩运行失败。'});
   else if(event.phase === 'idle')finish({status:'cancelled',message:'试玩已停止，未继续执行控制。'});
  });
  Promise.resolve().then(()=>{if(!done)return bridge.controlPreview!(command);}).catch(error=>finish({status:'failed',message:error instanceof Error?error.message:String(error)}));
 });
}
