# 菜单运行时第二轮性能静态审查（2026-11-10）

本记录对应第二轮实现冻结前的代码审查。实际执行统一构建、回归和 ABBA 对照由主代理负责；以下新改动尚无本轮性能结论。真实工程只读。

## 已实现的范围

只包含两处运行时模块；没有改布局求解算法、图片缓存、页面生命周期、媒体时钟、屏幕生成结构或蓝图事件。

| 文件 | 改动 | 保持的语义 |
| --- | --- | --- |
| `src/runtime/ui-control-runtime.ts` | `vn_ui_control_range` 在原字段读取循环中记录是否有关联参数，省去重复遍历；构造一个滑条 adjustment 时共用当次范围、行程和比例计算 | 关联参数读取及范围校验仍执行；每次构造重新读取。用户写入、清除临时覆盖、停止相关动画、变更回调和回调后可用性检查不变 |
| `src/runtime/ui-runtime.ts` | 初始化 `vn_ui_allowed_properties` 时把每个控件的支持字段列表转为 `frozenset` | 只改变静态能力表的成员查找；参数值、默认值、覆盖值和条件仍走原有实时读取 |

冻结基线为 `artifacts/editor-refinements-2026-11-10/baseline-source/src/runtime/`。对照脚本应只替换 `ui-control-runtime.ts` 整个模块，以及 `ui-runtime.ts` 中唯一的 `vn_ui_allowed_properties =` 赋值行。其余并行进行的开场音乐／过渡改动在 A/B 中使用同一个当前版本。

### 同步读取边界

旧的 `vn_ui_control_bar_adjustment` 在一个同步函数中读取范围至少四次：自己一次，`travel` 一次，`ratio → get` 一次，`ratio → travel` 一次。现在没有给整个交互建立缓存；只有这一次调用的局部 `span` 传给 `vn_ui_control_get`。

- `vn_ui_control_get` 原本所有单参数调用不变，仍自行获取范围。新增可选 `span` 仅由上述同步构造入口提供。
- `vn_ui_property_control_read` 仍执行来源参数校验；其数值绑定验证仍可读取范围，没有为减少调用而绕过它。
- 范围校验保留 `min/max/step` 的数值、有限性、顺序、步长、可表示性和引擎范围限制。原来的字段关联校验先后关系不变；只合并了同一循环后的重复存在性判断。
- 文本速度的右端瞬时显示、反向滑条、零跨度、临时覆盖显示和源值钳制仍使用原有公式。纯函数 `vn_ui_range_ratio` 仅承接已有公式。
- `vn_parameter_get` 和 `vn_preference_get` 的静态调用链只读取当前来源；这次范围读取到 adjustment 构造之间不执行参数写入或蓝图回调。
- 不提前返回“目标值等于当前显示值”。该情况下原有释放覆盖与写入来源语义仍可能需要执行。

### 支持字段集合的使用检查

静态检索 `src/`、`tests/`、`scripts/` 的全部 `vn_ui_allowed_properties` 引用：

- 定义在 `ui-runtime.ts`。
- `vn_ui_get`、`vn_ui_default`、`vn_ui_component_available`、`vn_ui_ancestor_enabled` 使用成员判断。
- `ui-property-control-runtime.ts` 的 `vn_ui_property_validate_value` 使用成员判断。
- 没有索引、排序、追加、删除或依赖字段顺序的使用；也没有对应的 JSON 序列化／反序列化入口。

该表在 `init python` 从工程静态元数据生成，集合内仍是原字符串键；没有新增 `default`、页面会话或存档字段。

## 暂不实施的 Transform 复用草案

本轮不改 `ui-layout-runtime.ts`、`screens.ts` 或 `ui-widgets.ts`。以下仅为源码研究，不能据此认定它是最终剩余卡顿的主因。

SDK 证据：

- `resources/runtime/renpy/sl2/slast.py:1011` 按子显示对象的参数、关键字、样式和版本决定能否复用；`:1204` 还比较 `at` 的 raw transform。
- `resources/runtime/renpy/display/transform.py:1124` 的 `Transform.__call__` 返回基础 `Transform` 活实例。当前 `vn_ui_layout_transform` 每次返回新对象；普通 `Transform` 没有按参数值比较的 `__eq__`。
- `slast.py:1043`、`:1140` 处理作用域／子树变化时的 `copy_on_change`，不会把这些变化强行塞进旧画面。
- `resources/runtime/renpy/display/screen.py:328` 的 `nosave/noreach` 排除屏幕缓存；`:372` 加载后清空这些缓存。
- 同文件 `show_screen` 在 `:1378` 附近会让新屏幕继承旧屏幕缓存，并直接进入 `UPDATE`。因此只比较位置参数，或只限制 `UPDATE` 阶段，都不足以证明页面替换的时间基线与旧版完全一致。

可供后续独立评估的最小结构是：专用 raw `at` 描述器，仅限当前屏幕实例内按完整位置／锚点／缩放／旋转／透明度元组比较。描述器继承 `Transform.__call__`，生成的活实例依然是普通 `Transform`，不改变活动动画对象的相等语义。

```python
# 未实施草案；不是本轮运行代码。
class VnUiLayoutAt(Transform):
    def __init__(self, owner, values):
        x, y, px, py, scale_x, scale_y, rotation, alpha = values
        super(VnUiLayoutAt, self).__init__(
            pos=(absolute(x), absolute(y)),
            anchor=(absolute(px), absolute(py)),
            transform_anchor=True, xzoom=scale_x, yzoom=scale_y,
            rotate=rotation or None, rotate_pad=False,
            subpixel=True, alpha=alpha)
        self.vn_owner = __import__("weakref").ref(owner)
        self.vn_owner_id, self.vn_values = id(owner), values

    def __eq__(self, other):
        if self is other: return True
        if type(other) is not type(self): return NotImplemented
        owner = self.vn_owner()
        return owner is not None and owner is other.vn_owner() and self.vn_values == other.vn_values

    def __hash__(self):
        return hash((type(self), self.vn_owner_id, self.vn_values))
```

入口还应在没有当前屏幕、预测或非 `UPDATE` 阶段返回普通 `Transform`。弱引用用于避免 raw cache 延长整页 scope 的寿命；不得把描述器放入 `default`、持久 scope，或直接 `add` 到绘制树。读取布局与动态参数依然在每次入口重新执行。

若后续 profile 证明 Transform 构造值得处理，必须另做以下验证后才能采用：同一实例几何不变时的复用；位置／尺寸／旋转／缩放／透明度变化即时生效；旧画面转场隔离；页面关闭重开、同 tag 替换和存读档；短媒体起点、子动画和点击命中；真实设置页像素一致性。当前先保留原实现。

背景表面也不是全部按身份比较。SDK `imagelike.py` 中的普通 `Solid`／`Frame` 已有结构相等，圆角／边框／部分图片适配包装才涉及新对象。`vn_ui_nine_slice` 的 `renpy.image_size` 是另一个潜在重复解码入口，但真实工程标题／设置没有这种九宫格用法，最终 build08 拖动期间图片解码请求为零，本轮不改它。

## 统一验收需要判断的内容

历史 build08 的真实设置页有 71 控件，44 次滑条回调约产生 88 次整页布局求解，合计约 710～760ms；有效比例变化的滑条响应中位约 86ms，首次进入设置两次样本为 613／696ms。这些只用于确定本轮观察方向，不能当作新改动的收益。

既有回归已覆盖范围调整／零跨度／非法范围、实际步长、反向滑条、瞬时文字速度、临时覆盖释放、事件次数、单向／双向参数及保存加载。主代理可按实际最终范围统一选择 `verify-ui-control-interaction-runtime.ts`、`verify-ui-control-properties-runtime.ts`、`verify-ui-property-control-runtime.ts`，并运行本轮真实 ABBA。

不把减少了多少函数调用直接换算成降低了多少毫秒。若首次打开设置仍有明显停顿，应以本轮最终代码 profile 区分冷图片／字体加载、屏幕求值、布局、构造和绘制，避免凭旧 profile 引入全局缓存。

本静态审查没有启动构建、测试、GUI 或 profile；没有产生临时产物。
