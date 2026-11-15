import { blueprintFromPerformance } from '../../src/core/blueprint-authoring';
import type { ActorTransitions, Project, StageAction } from '../../src/core/model';
import { textCommandAction } from '../../src/core/text-script';
import { pythonLiteral as q } from '../../src/runtime/literals';
import assert from 'node:assert/strict';
import path from 'node:path';

export interface ActorNativeCase { name: string; source: string }
const rules: Required<ActorTransitions> = { enter: { mode: 'dissolve', duration: .4 }, expression: { mode: 'dissolve', duration: .25 }, exit: { mode: 'dissolve', duration: .7 } };
type Show = Extract<StageAction, { kind: 'show' }>;
const show = (characterId: string, x: number, expression = 'normal', instanceId = ''): Show => ({
  kind: 'show', characterId, expressionId: characterId ? characterId + '_' + expression : '',
  x, y: 1, scale: 1, layer: 10, transition: 'dissolve', lifetime: 'line', actorTransitions: rules,
  ...(instanceId ? { instanceId } : {}),
});
const background: StageAction = { kind: 'background', assetId: 'dark', transition: 'none' };

/** Ordinary authored lines and graphs; tests only navigate to each scenario's
 * initial dialogue. Every tested boundary then advances through real dialogue. */
export function addActorContinuityFixture(project: Project): void {
  const sceneId = project.scenes[0].id;
  const a = (expression = 'normal') => show('a', .25, expression);
  const b = (expression = 'normal') => show('b', .75, expression);
  const graph = blueprintFromPerformance(project, [a('happy'), b('happy')], '双角色换表情');
  const defaults = blueprintFromPerformance(project, [show('', .25), { ...b(), expressionId: '' }], '跟随发言人与默认表情');
  const nested = blueprintFromPerformance(project, [{ kind: 'blueprint', blueprintId: defaults.id }], '嵌套双人默认表情');
  project.blueprints.push(graph, defaults, nested);
  // Keep the reported script's named characters and explicit portrait targets.
  // These three fixture-only characters have no character/line phase override.
  // Literal left/right presets keep the opaque test rectangles non-overlapping.
  const userPresets = () => [
    { id: 'left', name: '左', x: .25, y: 1, scale: 1, useDefaultFraming: false },
    { id: 'right', name: '右', x: .75, y: 1, scale: 1, useDefaultFraming: false },
  ];
  project.characters.push(
    { id: 'qa_yuan', name: '鸢', color: '#ffffff', displayPresets: userPresets(), expressions: [
      { id: 'qa_yuan_shadow', name: '影', assetId: 'red' }, { id: 'qa_yuan_serious', name: '严肃', assetId: 'green' },
    ] },
    { id: 'qa_zhao', name: '赵老头', color: '#ffffff', displayPresets: userPresets(), expressions: [
      { id: 'qa_zhao_normal', name: '通常', assetId: 'red' }, { id: 'qa_zhao_shadow', name: '影', assetId: 'green' },
    ] },
    { id: 'qa_merchant', name: '赵掌柜', color: '#ffffff', expressions: [] },
  );
  const userShow = (command: string): Show => {
    const action = textCommandAction(project, command, true);
    assert.ok(action?.kind === 'show', command);
    assert.equal(action.lifetime, 'line');
    assert.equal(action.actorTransitions, undefined, 'The reported command must exercise default phase timing.');
    assert.equal(action.duration, undefined);
    return action;
  };
  const yuanShadow = '@显示角色：角色=鸢，表情=影，站位预设=left，显示范围=仅本句';
  const yuanSerious = '@显示角色：角色=鸢，表情=严肃，站位预设=left，显示范围=仅本句';
  const zhaoNormal = '@显示角色：角色=赵老头，表情=通常，站位预设=right，显示范围=仅本句';
  const zhaoShadow = '@显示角色：角色=赵老头，表情=影，站位预设=right，显示范围=仅本句';
  const scenarios: { id: string; lines: { id: string; actions: StageAction[]; speakerId?: string }[] }[] = [
    { id: 'pair', lines: [
      { id: 'pair_seed', actions: [background, a(), b()] },
      { id: 'pair_same', actions: [a(), b()] },
      { id: 'pair_one', actions: [a('happy'), b()] },
      { id: 'pair_reverse', actions: [b('happy'), a()] },
      { id: 'pair_default', speakerId: 'a', actions: [{ ...b(), expressionId: '' }, show('', .25)] },
      { id: 'pair_replace', actions: [a('happy'), show('c', .75)] },
      { id: 'pair_empty', actions: [] },
    ] },
    { id: 'blueprints', lines: [
      { id: 'graph_seed', actions: [background, a(), b()] },
      { id: 'graph_changed', actions: [{ kind: 'blueprint', blueprintId: graph.id }] },
      { id: 'graph_defaults', speakerId: 'a', actions: [{ kind: 'blueprint', blueprintId: nested.id }] },
    ] },
    { id: 'pause', lines: [
      { id: 'pause_seed', actions: [background, a(), b()] },
      { id: 'pause_zero', actions: [a('happy'), { kind: 'pause', seconds: 0 }, b()] },
      { id: 'pause_again', actions: [a(), b()] },
      { id: 'pause_positive', actions: [a('happy'), { kind: 'pause', seconds: .15 }, b()] },
    ] },
    { id: 'named', lines: [
      { id: 'named_seed', actions: [background, show('a', .25, 'normal', 'left'), show('a', .75, 'normal', 'right')] },
      { id: 'named_changed', actions: [show('a', .25, 'happy', 'left'), show('a', .75, 'normal', 'right')] },
    ] },
    { id: 'numbers', lines: [
      { id: 'numbers_seed', actions: [background, a(), show('a', .75, 'normal', '2'), show('a', .5, 'normal', '3')] },
      { id: 'numbers_changed', actions: [show('a', .5, 'happy', '3'), show('a', .75, 'happy', '2'), show('a', .25, 'happy', '1')] },
      { id: 'numbers_hide_one', actions: [{ kind: 'hide', characterId: 'a', instanceId: '1', transition: 'none' }, show('a', .75, 'happy', '2'), show('a', .5, 'happy', '3')] },
      { id: 'numbers_animate_two', actions: [show('a', .75, 'happy', '2'), show('a', .5, 'happy', '3'), { kind: 'animate', characterId: 'a', instanceId: '2', wait: true, repeat: false, keyframes: [{ x: .68, y: 1, scale: 1, rotation: 12, opacity: 1, duration: .2, easing: 'linear' }] }] },
      { id: 'numbers_shared_seed', actions: [background, show('a', .25, 'normal', '2'), show('b', .75, 'normal', '2')] },
      { id: 'numbers_shared_changed', actions: [show('b', .75, 'happy', '2'), show('a', .25, 'happy', '2')] },
    ] },
    { id: 'user_defaults', lines: [
      { id: 'user_before', speakerId: 'qa_yuan', actions: [background] },
      { id: 'user_seed', speakerId: 'qa_merchant', actions: [userShow(yuanShadow), userShow(zhaoNormal)] },
      { id: 'user_changed', speakerId: 'qa_yuan', actions: [userShow(yuanSerious), userShow(zhaoShadow)] },
      { id: 'user_same', speakerId: 'qa_yuan', actions: [userShow(yuanSerious), userShow(zhaoShadow)] },
    ] },
  ];
  for (const [index, scenario] of scenarios.entries()) project.nodes.push({
    id: 'qa_continuity_' + scenario.id, name: '角色续接 ' + scenario.id, kind: 'passage', sceneId,
    x: 500 + index * 300, y: 500, next: 'qa_continuity_' + scenario.id,
    lines: scenario.lines.map(line => ({ ...line, text: line.id + '.' })),
  });
}

const advance = (window: string, line: string) => `    $ qa_watch(${q(window)})
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until ${q(line + '.')}
    $ qa_stop_watch()`;
const tag = (character: string, instance = '') => `vn_actor_tag(${q(character)}, ${q(instance)})`;
const events = (window: string, values: [string, string, boolean][]) => `qa_continued(${q(window)}, [${values.map(([character, instance, changed]) => `(${tag(character, instance)}, ${changed ? 'True' : 'False'})`).join(', ')}])`;
const pixels = (window: string, leftFrom: string, leftTo: string, rightFrom: string, rightTo: string) =>
  `qa_solid_path(${q(window)}, "left", ${q(leftFrom)}, ${q(leftTo)}) and qa_solid_path(${q(window)}, "right", ${q(rightFrom)}, ${q(rightTo)})`;

export function actorContinuityCases(): ActorNativeCase[] {
  const start = (name: string, scenario: string, line: string) => `testcase ${name}:
    $ qa_begin_case(${q(name)})
    click id "vn_main_start"
    pause until "First."
    run Jump(${q('vn_node_qa_continuity_' + scenario)})
    pause until ${q(line + '.')}
    move pos (780, 80)
`;
  return [
    { name: 'pair_continuity', source: start('pair_continuity', 'pair', 'pair_seed') + `
    assert eval qa_registry([("a", "", "normal"), ("b", "", "normal")])
${advance('pair_same', 'pair_same')}
    assert eval ${events('pair_same', [['a', '', false], ['b', '', false]])}
    assert eval ${pixels('pair_same', 'red', 'red', 'red', 'red')}
${advance('pair_one', 'pair_one')}
    assert eval ${events('pair_one', [['a', '', true], ['b', '', false]])}
    assert eval ${pixels('pair_one', 'red', 'green', 'red', 'red')}
${advance('pair_reverse', 'pair_reverse')}
    assert eval ${events('pair_reverse', [['a', '', true], ['b', '', true]])}
    assert eval ${pixels('pair_reverse', 'green', 'red', 'red', 'green')}
${advance('pair_default', 'pair_default')}
    assert eval ${events('pair_default', [['a', '', false], ['b', '', true]])}
    assert eval ${pixels('pair_default', 'red', 'red', 'green', 'red')}
    assert eval qa_registry([("a", "", "normal"), ("b", "", "normal")])
${advance('pair_replace', 'pair_replace')}
    assert eval ${events('pair_replace', [['a', '', true]])}
    assert eval qa_solid_path("pair_replace", "left", "red", "green")
    assert eval qa_replaced("pair_replace", ${tag('b')}, ${tag('c')})
    assert eval qa_registry([("a", "", "happy"), ("c", "", "normal")])
${advance('pair_empty', 'pair_empty')}
    assert eval not vn_actor_instances and not vn_actor_pending_exit and not vn_actor_departures
    assert eval qa_retired("pair_empty", [${tag('a')}, ${tag('c')}])
    screenshot "pair-empty.png"
` },
    { name: 'blueprint_continuity', source: start('blueprint_continuity', 'blueprints', 'graph_seed') + `
${advance('graph_changed', 'graph_changed')}
    assert eval ${events('graph_changed', [['a', '', true], ['b', '', true]])}
    assert eval ${pixels('graph_changed', 'red', 'green', 'red', 'green')}
${advance('graph_defaults', 'graph_defaults')}
    assert eval ${events('graph_defaults', [['a', '', true], ['b', '', true]])}
    assert eval ${pixels('graph_defaults', 'green', 'red', 'green', 'red')}
    assert eval qa_registry([("a", "", "normal"), ("b", "", "normal")]) and not vn_actor_transition_overrides
    screenshot "blueprint-defaults.png"
` },
    { name: 'pause_boundaries', source: start('pause_boundaries', 'pause', 'pause_seed') + `
${advance('pause_zero', 'pause_zero')}
    assert eval qa_pause_boundary("pause_zero", ${tag('a')}, ${tag('b')}, 0)
    assert eval qa_solid_path("pause_zero", "left", "red", "green")
    assert eval qa_registry([("a", "", "happy"), ("b", "", "normal")])
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until "pause_again."
${advance('pause_positive', 'pause_positive')}
    assert eval qa_pause_boundary("pause_positive", ${tag('a')}, ${tag('b')}, .15)
    assert eval qa_solid_path("pause_positive", "left", "red", "green")
    assert eval qa_registry([("a", "", "happy"), ("b", "", "normal")])
    screenshot "pause-groups.png"
` },
    { name: 'named_instances_save_load', source: start('named_instances_save_load', 'named', 'named_seed') + `
    assert eval qa_registry([("a", "left", "normal"), ("a", "right", "normal")])
    run FileSave("qa_actor_named", confirm=False, slot=True)
    assert eval renpy.can_load("qa_actor_named")
${advance('named_before_load', 'named_changed')}
    assert eval ${events('named_before_load', [['a', 'left', true], ['a', 'right', false]])}
    assert eval ${pixels('named_before_load', 'red', 'green', 'red', 'red')}
    $ qa_probe.loaded_epoch = qa_probe.epoch
    run FileLoad("qa_actor_named", confirm=False, slot=True)
    pause until "named_seed."
    assert eval qa_probe.epoch > qa_probe.loaded_epoch and qa_registry([("a", "left", "normal"), ("a", "right", "normal")])
${advance('named_after_load', 'named_changed')}
    assert eval ${events('named_after_load', [['a', 'left', true], ['a', 'right', false]])}
    assert eval ${pixels('named_after_load', 'red', 'green', 'red', 'red')}
    screenshot "named-restored-continuity.png"
` },
    { name: 'numbered_instances', source: start('numbered_instances', 'numbers', 'numbers_seed') + `
    assert eval ${tag('a', '1')} == ${tag('a')} and len(set([${tag('a')}, ${tag('a', '2')}, ${tag('a', '3')}])) == 3
    assert eval qa_registry([("a", "", "normal"), ("a", "2", "normal"), ("a", "3", "normal")])
    run FileSave("qa_actor_numbered", confirm=False, slot=True)
    assert eval renpy.can_load("qa_actor_numbered")
${advance('numbers_changed', 'numbers_changed')}
    assert eval ${events('numbers_changed', [['a', '1', true], ['a', '2', true], ['a', '3', true]])}
    assert eval ${pixels('numbers_changed', 'red', 'green', 'red', 'green')} and qa_solid_path("numbers_changed", "center", "red", "green")
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until "numbers_hide_one."
    assert eval not renpy.showing(${tag('a')}) and qa_registry([("a", "2", "happy"), ("a", "3", "happy")])
    $ qa_probe.third = renpy.display.core.displayable_by_tag("master", ${tag('a', '3')})
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until "numbers_animate_two."
    assert eval .67 < qa_actor_x(${tag('a', '2')}) < .69 and renpy.display.core.displayable_by_tag("master", ${tag('a', '2')}).state.rotate == 12
    assert eval renpy.display.core.displayable_by_tag("master", ${tag('a', '3')}) is qa_probe.third and .49 < qa_actor_x(${tag('a', '3')}) < .51
    screenshot "number-two-independent-motion.png"
    $ qa_probe.loaded_epoch = qa_probe.epoch
    run FileLoad("qa_actor_numbered", confirm=False, slot=True)
    pause until "numbers_seed."
    assert eval qa_probe.epoch > qa_probe.loaded_epoch and qa_registry([("a", "", "normal"), ("a", "2", "normal"), ("a", "3", "normal")])
${advance('numbers_restored', 'numbers_changed')}
    assert eval ${events('numbers_restored', [['a', '', true], ['a', '2', true], ['a', '3', true]])}
    assert eval ${pixels('numbers_restored', 'red', 'green', 'red', 'green')} and qa_solid_path("numbers_restored", "center", "red", "green")
    advance until "numbers_shared_seed."
    assert eval ${tag('a', '2')} != ${tag('b', '2')} and qa_registry([("a", "2", "normal"), ("b", "2", "normal")])
${advance('numbers_shared_changed', 'numbers_shared_changed')}
    assert eval ${events('numbers_shared_changed', [['a', '2', true], ['b', '2', true]])}
    assert eval ${pixels('numbers_shared_changed', 'red', 'green', 'red', 'green')}
    screenshot "different-characters-number-two.png"
` },
    { name: 'user_text_default_continuity', source: start('user_text_default_continuity', 'user_defaults', 'user_before') + `
    assert eval vn_current_speaker == "qa_yuan" and not vn_actor_instances
    $ renpy.test.testmouse.click_mouse(1, 780, 80)
    pause until "user_seed."
    assert eval vn_current_speaker == "qa_merchant" and qa_registry([("qa_yuan", "", "shadow"), ("qa_zhao", "", "normal")])
    assert eval all(actor["transitions"] == {phase: dict(mode="dissolve", duration=.5) for phase in ("enter", "expression", "exit")} for actor in vn_actor_instances.values())
    assert eval not vn_actor_transition_overrides and all(vn_bp_characters[character].get("transitions") is None for character in ("qa_yuan", "qa_zhao", "qa_merchant"))
${advance('user_changed', 'user_changed')}
    assert eval qa_continued("user_changed", [(${tag('qa_yuan')}, True), (${tag('qa_zhao')}, True)], expression_duration=.5)
    assert eval ${pixels('user_changed', 'red', 'green', 'red', 'green')}
    assert eval vn_current_speaker == "qa_yuan" and qa_registry([("qa_yuan", "", "serious"), ("qa_zhao", "", "shadow")]) and not renpy.showing(${tag('qa_merchant')})
${advance('user_same', 'user_same')}
    assert eval qa_continued("user_same", [(${tag('qa_yuan')}, False), (${tag('qa_zhao')}, False)], expression_duration=.5)
    assert eval ${pixels('user_same', 'green', 'green', 'green', 'green')}
    screenshot "user-text-default-continuity.png"
` },
  ];
}

/** Observe the actual renderer and product calls. No probe advances a product
 * clock, creates an actor or reduces an authored wait. Function attributes keep
 * evidence outside rollback; object references prevent identity reuse. */
export function actorContinuityObserver(output: string): string {
  return String.raw`init -999 python:
    import renpy as qa_engine
    qa_engine.safe_mode_checked = True

init 999 python:
    import time as qa_time, json as qa_json, os as qa_os
    def qa_probe():
        pass
    def qa_copy(value):
        return qa_json.loads(qa_json.dumps(value))
    def qa_now():
        return qa_time.monotonic() - qa_probe.started
    def qa_display(tag):
        return renpy.display.core.displayable_by_tag("master", tag)
    def qa_state():
        return {tag: dict(characterId=row["characterId"], expressionId=row["expressionId"], lifetime=row.get("lifetime"), signature=qa_copy(row.get("signature")), displayableId=id(qa_display(tag)) if qa_display(tag) is not None else None, showing=renpy.showing(tag)) for tag, row in vn_actor_instances.items()}
    def qa_begin_case(name):
        qa_probe.name, qa_probe.started, qa_probe.window, qa_probe.epoch = name, qa_time.monotonic(), None, 0
        qa_probe.frames, qa_probe.events, qa_probe.references, qa_probe.loads = [], [], [], []
        qa_probe.windows, qa_probe.shots = {}, {}
        qa_probe.last_frame, qa_probe.watch = -1.0, True
    def qa_actor_x(tag):
        frame = vn_actor_frame(qa_display(tag))
        pos = frame.visit()[0].get_placement()[0]
        return getattr(pos, "relative", pos)
    def qa_watch(name):
        qa_probe.window = name
        qa_probe.windows[name] = dict(start=qa_now(), epoch=qa_probe.epoch, before=qa_state())
        qa_capture(False)
    def qa_stop_watch():
        qa_capture(False)
        qa_probe.windows[qa_probe.window].update(end=qa_now(), after=qa_state())
        qa_probe.window = None
    def qa_capture(actual_draw):
        if not qa_probe.watch or (qa_probe.name != "phases" and qa_probe.window is None):
            return
        if actual_draw and qa_probe.name == "phases" and qa_now() - qa_probe.last_frame < .03:
            return
        started = qa_time.monotonic()
        surface = renpy.display.draw.screenshot(renpy.display.interface.surftree)
        width, height = surface.get_size()
        pixels = {name: list(surface.get_at((int(width * x), int(height * .48))))[:3] for name, x in (("left", .25), ("center", .5), ("right", .75))}
        row = dict(line=vn_current_line, time=qa_now(), epoch=qa_probe.epoch, window=qa_probe.window, actualDraw=actual_draw, pixels=pixels,
            pixel=list(surface.get_at((int(width * .5), int(height * .5))))[:3], actors=qa_state(), pending=list(vn_actor_pending_exit), departures=list(vn_actor_departures))
        row["readbackSeconds"] = qa_time.monotonic() - started
        qa_probe.frames.append(row)
        qa_probe.last_frame = row["time"]
        if qa_probe.window:
            count = sum(1 for frame in qa_probe.frames if frame["window"] == qa_probe.window and frame["actualDraw"])
            if (not actual_draw and count == 0) or (actual_draw and count in (1, 4, 10)):
                qa_probe.shots[qa_probe.window + ("-baseline" if not actual_draw else "-draw-" + str(count))] = surface.copy()
        elif vn_current_line == "none" and "legacy-exit-mid" not in qa_probe.shots and sum(1 for frame in qa_probe.frames if frame["line"] == "none") >= 3:
            qa_probe.shots["legacy-exit-mid"] = surface.copy()
    def qa_record(self, root_widget, fullscreen_video, draw):
        result = qa_record.original(self, root_widget, fullscreen_video, draw)
        if draw:
            qa_capture(True)
        return result
    def qa_event(kind, tag, **fields):
        row = dict(kind=kind, tag=tag, window=qa_probe.window, line=vn_current_line, time=qa_now(), epoch=qa_probe.epoch, **fields)
        qa_probe.events.append(row)
        return row
    def qa_show(tag, image_name, motion, signature, actor, rules, wait):
        before = qa_display(tag)
        row = qa_event("show", tag, old=qa_copy(vn_actor_instances.get(tag)), previousPresent=before is not None, previousId=id(before) if before is not None else None)
        result = qa_show.original(tag, image_name, motion, signature, actor, rules, wait)
        after = qa_display(tag)
        qa_probe.references.extend([before, after])
        row.update(sameDisplayable=before is after, currentId=id(after) if after is not None else None, actor=qa_copy(vn_actor_instances.get(tag)))
        return result
    def qa_blend(tag, previous, current, rule, layer, wait):
        row = qa_event("blend", tag, previousPresent=previous is not None, currentPresent=current is not None, rule=qa_copy(rule), wait=wait)
        result = qa_blend.original(tag, previous, current, rule, layer, wait)
        row.update(created=result is not None, started=getattr(result, "started", None))
        return result
    def qa_depart(tag, actor, rule=None, wait=None):
        qa_event("depart", tag, actor=qa_copy(actor), previousPresent=qa_display(tag) is not None)
        return qa_depart.original(tag, actor, rule, wait)
    def qa_loaded():
        qa_probe.epoch += 1
        qa_probe.loads.append(dict(epoch=qa_probe.epoch, time=qa_now(), line=vn_current_line, actors=qa_state()))
    def qa_events(name, kind, tag=None):
        return [row for row in qa_probe.events if row["window"] == name and row["kind"] == kind and (tag is None or row["tag"] == tag)]
    def qa_registry(expected):
        keys = [vn_actor_tag(character, instance) for character, instance, expression in expected]
        return len(keys) == len(set(keys)) and set(vn_actor_instances) == set(keys) and all(vn_actor_instances.get(vn_actor_tag(character, instance), {}).get("characterId") == character and vn_actor_instances.get(vn_actor_tag(character, instance), {}).get("expressionId") == character + "_" + expression and vn_actor_instances.get(vn_actor_tag(character, instance), {}).get("lifetime") == "line" and renpy.showing(vn_actor_tag(character, instance)) for character, instance, expression in expected)
    def qa_continued(name, expected, expression_duration=.25):
        for tag, changed in expected:
            shows, blends = qa_events(name, "show", tag), qa_events(name, "blend", tag)
            if len(shows) != 1 or not shows[0]["previousPresent"] or shows[0]["old"] is None or qa_events(name, "depart", tag):
                return False
            if changed:
                if len(blends) != 1 or not all(blends[0][key] for key in ("previousPresent", "currentPresent", "created")) or blends[0]["rule"] != dict(mode="dissolve", duration=expression_duration):
                    return False
            elif not shows[0]["sameDisplayable"] or blends:
                return False
        return True
    qa_colors = dict(red=(220, 40, 50), green=(30, 210, 70), dark=(6, 8, 12))
    def qa_close(pixel, color, tolerance=10):
        return all(abs(a - b) <= tolerance for a, b in zip(pixel, color))
    def qa_progress(pixel, first, last):
        delta = [b - a for a, b in zip(first, last)]
        return sum((p - a) * d for p, a, d in zip(pixel, first, delta)) / float(sum(d * d for d in delta))
    def qa_solid_path(name, side, before, after):
        rows = [row for row in qa_probe.frames if row["window"] == name]
        drawn = [row for row in rows if row["actualDraw"]]
        first, last = qa_colors[before], qa_colors[after]
        if not rows or not drawn or not qa_close(rows[0]["pixels"][side], first) or not qa_close(rows[-1]["pixels"][side], last):
            return False
        values = [row["pixels"][side] for row in rows]
        if before == after:
            return all(qa_close(pixel, first) for pixel in values)
        if len(drawn) < 3 or qa_progress(drawn[0]["pixels"][side], first, last) > .4:
            return False
        for pixel in values:
            progress = qa_progress(pixel, first, last)
            expected = [a + (b - a) * progress for a, b in zip(first, last)]
            if not -.06 <= progress <= 1.06 or not qa_close(pixel, expected) or abs(sum(pixel) - sum(first)) > 18:
                return False
        return any(.12 < qa_progress(row["pixels"][side], first, last) < .88 for row in drawn)
    def qa_replaced(name, leaving, entering):
        departures, entries = qa_events(name, "depart", leaving), qa_events(name, "show", entering)
        blends = qa_events(name, "blend", entering)
        elapsed = qa_probe.windows[name]["end"] - qa_probe.windows[name]["start"]
        return len(departures) == len(entries) == len(blends) == 1 and not entries[0]["previousPresent"] and blends[0]["created"] and blends[0]["rule"] == dict(mode="dissolve", duration=.4) and abs(departures[0]["time"] - entries[0]["time"]) < .2 and .6 < elapsed < 1.1
    def qa_retired(name, tags):
        rows = qa_events(name, "depart")
        elapsed = qa_probe.windows[name]["end"] - qa_probe.windows[name]["start"]
        return len(rows) == len(tags) and set(row["tag"] for row in rows) == set(tags) and not qa_events(name, "show") and .6 < elapsed < 1.1
    def qa_pause_boundary(name, kept, retired, seconds):
        departures, shows, blends = qa_events(name, "depart", retired), qa_events(name, "show", retired), qa_events(name, "blend", retired)
        elapsed = qa_probe.windows[name]["end"] - qa_probe.windows[name]["start"]
        return qa_continued(name, [(kept, True)]) and len(departures) == len(shows) == len(blends) == 1 and not shows[0]["previousPresent"] and shows[0]["old"] is None and shows[0]["time"] - departures[0]["time"] >= .6 + seconds and blends[0]["rule"] == dict(mode="dissolve", duration=.4) and 1.0 + seconds < elapsed < 1.65 + seconds
    def qa_dump():
        qa_probe.watch = False
        for name, surface in qa_probe.shots.items():
            renpy.pygame.image.save(surface, qa_os.path.join(@@SHOTS@@, qa_probe.name + "-" + name + ".png"))
        windows = qa_copy(qa_probe.windows)
        for name, row in windows.items():
            frames = [frame for frame in qa_probe.frames if frame["window"] == name and frame["actualDraw"]]
            row["actualDraws"] = len(frames)
            row["maxDrawGapSeconds"] = max([b["time"] - a["time"] for a, b in zip(frames, frames[1:])] or [0])
            row["readbackSeconds"] = sum(frame["readbackSeconds"] for frame in frames)
        with open(qa_os.path.join(@@TRACES@@, qa_probe.name + ".json"), "w", encoding="utf-8") as stream:
            qa_json.dump(dict(name=qa_probe.name, frames=qa_probe.frames, events=qa_probe.events, loads=qa_probe.loads, windows=windows), stream, ensure_ascii=False, indent=2)
        qa_probe.references = []
    qa_begin_case("initial")
    qa_probe.watch = False
    qa_record.original, renpy.display.core.Interface.draw_screen = renpy.display.core.Interface.draw_screen, qa_record
    qa_show.original, vn_actor_show = vn_actor_show, qa_show
    qa_blend.original, vn_actor_blend = vn_actor_blend, qa_blend
    qa_depart.original, vn_actor_depart = vn_actor_depart, qa_depart
    config.after_load_callbacks.append(qa_loaded)

testsuite global:
    before testcase:
        $ _test.timeout = 15
        $ _test.transition_timeout = 10.0
        $ preferences.text_cps = 0
        $ preferences.transitions = 2
        $ preferences.afm_enable = False
        $ _test.screenshot_directory = "tests/screenshots"
        if not screen "main_menu":
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    after testcase:
        $ qa_dump()
        run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

`.replaceAll('@@SHOTS@@', q(path.join(output, 'screenshots'))).replaceAll('@@TRACES@@', q(path.join(output, 'traces')));
}
