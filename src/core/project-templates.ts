import { createProject, makeId, type Project } from './model';
import { endingPerformanceNodes } from './ending-migration';

export type ProjectTemplate = 'blank' | 'aihong' | `user:${string}`;
export interface ProjectTemplateInfo {
  id: Exclude<ProjectTemplate, 'blank'>;
  name: string;
  description: string;
  builtin: boolean;
  customized: boolean;
  updatedAt: number;
  available: boolean;
}

/** An editable, self-contained example using ordinary story nodes. */
export function createBranchingProject(name: string): Project {
  const project = createProject(name);
  const chapterId = project.chapters[0].id;
  const sceneId = project.scenes[0].id;
  project.chapters[0].name = '第一章：雨中的车站';
  project.scenes[0].name = '最后一班车';
  const togetherScene = makeId('scene'), umbrellaScene = makeId('scene');
  project.scenes.push({ id: togetherScene, chapterId, name: '一同回家' }, { id: umbrellaScene, chapterId, name: '借出雨伞' });
  const [startId, openingId, choiceId, togetherId, umbrellaId, togetherEnd, umbrellaEnd] = Array.from({ length: 7 }, () => makeId());
  const line = (text: string) => ({ id: makeId('line'), text, actions: [] });
  project.entryId = startId;
  project.nodes = [
    { kind: 'start', id: startId, sceneId, name: '开始', x: 40, y: 100, next: openingId },
    { kind: 'passage', id: openingId, sceneId, name: '站台上的陌生人', x: 330, y: 100, next: choiceId,
      lines: [line('末班车离站后，雨还没有停。'), line('站台边，一个抱着纸箱的人望着没有尽头的雨幕。你手里只有一把伞。')] },
    { kind: 'choice', id: choiceId, sceneId, name: '雨中的决定', x: 620, y: 100, prompt: '你会怎么做？',
      choices: [{ id: makeId('option'), text: '撑开伞，邀请对方同行', target: togetherId }, { id: makeId('option'), text: '把伞借给对方，留在车站等雨停', target: umbrellaId }] },
    { kind: 'passage', id: togetherId, sceneId: togetherScene, name: '伞下的路', x: 40, y: 100, next: togetherEnd,
      lines: [line('两个人小心地挤进伞下，沿着街灯慢慢走。'), line('聊到第二个路口，你才发现对方就住在隔壁。原来回家的路，也可以是相识的开始。')] },
    ...endingPerformanceNodes(project, { id: togetherEnd, sceneId: togetherScene, name: '结局一：同行', x: 350, y: 100 }, '结局一：同行\n一把伞，缩短了两个人之间的距离。'),
    { kind: 'passage', id: umbrellaId, sceneId: umbrellaScene, name: '等雨停的人', x: 40, y: 100, next: umbrellaEnd,
      lines: [line('你递出雨伞，对方把一张写着联系方式的纸条留给你。'), line('雨停时，车站外多了一杯热茶。纸杯上写着：谢谢你，明天还在这里见。')] },
    ...endingPerformanceNodes(project, { id: umbrellaEnd, sceneId: umbrellaScene, name: '结局二：再会', x: 350, y: 100 }, '结局二：再会\n一次小小的善意，留下了明天的约定。'),
  ];
  return project;
}

/** Keep a display name from turning a suggested folder into a Windows device/path. */
export function projectFolderName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80).replace(/[. ]+$/, '');
  if (!cleaned) return '未命名作品';
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(cleaned) ? `作品_${cleaned}` : cleaned;
}
