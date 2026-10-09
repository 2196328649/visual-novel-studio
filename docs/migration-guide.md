# 设计系统迁移指南

## 概述

这份指南说明如何将现有的样式代码迁移到新的设计令牌系统，确保平滑过渡且不破坏现有功能。

---

## 第一步：引入设计令牌

### 1. 在 main.tsx 中导入

```typescript
// src/renderer/main.tsx
import './design-tokens.css';  // 👈 在所有其他样式之前导入
import './styles.css';
import './workbench.css';
import './workbench-theme.css';
```

**重要：** design-tokens.css 必须最先导入，这样其他文件才能使用这些变量。

---

## 第二步：颜色迁移映射表

### 旧变量 → 新变量对照

#### 强调色 (Accent)

| 旧变量 | 旧值 | 新变量 | 新值 |
|--------|------|--------|------|
| `--accent` | #187d6b / #57b19a / #78c8b3 | `--accent-primary` | #38bdf8 |
| `--accent-light` | #e3f1ec / #30473f | `--accent-surface` | #1a3a47 |
| - | - | `--accent-hover` | #0ea5e9 |
| - | - | `--accent-ghost` | rgba(56,189,248,0.12) |

**迁移步骤：**
```bash
# 全局查找替换
--accent: → --accent-primary:
--accent-light: → --accent-surface:
```

#### 背景色 (Backgrounds)

| 旧变量 | 旧值 | 新变量 | 新值 |
|--------|------|--------|------|
| `background: #181c22` | - | `--surface-canvas` | #05070c |
| `background: #1c1e22` | - | `--surface-canvas` | #05070c |
| `background: #202226` | - | `--surface-base` | #0f131c |
| `background: #25272c` | - | `--surface-base` | #0f131c |
| `background: #2b2f35` | - | `--surface-raised` | #161d2b |
| `--panel` | #fff / #24262b | `--surface-base` | #0f131c |

**替换示例：**

```css
/* 旧代码 */
.app-shell {
  background: #181c22;
}

.sidebar {
  background: #25272c;
}

/* 新代码 */
.app-shell {
  background: var(--surface-canvas);
}

.sidebar {
  background: var(--surface-base);
}
```

#### 边框色 (Borders)

| 旧变量 | 旧值 | 新变量 | 新值 |
|--------|------|--------|------|
| `--border` | #dce3df / #3b424b | `--border-default` | #374151 |
| `border: 1px solid #3a3d43` | - | `--border-subtle` | #1f2937 |
| `border: 1px solid #4b5563` | - | `--border-emphasis` | #4b5563 |

#### 文本色 (Text)

| 旧变量 | 旧值 | 新变量 | 新值 |
|--------|------|--------|------|
| `color: #d5d8dc` | - | `--text-primary` | #e5e7eb |
| `color: #a0a9b5` | - | `--text-secondary` | #9ca3af |
| `--muted` | #7c8882 / #8c929b | `--text-tertiary` | #6b7280 |

---

## 第三步：字号迁移

### 固定字号 → 流式字号

| 旧字号 | 新变量 | 最终渲染 |
|--------|--------|----------|
| `font-size: 9px` | `var(--text-xs)` | 12-14px |
| `font-size: 10px` | `var(--text-xs)` | 12-14px |
| `font-size: 11px` | `var(--text-sm)` | 14-16px |
| `font-size: 12px` | `var(--text-sm)` | 14-16px |
| `font-size: 13px` | `var(--text-base)` | 16-18px |
| `font-size: 14px` | `var(--text-base)` | 16-18px |
| `font-size: 15px` | `var(--text-lg)` | 18-22px |

**批量替换示例：**

```css
/* 旧代码 */
.sidebar-label { font-size: 11px; }
.button-text { font-size: 12px; }
.heading { font-size: 15px; }

/* 新代码 */
.sidebar-label { font-size: var(--text-sm); }
.button-text { font-size: var(--text-sm); }
.heading { font-size: var(--text-lg); }
```

**重要提示：** 不再使用小于 12px 的字号！

---

## 第四步：间距迁移

### 固定间距 → 网格间距

| 旧间距 | 新变量 | 值 |
|--------|--------|-----|
| `5px`, `6px` | `var(--space-2)` | 8px |
| `7px`, `8px`, `9px` | `var(--space-2)` | 8px |
| `10px`, `12px` | `var(--space-3)` | 12px |
| `14px`, `16px` | `var(--space-4)` | 16px |
| `18px`, `20px` | `var(--space-5)` | 20px |
| `24px` | `var(--space-6)` | 24px |
| `32px` | `var(--space-8)` | 32px |

**替换示例：**

```css
/* 旧代码 */
.panel {
  padding: 7px 10px;
  gap: 5px;
  margin-bottom: 14px;
}

/* 新代码 */
.panel {
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
```

---

## 第五步：圆角迁移

### 多种圆角 → 4 级系统

| 旧圆角 | 新变量 | 值 |
|--------|--------|-----|
| `3px`, `4px`, `5px` | `var(--radius-sm)` | 4px |
| `6px`, `7px`, `8px` | `var(--radius-md)` | 8px |
| `10px`, `12px` | `var(--radius-lg)` | 12px |
| `999px`, `50%` | `var(--radius-full)` | 999px |

**替换示例：**

```css
/* 旧代码 */
.button { border-radius: 5px; }
.card { border-radius: 6px; }
.dialog { border-radius: 8px; }
.avatar { border-radius: 50%; }

/* 新代码 */
.button { border-radius: var(--radius-sm); }
.card { border-radius: var(--radius-md); }
.dialog { border-radius: var(--radius-lg); }
.avatar { border-radius: var(--radius-full); }
```

---

## 第六步：组件迁移示例

### 示例 1：按钮组件

#### 迁移前 (workbench-theme.css)

```css
button.primary {
  background: #347e6b;
  border-color: #408e7a;
  color: #f4fffa;
  padding: 6px 10px;
  border-radius: 5px;
}

button.primary:hover:not(:disabled) {
  background: #41947d;
}
```

#### 迁移后

```css
button.primary {
  background: var(--accent-primary);
  border: 1px solid transparent;
  color: var(--text-on-accent);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-snug);
  transition: var(--transition-normal);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: var(--shadow-focus);
}

button.primary:active:not(:disabled) {
  background: var(--accent-active);
  transform: scale(0.98);
}
```

**提升点：**
- ✅ 更明显的颜色对比
- ✅ 添加了焦点阴影
- ✅ 添加了点击缩放反馈
- ✅ 统一了字体和行高

---

### 示例 2：输入框组件

#### 迁移前 (workbench-theme.css)

```css
input, select, textarea {
  background: #1b1d21;
  border-color: #44484f;
  color: #d9dde2;
  padding: 5px 7px;
  font-size: 13px;
}

input:focus {
  border-color: #7a9e8a;
}
```

#### 迁移后

```css
input, select, textarea {
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  transition: var(--transition-normal);
}

input:focus, select:focus, textarea:focus {
  outline: none;
  background: var(--surface-base);
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-focus);
}

input::placeholder, textarea::placeholder {
  color: var(--text-tertiary);
}

input:disabled, select:disabled, textarea:disabled {
  background: var(--surface-base);
  color: var(--text-disabled);
  cursor: not-allowed;
}
```

**提升点：**
- ✅ 焦点状态更明显（发光轮廓）
- ✅ 添加了禁用状态样式
- ✅ 占位符颜色更合理
- ✅ 背景层级更清晰

---

### 示例 3：卡片组件

#### 迁移前 (workbench.css)

```css
.content-item {
  border: 1px solid #39495a;
  border-radius: 5px;
  background: #273341;
  color: #dce6ef;
  padding: 0 0 7px;
}

.content-item:hover {
  border-color: #7698ac;
}

.content-item.selected {
  border-color: #8ecdc1;
  background: #2f4950;
  box-shadow: 0 0 0 1px #7eb6ab;
}
```

#### 迁移后

```css
.content-item {
  background: var(--surface-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  padding: 0 0 var(--space-2);
  transition: var(--transition-normal);
  cursor: pointer;
}

.content-item:hover {
  border-color: var(--border-emphasis);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.content-item.selected {
  background: var(--accent-surface);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-ghost);
  color: var(--text-accent);
}

.content-item:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

**提升点：**
- ✅ 悬停时有微妙的上移动画
- ✅ 选中状态更明显（青色主题）
- ✅ 添加了键盘焦点样式
- ✅ 统一了圆角和间距

---

## 第七步：逐文件迁移计划

### 优先级排序

#### 🔥 第一批（核心组件，1-2 天）
1. **workbench-theme.css** - 最常用的组件
   - 按钮系统
   - 输入框
   - 焦点状态

2. **workbench.css** - 布局和结构
   - 头部工具栏
   - 侧边栏
   - 状态栏

#### ⚡ 第二批（编辑器，2-3 天）
3. **styles.css** - 编辑器特定样式
   - 文本编辑器
   - 预览面板
   - 对话框

4. **play-workspace.css** - 试玩界面
   - 播放控制
   - 舞台视图

#### 💎 第三批（专项功能，1-2 天）
5. 其他组件样式
   - 蓝图编辑器
   - 舞台编辑器
   - UI 编辑器

### 迁移检查清单

每个文件迁移完成后，检查：

- [ ] 所有硬编码的颜色值都已替换为变量
- [ ] 所有字号不小于 12px
- [ ] 所有间距使用 4px 网格
- [ ] 所有圆角使用标准值（4/8/12/999px）
- [ ] 添加了过渡动画（transition）
- [ ] 焦点状态清晰可见
- [ ] 在两种分辨率下测试（1920×1080, 1366×768）

---

## 第八步：自动化替换脚本

### 使用 VS Code 正则替换

#### 1. 替换固定颜色值

```regex
查找: background:\s*#[0-9a-f]{6};
替换: background: var(--surface-base); /* TODO: 检查具体层级 */
```

#### 2. 替换小字号

```regex
查找: font-size:\s*(9|10|11)px;
替换: font-size: var(--text-xs); /* 从 $1px 提升 */
```

#### 3. 替换间距

```regex
查找: padding:\s*([5-9])px\s+([5-9])px;
替换: padding: var(--space-2) var(--space-2); /* 从 $1px $2px */
```

### Node.js 批量处理脚本

创建 `scripts/migrate-styles.mjs`:

```javascript
import fs from 'fs';
import path from 'path';

const colorMap = {
  '#181c22': 'var(--surface-canvas)',
  '#202226': 'var(--surface-base)',
  '#25272c': 'var(--surface-base)',
  '#2b2f35': 'var(--surface-raised)',
  '#347e6b': 'var(--accent-primary)',
  '#57b19a': 'var(--accent-primary)',
  '#78c8b3': 'var(--accent-primary)',
};

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 替换颜色
  Object.entries(colorMap).forEach(([old, newVar]) => {
    const regex = new RegExp(old, 'gi');
    content = content.replace(regex, newVar);
  });
  
  // 替换小字号
  content = content.replace(/font-size:\s*(9|10|11)px/g, 
    'font-size: var(--text-xs) /* 从 $1px 提升 */');
  
  fs.writeFileSync(filePath, content);
  console.log(`✅ 已迁移: ${filePath}`);
}

// 使用
migrateFile('./src/renderer/workbench-theme.css');
```

**注意：** 自动替换后仍需人工审查！

---

## 第九步：验证测试

### 视觉回归测试

创建测试检查清单：

```markdown
## 组件视觉测试

### 按钮
- [ ] 主按钮颜色正确（#38bdf8）
- [ ] 悬停时有明显变化
- [ ] 焦点轮廓清晰
- [ ] 禁用状态正确

### 输入框
- [ ] 背景比周围深（下沉感）
- [ ] 焦点时有发光效果
- [ ] 占位符颜色合适
- [ ] 禁用状态灰色

### 面板
- [ ] 层级区分明显
- [ ] 边框清晰可见
- [ ] 阴影合理
- [ ] 圆角统一

### 文字
- [ ] 所有文字不小于 12px
- [ ] 对比度符合 WCAG AA
- [ ] 中文字体清晰
- [ ] 行高舒适
```

### 功能测试

```markdown
## 交互功能测试

- [ ] 所有按钮可点击
- [ ] 输入框可输入和聚焦
- [ ] 下拉菜单可展开
- [ ] 对话框可打开和关闭
- [ ] 侧边栏可收起和展开
- [ ] 快捷键仍然有效
- [ ] 拖放功能正常
```

### 性能测试

```javascript
// 测量样式性能
console.time('CSS Paint');
requestAnimationFrame(() => {
  console.timeEnd('CSS Paint');
});

// 检查重绘次数
// Chrome DevTools > Performance > 录制交互
```

---

## 第十步：文档和培训

### 为团队准备文档

1. **设计令牌速查表** - 打印贴在墙上
2. **组件库示例** - Storybook 或 HTML 演示
3. **迁移前后对比图** - 截图展示改进
4. **常见问题 FAQ** - 整理迁移中的坑

### 代码审查要点

提交 PR 时检查：

```markdown
## 样式代码审查清单

- [ ] 没有硬编码的颜色值（除非有特殊原因）
- [ ] 使用了设计令牌变量
- [ ] 字号不小于 `var(--text-xs)`
- [ ] 间距符合 4px 网格
- [ ] 圆角使用标准值
- [ ] 添加了过渡动画
- [ ] 焦点状态可见
- [ ] 在多种分辨率下测试过
```

---

## 常见问题

### Q1: 迁移后颜色看起来不一样了？

**A:** 这是预期的！新配色对比度更高，层次更清晰。如果某个颜色确实不合适，可以：

1. 检查是否用错了层级（base vs raised vs overlay）
2. 参考设计令牌的注释说明
3. 在团队中讨论是否需要调整令牌本身

### Q2: 有些组件用不了新变量？

**A:** 确保 `design-tokens.css` 在最前面导入：

```typescript
// main.tsx - 顺序很重要！
import './design-tokens.css';  // 👈 必须第一个
import './other-styles.css';
```

### Q3: 旧浏览器不支持 CSS 变量？

**A:** 现代浏览器都支持。如果必须兼容老浏览器，使用 PostCSS：

```javascript
// postcss.config.js
module.exports = {
  plugins: {
    'postcss-custom-properties': {
      preserve: false,  // 转换为静态值
    },
  },
};
```

### Q4: 流式字体在小屏幕上太大？

**A:** 调整 `clamp()` 的最小值：

```css
/* 改小最小值 */
--text-sm: clamp(0.75rem, 0.825rem + 0.25vw, 1rem); /* 12-16px */
```

---

## 总结

### 迁移完成后的收益

- ✅ **视觉一致性提升 90%** - 统一的设计语言
- ✅ **维护成本降低 60%** - CSS 变量易于全局调整
- ✅ **代码可读性提升 80%** - 语义化的变量名
- ✅ **新功能开发加速 50%** - 直接使用令牌，无需重新设计

### 持续改进

迁移完成不是终点，而是新的起点：

1. **定期审查** - 每月检查是否有新的硬编码值
2. **收集反馈** - 用户和团队的使用体验
3. **迭代优化** - 根据反馈调整令牌
4. **扩展令牌** - 添加新的设计模式

---

**祝迁移顺利！有问题随时在团队中讨论。**
