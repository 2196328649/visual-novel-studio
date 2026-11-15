import { createProject, type PassageNode, type Project } from '../../src/core/model';

export function storyGroupsFixture(): Project {
  const p = createProject('剧情分层与打组验收');
  p.id = 'story_group_acceptance'; p.chapters = [{ id: 'chapter_one', name: '第一章' }];
  p.scenes = [{ id: 'station', chapterId: 'chapter_one', name: '车站' }, { id: 'port', chapterId: 'chapter_one', name: '港口' }, { id: 'common', chapterId: 'chapter_one', name: '共同回忆' }];
  p.entryId = 'opening';
  p.variables = [{ id: 'affection', name: '好感度', type: 'number', initial: 0, persistent: false }];
  const passage = (id: string, name: string, sceneId: string, x: number, y: number, text: string, next?: string): PassageNode => ({
    id, kind: 'passage', name, sceneId, x, y, lines: [{ id: id + '_line', text, actions: [] }], next,
  });
  p.nodes = [
    passage('opening', '抵达车站', 'station', 20, 180, '钟声响起，我们来到车站。', 'choice'),
    { id: 'choice', kind: 'choice', name: '车站的选择', sceneId: 'station', x: 355, y: 180, prompt: '接下来去哪里？', choices: [{ id: 'leave', text: '一起离开', target: 'leave_story' }, { id: 'stay', text: '留在车站', target: 'stay_story' }] },
    passage('leave_story', '离开前的约定', 'station', 690, 70, '请记住这个约定。', 'port_story'),
    passage('stay_story', '灯下的谈话', 'station', 690, 335, '我们在灯下继续谈话。', 'night'),
    passage('night', '夜晚', 'station', 1030, 335, '夜色渐深。', 'end'),
    { id: 'end', kind: 'end', name: '返回标题界面', sceneId: 'station', x: 1370, y: 335 },
    passage('port_story', '港口重逢', 'port', 50, 170, '船还在等我们。', 'remember'),
    { id: 'remember', kind: 'call', name: '回想约定', sceneId: 'port', x: 390, y: 170, target: 'memory', next: 'back_to_station' },
    { id: 'back_to_station', kind: 'jump', name: '返回车站支线', sceneId: 'port', x: 730, y: 170, target: 'stay_story' },
    passage('memory', '共同回忆', 'common', 80, 150, '那时我们还不知道明天的事。', 'memory_return'),
    { id: 'memory_return', kind: 'return', name: '结束回忆', sceneId: 'common', x: 420, y: 150 },
  ];
  return p;
}
