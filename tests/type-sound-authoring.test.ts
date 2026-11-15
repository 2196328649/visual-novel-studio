import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, projectSchema, type Project, type TextPresentation } from '../src/core/model';
import { editTextTypeSound, effectiveTextStyle, mergeTextStyles, speakerTextStyle, textRevealPlan, textRuntimeLook, textTypeSoundMode, typeSoundTimes } from '../src/core/text-presentation';
import { applyTextScript, projectToText } from '../src/core/text-script';
import { compileProject } from '../src/runtime/compiler';

function fixture() {
  const project = createProject('打字音来源');
  project.assets.push(
    { id: 'actor_sound', kind: 'audio', name: '角色声音', path: 'actor.wav' },
    { id: 'line_sound', kind: 'audio', name: '本句声音', path: 'line.wav' },
    { id: 'new_sound', kind: 'audio', name: '新声音', path: 'new.wav' },
  );
  project.characters = [{ id: 'speaker', name: '说话人', color: '#ffffff', expressions: [], textPresentation: { typeSoundId: 'actor_sound', typeSoundVolume: .4, typeSoundEvery: 2 } }];
  const line = lines(project)[0];
  line.text = '一二三四五六'; line.speakerId = 'speaker';
  return { project, line };
}
const lines = (project: Project) => project.nodes.flatMap(node => node.kind === 'passage' ? node.lines : []);

test('choosing no sound silences the line in schema, preview and compiled dialogue without losing its other style', () => {
  const { project, line } = fixture();
  const own: TextPresentation = { typeSoundId: 'line_sound', typeSoundVolume: .8, typeSoundEvery: 3, color: '#ff1234', bold: false };
  line.textPresentation = editTextTypeSound(own, speakerTextStyle(project, 'speaker'), 'mute');
  assert.deepEqual(own, { typeSoundId: 'line_sound', typeSoundVolume: .8, typeSoundEvery: 3, color: '#ff1234', bold: false }, 'editing never mutates the source');
  const saved = projectSchema.parse(project), savedLine = lines(saved)[0], style = effectiveTextStyle(saved, savedLine);
  assert.equal(savedLine.textPresentation?.typeSoundId, 'line_sound');
  assert.equal(savedLine.textPresentation?.typeSoundVolume, 0);
  assert.equal(savedLine.textPresentation?.color, '#ff1234');
  assert.equal(savedLine.textPresentation?.bold, false);
  assert.equal(textTypeSoundMode(savedLine.textPresentation, style), 'mute');
  assert.deepEqual(typeSoundTimes(style, line.text, textRevealPlan(style, line.text, 30)), []);
  assert.equal(textRuntimeLook(saved, style, line.text)?.typeSound, undefined);
  const built = compileProject(saved);
  assert.deepEqual(built.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.ok(!built.files['game/story.rpy'].includes('"typeSound"'));
});

test('no sound overrides a character sound even when the line has never set a local sound ID', () => {
  const { project, line } = fixture();
  const base = speakerTextStyle(project, 'speaker');
  line.textPresentation = editTextTypeSound({ italic: true }, base, 'mute');
  const style = effectiveTextStyle(project, line);
  assert.deepEqual(line.textPresentation, { italic: true, typeSoundVolume: 0 });
  assert.equal(style.typeSoundId, 'actor_sound');
  assert.equal(textRuntimeLook(project, style, line.text)?.typeSound, undefined);
  assert.equal(textTypeSoundMode(line.textPresentation, style), 'mute');
});

test('restoring sound inheritance clears ID, volume and beat together and resumes the current character settings', () => {
  const { project, line } = fixture();
  line.textPresentation = editTextTypeSound({ typeSoundId: 'line_sound', typeSoundVolume: 0, typeSoundEvery: 6, italic: true }, speakerTextStyle(project, 'speaker'), 'inherit');
  assert.deepEqual(line.textPresentation, { italic: true });
  let style = effectiveTextStyle(project, line);
  assert.equal(textTypeSoundMode(line.textPresentation, style), 'inherit');
  assert.deepEqual(textRuntimeLook(project, style, line.text)?.typeSound, { path: 'actor.wav', volume: .4, marks: [[0, 1], [0, 3], [0, 5]] });
  project.characters[0].textPresentation!.typeSoundVolume = .6;
  style = effectiveTextStyle(project, line);
  assert.equal((textRuntimeLook(project, style, line.text)?.typeSound as { volume: number }).volume, .6);
});

test('old sound ID plus zero volume is shown as mute; selecting a sound makes it audible again', () => {
  const { project, line } = fixture();
  const old: TextPresentation = { typeSoundId: 'line_sound', typeSoundVolume: 0, typeSoundEvery: 3 };
  assert.equal(textTypeSoundMode(old, mergeTextStyles(speakerTextStyle(project, 'speaker'), old)), 'mute');
  line.textPresentation = editTextTypeSound(old, speakerTextStyle(project, 'speaker'), 'sound', 'new_sound');
  const style = effectiveTextStyle(project, line);
  assert.equal(textTypeSoundMode(line.textPresentation, style), 'sound');
  assert.equal((textRuntimeLook(project, style, line.text)?.typeSound as { path: string; volume: number }).path, 'new.wav');
  assert.equal(style.typeSoundVolume, .4);
  assert.equal(style.typeSoundEvery, 3);
  assert.equal(old.typeSoundVolume, 0);
});

test('selecting a sound above a muted character or preset re-enables volume while preserving positive custom volume', () => {
  const { project, line } = fixture();
  project.textPresets = [{ id: 'muted_preset', name: '静音预设', style: { typeSoundId: 'actor_sound', typeSoundVolume: 0 } }];
  const base = mergeTextStyles(speakerTextStyle(project, 'speaker'), project.textPresets[0].style);
  const inherited: TextPresentation = { presetId: 'muted_preset' };
  assert.equal(textTypeSoundMode(inherited, base), 'inherit', 'no local override still follows its source, even when that source is muted');
  line.textPresentation = editTextTypeSound(inherited, base, 'sound', 'line_sound');
  assert.equal(effectiveTextStyle(project, line).typeSoundVolume, 1);
  assert.ok(textRuntimeLook(project, effectiveTextStyle(project, line), line.text)?.typeSound);
  const selected = editTextTypeSound({ typeSoundVolume: .25 }, base, 'sound', 'new_sound');
  assert.equal(selected.typeSoundVolume, .25);
  assert.deepEqual(editTextTypeSound(selected, base, 'inherit'), {});
});

test('character silence is inherited by its lines and keeps the existing readable script format', () => {
  const { project, line } = fixture();
  project.characters[0].textPresentation = editTextTypeSound(project.characters[0].textPresentation!, undefined, 'mute');
  assert.equal(textRuntimeLook(project, effectiveTextStyle(project, line), line.text)?.typeSound, undefined);
  line.textPresentation = { typeSoundId: 'line_sound', typeSoundVolume: 0, typeSoundEvery: 4 };
  const source = projectToText(project), parsed = applyTextScript(project, source);
  assert.deepEqual(parsed.issues.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(lines(parsed.project)[0].textPresentation, line.textPresentation);
  assert.equal(textRuntimeLook(parsed.project, effectiveTextStyle(parsed.project, lines(parsed.project)[0]), line.text)?.typeSound, undefined);
});

test('no sound saved as a preset stays muted until sound playback is explicitly enabled', () => {
  const { project, line } = fixture();
  const preset = editTextTypeSound({ typeSoundId: 'line_sound', typeSoundEvery: 3 }, undefined, 'mute');
  project.textPresets = [{ id: 'silent_look', name: '无打字音', style: preset }];
  line.textPresentation = { presetId: 'silent_look', color: '#abcdef' };
  let style = effectiveTextStyle(projectSchema.parse(project), line);
  assert.equal(textTypeSoundMode(line.textPresentation, style), 'inherit');
  assert.equal(style.typeSoundVolume, 0);
  assert.equal(textRuntimeLook(project, style, line.text)?.typeSound, undefined);
  line.textPresentation = editTextTypeSound(line.textPresentation, mergeTextStyles(speakerTextStyle(project, 'speaker'), preset), 'sound');
  style = effectiveTextStyle(project, line);
  assert.equal(style.typeSoundId, 'line_sound');
  assert.equal(style.typeSoundVolume, 1);
  assert.equal(style.typeSoundEvery, 3);
  assert.equal(line.textPresentation.color, '#abcdef');
  assert.ok(textRuntimeLook(project, style, line.text)?.typeSound);
});

test('a derived character can resume inherited muted sound without creating a local sound ID', () => {
  const { project, line } = fixture();
  project.characters[0].textPresentation = { typeSoundId: 'actor_sound', typeSoundVolume: 0, typeSoundEvery: 3 };
  project.characters.push({ id: 'child', name: '下级角色', color: '#ffffff', expressions: [], baseCharacterId: 'speaker', textPresentation: { bold: false, entranceTime: 0 } });
  const child = project.characters[1], base = speakerTextStyle(project, 'speaker');
  assert.equal(textTypeSoundMode(child.textPresentation, speakerTextStyle(project, 'child')), 'inherit');
  child.textPresentation = editTextTypeSound(child.textPresentation!, base, 'sound');
  assert.deepEqual(child.textPresentation, { bold: false, entranceTime: 0, typeSoundVolume: 1 });
  line.speakerId = 'child';
  let style = effectiveTextStyle(projectSchema.parse(project), line);
  assert.equal(style.typeSoundId, 'actor_sound');
  assert.equal(style.typeSoundEvery, 3);
  assert.equal(style.typeSoundVolume, 1);
  assert.ok(textRuntimeLook(project, style, line.text)?.typeSound);
  child.textPresentation = editTextTypeSound(child.textPresentation, base, 'inherit');
  style = effectiveTextStyle(project, line);
  assert.deepEqual(child.textPresentation, { bold: false, entranceTime: 0 });
  assert.equal(style.typeSoundVolume, 0);
  assert.equal(textRuntimeLook(project, style, line.text)?.typeSound, undefined);
});
