import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectSchema } from '../../src/core/model';
import { synchronizeBlueprintSignatures } from '../../src/core/blueprint';
import { createUiVoicePreviewFixture, writeUiVoicePreviewAudio } from './ui-voice-preview-fixture';

/** Original editable page artwork, with synthetic voices and isolated player data. */
export async function createAihongVoiceBehaviorFixture(root: string, directory: string) {
 for (const relative of ['resources/templates/aihong', 'artifacts/aihong-template']) {
  const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(root, relative, 'project.vns.json'), 'utf8')));
  const list = template.ui.components.find(c => c.id === 'ai_voicecollection_items')!.list!;
  assert.equal(list.voiceOrder, 'favorites'); assert.equal(list.voiceRemoveConfirm, true);
 }
 const templateDirectory = path.join(root, 'resources/templates/aihong');
 const template = projectSchema.parse(JSON.parse(await fs.readFile(path.join(templateDirectory, 'project.vns.json'), 'utf8')));
 const { project } = createUiVoicePreviewFixture();
 project.name = '哀鸿语音收藏操作验收';
 project.ui.components = project.ui.components.filter(c => !['voiceCollection', 'messageBox'].includes(c.page));
 project.ui.components.push(...structuredClone(template.ui.components.filter(c => ['voiceCollection', 'messageBox'].includes(c.page))).map(c => c.id === 'ai_voicecollection_items' ? { ...c, id: 'voice_list' } : c));
 project.ui.pages!.voiceCollection = structuredClone(template.ui.pages!.voiceCollection);
 project.ui.pages!.messageBox = structuredClone(template.ui.pages!.messageBox);
 const dependencies = new Set<string>();
 const collect = (value: unknown) => {
  if (typeof value === 'string') dependencies.add(value);
  else if (Array.isArray(value)) value.forEach(collect);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
 };
 collect([project.ui.components, project.ui.pages]);
 await writeUiVoicePreviewAudio(directory);
 for (const asset of template.assets.filter(a => dependencies.has(a.id))) {
  project.assets.push(structuredClone(asset));
  const target = path.resolve(directory, asset.path);
  assert.ok(target.startsWith(path.resolve(directory) + path.sep));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.resolve(templateDirectory, asset.path), target);
 }
 synchronizeBlueprintSignatures(project);
 return projectSchema.parse(project);
}
