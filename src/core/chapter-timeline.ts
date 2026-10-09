import { projectGraphs, addProjectGraphs } from './project-resources';
import { canLaunchTimeline } from './timeline-launch';
import type { Project, BlueprintGraph } from './model';
import { callablePins } from './blueprint';
import type { chapterCompositionBlueprint } from './chapter-composition-blueprint';

/** Retarget existing data links only after every input has a corresponding component pin. */
export function replaceChapterWithTimeline(project:Project, owner:BlueprintGraph, nodeId:string, result:ReturnType<typeof chapterCompositionBlueprint>) {
 const node=owner.nodes.find(node=>node.id===nodeId);
 if(!node||node.type!=='showChapter')throw new Error('标题片段已变化，请重新打开。');
 if(projectGraphs(project).length>=256)throw new Error('蓝图数量已达到上限。');
 const incoming=owner.links.filter(link=>link.toNodeId===nodeId&&node.pins.some(pin=>pin.id===link.toPinId&&pin.dataType!=='exec'));
 for(const link of incoming)if(!result.chapterInputs[link.toPinId])throw new Error('当前标题结构尚不能展开此动态参数：'+(node.pins.find(pin=>pin.id===link.toPinId)?.name??link.toPinId));
 const child=result.graph;child.timelineComponent=true;
 const wait=node.properties.wait;
 if(wait===false&&!canLaunchTimeline(project,child))throw new Error('内部时间轴包含延迟，暂不能保留重叠播放。');
 for(const link of incoming)link.toPinId='arg_'+result.chapterInputs[link.toPinId];
 node.type='callFunction';node.name=child.name;node.properties={graphId:child.id,...(typeof wait==='boolean'?{wait}:{})};node.pins=callablePins(child);
 addProjectGraphs(project, child);
 return child;
}
