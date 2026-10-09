const cache=new WeakMap<HTMLTextAreaElement,{key:string;heights:Map<string,number>}>();
function mirror(input:HTMLTextAreaElement,padding:boolean) {
 const style=getComputedStyle(input),element=document.createElement('div');
 Object.assign(element.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',left:'-100000px',top:'0',width:input.clientWidth+'px',boxSizing:'border-box',fontFamily:style.fontFamily,fontSize:style.fontSize,fontStyle:style.fontStyle,fontWeight:style.fontWeight,fontStretch:style.fontStretch,fontVariantLigatures:style.fontVariantLigatures,fontFeatureSettings:style.fontFeatureSettings,letterSpacing:style.letterSpacing,tabSize:style.tabSize,lineHeight:style.lineHeight,whiteSpace:input.wrap==='off'?'pre':'pre-wrap',overflowWrap:input.wrap==='off'?'normal':'anywhere',wordBreak:input.wrap==='off'?'normal':'break-all',padding:padding?style.padding:'0'});
 if(!padding)element.style.width=Math.max(1,input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))+'px';
 return element;
}
/** Measure changed logical lines once; scrolling still paints only the visible rows. */
export function wrappedLineOffsets(input:HTMLTextAreaElement,lines:string[]) {
 const style=getComputedStyle(input),key=[input.clientWidth,style.fontFamily,style.fontSize,style.fontWeight,style.fontStyle,style.lineHeight,style.fontVariantLigatures,style.letterSpacing,style.tabSize].join('/');
 let entry=cache.get(input);if(!entry||entry.key!==key){entry={key,heights:new Map()};cache.set(input,entry);}
 if(entry.heights.size>20000)entry.heights.clear();
 const unknown=[...new Set(lines.filter(line=>!entry.heights.has(line)))],probe=mirror(input,false);
 if(unknown.length){
  for(const line of unknown){const row=document.createElement('div');row.textContent=line||'\u200b';probe.appendChild(row);}
  document.body.appendChild(probe);
  unknown.forEach((line,i)=>entry!.heights.set(line,Math.max(parseFloat(style.lineHeight)||22,probe.children[i].getBoundingClientRect().height)));
  probe.remove();
 }
 const offsets=[0];for(const line of lines)offsets.push(offsets.at(-1)!+entry.heights.get(line)!);return offsets;
}
/** Native textarea selection offsets stay unchanged by display-only wrapping. */
export function textareaOffsetPoint(input:HTMLTextAreaElement,offset:number) {
 const probe=mirror(input,true),marker=document.createElement('span');
 probe.textContent=input.value.slice(0,offset);marker.textContent=input.value.slice(offset,offset+1)||'\u200b';probe.appendChild(marker);document.body.appendChild(probe);
 const bounds=probe.getBoundingClientRect(),point=marker.getBoundingClientRect();probe.remove();return{x:point.left-bounds.left,y:point.top-bounds.top};
}
