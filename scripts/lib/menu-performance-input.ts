import assert from 'node:assert/strict';

export interface MenuInputEvent {
  eventId: number;
  phase: string;
  type: 'down' | 'move' | 'up';
  postedAt: number;
  dispatchedAt?: number;
  position: number[];
  button: number | null;
  actionIds: number[];
  dispatches: { stage: 'focus' | 'slider' | 'button'; component?: string; enteredAt: number; returnedAt?: number; exception?: string }[];
  intent?: { kind: 'hover' | 'screen'; target: string; component: string };
  presentation?: string;
  firstTargetFrameId?: number;
  firstTargetFrameStartedAt?: number;
  firstTargetFrameCompletedAt?: number;
  firstTargetReadback?: { screen: string | null; component: string | null; pointerInside: boolean };
}

export interface MenuInputAction {
  actionId: number;
  eventId: number | null;
  eventType: MenuInputEvent['type'] | null;
  phase: string;
  source: string;
  ratio: number;
  reverse: boolean;
  valueBefore: number | null;
  valueAfter: number | null;
  sourceBefore: number | null;
  sourceAfter: number | null;
  normalizedBefore: number | null;
  normalizedAfter: number | null;
  valueChanged: boolean;
  handlerEnteredAt: number;
  handlerReturnedAt: number;
  probeBeforeMs: number;
  probeAfterMs: number;
  probeError?: string;
  exception?: string;
  frameStatus?: string;
  supersededByActionId?: number;
  firstFrameId?: number;
  firstFrameStartedAt?: number;
  firstFrameCompletedAt?: number;
  firstFrameValue?: number | null;
  firstFrameSource?: number | null;
  firstFrameNormalized?: number | null;
  firstFrameBarRatio?: number | null;
  firstFrameProbeError?: string;
}

export interface MenuInputLatency {
  kind: 'slider' | 'hover' | 'screen';
  eventId: number;
  eventType: MenuInputEvent['type'];
  actionId?: number;
  frameId: number;
  toHandlerMs?: number;
  handlerMs?: number;
  handlerToFrameMs?: number;
  handlerReturnToDrawMs?: number;
  toFrameMs: number;
  valueBefore?: number | null;
  valueAfter?: number | null;
  frameValue?: number | null;
  frameSource?: number | null;
  frameNormalized?: number | null;
  frameBarRatio?: number | null;
  valueChanged?: boolean;
  presented: boolean;
}

export interface MenuInputFrame {
  frameId: number;
  startedAt: number;
  completedAt: number;
  frameMs: number | null;
  drawMs: number;
  inputProbeMs: number;
}

/** Instrument only the generated acceptance game. Event IDs travel on the
 * actual posted SDL event, so a release or a same-position press never inherits
 * the previous motion's timestamp. No product source or input cadence changes. */
export const menuPerformanceInputRuntime = `    import math as qa_math
    qa_input = qa_builtins.dict(nextEvent=0, nextAction=0, nextFrame=0, current=None, events=qa_builtins.list(), byEvent=qa_builtins.dict(), pendingActions=qa_builtins.list(), pendingPresentations=qa_builtins.list())
    qa_original_post = renpy.test.testmouse.post
    qa_original_focus_event = renpy.display.focus.mouse_handler
    qa_original_bar_event = VnUiBar.event
    qa_original_button_event = VnSkinButton.event
    qa_original_bar = vn_ui_control_bar_changed

    def qa_post(event_type, **kwargs):
        phase = qa_state["active"]
        kind = {vn_ui_pygame.MOUSEMOTION: "move", vn_ui_pygame.MOUSEBUTTONDOWN: "down", vn_ui_pygame.MOUSEBUTTONUP: "up"}.get(event_type)
        if phase is None or kind is None:
            return qa_original_post(event_type, **kwargs)
        qa_input["nextEvent"] += 1
        identity = qa_input["nextEvent"]
        intent = qa_state["intent"]
        row = qa_builtins.dict(eventId=identity, phase=phase["name"], type=kind, postedAt=qa_time.perf_counter(), position=qa_builtins.list(kwargs.get("pos", ())), button=kwargs.get("button"), buttons=qa_builtins.list(kwargs.get("buttons", ())), actionIds=qa_builtins.list(), dispatches=qa_builtins.list())
        if intent is not None:
            row["intent"] = qa_builtins.dict(intent)
            requested = intent["kind"] == "hover" and kind == "move" or intent["kind"] == "screen" and kind == "up" and kwargs.get("button") == 1
            if requested:
                row["presentation"] = "pending"
                qa_input["pendingPresentations"].append(identity)
        qa_input["events"].append(row)
        qa_input["byEvent"][identity] = row
        phase["inputEventIds"].append(identity)
        # testmouse.post retains all kwargs on the real pygame Event. Normal
        # engine motion coalescing is preserved; skipped IDs remain in evidence.
        kwargs["vn_menu_qa_event_id"] = identity
        return qa_original_post(event_type, **kwargs)

    def qa_event_row(ev):
        return qa_input["byEvent"].get(getattr(ev, "vn_menu_qa_event_id", None))

    def qa_dispatch_begin(row, stage, component=None):
        if row is None: return None
        now = qa_time.perf_counter()
        if "dispatchedAt" not in row: row["dispatchedAt"] = now
        item = qa_builtins.dict(stage=stage, enteredAt=now)
        if component is not None: item["component"] = component
        row["dispatches"].append(item)
        return item

    def qa_focus_event(ev, x, y, default=False):
        row = qa_event_row(ev)
        record = qa_dispatch_begin(row, "focus")
        previous = qa_input["current"]
        qa_input["current"] = row
        try:
            return qa_original_focus_event(ev, x, y, default=default)
        except BaseException as error:
            if record is not None: record["exception"] = type(error).__name__
            raise
        finally:
            if record is not None: record["returnedAt"] = qa_time.perf_counter()
            qa_input["current"] = previous

    def qa_bar_event(self, ev, x, y, st):
        if getattr(self, "vn_component_id", None) != qa_slider:
            return qa_original_bar_event(self, ev, x, y, st)
        row = qa_event_row(ev)
        record = qa_dispatch_begin(row, "slider", qa_slider)
        previous = qa_input["current"]
        qa_input["current"] = row
        try:
            return qa_original_bar_event(self, ev, x, y, st)
        except BaseException as error:
            if record is not None: record["exception"] = type(error).__name__
            raise
        finally:
            if record is not None: record["returnedAt"] = qa_time.perf_counter()
            qa_input["current"] = previous

    def qa_button_event(self, ev, x, y, st):
        row = qa_event_row(ev)
        intent = row.get("intent") if row is not None else None
        if intent is None or getattr(self, "vn_component_id", None) != intent["component"]:
            return qa_original_button_event(self, ev, x, y, st)
        record = qa_dispatch_begin(row, "button", self.vn_component_id)
        previous = qa_input["current"]
        qa_input["current"] = row
        try:
            return qa_original_button_event(self, ev, x, y, st)
        except BaseException as error:
            record["exception"] = type(error).__name__
            raise
        finally:
            record["returnedAt"] = qa_time.perf_counter()
            qa_input["current"] = previous

    def qa_slider_values():
        try:
            return qa_builtins.dict(value=vn_ui_get(qa_slider, "numberValue"), source=vn_preference_get("musicVolume"), normalized=vn_ui_control_ratio(qa_slider))
        except Exception as error:
            # Preserve the product exception and original callback outcome.
            # Missing readback is explicit and rejected by the Node audit.
            return qa_builtins.dict(value=None, source=None, normalized=None, error=type(error).__name__ + ": " + str(error))

    def qa_drawn_slider():
        try:
            screen = renpy.get_screen("preferences")
            # Inspect the already drawn SL2 widget map directly. get_displayable
            # may call screen.update() for an absent child, which would add work.
            bar = screen.widgets.get("vn_component_" + qa_slider + "_control") if screen is not None else None
            if not isinstance(bar, VnUiBar) or bar.adjustment.range != 1.0:
                return qa_builtins.dict(ratio=None, error="Expected the drawn normalized music bar")
            return qa_builtins.dict(ratio=bar.adjustment.value)
        except Exception as error:
            return qa_builtins.dict(ratio=None, error=type(error).__name__ + ": " + str(error))

    def qa_finite_number(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and qa_math.isfinite(value)

    def qa_bar(component_id, ratio, reverse=False):
        phase = qa_state["active"]
        if component_id != qa_slider or phase is None:
            return qa_original_bar(component_id, ratio, reverse)
        row = qa_input["current"]
        qa_input["nextAction"] += 1
        probe_start = qa_time.perf_counter()
        before = qa_slider_values()
        probe_before_ms = (qa_time.perf_counter()-probe_start)*1000
        action = qa_builtins.dict(actionId=qa_input["nextAction"], eventId=row["eventId"] if row is not None else None, eventType=row["type"] if row is not None else None, phase=phase["name"], source=component_id, ratio=ratio, reverse=reverse, valueBefore=before["value"], sourceBefore=before["source"], normalizedBefore=before["normalized"], probeBeforeMs=probe_before_ms)
        qa_state["actions"].append(action)
        phase["actionIds"].append(action["actionId"])
        if row is not None: row["actionIds"].append(action["actionId"])
        try:
            action["handlerEnteredAt"] = qa_time.perf_counter()
            return qa_original_bar(component_id, ratio, reverse)
        except BaseException as error:
            action["exception"] = type(error).__name__
            raise
        finally:
            returned = qa_time.perf_counter()
            after = qa_slider_values()
            action.update(handlerReturnedAt=returned, valueAfter=after["value"], sourceAfter=after["source"], normalizedAfter=after["normalized"], valueChanged=before["value"] != after["value"], probeAfterMs=(qa_time.perf_counter()-returned)*1000)
            if before.get("error") or after.get("error"):
                action["probeError"] = str(before.get("error")) + " / " + str(after.get("error"))
            qa_input["pendingActions"].append(action)

    def qa_input_frame(phase, frame):
        probe_start = qa_time.perf_counter()
        remaining = qa_builtins.list()
        values = None
        drawn = None
        for action in qa_input["pendingActions"]:
            if action["phase"] != phase["name"] or action["handlerReturnedAt"] > frame["startedAt"]:
                remaining.append(action)
                continue
            if values is None:
                values = qa_slider_values()
                drawn = qa_drawn_slider()
            valid = not values.get("error") and not drawn.get("error") and all(qa_finite_number(value) for value in (values["value"], values["source"], values["normalized"], drawn["ratio"]))
            expected_ratio = (1.0 - values["normalized"] if action["reverse"] else values["normalized"]) if valid else None
            current_matches_widget = valid and abs(values["value"]-values["source"]) < .0001 and abs(drawn["ratio"]-expected_ratio) < .000001
            matches = current_matches_widget and values["value"] == action["valueAfter"] and values["source"] == action["sourceAfter"] and values["normalized"] == action["normalizedAfter"]
            later = next((candidate for candidate in reversed(qa_input["pendingActions"]) if candidate["actionId"] > action["actionId"] and candidate["phase"] == phase["name"] and candidate["source"] == action["source"] and candidate["handlerReturnedAt"] <= frame["startedAt"]), None)
            replaced = later is not None and values["value"] == later["valueAfter"] and values["source"] == later["sourceAfter"] and values["normalized"] == later["normalizedAfter"]
            # A stale/missing drawn bar is a verification failure, never a slow
            # sample silently removed as superseded. Supersession needs the
            # actual later action that wrote the state shown in this frame.
            status = "presented" if matches else "readback-unavailable" if not valid else "widget-value-mismatch" if not current_matches_widget else "superseded-before-frame" if replaced else "unexpected-value-change-before-frame"
            if status == "superseded-before-frame": action["supersededByActionId"] = later["actionId"]
            if values.get("error") or drawn.get("error"): action["firstFrameProbeError"] = str(values.get("error")) + " / " + str(drawn.get("error"))
            action.update(frameStatus=status, firstFrameId=frame["frameId"], firstFrameStartedAt=frame["startedAt"], firstFrameCompletedAt=frame["completedAt"], firstFrameValue=values["value"], firstFrameSource=values["source"], firstFrameNormalized=values["normalized"], firstFrameBarRatio=drawn["ratio"])
            row = qa_input["byEvent"].get(action["eventId"])
            if row is None:
                action["frameStatus"] = "unassociated-event"
                continue
            phase["inputLatencies"].append(qa_builtins.dict(kind="slider", eventId=row["eventId"], eventType=row["type"], actionId=action["actionId"], frameId=frame["frameId"], toHandlerMs=(action["handlerEnteredAt"]-row["postedAt"])*1000, handlerMs=(action["handlerReturnedAt"]-action["handlerEnteredAt"])*1000, handlerToFrameMs=(frame["completedAt"]-action["handlerEnteredAt"])*1000, handlerReturnToDrawMs=(frame["startedAt"]-action["handlerReturnedAt"])*1000, toFrameMs=(frame["completedAt"]-row["postedAt"])*1000, valueBefore=action["valueBefore"], valueAfter=action["valueAfter"], frameValue=values["value"], frameSource=values["source"], frameNormalized=values["normalized"], frameBarRatio=drawn["ratio"], valueChanged=action["valueChanged"], presented=matches))
        qa_input["pendingActions"] = remaining
        pending = qa_builtins.list()
        focused = renpy.display.focus.get_focused()
        for identity in qa_input["pendingPresentations"]:
            row = qa_input["byEvent"][identity]
            intent = row["intent"]
            if row["phase"] != phase["name"] or "dispatchedAt" not in row:
                pending.append(identity)
                continue
            # ShowMenu can suspend this handler in a nested game-menu context
            # until that menu closes. Its entry plus the drawn target screen
            # is the correct opening boundary; waiting for its return is not.
            buttons = [item for item in row["dispatches"] if item["stage"] == "button" and item["enteredAt"] <= frame["startedAt"] and (intent["kind"] == "screen" or item.get("returnedAt", float("inf")) <= frame["startedAt"])]
            target = renpy.get_screen(intent["target"]) if intent["kind"] == "screen" else None
            ready = bool(buttons) and (target is not None if intent["kind"] == "screen" else getattr(focused, "vn_component_id", None) == intent["component"] and getattr(focused, "vn_pointer_inside", False))
            if not ready:
                pending.append(identity)
                continue
            row.update(presentation="presented", firstTargetFrameId=frame["frameId"], firstTargetFrameStartedAt=frame["startedAt"], firstTargetFrameCompletedAt=frame["completedAt"], firstTargetReadback=qa_builtins.dict(screen=target.screen_name[0] if target is not None else None, component=getattr(focused, "vn_component_id", None), pointerInside=bool(getattr(focused, "vn_pointer_inside", False))))
            phase["inputLatencies"].append(qa_builtins.dict(kind=intent["kind"], eventId=identity, eventType=row["type"], frameId=frame["frameId"], toHandlerMs=(buttons[0]["enteredAt"]-row["postedAt"])*1000, toFrameMs=(frame["completedAt"]-row["postedAt"])*1000, presented=True))
        qa_input["pendingPresentations"] = pending
        frame["inputProbeMs"] = (qa_time.perf_counter()-probe_start)*1000

    def qa_input_end(phase):
        for action in qa_input["pendingActions"]:
            action["frameStatus"] = "unpresented-at-phase-end"
            phase["unpresentedInputs"] += 1
        qa_input["pendingActions"] = qa_builtins.list()
        for identity in qa_input["pendingPresentations"]:
            qa_input["byEvent"][identity]["presentation"] = "unpresented-at-phase-end"
            phase["unpresentedInputs"] += 1
        qa_input["pendingPresentations"] = qa_builtins.list()

    def qa_expect_hover(identity):
        for previous in qa_input["pendingPresentations"]:
            qa_input["byEvent"][previous]["presentation"] = "superseded-by-next-intent"
            qa_state["active"]["unpresentedInputs"] += 1
        qa_input["pendingPresentations"] = qa_builtins.list()
        qa_state["intent"] = qa_builtins.dict(kind="hover", target=identity, component=identity)

    def qa_expect_screen(name, identity):
        qa_state["intent"] = qa_builtins.dict(kind="screen", target=name, component=identity)

    def qa_input_restore():
        renpy.test.testmouse.post = qa_original_post
        renpy.display.focus.mouse_handler = qa_original_focus_event
        VnUiBar.event = qa_original_bar_event
        VnSkinButton.event = qa_original_button_event
        renpy.store.vn_ui_control_bar_changed = qa_original_bar

    renpy.test.testmouse.post = qa_post
    renpy.display.focus.mouse_handler = qa_focus_event
    VnUiBar.event = qa_bar_event
    VnSkinButton.event = qa_button_event
    vn_ui_control_bar_changed = qa_bar

`;

export function auditMenuInputTrace(metrics: {
  inputTraceVersion?: number;
  inputEvents?: MenuInputEvent[];
  actions: MenuInputAction[];
  phases: { name: string; inputEventIds: number[]; actionIds: number[]; unpresentedInputs: number; inputLatencies: MenuInputLatency[]; frames: MenuInputFrame[] }[];
}) {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const close = (actual: number | undefined, expected: number, message: string) => assert.ok(finite(actual) && Math.abs(actual - expected) < .001, message);
  assert.equal(metrics.inputTraceVersion, 2, 'This run must use event IDs rather than lastMove timestamps.');
  const events = new Map((metrics.inputEvents ?? []).map(event => [event.eventId, event]));
  assert.equal(events.size, metrics.inputEvents?.length, 'Every posted event has a unique ID.');
  const actions = new Map(metrics.actions.map(action => [action.actionId, action]));
  assert.equal(actions.size, metrics.actions.length, 'Every callback has a unique action ID.');
  const phases = new Map(metrics.phases.map(phase => [phase.name, phase]));
  assert.equal(phases.size, metrics.phases.length, 'Phase names must be unique.');
  for (const event of events.values()) {
    assert.ok(['down', 'move', 'up'].includes(event.type));
    assert.ok(Number.isSafeInteger(event.eventId) && event.eventId > 0 && finite(event.postedAt));
    assert.ok(phases.get(event.phase)?.inputEventIds.includes(event.eventId));
    assert.ok(event.dispatchedAt === undefined || event.dispatchedAt >= event.postedAt);
    assert.equal(new Set(event.actionIds).size, event.actionIds.length);
    assert.equal(event.dispatchedAt, event.dispatches[0]?.enteredAt, 'First dispatch timestamp must identify the first observed dispatch.');
    for (const dispatch of event.dispatches) {
      assert.ok(['focus', 'slider', 'button'].includes(dispatch.stage));
      assert.ok(finite(dispatch.enteredAt) && dispatch.enteredAt >= event.postedAt);
      assert.ok(dispatch.returnedAt === undefined || finite(dispatch.returnedAt) && dispatch.returnedAt >= dispatch.enteredAt);
      if (dispatch.stage !== 'focus') assert.equal(typeof dispatch.component, 'string');
    }
    for (const identity of event.actionIds) assert.equal(actions.get(identity)?.eventId, event.eventId);
  }
  for (const action of actions.values()) {
    const event = action.eventId === null ? undefined : events.get(action.eventId);
    assert.ok(event, 'Timed slider callbacks must be associated with their actual SDL event; unassociated callbacks remain in metrics.');
    assert.equal(event.type, action.eventType);
    assert.equal(event.phase, action.phase);
    assert.ok(event.actionIds.includes(action.actionId));
    assert.ok(phases.get(action.phase)?.actionIds.includes(action.actionId));
    assert.ok(Number.isSafeInteger(action.actionId) && action.actionId > 0);
    assert.ok(finite(action.handlerEnteredAt) && finite(action.handlerReturnedAt) && action.handlerEnteredAt >= event.postedAt && action.handlerReturnedAt >= action.handlerEnteredAt);
    assert.ok(event.dispatches.some(dispatch => dispatch.stage === 'slider' && dispatch.component === action.source && dispatch.enteredAt <= action.handlerEnteredAt && dispatch.returnedAt !== undefined && dispatch.returnedAt >= action.handlerReturnedAt), 'A matching slider dispatch must enclose the original callback.');
    assert.equal(action.probeError, undefined, 'Readbacks must succeed.');
    assert.equal(action.exception, undefined, 'The product callback must finish normally.');
    for (const value of [action.ratio, action.valueBefore, action.valueAfter, action.sourceBefore, action.sourceAfter, action.normalizedBefore, action.normalizedAfter]) assert.ok(finite(value));
    assert.ok(action.normalizedBefore! >= 0 && action.normalizedBefore! <= 1 && action.normalizedAfter! >= 0 && action.normalizedAfter! <= 1);
    assert.equal(typeof action.reverse, 'boolean');
    assert.ok(finite(action.probeBeforeMs) && action.probeBeforeMs >= 0 && finite(action.probeAfterMs) && action.probeAfterMs >= 0);
    assert.equal(action.valueChanged, action.valueBefore !== action.valueAfter);
    assert.ok(Math.abs(action.valueBefore! - action.sourceBefore!) < .0001, 'The UI/source pre-state must be retained, not inferred from the pointer ratio.');
    assert.ok(Math.abs(action.valueAfter! - action.sourceAfter!) < .0001, 'The actual UI value must agree with musicVolume after each callback.');
  }
  const latencyActions = new Set<number>();
  const latencyPresentations = new Set<number>();
  const frameIds = new Set<number>();
  for (const phase of phases.values()) {
    assert.equal(new Set(phase.inputEventIds).size, phase.inputEventIds.length);
    assert.equal(new Set(phase.actionIds).size, phase.actionIds.length);
    for (const identity of phase.inputEventIds) assert.equal(events.get(identity)?.phase, phase.name);
    for (const identity of phase.actionIds) assert.equal(actions.get(identity)?.phase, phase.name);
    const frames = new Map(phase.frames.map(frame => [frame.frameId, frame]));
    for (const [index, frame] of phase.frames.entries()) {
      assert.ok(Number.isSafeInteger(frame.frameId) && frame.frameId > 0 && !frameIds.has(frame.frameId), 'Frame IDs must be unique across phases.');
      frameIds.add(frame.frameId);
      assert.ok(finite(frame.startedAt) && finite(frame.completedAt) && frame.completedAt >= frame.startedAt);
      assert.ok(index === 0 || frame.startedAt >= phase.frames[index - 1].completedAt);
      close(frame.drawMs, (frame.completedAt - frame.startedAt) * 1000, 'Draw duration must use this actual frame.');
      if (index === 0) assert.equal(frame.frameMs, null);
      else close(frame.frameMs ?? undefined, (frame.completedAt - phase.frames[index - 1].completedAt) * 1000, 'Frame interval must use adjacent completed draws.');
      assert.ok(finite(frame.inputProbeMs) && frame.inputProbeMs >= 0, 'Draw readback overhead must remain visible.');
    }
    for (const latency of phase.inputLatencies) {
      const event = events.get(latency.eventId), frame = frames.get(latency.frameId);
      assert.ok(event && frame);
      assert.equal(event.phase, phase.name);
      assert.equal(event.type, latency.eventType);
      assert.ok(event.postedAt <= frame.startedAt);
      close(latency.toFrameMs, (frame.completedAt - event.postedAt) * 1000, 'Input latency must start at its own posted event.');
      if (latency.actionId !== undefined) {
        assert.equal(latency.kind, 'slider');
        const action = actions.get(latency.actionId);
        assert.ok(action && action.eventId === event.eventId && action.firstFrameId === frame.frameId);
        assert.ok(!latencyActions.has(action.actionId), 'A callback is linked to its first eligible frame only once.');
        latencyActions.add(action.actionId);
        assert.equal(latency.valueChanged, action.valueChanged);
        assert.equal(latency.valueBefore, action.valueBefore); assert.equal(latency.valueAfter, action.valueAfter);
        assert.equal(latency.frameValue, action.firstFrameValue); assert.equal(latency.frameSource, action.firstFrameSource);
        assert.equal(latency.frameNormalized, action.firstFrameNormalized); assert.equal(latency.frameBarRatio, action.firstFrameBarRatio);
        assert.equal(action.firstFrameStartedAt, frame.startedAt); assert.equal(action.firstFrameCompletedAt, frame.completedAt);
        assert.ok(frame.startedAt >= action.handlerReturnedAt);
        assert.equal(phase.frames.find(candidate => candidate.startedAt >= action.handlerReturnedAt)?.frameId, frame.frameId, 'Do not skip a slow or mismatching first eligible frame.');
        close(latency.toHandlerMs, (action.handlerEnteredAt - event.postedAt) * 1000, 'Event→handler timing must recompute.');
        close(latency.handlerMs, (action.handlerReturnedAt - action.handlerEnteredAt) * 1000, 'Original callback duration must recompute.');
        close(latency.handlerToFrameMs, (frame.completedAt - action.handlerEnteredAt) * 1000, 'Handler→frame timing must recompute.');
        close(latency.handlerReturnToDrawMs, (frame.startedAt - action.handlerReturnedAt) * 1000, 'Handler return→draw timing must recompute.');
        assert.equal(action.firstFrameProbeError, undefined);
        assert.ok(['presented', 'superseded-before-frame'].includes(action.frameStatus ?? ''), 'Missing readbacks, stale visuals or unexplained value changes cannot be excluded as superseded.');
        for (const value of [action.firstFrameValue, action.firstFrameSource, action.firstFrameNormalized, action.firstFrameBarRatio]) assert.ok(finite(value));
        assert.ok(action.firstFrameNormalized! >= 0 && action.firstFrameNormalized! <= 1);
        assert.ok(Math.abs(action.firstFrameValue! - action.firstFrameSource!) < .0001);
        const expectedBarRatio = action.reverse ? 1 - action.firstFrameNormalized! : action.firstFrameNormalized!;
        assert.ok(Math.abs(action.firstFrameBarRatio! - expectedBarRatio) < .000001, 'The drawn bar adjustment must agree with the current normalized source value.');
        const matches = action.firstFrameValue === action.valueAfter && action.firstFrameSource === action.sourceAfter && action.firstFrameNormalized === action.normalizedAfter;
        assert.equal(latency.presented, matches);
        assert.equal(action.frameStatus === 'presented', matches);
        if (matches) assert.equal(action.supersededByActionId, undefined);
        else {
          const later = action.supersededByActionId === undefined ? undefined : actions.get(action.supersededByActionId);
          assert.ok(later && later.actionId > action.actionId && later.phase === action.phase && later.source === action.source && later.handlerReturnedAt <= frame.startedAt, 'Supersession needs an actual later callback before the same draw.');
          assert.equal(action.firstFrameValue, later.valueAfter); assert.equal(action.firstFrameSource, later.sourceAfter); assert.equal(action.firstFrameNormalized, later.normalizedAfter);
          assert.equal(metrics.actions.filter(candidate => candidate.actionId > action.actionId && candidate.phase === action.phase && candidate.source === action.source && candidate.handlerReturnedAt <= frame.startedAt).at(-1)?.actionId, later.actionId, 'Supersession must identify the latest eligible write.');
        }
      } else {
        assert.ok(latency.kind === 'hover' || latency.kind === 'screen');
        assert.equal(event.intent?.kind, latency.kind);
        assert.ok(!latencyPresentations.has(event.eventId), 'Each presentation intent is measured once.');
        latencyPresentations.add(event.eventId);
        assert.equal(event.presentation, 'presented'); assert.equal(latency.presented, true);
        assert.equal(event.firstTargetFrameId, frame.frameId); assert.equal(event.firstTargetFrameStartedAt, frame.startedAt); assert.equal(event.firstTargetFrameCompletedAt, frame.completedAt);
        const dispatch = event.dispatches.find(item => item.stage === 'button' && item.component === event.intent?.component && item.enteredAt <= frame.startedAt && (latency.kind === 'screen' || item.returnedAt !== undefined && item.returnedAt <= frame.startedAt));
        assert.ok(dispatch, 'A target button must receive this actual event before the target frame.');
        close(latency.toHandlerMs, (dispatch.enteredAt - event.postedAt) * 1000, 'Target handler latency must recompute.');
        if (latency.kind === 'screen') {
          assert.equal(event.type, 'up'); assert.equal(event.button, 1);
          assert.equal(event.firstTargetReadback?.screen, event.intent?.target, 'Opening latency needs the actual target screen at draw completion.');
        } else {
          assert.equal(event.type, 'move'); assert.equal(event.firstTargetReadback?.component, event.intent?.component); assert.equal(event.firstTargetReadback?.pointerInside, true);
        }
      }
    }
    const unpresentedActions = metrics.actions.filter(action => action.phase === phase.name && action.frameStatus === 'unpresented-at-phase-end');
    const unpresentedIntents = [...events.values()].filter(event => event.phase === phase.name && ['unpresented-at-phase-end', 'superseded-by-next-intent'].includes(event.presentation ?? ''));
    assert.equal(phase.unpresentedInputs, unpresentedActions.length + unpresentedIntents.length, 'Unpresented evidence must be retained without losing or duplicating records.');
    if (phase.name === 'preferences_slider') {
      assert.ok(phase.inputLatencies.filter(input => input.kind === 'slider' && input.valueChanged && input.presented).length >= 20, 'The two 20-step drags must still produce at least 20 actually presented value changes.');
    }
  }
  for (const action of actions.values()) {
    assert.ok(latencyActions.has(action.actionId) || action.frameStatus === 'unpresented-at-phase-end', 'Every callback is retained as a latency or an explicit unpresented action.');
    if (action.frameStatus === 'unpresented-at-phase-end') {
      assert.equal(action.firstFrameId, undefined);
      assert.ok(!phases.get(action.phase)!.frames.some(frame => frame.startedAt >= action.handlerReturnedAt), 'An available first frame cannot be reclassified as unpresented.');
    }
  }
  for (const event of events.values()) {
    const requested = event.intent?.kind === 'hover' && event.type === 'move' || event.intent?.kind === 'screen' && event.type === 'up' && event.button === 1;
    if (!requested) { assert.equal(event.presentation, undefined); continue; }
    assert.ok(['presented', 'unpresented-at-phase-end', 'superseded-by-next-intent'].includes(event.presentation ?? ''), 'Every requested target has a final presentation status.');
    assert.equal(event.presentation === 'presented', latencyPresentations.has(event.eventId));
  }
  return {
    version: 2,
    events: events.size,
    eventTypes: Object.fromEntries(['down', 'move', 'up'].map(type => [type, [...events.values()].filter(event => event.type === type).length])),
    eventsNotObservedAtDispatch: [...events.values()].filter(event => event.dispatchedAt === undefined).map(event => event.eventId),
    callbacks: actions.size,
    valueChangingCallbacks: [...actions.values()].filter(action => action.valueChanged).length,
    sameValueCallbacks: [...actions.values()].filter(action => !action.valueChanged).length,
    presentedValueChangingCallbacks: [...actions.values()].filter(action => action.valueChanged && action.frameStatus === 'presented').length,
    presentedSameValueCallbacks: [...actions.values()].filter(action => !action.valueChanged && action.frameStatus === 'presented').length,
    supersededCallbacks: [...actions.values()].filter(action => action.frameStatus === 'superseded-before-frame').map(action => action.actionId),
    unpresentedCallbacks: [...actions.values()].filter(action => action.frameStatus === 'unpresented-at-phase-end').map(action => action.actionId),
    unpresentedTargetEvents: [...events.values()].filter(event => ['unpresented-at-phase-end', 'superseded-by-next-intent'].includes(event.presentation ?? '')).map(event => ({ eventId: event.eventId, status: event.presentation })),
  };
}
