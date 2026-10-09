/** Consume standard Chat Completions SSE, including usage-only final chunks. */
export async function readAiStream(response: Response, onText: (text: string) => void) {
  if (!response.body) throw Error('模型没有返回响应正文。');
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='', content='', finish: string|undefined, done=false, usage: unknown, size=0;
  const event=(frame:string)=>{
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data) return;
    if(data.trim()==='[DONE]'){done=true;return;}
    let value:any;
    try {value=JSON.parse(data);} catch {throw Error('模型返回了无效的流式数据。');}
    if(value.error) throw Error(String(value.error.message??'流式请求失败'));
    if(value.usage) usage=value.usage;
    const choice=value.choices?.[0];
    if(choice?.delta?.refusal) throw Error('模型拒绝了此次请求。');
    if(typeof choice?.delta?.content==='string'){content+=choice.delta.content;onText(content);}
    if(choice?.finish_reason) finish=choice.finish_reason;
  };
  try {
    while(true){
      const chunk=await reader.read();
      if(chunk.done) break;
      size+=chunk.value.byteLength;if(size>2_000_000)throw Error('API 回复过大，请缩小请求范围。');
      buffer+=decoder.decode(chunk.value,{stream:true});
      buffer=buffer.replaceAll('\r\n','\n');
      let end:number;
      while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);if(done)break;}
      if(done)break;
    }
    buffer+=decoder.decode();if(!done&&buffer.trim())event(buffer.replaceAll('\r\n','\n'));
    if(!done&&!finish)throw Error('流式连接提前结束，可重试本条消息。');
    return {choices:[{message:{content},finish_reason:finish}],usage};
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
