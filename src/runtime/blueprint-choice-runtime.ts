/** Native typed matching and lazy choice evaluation. No bool/number coercion. */
export const blueprintChoiceRuntime = `init python:
    def vn_bp_choice_valid(kind, value):
        if kind == "number":
            return not isinstance(value, bool) and isinstance(value, (int, float)) and __import__("math").isfinite(value)
        if kind == "boolean":
            return isinstance(value, bool)
        return isinstance(value, str)

    def vn_bp_choice_match(key, key_type, cases):
        if key_type not in ("string", "number", "boolean") or not vn_bp_choice_valid(key_type, key):
            raise Exception("多路节点的匹配值类型错误；不会自动转换类型。")
        seen_ids, seen_values, chosen = set(), [], "default"
        for case_id, case_key in cases:
            if not isinstance(case_id, str) or case_id in seen_ids or not vn_bp_choice_valid(key_type, case_key) or case_key in seen_values:
                raise Exception("多路节点的分支标识、匹配值或类型无效。")
            seen_ids.add(case_id)
            seen_values.append(case_key)
            if case_key == key:
                chosen = "case_" + case_id
        return chosen

    def vn_bp_choice_value(key, key_type, cases, value_type, values):
        chosen = vn_bp_choice_match(key, key_type, cases)
        if value_type not in ("string", "number", "boolean", "asset", "character", "scene", "ui", "component") or chosen not in values:
            raise Exception("多路选择的结果定义无效。")
        # The dictionary holds thunks, not eagerly evaluated candidate values.
        result = values[chosen]()
        if not vn_bp_choice_valid(value_type, result):
            raise Exception("多路选择的结果类型错误；不会自动转换类型。")
        return result
`;
