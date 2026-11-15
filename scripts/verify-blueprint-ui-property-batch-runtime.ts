import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createBlueprintUiPropertyBatchRuntimeFixture, writeBlueprintUiPropertyBatchRuntimeAssets } from './lib/blueprint-ui-property-batch-runtime-fixture';
import { cleanVerificationDirectories } from './lib/verification-cleanup';
import { isolateRenpySaves } from './lib/renpy-saves';
import { compileProject } from '../src/runtime/compiler';
import { buildProject, runRenpy } from '../src/runtime/service';
import { pythonLiteral as q } from '../src/runtime/literals';

// Main acceptance runs this only after all implementations and the editor build.
const sdk = process.env.VNS_RENPY_SDK ?? path.resolve('resources/runtime');
const output = path.resolve(process.env.VNS_ARTIFACT_ROOT ?? 'artifacts/blueprint-property-batch-2026-11-12', 'native-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
const source = path.join(output, 'source'), game = path.join(output, 'game'), saves = path.join(output, 'saves');
const authorFile = path.resolve(process.env.VNS_AUTHOR_PROJECT ?? '../我的视觉小说1/project.vns.json');
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const report: Record<string, unknown> = { status: 'running', authorFile, checks: [], temporaryPaths: [source, game, saves, path.join(output, 'renpy-saves')] };
const previousSaveRoot = process.env.RENPY_PATH_TO_SAVES;
let authorHash: string | undefined, failure: unknown;
await fs.mkdir(output, { recursive: true });
const save = () => fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
async function check(name: string, result: { code: number; log: string }) {
  const logPath = path.join(output, name + '.log'); await fs.writeFile(logPath, result.log);
  (report.checks as unknown[]).push({ name, code: result.code, logPath }); await save();
  assert.equal(result.code, 0, name + ': ' + result.log.slice(-10000));
}

try {
  report.renpySaves = await isolateRenpySaves(output);
  authorHash = digest(await fs.readFile(authorFile)); report.authorSha256Before = authorHash;
  const f = createBlueprintUiPropertyBatchRuntimeFixture(), original = structuredClone(f.project);
  const compiled = compileProject(f.project);
  assert.deepEqual(compiled.diagnostics.filter(issue => issue.severity === 'error'), []);
  assert.deepEqual(f.project, original, 'Compilation must preserve authored batch rows, pins and links.');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'project.vns.json'), JSON.stringify(f.project, null, 2));
  await writeBlueprintUiPropertyBatchRuntimeAssets(source);
  const built = await buildProject({ project: f.project, projectDir: source, sdkRoot: sdk, spineRuntimeDir: path.resolve('resources/spine'), outputDir: game, development: true });
  await check('compile', { code: built.ok ? 0 : 1, log: built.log + '\n' + JSON.stringify(built.diagnostics, null, 2) });
  const start = ['    pause until screen "main_menu"', '    click id "vn_main_start" pos (0.5, 0.5)', '    pause until eval "pc_page" in vn_ui_open_pages', '    move pos (8, 8)'].join('\n');
  const tests = String.raw`default pb_test_ok = False
default pb_test_error = ""
default pb_test_old_x = 0.0
default pb_test_token = 0
default pb_test_page_token = 0

init 1000 python:
    import builtins as pb_builtins
    import json as pb_json
    from renpy.revertable import RevertableList as pb_revertable_list

    def pb_copy_data(value):
        # Owners and widget/task tokens retain identity; recursively copy only
        # saved containers so an in-place mutation cannot fool an equality probe.
        if isinstance(value, pb_builtins.dict): return {key: item if key == "owner" else pb_copy_data(item) for key, item in value.items()}
        if isinstance(value, pb_builtins.list): return [pb_copy_data(item) for item in value]
        if isinstance(value, pb_builtins.tuple): return tuple(pb_copy_data(item) for item in value)
        if isinstance(value, pb_builtins.set): return {pb_copy_data(item) for item in value}
        return value

    def pb_snapshot():
        # Retain only plain values and identities for equality probes; this
        # helper never samples animation or polls/updates a media request.
        clone = pb_copy_data
        editable, active = renpy.get_editable_input_value()
        return dict(parameters={key: vn_parameter_get(key) for key in vn_parameter_info}, overrides=clone(vn_ui_overrides),
            animations=clone(vn_ui_animations), samples=clone(getattr(vn_ui_animation_tick, "samples", {})),
            pending=set(getattr(vn_parameter_commit_values, "pending", ())),
            images=clone(vn_ui_image_loads), revisions=clone(vn_ui_image_revisions), videos=clone(vn_ui_video_states), spines=clone(vn_spine_states),
            imageRecovery=clone(vn_ui_image_recovery), videoRecovery=clone(vn_ui_video_recovery), spineRecovery=clone(vn_spine_recovery),
            preferences={key: vn_preference_get(key) for key in ("musicVolume", "textSpeed", "fullscreen")},
            focus=(editable, active, clone(VnInputFocusRequests.pending), renpy.display.focus.get_grab()))

    def pb_rejection_result(component_id, rows, message, before, error):
        global pb_test_error
        actual = str(error) if error is not None else "操作未拒绝"
        after = pb_snapshot()
        changed = [key for key in before if before[key] != after[key]]
        matched = error is not None and (not message or message in actual)
        if matched and not changed:
            pb_test_error = actual
            return True
        detail = dict(componentId=component_id, writesType=type(rows).__module__ + "." + type(rows).__name__, expectedError=message,
            actualError=actual, errorMatched=bool(matched), changedSections=changed,
            differences={key: dict(before=repr(before[key])[:1800], after=repr(after[key])[:1800]) for key in changed})
        pb_test_error = pb_json.dumps(detail, ensure_ascii=False)
        print("VNS_PROPERTY_BATCH_REJECTION:" + pb_json.dumps(detail, ensure_ascii=True), flush=True)
        return False

    def pb_reject(component_id, rows, message=""):
        before = pb_snapshot()
        try:
            vn_ui_set_many(component_id, rows)
        except Exception as error:
            return pb_rejection_result(component_id, rows, message, before, error)
        return pb_rejection_result(component_id, rows, message, before, None)

    def pb_input_evaluation_failure():
        before = pb_snapshot()
        def missing_input(): raise Exception("输入求值失败")
        try:
            vn_ui_set_many("pc_default", [("text", "不应写入", "override"), ("x", missing_input(), "override")])
        except Exception as error:
            return pb_rejection_result("pc_default", None, "输入求值失败", before, error)
        return pb_rejection_result("pc_default", None, "输入求值失败", before, None)

    def pb_snapshot_copies_all_containers():
        owner = pb_builtins.object()
        values = pb_builtins.list((pb_builtins.dict(value=1),))
        members = pb_builtins.set((1,))
        wrapped = pb_revertable_list((pb_builtins.list((2,)),))
        source = pb_builtins.dict(owner=owner, values=values, members=members, wrapped=wrapped)
        copied = pb_copy_data(source)
        values[0]["value"] = 9
        members.add(9)
        wrapped[0].append(9)
        return (copied["owner"] is owner and copied["values"] == [{"value": 1}]
            and copied["members"] == {1} and copied["wrapped"] == [[2]] and copied != source)

    def pb_batch_container_compatibility():
        global pb_test_error
        constructors = (pb_builtins.list, pb_builtins.tuple, pb_revertable_list)
        saved = pb_copy_data(vn_ui_overrides.get("pc_default"))
        try:
            for outer_index, outer in enumerate(constructors):
                for row_index, row_type in enumerate(constructors):
                    value = .1 + (outer_index * 3 + row_index) / 100.0
                    label = outer.__name__ + "/" + row_type.__name__
                    writes = outer((row_type(("x", value, "override")), row_type(("text", label, "override"))))
                    original, row_ids = pb_copy_data(writes), tuple(id(row) for row in writes)
                    vn_ui_set_many("pc_default", writes)
                    if vn_ui_get("pc_default", "x") != value or vn_ui_get("pc_default", "text") != label:
                        raise Exception("容器组合没有完整提交：" + label)
                    if writes != original or tuple(id(row) for row in writes) != row_ids:
                        raise Exception("批次修改了调用方的输入容器：" + label)
            return True
        except Exception as error:
            pb_test_error = str(error)
            print("VNS_PROPERTY_BATCH_CONTAINER:" + pb_test_error, flush=True)
            return False
        finally:
            if saved is None: vn_ui_overrides.pop("pc_default", None)
            else: vn_ui_overrides["pc_default"] = saved

    def pb_batch_shape_rejections():
        global pb_test_error
        visits = []
        class IterableOnly(pb_builtins.object):
            def __len__(self):
                visits.append("len")
                return 2
            def __iter__(self):
                visits.append("iter")
                return iter((("text", "不得写入", "override"), ("x", .8, "override")))
        def deferred_rows():
            visits.append("generator")
            yield ("text", "不得写入", "override")
        generator = deferred_rows()
        candidates = (None, "text", pb_builtins.dict(text="不得写入"), pb_builtins.set((1,)), IterableOnly(), generator,
            pb_builtins.list(), pb_revertable_list(), (), pb_builtins.list((("text", "不得写入", "override"),)) * 65)
        try:
            for writes in candidates:
                if not pb_reject("pc_default", writes, "一次设置需要 1～64 项属性"): return False
            # Validate the outer shape before len/iteration, then validate every
            # row before committing any earlier valid row.
            for outer in (pb_builtins.list, pb_builtins.tuple, pb_revertable_list):
                for bad_row in (pb_builtins.dict(property="text", value="不得写入", mode="override"), "text", IterableOnly(), deferred_rows(),
                        pb_builtins.list(("text", "缺少模式")), (9, "错误属性类型", "override")):
                    writes = outer((("text", "前项不得写入", "override"), bad_row))
                    if not pb_reject("pc_default", writes, "批量写入格式无效"): return False
            if visits: raise Exception("拒绝时不应读取任意可迭代对象：" + repr(visits))
            return True
        except Exception as error:
            pb_test_error = str(error)
            print("VNS_PROPERTY_BATCH_CONTAINER:" + pb_test_error, flush=True)
            return False
        finally:
            generator.close()

    def pb_fullscreen_reject_without_platform_change():
        original = renpy.can_fullscreen
        try:
            renpy.can_fullscreen = lambda: False
            return pb_reject("pb_fullscreen", [("x", .4, "override"), ("booleanValue", True, "source")], "无法应用全屏")
        finally:
            renpy.can_fullscreen = original

    def pb_character_reject_before_local_write():
        info = vn_ui_controls["pb_character_volume"]
        original = info.get("characterId")
        try:
            info["characterId"] = "missing_batch_character"
            return pb_reject("pb_character_volume", [("x", .4, "override"), ("numberValue", .5, "source")], "引用的角色不存在")
        finally:
            info["characterId"] = original

    def pb_single_refreshes_after_commit():
        observations, patches, synced = [], [], []
        def wrap(name):
            original = globals()[name]
            patches.append((name, original))
            def observed(*args, **kwargs):
                observations.append((name, vn_parameter_get("pc_number"), vn_parameter_get("pb_min"), vn_parameter_get("pb_max")))
                return original(*args, **kwargs)
            globals()[name] = observed
        try:
            wrap("vn_ui_layout_changed")
            for name in ("vn_ui_video_sync", "vn_ui_spine_sync"):
                original = globals()[name]
                patches.append((name, original))
                def unexpected(*args, **kwargs): synced.append(args)
                globals()[name] = unexpected
            vn_ui_set_many("pc_slider", [("minimum", 200, "override"), ("maximum", 400, "override"), ("numberValue", 300, "override"), ("x", .06, "override")])
            return len(observations) == 1 and observations[0][1:] == (300, 200, 400) and not synced
        finally:
            for name, original in patches: globals()[name] = original

    def pb_persistent_rejection_then_commit():
        values, original = [], renpy.save_persistent
        def observe():
            values.append((vn_parameter_get("pc_persistent_alpha"), vn_parameter_get("pc_alpha"), vn_ui_get("pb_persist_mix", "text")))
            original()
        try:
            renpy.save_persistent = observe
            refused = pb_reject("pb_persist_mix", [("opacity", .7, "override"), ("x", .5, "override"), ("fontSize", 0, "override")])
            if not refused or values: return False
            vn_ui_set_many("pb_persist_mix", [("opacity", .7, "override"), ("x", .5, "override"), ("text", "整批已保存", "override")])
            return values == [(.7, .5, "整批已保存")]
        finally:
            renpy.save_persistent = original

    def pb_media_sequence_boundaries(kind):
        global pb_test_error
        identity = "pb_video" if kind == "video" else "pb_rig"
        states = vn_ui_video_states if kind == "video" else vn_spine_states
        snapshot = vn_ui_video_snapshot if kind == "video" else vns_spine.snapshot
        fields = ("video", "videoLoop") if kind == "video" else ("spineAsset", "spineSpeed")
        base = snapshot(identity, strict=True)
        previous = states.get(identity)
        previous_overrides = pb_copy_data(vn_ui_overrides.get(identity))
        parameter_overrides = pb_copy_data(vn_ui_property_controls.get(identity))
        saved_parameter = vn_parameter_get("pc_alpha")
        # This video metadata exists only during this synchronous request test;
        # no interaction, decoder, native player or event sees the fake path.
        asset_id = "pb_request_only_video" if kind == "video" else "rig_b"
        if kind == "video": vn_bp_assets[asset_id] = dict(id=asset_id, kind="video", path="request-only.webm")
        changed = not base["loop"] if kind == "video" else 2
        same = base["loop"] if kind == "video" else base["speed"]
        limit = 9007199254740991
        try:
            if base["suspended"]:
                pb_test_error = "媒体边界测试的初始页面必须可见"
                return False
            # Make a sibling row a real parameter write. Overflow must retain
            # both the media request and the bound parameter/animation driver.
            controls = dict(vn_ui_property_controls.get(identity, {}))
            controls["opacity"] = dict(mode="sync", parameterId="pc_alpha", property="opacity")
            vn_ui_property_controls[identity] = controls
            states[identity] = dict(base, sequence=limit)
            if not pb_reject(identity, [("opacity", .65, "override"), (fields[1], changed, "override")], "请求序号"): return False
            maximum = states[identity]
            vn_ui_set_many(identity, [(fields[1], same, "override"), ("opacity", .7, "override")])
            if states[identity] is not maximum or vn_ui_get(identity, "opacity") != .7: return False
            states[identity] = dict(base, sourceSequence=limit)
            if not pb_reject(identity, [("opacity", .6, "override"), (fields[0], asset_id, "override")], "请求序号"): return False
            maximum_source = states[identity]
            vn_ui_set_many(identity, [(fields[0], base["assetId"], "override"), ("opacity", .75, "override")])
            if states[identity] is not maximum_source or vn_ui_get(identity, "opacity") != .75: return False
            # Fresh source then final suspension consume two request increments.
            states[identity] = dict(base, sequence=limit - 1)
            if not pb_reject(identity, [(fields[0], asset_id, "override"), ("visible", False, "override"), ("opacity", .6, "override")], "请求序号"): return False
            return True
        except Exception as error:
            pb_test_error = str(error)
            return False
        finally:
            if previous is None: states.pop(identity, None)
            else: states[identity] = previous
            if previous_overrides is None: vn_ui_overrides.pop(identity, None)
            else: vn_ui_overrides[identity] = previous_overrides
            if parameter_overrides is None: vn_ui_property_controls.pop(identity, None)
            else: vn_ui_property_controls[identity] = parameter_overrides
            renpy.store.vn_var_pc_alpha = saved_parameter
            if kind == "video": vn_bp_assets.pop(asset_id, None)

    def pb_condition_media_rejection():
        identity = "pb_condition_rig"
        previous = vn_spine_states.get(identity)
        base = vns_spine.snapshot(identity, strict=True)
        try:
            if base["suspended"]: return False
            vn_spine_states[identity] = dict(base, sequence=9007199254740991)
            return pb_reject("pb_conflict", [("opacity", .7, "override"), ("x", .7, "override"), ("text", "不得提交", "override")], "请求序号")
        finally:
            if previous is None: vn_spine_states.pop(identity, None)
            else: vn_spine_states[identity] = previous

    def pb_media_batch_scope(kind):
        global pb_test_error
        identity = "pb_video" if kind == "video" else "pb_rig"
        states = vn_ui_video_states if kind == "video" else vn_spine_states
        snapshot = vn_ui_video_snapshot if kind == "video" else vns_spine.snapshot
        field, record_field = ("videoLoop", "loop") if kind == "video" else ("spineSpeed", "speed")
        source_field = "video" if kind == "video" else "spineAsset"
        parameter_id = "pc_flag" if kind == "video" else "pc_alpha"
        writer, writer_field = ("pc_toggle", "booleanValue") if kind == "video" else ("pb_conflict", "opacity")
        previous = states.get(identity)
        saved_overrides = pb_copy_data(vn_ui_overrides)
        saved_controls = vn_ui_property_controls.get(identity)
        saved_readers = vn_ui_parameter_readers.get(parameter_id)
        limit = 9007199254740991
        def media():
            return pb_copy_data(dict(images=vn_ui_image_loads, revisions=vn_ui_image_revisions, videos=vn_ui_video_states, spines=vn_spine_states,
                imageRecovery=vn_ui_image_recovery, videoRecovery=vn_ui_video_recovery, spineRecovery=vn_spine_recovery))
        def unchanged_write(target, rows):
            before, record = media(), states[identity]
            vn_ui_set_many(target, rows)
            if states[identity] is not record or media() != before:
                raise Exception("无关批次采用或改写了媒体记录：" + kind)
        def button_text(label):
            unchanged_write("pb_snapshot", [("text", label, "override"), ("opacity", .8, "override")])
            if vn_ui_get("pb_snapshot", "text") != label: raise Exception("普通文字批次没有提交")
        try:
            base = snapshot(identity, strict=True)
            same = vn_ui_get(identity, field)
            different = not same if kind == "video" else same + 1
            states[identity] = dict(base, version=99)
            button_text("坏媒体不阻断文字批次")
            if not pb_reject(identity, [(field, same, "override"), ("opacity", .7, "override")], "版本"): return False
            if not pb_reject(identity, [("x", vn_ui_get(identity, "x") + .01, "override"), ("opacity", .7, "override")], "版本"): return False
            # A valid request awaiting a later poll belongs to that media; an
            # unrelated success must neither adopt it nor advance its counters.
            for sequence in (base["sequence"], limit):
                pending = dict(base, sequence=sequence)
                pending[record_field] = different
                states[identity] = pending
                button_text("待处理媒体不被文字批次接管")
                unchanged_write(identity, [("opacity", .65, "override"), ("layer", 3, "override")])
            if not pb_reject(identity, [(field, same, "override"), ("opacity", .7, "override")], "请求序号"): return False
            states[identity] = dict(base, assetId="", sourceSequence=limit)
            button_text("待换源媒体不被文字批次接管")
            if not pb_reject(identity, [(source_field, base["assetId"], "override"), ("opacity", .7, "override")], "请求序号"): return False
            # Same-value parameter rows reach shared-reader validation. They
            # still must not inspect a media record whose effective value stays
            # the same; a real indirect configuration change must inspect it.
            controls = dict(saved_controls or {})
            controls[field] = dict(mode="follow", parameterId=parameter_id, property=field)
            vn_ui_property_controls[identity] = controls
            vn_ui_parameter_readers[parameter_id] = list(saved_readers or ()) + [(identity, field)]
            states[identity] = dict(base, version=99)
            parameter = vn_parameter_get(parameter_id)
            sibling = ("opacity", .8, "override") if kind == "video" else ("text", "同值来源保持无关媒体", "override")
            unchanged_write(writer, [(writer_field, parameter, "override"), sibling])
            changed = not parameter if kind == "video" else .45
            if not pb_reject(writer, [(writer_field, changed, "override"), sibling], "版本"): return False
            return True
        except Exception as error:
            pb_test_error = str(error)
            return False
        finally:
            if previous is None: states.pop(identity, None)
            else: states[identity] = previous
            if saved_controls is None: vn_ui_property_controls.pop(identity, None)
            else: vn_ui_property_controls[identity] = saved_controls
            if saved_readers is None: vn_ui_parameter_readers.pop(parameter_id, None)
            else: vn_ui_parameter_readers[parameter_id] = saved_readers
            vn_ui_overrides.clear()
            vn_ui_overrides.update(saved_overrides)

    def pb_media_layout_scope(kind):
        global pb_test_error
        identity = "pb_video" if kind == "video" else "pb_rig"
        states = vn_ui_video_states if kind == "video" else vn_spine_states
        snapshot = vn_ui_video_snapshot if kind == "video" else vns_spine.snapshot
        previous = states.get(identity)
        saved_parent = vn_ui_parents.get(identity)
        saved_overrides = pb_copy_data(vn_ui_overrides)
        try:
            # All temporary hierarchy and request changes are restored before
            # another interaction, decoder or Spine poll can observe them.
            vn_ui_parents[identity] = "pc_parent"
            vn_ui_overrides["pc_parent"] = dict(vn_ui_overrides.get("pc_parent", {}), layoutFlow="horizontal", clipChildren=True)
            vn_ui_overrides["pc_alpha_a"] = dict(vn_ui_overrides.get("pc_alpha_a", {}), width=.25)
            vn_ui_overrides[identity] = dict(vn_ui_overrides.get(identity, {}), x=0, y=0, width=.2, height=.5)
            base = snapshot(identity, strict=True)
            if base["suspended"]: raise Exception("布局范围验收的媒体必须初始可见")
            states[identity] = dict(base, sequence=9007199254740991)
            if not pb_reject("pc_parent", [("visible", False, "override"), ("opacity", .4, "override")], "请求序号"): return False
            if not pb_reject("pc_alpha_a", [("width", 1.1, "override"), ("text", "不得挤出媒体后提交", "override")], "请求序号"): return False
            states[identity] = dict(base, version=99)
            if not pb_reject("pc_parent", [("x", vn_ui_get("pc_parent", "x") + .01, "override"), ("opacity", .4, "override")], "版本"): return False
            return True
        except Exception as error:
            pb_test_error = str(error)
            return False
        finally:
            if previous is None: states.pop(identity, None)
            else: states[identity] = previous
            if saved_parent is None: vn_ui_parents.pop(identity, None)
            else: vn_ui_parents[identity] = saved_parent
            vn_ui_overrides.clear()
            vn_ui_overrides.update(saved_overrides)

testsuite global:
    before testcase:
        $ _test.timeout = 15.0
        $ _test.transition_timeout = 0.05
        $ _test.screenshot_directory = "tests/screenshots"
        $ preferences.text_cps = 0
        $ persistent.vn_var_pc_persistent_alpha = .25
    after testcase:
        if eval not main_menu:
            run MainMenu(confirm=False)
        pause until screen "main_menu"
    teardown:
        exit

testcase compiled_foreground_reads_all_inputs_before_any_write_and_keeps_legacy:
@@START@@
    $ pb_test_old_x = vn_ui_get("pc_default", "x")
    click id "vn_component_pb_snapshot" pos (.5, .5)
    assert eval vn_ui_get("pc_default", "x") == .5 and vn_ui_get("pc_default", "y") == pb_test_old_x
    assert eval vn_ui_get("pc_default", "text") == "同一节点的三项写入"
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0
    click id "vn_component_pb_legacy" pos (.5, .5)
    assert eval vn_ui_get("pc_default", "text") == "旧单项仍可运行"
    $ pb_test_ok = pb_input_evaluation_failure()
    assert eval pb_test_ok
    screenshot "01-foreground-and-input-snapshot"

testcase native_and_revertable_batch_containers_share_validation_and_commit_rules:
@@START@@
    $ vn_ui_set_many("pc_default", [["x", .41, "override"], ["text", "测试器原生列表已提交", "override"]])
    assert eval vn_ui_get("pc_default", "x") == .41 and vn_ui_get("pc_default", "text") == "测试器原生列表已提交"
    $ pb_test_ok = pb_batch_container_compatibility()
    assert eval pb_test_ok
    $ pb_test_ok = pb_batch_shape_rejections()
    assert eval pb_test_ok
    $ pb_test_ok = pb_snapshot_copies_all_containers()
    assert eval pb_test_ok

testcase all_input_errors_reject_without_partial_values_or_animation_changes:
@@START@@
    $ pb_test_token = vn_ui_animate("pc_alpha_a", "opacity", .95, 3, "linear")
    $ pb_test_ok = pb_reject("pc_alpha_a", [("opacity", .7, "override"), ("fontSize", 0, "override")])
    assert eval pb_test_ok and vn_ui_animation_active(pb_test_token)
    $ pb_test_ok = pb_reject("pc_default", [("x", .6, "override"), ("unknown_property", True, "override")])
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_default", [("text", "不应写入", "override"), ("x", .6, "bad_mode")], "绑定源")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_default", [("text", "不应写入", "override"), ("visible", False, "source")], "绑定源")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_default", [("x", float("inf"), "override"), ("text", "不应写入", "override")])
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_default", [])
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("missing_component", [("x", .6, "override")])
    assert eval pb_test_ok

testcase follow_aliases_and_conflicting_parameter_writers_reject_whole_batch:
@@START@@
    $ pb_test_ok = pb_reject("pc_slider_follow", [("x", .6, "override"), ("normalizedValue", .7, "override")], "单向跟随")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_text_follow", [("fontSize", 31, "override"), ("text", "不得写入", "source")], "单向跟随")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pb_conflict", [("opacity", .7, "override"), ("x", .8, "override")], "同一参数")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_slider", [("numberValue", 50, "override"), ("normalizedValue", .5, "source")], "重复写入")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_choices", [("stringValue", "困难", "override"), ("optionIndex", 1, "override")], "重复写入")
    assert eval pb_test_ok
    $ vn_ui_set_many("pb_conflict", [("opacity", .7, "override"), ("x", .7, "override")])
    assert eval vn_parameter_get("pc_alpha") == .7 and vn_ui_get("pb_conflict", "opacity") == .7 and vn_ui_get("pb_conflict", "x") == .7

testcase candidate_range_precedes_ratio_and_both_row_orders_preserve_the_same_value:
@@START@@
    click id "vn_component_pb_range" pos (.5, .5)
    assert eval vn_parameter_get("pb_min") == 200 and vn_parameter_get("pb_max") == 400 and vn_parameter_get("pc_number") == 300
    assert eval vn_ui_get("pc_slider", "numberValue") == 300 and vn_ui_get("pc_slider", "normalizedValue") == .5 and vn_ui_get("pc_slider", "step") == 5
    assert eval vn_ui_get("pc_slider_follow", "numberValue") == 100 and vn_ui_get("pc_clamped", "numberValue") == 40
    assert eval vn_parameter_get("pc_legacy_number") == 10 and vn_parameter_get("pc_changed_count") == 0
    $ vn_ui_set_many("pc_slider", [("maximum", 100, "override"), ("minimum", 0, "override"), ("numberValue", 30, "override")])
    $ vn_ui_set_many("pc_slider", [("maximum", 400, "override"), ("minimum", 200, "override"), ("normalizedValue", .5, "override")])
    assert eval vn_parameter_get("pc_number") == 300 and vn_ui_get("pc_slider", "minimum") == 200 and vn_ui_get("pc_slider", "maximum") == 400
    $ pb_test_ok = pb_reject("pc_slider", [("numberValue", 450, "override"), ("minimum", 500, "override"), ("maximum", 400, "override")])
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pb_ratio_cycle", [("normalizedValue", .5, "override"), ("x", .4, "override")], "比例范围")
    assert eval pb_test_ok
    screenshot "02-final-range-and-ratio"

testcase legacy_parameter_source_uses_final_range_without_local_value_override:
@@START@@
    $ vn_ui_set("pb_legacy_slider", "numberValue", 60)
    click id "vn_component_pb_source" pos (.5, .5)
    assert eval vn_parameter_get("pc_legacy_number") == 250 and vn_ui_get("pb_legacy_slider", "numberValue") == 250
    assert eval vn_ui_get("pb_legacy_slider", "minimum") == 200 and vn_ui_get("pb_legacy_slider", "maximum") == 300
    assert eval "numberValue" not in vn_ui_overrides.get("pb_legacy_slider", {}) and vn_parameter_get("pc_changed_count") == 0
    $ vn_ui_set_many("pc_choices", [("optionIndex", 2, "source"), ("x", .68, "override")])
    assert eval vn_parameter_get("pc_choice") == "旁观" and vn_ui_get("pc_choices_follow", "optionIndex") == 2
    assert eval "stringValue" not in vn_ui_overrides.get("pc_choices", {})

testcase final_unicode_text_and_length_are_atomic_without_changing_legacy_single_semantics:
@@START@@
    $ vn_ui_set_many("pc_input", [("maxLength", 2, "override"), ("stringValue", "甲🦊", "source")])
    assert eval vn_ui_get("pc_input", "maxLength") == 2 and vn_parameter_get("pc_text") == "甲🦊"
    $ vn_ui_set_many("pc_input", [("stringValue", "甲乙🦊", "override"), ("maxLength", 3, "override")])
    assert eval vn_parameter_get("pc_text") == "甲乙🦊" and vn_ui_get("pc_input", "stringValue") == "甲乙🦊"
    $ pb_test_ok = pb_reject("pc_input", [("visible", False, "override"), ("maxLength", 1, "override"), ("stringValue", "甲🦊", "override")])
    assert eval pb_test_ok
    $ vn_ui_set("pb_legacy_input", "stringValue", "甲乙丙丁")
    $ vn_ui_set("pb_legacy_input", "maxLength", 2)
    assert eval vn_ui_get("pb_legacy_input", "stringValue") == "甲乙丙丁" and vn_ui_get("pb_legacy_input", "maxLength") == 2
    $ pb_test_ok = pb_reject("pb_legacy_input", [("x", .3, "override"), ("maxLength", 3, "override")])
    assert eval pb_test_ok
    $ vn_ui_set_many("pb_legacy_input", [("stringValue", "甲🦊", "override"), ("maxLength", 2, "override")])
    assert eval vn_ui_get("pb_legacy_input", "stringValue") == "甲🦊" and vn_parameter_get("pb_text") == "甲乙"

testcase source_text_checks_other_active_readers_and_ignores_unopened_readers:
@@START@@
    $ pb_test_ok = pb_reject("pb_legacy_input", [("stringValue", "甲乙丙丁", "source"), ("x", .4, "override")])
    assert eval pb_test_ok and vn_parameter_get("pb_text") == "甲乙"
    $ vn_ui_set("pb_short_reader", "stringValue", "短")
    $ vn_ui_set_many("pb_strict_input", [("maxLength", 4, "source"), ("stringValue", "甲乙丙丁", "source")])
    assert eval vn_parameter_get("pb_length") == 4 and vn_parameter_get("pb_text") == "甲乙丙丁"
    assert eval vn_ui_get("pb_short_reader", "stringValue") == "短" and vn_ui_get("pb_strict_input", "stringValue") == "甲乙丙丁"
    assert eval vn_ui_get("pb_legacy_input", "stringValue") == "甲乙丙丁" and "pb_unopened" not in vn_ui_open_pages
    $ pb_test_ok = pb_reject("pb_strict_input", [("maxLength", 1, "source"), ("x", .4, "override")])
    assert eval pb_test_ok and vn_parameter_get("pb_length") == 4

testcase preference_sources_prepare_engine_limits_and_unavailable_modes_before_commit:
@@START@@
    run ShowMenu("preferences")
    pause until screen "preferences"
    $ vn_ui_set("pb_preference", "numberValue", .8)
    $ vn_ui_set_many("pb_preference", [("numberValue", .6, "source"), ("maximum", .8, "override"), ("minimum", .2, "override")])
    assert eval abs(vn_preference_get("musicVolume") - .6) < .0000001 and "numberValue" not in vn_ui_overrides.get("pb_preference", {})
    assert eval vn_ui_get("pb_preference_reader", "numberValue") == .5
    $ pb_test_ok = pb_reject("pb_preference", [("numberValue", .4, "source"), ("maximum", 1.2, "override"), ("x", .4, "override")], "引擎边界")
    assert eval pb_test_ok
    $ vn_ui_set_many("pb_text_speed", [("numberValue", 400, "source"), ("minimum", 300, "override"), ("maximum", 500, "override")])
    assert eval vn_preference_get("textSpeed") == 400 and vn_ui_get("pb_text_speed", "numberValue") == 400 and vn_ui_get("pb_text_speed", "maximum") == 500
    $ pb_test_ok = pb_fullscreen_reject_without_platform_change()
    assert eval pb_test_ok
    $ pb_test_ok = pb_character_reject_before_local_write()
    assert eval pb_test_ok
    screenshot "06-final-preference-range"
    click id "vn_component_pb_preferences_close" pos (.5, .5)
    pause until not screen "preferences"

testcase rejected_batch_keeps_input_focus_and_successful_disable_clears_it_once:
@@START@@
    click id "vn_component_pc_input_edit" pos (.5, .5)
    pause until eval vn_ui_get("pc_input", "focused")
    $ pb_test_ok = pb_reject("pc_input", [("enabled", False, "override"), ("stringValue", "过长文字" * 10, "source")])
    assert eval pb_test_ok and vn_ui_get("pc_input", "focused") and vn_parameter_get("pc_commit_count") == 0
    $ vn_ui_set_many("pc_input", [("enabled", False, "override"), ("stringValue", "批次文字", "source")])
    assert eval not vn_ui_get("pc_input", "focused") and vn_parameter_get("pc_text") == "批次文字" and vn_ui_get("pc_input", "enabled") is False
    assert eval vn_parameter_get("pc_changed_count") == 0 and vn_parameter_get("pc_commit_count") == 0

testcase one_successful_commit_replaces_parameter_animation_and_refreshes_final_state:
@@START@@
    $ pb_test_token = vn_ui_animate("pc_alpha_a", "opacity", .95, 3, "linear")
    $ pb_test_ok = pb_reject("pc_alpha_b", [("opacity", .6, "override"), ("fontSize", 0, "override")])
    assert eval pb_test_ok and vn_ui_animation_active(pb_test_token)
    $ vn_ui_set_many("pc_alpha_b", [("opacity", .6, "override"), ("text", "已由批次接管", "override")])
    assert eval not vn_ui_animation_active(pb_test_token) and vn_parameter_get("pc_alpha") == .6 and vn_ui_get("pc_alpha_a", "opacity") == .6
    $ pb_test_ok = pb_single_refreshes_after_commit()
    assert eval pb_test_ok
    $ pb_test_ok = pb_persistent_rejection_then_commit()
    assert eval pb_test_ok and vn_parameter_get("pc_persistent_alpha") == .7 and vn_parameter_get("pc_alpha") == .5

testcase media_batch_preserves_failed_requests_and_supports_new_asset_skin_in_both_orders:
@@START@@
    $ pb_test_ok = pb_reject("pc_image_control", [("image", "pc_asset_b", "source"), ("opacity", 2, "override")])
    assert eval pb_test_ok and vn_parameter_get("pc_image") == "pc_asset_a"
    $ vn_ui_set_many("pc_image_control", [("image", "pc_asset_b", "source"), ("opacity", .75, "override")])
    assert eval vn_parameter_get("pc_image") == "pc_asset_b" and vn_ui_get("pc_image_control", "opacity") == .75
    assert eval vn_ui_get("pb_legacy_image", "image") == "pc_asset_b" and vn_ui_image_revisions.get("pb_legacy_image", 0) > 0
    $ pb_test_ok = pb_reject("pb_rig", [("spineAsset", "rig_b", "override"), ("spineSkin", "missing_skin", "override")], "皮肤")
    assert eval pb_test_ok and vn_ui_get("pb_rig", "spineAsset") == "rig_a"
    click id "vn_component_pb_media" pos (.5, .5)
    assert eval vn_ui_get("pb_rig", "spineAsset") == "rig_b" and vn_ui_get("pb_rig", "spineSkin") == "blue_only" and vn_ui_get("pb_rig", "spineSpeed") == 2
    assert eval vn_spine_states["pb_rig"]["skin"] == "blue_only" and vn_spine_states["pb_rig"]["assetId"] == "rig_b"
    $ vn_ui_set_many("pb_rig", [("spineAsset", "rig_a", "override"), ("spineSkin", "alternate", "override")])
    assert eval vn_ui_get("pb_rig", "spineAsset") == "rig_a" and vn_ui_get("pb_rig", "spineSkin") == "alternate"
    $ vn_ui_set_many("pb_rig", [("spineAsset", "rig_b", "override"), ("spineSpeed", 1, "override")])
    assert eval vn_ui_get("pb_rig", "spineSkin") == ""
    $ vn_ui_set_many("pb_sync_rig", [("spineSkin", "blue_only", "source"), ("spineAsset", "rig_b", "override")])
    assert eval vn_parameter_get("pb_skin") == "blue_only" and vn_ui_get("pb_sync_rig", "spineAsset") == "rig_b" and "spineSkin" not in vn_ui_overrides.get("pb_sync_rig", {})
    $ pb_test_ok = pb_reject("pb_sync_rig", [("spineAsset", "rig_a", "override"), ("spineSpeed", 2, "override")], "皮肤")
    assert eval pb_test_ok and vn_parameter_get("pb_skin") == "blue_only"
    screenshot "03-spine-asset-and-skin"

testcase media_request_limits_reject_real_increments_but_preserve_equal_writes:
@@START@@
    $ pb_test_ok = pb_media_sequence_boundaries("video")
    assert eval pb_test_ok
    $ pb_test_ok = pb_media_sequence_boundaries("spine")
    assert eval pb_test_ok
    assert eval "pb_request_only_video" not in vn_bp_assets

testcase unrelated_media_records_do_not_block_or_adopt_during_ordinary_batches:
@@START@@
    $ pb_test_ok = pb_media_batch_scope("video")
    assert eval pb_test_ok
    $ pb_test_ok = pb_media_batch_scope("spine")
    assert eval pb_test_ok

testcase ancestor_and_sibling_layout_changes_prepare_the_media_they_move_or_suspend:
@@START@@
    $ pb_test_ok = pb_media_layout_scope("video")
    assert eval pb_test_ok
    $ pb_test_ok = pb_media_layout_scope("spine")
    assert eval pb_test_ok

testcase parameter_condition_suspension_is_prepared_before_any_parameter_or_text_commits:
@@START@@
    $ pb_test_ok = pb_condition_media_rejection()
    assert eval pb_test_ok and vn_parameter_get("pc_alpha") == .4
    $ vn_ui_set_many("pb_conflict", [("opacity", .7, "override"), ("x", .7, "override"), ("text", "条件已一起提交", "override")])
    assert eval vn_parameter_get("pc_alpha") == .7 and vn_ui_get("pb_conflict", "text") == "条件已一起提交"
    assert eval vn_ui_get("pb_condition_rig", "visible") is False and vn_spine_states["pb_condition_rig"]["suspended"] is True

testcase final_layout_overflow_cannot_commit_values_or_take_animation_ownership:
@@START@@
    $ pb_test_token = vn_ui_animate("pc_default", "x", .5, 3, "linear")
    $ pb_test_ok = pb_reject("pc_default", [("x", 1e308, "override"), ("text", "不应留下布局失败值", "override")], "布局计算")
    assert eval pb_test_ok and vn_ui_animation_active(pb_test_token)
    $ pb_test_ok = pb_reject("pc_default", [("layoutRotation", 1e308, "override"), ("text", "不应留下旋转失败值", "override")], "布局计算")
    assert eval pb_test_ok
    $ pb_test_ok = pb_reject("pc_default", [("width", 1e308, "override"), ("scaleX", 1e308, "override")], "布局计算")
    assert eval pb_test_ok

testcase background_compiler_reads_the_old_state_before_its_batch_and_resumes_after_commit:
@@START@@
    $ pb_test_old_x = vn_ui_get("pc_default", "x")
    click id "vn_component_pb_async" pos (.5, .5)
    pause until eval vn_parameter_get("pb_done")
    assert eval vn_ui_get("pc_default", "x") == .6 and vn_ui_get("pc_default", "y") == pb_test_old_x
    assert eval vn_ui_get("pc_default", "text") == "后台已完成批次" and vn_parameter_get("pc_changed_count") == 0
    screenshot "04-background-input-snapshot"

testcase saved_batch_restores_parameters_and_overrides_and_reopen_releases_only_local_state:
@@START@@
    click id "vn_component_pb_range" pos (.5, .5)
    $ vn_ui_set_many("pc_default", [("text", "批次存档", "override"), ("opacity", .7, "override")])
    $ pb_test_page_token = vn_ui_page_token("pc_page")
    $ renpy.save("blueprint-property-batch-checkpoint")
    $ vn_ui_set_many("pc_slider", [("minimum", 0, "override"), ("maximum", 100, "override"), ("numberValue", 50, "override")])
    $ vn_ui_set("pc_default", "text", "存档之后")
    run FileLoad("blueprint-property-batch-checkpoint", confirm=False, slot=True)
    pause until eval vn_parameter_get("pc_number") == 300
    assert eval vn_parameter_get("pb_min") == 200 and vn_parameter_get("pb_max") == 400 and vn_ui_get("pc_default", "text") == "批次存档"
    assert eval vn_ui_page_token("pc_page") == pb_test_page_token and vn_ui_get("pc_default", "opacity") == .7
    click id "vn_component_pc_close" pos (.5, .5)
    pause until "属性控制页面已关闭。"
    assert eval "pc_default" not in vn_ui_overrides and vn_parameter_get("pc_number") == 300
    run Jump(@@FIRST@@)
    pause until eval "pc_page" in vn_ui_open_pages
    assert eval vn_ui_page_token("pc_page") != pb_test_page_token and vn_ui_get("pc_slider", "numberValue") == 300
    assert eval vn_ui_get("pc_default", "text") == "原始设计文字" and vn_parameter_get("pc_changed_count") == 0
    screenshot "05-saved-batch-and-page-reopen"
`.replaceAll('@@START@@', start).replaceAll('@@FIRST@@', q('vn_node_' + f.firstPassageId));
  await fs.writeFile(path.join(output, 'testcases.rpy'), tests);
  await fs.writeFile(path.join(game, 'game/testcases.rpy'), tests);
  const runOptions = { savedir: saves, timeoutMs: 240000 };
  await check('lint', await runRenpy(sdk, game, ['lint'], runOptions));
  const native = await runRenpy(sdk, game, ['test', '--report-detailed', '--report-skipped'], { ...runOptions, onData: text => process.stdout.write(text) });
  await check('runtime', native);
  report.cases = (tests.match(/^testcase /gm) ?? []).length;
  report.assertions = (tests.match(/^    assert /gm) ?? []).length;
  assert.match(native.log, new RegExp('Test cases\\s*:\\s*' + report.cases + '\\s*\\|\\s*' + report.cases + ' passed'));
  assert.equal(Number(native.log.match(/Assertions\s*:\s*(\d+)/)?.[1]), report.assertions);
  report.status = 'passed';
} catch (error) {
  failure = error; report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
} finally {
  try {
    for (const directory of [path.join(game, 'tests/screenshots'), path.join(game, 'game/tests/screenshots')]) {
      if (await fs.stat(directory).then(stat => stat.isDirectory()).catch(() => false)) await fs.cp(directory, path.join(output, 'screenshots'), { recursive: true });
    }
  } catch (error) { failure ??= error; report.status = 'failed'; report.screenshotError = String(error); }
  try {
    const after = digest(await fs.readFile(authorFile)); report.authorSha256After = after;
    if (authorHash !== undefined) assert.equal(after, authorHash, 'Native acceptance must leave the real author project unchanged.');
  } catch (error) { failure ??= error; report.status = 'failed'; report.sourceProtectionError = String(error); }
  try {
    report.cleanup = await cleanVerificationDirectories(output, ['source', 'game', 'saves', 'renpy-saves']);
    assert.deepEqual((report.cleanup as { errors: unknown[] }).errors, []);
  } catch (error) { failure ??= error; report.status = 'failed'; report.cleanupError = String(error); }
  if (previousSaveRoot === undefined) delete process.env.RENPY_PATH_TO_SAVES;
  else process.env.RENPY_PATH_TO_SAVES = previousSaveRoot;
  await save(); console.log(path.join(output, 'report.json'));
}
if (failure) throw failure;
