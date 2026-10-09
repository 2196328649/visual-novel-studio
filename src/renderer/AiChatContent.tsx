import { Fragment, type ReactNode } from 'react';
import type { AiUsage } from '../core/ai-conversations';

// Render a small safe Markdown subset with React nodes; never evaluate provider HTML.
function inline(text:string):ReactNode {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part,i)=>part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part);
}
export function AiChatContent({text}:{text:string}) {
  const pieces=text.split(/(```[\s\S]*?(?:```|$))/g);
  return <div className="ai-markdown">{pieces.map((piece,index)=>{
    if(piece.startsWith('```')){const start=piece.indexOf('\n'),code=piece.slice(start<0?3:start+1).replace(/```$/,'');return <pre key={index}><code>{code}</code></pre>;}
    const prose=piece.replace(/^\n+|\n+$/g,'');
    if(!prose)return null;
    return <Fragment key={index}>{prose.split('\n').map((line,i)=>{
      const heading=/^#{1,4}\s+(.+)/.exec(line), bullet=/^(?:[-*]|\d+\.)\s+(.+)/.exec(line);
      return heading?<h4 key={i}>{inline(heading[1])}</h4>:bullet?<div className="ai-markdown-bullet" key={i}>• {inline(bullet[1])}</div>:<div key={i}>{line?inline(line):<br/>}</div>;
    })}</Fragment>;
  })}</div>;
}
export function AiUsageLabel({usage}:{usage:AiUsage}) {
  return <small className="ai-usage" title="服务商返回的 token 统计。缓存命中由服务商决定；未返回不等于未命中。多次内部调用会合并统计。">{usage.reportedRequests ? `输入 ${usage.inputTokens.toLocaleString()} · 输出 ${usage.outputTokens.toLocaleString()} token` : '服务商未返回 token 用量'} · {usage.cacheReportedRequests ? `缓存命中 ${usage.cachedTokens.toLocaleString()} token${usage.cacheReportedRequests<usage.requests?'（部分调用）':''}` : '缓存用量未返回'}{usage.requests>1?` · ${usage.requests} 次调用`:''}</small>;
}
