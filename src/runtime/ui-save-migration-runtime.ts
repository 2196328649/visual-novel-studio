/** The shipped 0.8.0 runtime saved open-page modes but had no instance tokens.
 * This adapter is deliberately separate from current page creation: loading or
 * rollback must not replay entry events, reset controls, or invent caller data. */
export const uiSaveMigrationRuntime = `default vn_ui_page_schema = 0
default vn_ui_page_migration_source = None
default vn_ui_page_migration_recovery = {}
default vn_ui_page_migration_log = []

init python:
    def vn_ui_new_save_schema():
        global vn_ui_page_schema, vn_ui_page_migration_source, vn_ui_page_migration_recovery, vn_ui_page_migration_log
        vn_ui_page_schema = 1
        vn_ui_page_migration_source = None
        vn_ui_page_migration_recovery = {}
        vn_ui_page_migration_log = []

    def vn_ui_upgrade_saved_pages():
        global vn_ui_page_schema, vn_ui_page_serial, vn_ui_page_sessions, vn_ui_page_order, vn_ui_overrides
        global vn_ui_page_migration_source, vn_ui_page_migration_recovery, vn_ui_page_migration_log
        version = getattr(renpy.store, "vn_ui_page_schema", 0)
        if type(version) is not int or version not in (0, 1):
            raise Exception("存档页面格式版本不受支持，未改写原存档。请使用保存该存档的版本。")
        if not isinstance(vn_ui_open_pages, dict) or not isinstance(vn_ui_page_sessions, dict):
            raise Exception("存档页面记录损坏，未改写原存档。")
        missing = [page_id for page_id in vn_ui_open_pages if page_id not in vn_ui_page_sessions]
        if version == 0 and not missing and not renpy.game.after_rollback:
            vn_ui_new_save_schema()
            return
        if version == 1 and not missing:
            return
        if version == 1 and getattr(renpy.store, "vn_ui_page_migration_source", None) != 0:
            raise Exception("存档缺少页面实例记录，无法安全恢复。未改写原存档。")
        # Validate every old entry before installing any instance. A removed or
        # unsupported page must not silently become a different page or hang.
        for page_id in missing:
            if page_id not in vn_custom_pages:
                raise Exception("存档引用的页面已删除：" + str(page_id) + "。请恢复对应工程版本；原存档未改写。")
            if vn_ui_open_pages[page_id] not in ("shown", "waiting"):
                raise Exception("存档页面打开方式不受支持：" + str(page_id) + "。原存档未改写。")
            vn_ui_interface_inputs(page_id, {}, migrating=True)
        native_candidates = [page_id for page_id in vn_ui_native_page_screens if vn_ui_native_page_displayable(page_id) is not None]
        for page_id in native_candidates:
            vn_ui_interface_inputs(page_id, {}, system=True, migrating=True)
        sessions = dict(vn_ui_page_sessions)
        if type(vn_ui_page_serial) is not int or any(not isinstance(record, dict) or type(record.get("token")) is not int for record in sessions.values()):
            raise Exception("存档页面实例标识不受支持。原存档未改写。")
        order = [page_id for page_id in vn_ui_page_order if page_id in vn_ui_open_pages]
        serial = max([vn_ui_page_serial] + [record.get("token", 0) for record in sessions.values()])
        # Insertion order is known; legacy records never stored parent identity.
        # Do not invent ancestry between independently opened old overlays.
        for page_id in missing:
            serial += 1
            sessions[page_id] = dict(token=serial, modal=vn_custom_pages[page_id].get("modal", True), parent=None,
                inputs=vn_ui_interface_inputs(page_id, {}, migrating=True), values={}, auto=0.0, confirm=False, allowSkip=False,
                depth=1, parentTask=None, flowToken=None, didShow=True, migratedFrom=0)
            if page_id not in order: order.append(page_id)
        recovery = dict(vn_ui_page_migration_recovery)
        if "legacy0" not in recovery:
            recovery["legacy0"] = __import__("copy").deepcopy(dict(version=version, openPages=vn_ui_open_pages, results=vn_ui_page_results, overrides=vn_ui_overrides))
        vn_ui_page_migration_recovery = recovery
        vn_ui_page_sessions, vn_ui_page_order, vn_ui_page_serial = sessions, order, serial
        native_pages = set()
        for page_id in native_candidates:
            session = vn_ui_native_page_scope(page_id, migrating=True)
            if session is not None:
                session["didShow"] = True
                native_pages.add(page_id)
        # Old overrides had no ownership. Only a host present in the saved base
        # context can inherit them. Keep every original byte-equivalent value in
        # recovery, rather than applying a closed menu to a fresh future instance.
        live_pages = set(vn_ui_open_pages) | native_pages
        released = [identity for identity in vn_ui_overrides if vn_ui_component_pages.get(identity) not in live_pages]
        vn_ui_overrides = {identity: value for identity, value in vn_ui_overrides.items() if identity not in released}
        for page_id in missing:
            vn_ui_interface_prepare(page_id, sessions[page_id]["inputs"], migrated=True)
        vn_ui_page_migration_log = (list(vn_ui_page_migration_log) + [dict(source=version, target=1, pages=list(missing), nativePages=sorted(native_pages), releasedOverrides=released, rollback=bool(renpy.game.after_rollback))])[-32:]
        vn_ui_page_migration_source, vn_ui_page_schema = 0, 1
        renpy.retain_after_load()

    config.start_callbacks.append(vn_ui_new_save_schema)
    # Register after the media callbacks so page identity exists before those
    # callbacks inspect a restored component. Rollback may reach pre-upgrade
    # checkpoints too; it uses the same idempotent, side-effect-free adapter.
    config.after_load_callbacks.insert(0, vn_ui_upgrade_saved_pages)
    config.interact_callbacks.insert(0, vn_ui_upgrade_saved_pages)
`;
