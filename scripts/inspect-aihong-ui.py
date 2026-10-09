"""Read original Unity UI metadata without modifying or driving the game."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


def write_page_index(output: Path, records: list, files: dict) -> None:
    by_id = {(item["file"], item["pathId"]): item for item in records}

    def reference(file_name, pointer):
        if not isinstance(pointer, dict) or not pointer.get("m_PathID"):
            return None
        if pointer.get("m_FileID"):
            externals = files[file_name]["externals"]
            index = pointer["m_FileID"] - 1
            if index >= len(externals):
                return None
            file_name = externals[index].replace("\\", "/").split("/")[-1]
        return by_id.get((file_name, pointer["m_PathID"]))

    rectangles = {(item["file"], item["data"]["m_GameObject"]["m_PathID"]): item for item in records if item["type"] == "RectTransform"}
    paths = {}

    def hierarchy(item, seen=None):
        key = (item["file"], item["pathId"])
        if key in paths:
            return paths[key]
        seen = set(seen or [])
        if key in seen:
            return item["data"].get("m_Name", "")
        seen.add(key)
        rect = rectangles.get(key)
        parent_rect = reference(item["file"], rect["data"].get("m_Father")) if rect else None
        parent = reference(parent_rect["file"], parent_rect["data"].get("m_GameObject")) if parent_rect else None
        value = (hierarchy(parent, seen) + "/" if parent else "") + item["data"].get("m_Name", "")
        paths[key] = value
        return value

    page_roots = {
        "标题": "Canvas-AdvUI/Title", "对话框": "UI/MessageWindowManager/MessageWindow", "剧情菜单": "Canvas-AdvUI/MainGame",
        "存读档": "Canvas-AdvUI/SaveLoad", "设置": "Canvas-AdvUI/Config", "CG图鉴": "Canvas-AdvUI/Gallery/CgGallery",
        "音乐室": "Canvas-AdvUI/Gallery/SoundRoom", "语音收藏": "Canvas-AdvUI/Gallery/VoiceCollection", "对话历史": "UI/BackLog",
        "剧情流程图": "Canvas-AdvUI/UI_PlotMap", "章节剧情视图": "Canvas-AdvUI/UI_PlotView", "系统消息": "Canvas-System UI",
    }

    def ref_summary(file_name, pointer):
        target = reference(file_name, pointer)
        return {"file": target["file"], "pathId": target["pathId"], "name": target["data"].get("m_Name", ""), "type": target["type"]} if target else None

    pages = []
    for name, prefix in page_roots.items():
        nodes = []
        for item in records:
            if item["type"] != "GameObject" or item["file"] != "level0":
                continue
            node_path = hierarchy(item)
            if node_path != prefix and not node_path.startswith(prefix + "/"):
                continue
            components = [reference(item["file"], value.get("component")) for value in item["data"].get("m_Component", [])]
            components = [value for value in components if value is not None]
            graphics = []
            for component in components:
                data = component["data"]
                kind = component.get("class") or component["type"]
                if kind == "UnityEngine.UI.Image":
                    graphics.append({"kind": "image", "sprite": ref_summary(component["file"], data.get("m_Sprite")), "color": data.get("m_Color"), "imageType": data.get("m_Type"), "preserveAspect": data.get("m_PreserveAspect")})
                elif kind == "UnityEngine.UI.Button":
                    graphics.append({"kind": "button", "interactable": data.get("m_Interactable"), "transition": data.get("m_Transition"), "colors": data.get("m_Colors"), "states": {key: ref_summary(component["file"], value) for key, value in data.get("m_SpriteState", {}).items()}, "actions": [value.get("m_MethodName") for value in data.get("m_OnClick", {}).get("m_PersistentCalls", {}).get("m_Calls", [])]})
                elif kind in ("TMPro.TextMeshProUGUI", "UnityEngine.UI.Text"):
                    graphics.append({"kind": "text", "text": data.get("m_text", data.get("m_Text", "")), "fontSize": data.get("m_fontSize", data.get("m_FontData", {}).get("m_FontSize")), "color": data.get("m_fontColor", data.get("m_Color")), "font": ref_summary(component["file"], data.get("m_fontAsset", data.get("m_FontData", {}).get("m_Font")))})
                elif "Language" in kind and "Adapter" in kind:
                    graphics.append({"kind": "localization", "component": kind, "simplifiedChinese": data.get("SC")})
                elif any(value in kind for value in ("LayoutGroup", "ContentSizeFitter", "CanvasScaler", "CanvasGroup", "SkeletonGraphic")):
                    graphics.append({"kind": "layout-or-effect", "component": kind, "data": data})
            rect = rectangles.get((item["file"], item["pathId"]))
            nodes.append({"file": item["file"], "pathId": item["pathId"], "path": node_path, "activeInSerializedScene": item["data"].get("m_IsActive"), "rectangle": rect["data"] if rect else None, "components": graphics})
        pages.append({"name": name, "root": prefix, "nodeCount": len(nodes), "nodes": nodes})
    (output / "ui-pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "ui-page-counts.json").write_text(json.dumps([{key: value for key, value in page.items() if key != "nodes"} for page in pages], ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game-data", type=Path, default=Path("E:/Game/GAMES/TheLamentingGeese_Data"))
    parser.add_argument("--dependencies", type=Path, default=Path("artifacts/unity-inspect-python"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--generate-types", action="store_true", help="Recover serialized component layouts from the local game assemblies")
    parser.add_argument("--index-only", action="store_true", help="Build a page index from an existing extraction in --output")
    args = parser.parse_args()
    if args.index_only:
        if args.output is None:
            parser.error("--index-only requires --output")
        summary = json.loads((args.output / "summary.json").read_text(encoding="utf-8"))
        records = json.loads((args.output / "objects.json").read_text(encoding="utf-8"))
        write_page_index(args.output, records, summary["files"])
        print((args.output / "ui-page-counts.json").read_text(encoding="utf-8"))
        return
    sys.path.insert(0, str(args.dependencies.resolve()))
    import UnityPy

    output = args.output or Path("artifacts/aihong-ui-inspection") / datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    output.mkdir(parents=True, exist_ok=True)
    files = [args.game_data / name for name in ("globalgamemanagers.assets", "level0", "sharedassets0.assets", "resources.assets")]
    environment = UnityPy.load(*(str(file) for file in files))
    if args.generate_types:
        from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
        unity_version = next(iter(environment.objects)).assets_file.unity_version
        generator = TypeTreeGenerator(unity_version, "AssetsTools")
        generator.load_local_game(str(args.game_data.parent))
        # IL2CPP reports assembly names without .dll, while UnityPy appends it.
        # Normalize to the actual loaded name before calling the generator.
        loaded_assemblies = set(generator.get_loaded_dll_names())
        raw_get_nodes = generator.get_nodes

        def loaded_nodes(assembly, fullname):
            if assembly not in loaded_assemblies and assembly.removesuffix(".dll") in loaded_assemblies:
                assembly = assembly.removesuffix(".dll")
            return raw_get_nodes(assembly, fullname)

        generator.get_nodes = loaded_nodes
        environment.typetree_generator = generator
    counts = Counter()
    errors = []
    records = []
    file_info = {}
    interesting = {"GameObject", "RectTransform", "Canvas", "CanvasGroup", "MonoBehaviour", "MonoScript", "Sprite", "Texture2D", "Font"}
    for obj in environment.objects:
        kind = obj.type.name
        counts[kind] += 1
        asset_file = obj.assets_file
        file_name = Path(asset_file.name).name
        if file_name not in file_info:
            file_info[file_name] = {"unityVersion": asset_file.unity_version, "externals": [getattr(item, "path", str(item)) for item in asset_file.externals]}
        if kind not in interesting:
            continue
        class_name = None
        try:
            if kind == "MonoBehaviour" and args.generate_types:
                head = obj.parse_monobehaviour_head()
                script = head.m_Script.deref_parse_as_object()
                class_name = f"{script.m_Namespace}.{script.m_ClassName}".strip(".")
                if obj.byte_size > 1000000 and not class_name.endswith("TMP_FontAsset"):
                    errors.append({"file": file_name, "pathId": obj.path_id, "type": kind, "class": class_name, "reason": "Large non-visual data object skipped", "bytes": obj.byte_size})
                    continue
                data = obj.read_typetree(nodes=obj.generate_monobehaviour_node())
            else:
                data = obj.read_typetree()
            if kind == "Texture2D":
                data = {key: data[key] for key in ("m_Name", "m_Width", "m_Height", "m_TextureFormat", "m_StreamData") if key in data}
            elif kind == "Font":
                data = {"m_Name": data.get("m_Name"), "fontBytes": len(data.get("m_FontData", []))}
            elif kind == "Sprite":
                render = data.get("m_RD", {})
                data = {key: data[key] for key in ("m_Name", "m_Rect", "m_Pivot", "m_Border", "m_PixelsToUnits") if key in data}
                data["render"] = {key: render[key] for key in ("texture", "m_Texture", "textureRect", "m_TextureRect", "settingsRaw", "m_SettingsRaw") if key in render}
            elif kind == "MonoBehaviour":
                # Retain scene/prefab components, not large settings tables or
                # scripts with no GameObject connection.
                game_object = data.get("m_GameObject", {})
                if not game_object.get("m_PathID"):
                    if class_name and class_name.endswith("TMP_FontAsset"):
                        data = {key: value for key, value in data.items() if key == "m_Name" or any(part in key for part in ("SourceFont", "FaceInfo", "AtlasTexture", "FallbackFont"))}
                    else:
                        continue
            records.append({"file": file_name, "pathId": obj.path_id, "type": kind, "class": class_name, "data": data})
        except Exception as error:
            errors.append({"file": file_name, "pathId": obj.path_id, "type": kind, "class": class_name, "reason": str(error)[:350]})
    summary = {"status": "partial" if errors else "complete", "source": str(args.game_data.resolve()), "UnityPy": UnityPy.__version__, "generatedTypes": args.generate_types, "files": file_info, "objectCounts": dict(counts), "records": len(records), "errorCount": len(errors), "errors": errors[:12]}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "objects.json").write_text(json.dumps(records, ensure_ascii=False, default=str), encoding="utf-8")
    (output / "errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
    write_page_index(output, records, file_info)
    print(json.dumps({**summary, "output": str(output.resolve())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
