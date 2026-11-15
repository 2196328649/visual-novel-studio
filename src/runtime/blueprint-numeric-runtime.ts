import { blueprintNumericInputs } from '../core/blueprint-numeric';
import { pythonLiteral } from './screens';

/** The native interpreter follows the same strict types, ranges and rounding contract. */
export const blueprintNumericRuntime = `init python:
    vn_bp_numeric_inputs = ${pythonLiteral(Object.fromEntries(Object.entries(blueprintNumericInputs).map(([type, pins]) => [type, pins.map(pin => [pin.id, pin.name, pin.dataType])]))) }

    def vn_bp_numeric(kind, values, mode="nearest"):
        import math
        if kind not in vn_bp_numeric_inputs:
            raise Exception("未知的数值运算。")
        for key, name, data_type in vn_bp_numeric_inputs[kind]:
            if data_type == "number":
                vn_bp_number(values.get(key), None, None, name)
            else:
                vn_bp_boolean(values.get(key), name)
        def clamp(value, minimum, maximum):
            return min(maximum, max(minimum, value))
        if kind in ("clamp", "inRange") and values["min"] > values["max"]:
            raise Exception("最小值不能大于最大值。")
        if kind == "clamp":
            result = clamp(values["value"], values["min"], values["max"])
        elif kind == "abs":
            result = abs(values["value"])
        elif kind == "round":
            value = values["value"]
            if mode == "nearest":
                magnitude = abs(value)
                whole = math.floor(magnitude)
                result = (-1 if value < 0 else 1) * (whole + (1 if magnitude - whole >= 0.5 else 0))
            elif mode == "floor":
                result = math.floor(value)
            elif mode == "ceil":
                result = math.ceil(value)
            elif mode == "truncate":
                result = math.trunc(value)
            else:
                raise Exception("请选择有效的取整方式。")
        elif kind == "inRange":
            result = (values["value"] >= values["min"] if values["includeMin"] else values["value"] > values["min"]) and (values["value"] <= values["max"] if values["includeMax"] else values["value"] < values["max"])
        elif kind == "nearlyEqual":
            if values["tolerance"] < 0:
                raise Exception("允许误差不能是负数。")
            result = abs(values["a"] - values["b"]) <= values["tolerance"]
        elif kind == "mapRange":
            span = values["inputMax"] - values["inputMin"]
            if span == 0:
                raise Exception("输入起点和终点不能相等。")
            offset = values["value"] - values["inputMin"]
            if not math.isfinite(span) or not math.isfinite(offset):
                raise Exception("映射区间计算超出有限数值范围。")
            alpha = offset / span
            if values["clamp"]:
                alpha = clamp(alpha, 0, 1)
            result = values["outputMin"] * (1 - alpha) + values["outputMax"] * alpha
        else:
            alpha = clamp(values["alpha"], 0, 1) if values["clampAlpha"] else values["alpha"]
            result = values["a"] * (1 - alpha) + values["b"] * alpha
        if not isinstance(result, bool) and not math.isfinite(result):
            raise Exception("计算结果超出有限数值范围。")
        return 0 if not isinstance(result, bool) and result == 0 else result
`;
