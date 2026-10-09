# 叙事工坊 UI 优化方案

## 一、设计原则

### 1. 深色优先，层次分明
建立清晰的表面层级系统，从最深的画布到最浅的浮层，每层有明确的语义和用途。

### 2. 强调创作核心
编辑区域获得最大空间和最少干扰，工具面板收敛但触手可及。

### 3. 中文优化
针对中文字体特点优化字号、行高和字重，确保在 Windows 下的清晰度。

---

## 二、色彩系统重构

### 当前问题
- 三套配色定义分散且冲突
- 表面层级区分度低（#181c22 → #2b2f35 仅提升 6-8% 亮度）
- 强调色不统一（#78c8b3 / #57b19a / #187d6b）

### 优化方案：统一深色调色板

```css
:root {
  /* === 表面层级（Surface Ladder）=== */
  /* 从 3% 到 18% 亮度，每层提升 2-3%，确保可感知差异 */
  --surface-canvas: #05070c;      /* L: 3%  - 画布背景 */
  --surface-sunken: #0a0d12;      /* L: 5%  - 下沉区域 */
  --surface-base: #0f131c;        /* L: 7%  - 基础面板 */
  --surface-raised: #161d2b;      /* L: 10% - 抬升卡片 */
  --surface-overlay: #1e2636;     /* L: 13% - 悬浮层 */
  --surface-dialog: #242d3d;      /* L: 16% - 对话框 */
  --surface-peak: #2a3544;        /* L: 18% - 最高层 */

  /* === 主题色（从创作工具特质提取）=== */
  /* 青绿色调：平静、专注、创造力 */
  --accent-primary: #38bdf8;      /* 明亮青色 - 主要交互 */
  --accent-muted: #2a7a8f;        /* 暗青色 - 次要元素 */
  --accent-surface: #1a3a47;      /* 青色背景 - 强调区域 */
  
  /* === 语义色 === */
  --success: #6ee7b7;             /* 成功/完成 */
  --warning: #fbbf24;             /* 警告 */
  --error: #f87171;               /* 错误 */
  --info: #60a5fa;                /* 信息 */

  /* === 文本层级 === */
  --text-primary: #e5e7eb;        /* 主要内容 */
  --text-secondary: #9ca3af;      /* 次要信息 */
  --text-tertiary: #6b7280;       /* 辅助文字 */
  --text-accent: #38bdf8;         /* 强调文字 */

  /* === 边界与分隔 === */
  --border-subtle: #1f2937;       /* 轻微分隔 */
  --border-default: #374151;      /* 默认边框 */
  --border-emphasis: #4b5563;     /* 强调边框 */

  /* === 间距系统（基于 4px 网格）=== */
  --space-1: 0.25rem;  /* 4px */
  --space-2: 0.5rem;   /* 8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-5: 1.25rem;  /* 20px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-10: 2.5rem;  /* 40px */

  /* === 圆角系统 === */
  --radius-sm: 4px;    /* 小组件：按钮、输入框 */
  --radius-md: 8px;    /* 中等：卡片、面板 */
  --radius-lg: 12px;   /* 大型：对话框、模态 */
  --radius-full: 999px; /* 完整圆形：头像、标记 */

  /* === 阴影层级 === */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.6);
  --shadow-xl: 0 24px 48px rgba(0, 0, 0, 0.7);
}
```

---

## 三、字体与排版优化

### 当前问题
- 字号过小（10px、11px 在高 DPI 屏幕上难以辨识）
- 缺少流式缩放
- 行高不统一

### 优化方案：流式字体系统

```css
:root {
  /* === 字体族 === */
  --font-sans: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", "Microsoft YaHei UI", monospace;

  /* === 流式字阶（clamp 实现响应式）=== */
  --text-xs: clamp(0.75rem, 0.7rem + 0.2vw, 0.875rem);    /* 12-14px */
  --text-sm: clamp(0.875rem, 0.825rem + 0.25vw, 1rem);    /* 14-16px */
  --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);   /* 16-18px */
  --text-lg: clamp(1.125rem, 1.05rem + 0.375vw, 1.375rem); /* 18-22px */
  --text-xl: clamp(1.25rem, 1.15rem + 0.5vw, 1.625rem);   /* 20-26px */
  --text-2xl: clamp(1.5rem, 1.35rem + 0.75vw, 2rem);      /* 24-32px */

  /* === 行高系统 === */
  --leading-tight: 1.25;   /* 标题 */
  --leading-snug: 1.375;   /* 按钮、标签 */
  --leading-normal: 1.5;   /* 正文 */
  --leading-relaxed: 1.625; /* 长文本 */
  --leading-loose: 1.75;   /* 说明文字 */

  /* === 字重 === */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* === 字偶距（针对中文优化）=== */
  --tracking-tight: -0.02em;  /* 大标题 */
  --tracking-normal: 0;       /* 正文 */
  --tracking-wide: 0.02em;    /* 小字 */
}

/* 应用示例 */
body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  letter-spacing: var(--tracking-normal);
}

h1 {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.sidebar-label {
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
}

code, .text-source-input {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}
```

---

## 四、组件系统重构

### 1. 按钮系统

```css
/* 基础按钮 */
.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-snug);
  transition: all 120ms ease-out;
  cursor: pointer;
}

/* 主要按钮 */
.btn-primary {
  background: var(--accent-primary);
  color: var(--surface-canvas);
  border: 1px solid transparent;
}

.btn-primary:hover:not(:disabled) {
  background: #0ea5e9;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
}

/* 次要按钮 */
.btn-secondary {
  background: var(--surface-raised);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--surface-overlay);
  border-color: var(--border-emphasis);
}

/* 图标按钮 */
.icon-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  border: none;
  transition: all 100ms ease-out;
}

.icon-btn:hover:not(:disabled) {
  background: var(--surface-raised);
  color: var(--text-primary);
}

.icon-btn:active:not(:disabled) {
  scale: 0.95;
}
```

### 2. 输入控件

```css
input, select, textarea {
  padding: var(--space-2) var(--space-3);
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  transition: all 120ms ease-out;
}

input:focus, select:focus, textarea:focus {
  outline: none;
  background: var(--surface-base);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.15);
}

input::placeholder, textarea::placeholder {
  color: var(--text-tertiary);
}
```

### 3. 面板与卡片

```css
/* 基础面板 */
.panel {
  background: var(--surface-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

/* 抬升卡片 */
.card {
  background: var(--surface-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.card:hover {
  border-color: var(--border-emphasis);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
  transition: all 150ms ease-out;
}

/* 对话框 */
.dialog {
  background: var(--surface-dialog);
  border: 1px solid var(--border-emphasis);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: var(--space-6);
}
```

---

## 五、布局优化

### 1. 头部工具栏

```css
.app-header {
  height: 56px; /* 增加 2px，更舒适的点击区域 */
  background: var(--surface-base);
  border-bottom: 1px solid var(--border-default);
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 200px;
}

.brand-symbol {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: var(--accent-surface);
  border-radius: var(--radius-sm);
  color: var(--accent-primary);
}

.project-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.project-title strong {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### 2. 侧边栏

```css
.sidebar {
  background: var(--surface-base);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  width: 240px; /* 从 210px 增加到 240px，更舒适 */
}

.sidebar-search {
  margin: var(--space-3);
  position: relative;
}

.sidebar-search input {
  width: 100%;
  padding-left: var(--space-8); /* 为图标留空间 */
}

.sidebar-search::before {
  content: '';
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  /* 搜索图标 */
}
```

### 3. 主工作区

```css
.main-workspace {
  background: var(--surface-canvas);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.view-tabs {
  height: 48px; /* 从 44px 增加到 48px */
  background: var(--surface-base);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
}

.tabs {
  display: flex;
  gap: var(--space-1);
}

.tabs > button {
  padding: var(--space-3) var(--space-4);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: all 120ms ease-out;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.tabs > button.active {
  color: var(--text-accent);
  border-bottom-color: var(--accent-primary);
  background: rgba(56, 189, 248, 0.08);
}

.tabs > button:hover:not(.active) {
  color: var(--text-primary);
  background: var(--surface-raised);
}
```

---

## 六、状态反馈优化

### 1. 焦点状态

```css
*:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

### 2. 加载状态

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  animation: spin 1s linear infinite;
  color: var(--accent-primary);
}

/* 骨架屏 */
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.skeleton {
  background: var(--surface-raised);
  border-radius: var(--radius-sm);
  animation: skeleton-pulse 2s ease-in-out infinite;
}
```

### 3. 错误与警告

```css
.diagnostic {
  padding: var(--space-3);
  border-left: 3px solid;
  border-radius: var(--radius-sm);
  margin: var(--space-2) 0;
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.diagnostic.error {
  background: rgba(248, 113, 113, 0.1);
  border-color: var(--error);
  color: var(--error);
}

.diagnostic.warning {
  background: rgba(251, 191, 36, 0.1);
  border-color: var(--warning);
  color: var(--warning);
}

.diagnostic.info {
  background: rgba(56, 189, 248, 0.1);
  border-color: var(--info);
  color: var(--info);
}
```

---

## 七、响应式断点

```css
/* 移动优先的响应式设计 */
:root {
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-2xl: 1536px;
}

/* 小屏幕：收起侧边栏，使用抽屉 */
@media (max-width: 1024px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 56px;
    bottom: 0;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 250ms ease-out;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* 中等屏幕：缩小面板宽度 */
@media (max-width: 1280px) {
  .sidebar {
    width: 200px;
  }

  .inspector {
    width: 260px;
  }

  .editor-layout {
    grid-template-columns: 200px minmax(0, 1fr) 260px;
  }
}

/* 大屏幕：保持最佳布局 */
@media (min-width: 1536px) {
  .sidebar {
    width: 280px;
  }

  .inspector {
    width: 320px;
  }

  .editor-layout {
    grid-template-columns: 280px minmax(0, 1fr) 320px;
  }
}
```

---

## 八、实施计划

### 阶段一：基础系统（1-2 天）
1. 创建新的 CSS 变量系统文件 `design-tokens.css`
2. 重构色彩变量到所有现有样式文件
3. 建立字体和间距系统

### 阶段二：组件重构（2-3 天）
1. 按钮组件统一
2. 输入控件优化
3. 面板和卡片组件

### 阶段三：布局优化（1-2 天）
1. 头部工具栏调整
2. 侧边栏和主工作区
3. 响应式断点测试

### 阶段四：细节打磨（1 天）
1. 动画和过渡效果
2. 状态反馈优化
3. 辅助功能检查

### 验收标准
- [ ] 所有颜色使用 CSS 变量
- [ ] 字号不小于 12px（var(--text-xs)）
- [ ] 圆角值统一为 4/8/12/999px
- [ ] 间距使用 4px 网格系统
- [ ] 焦点状态清晰可见
- [ ] 在 1920×1080、1366×768 分辨率下测试通过
- [ ] 暗色模式下对比度符合 WCAG AA 标准

---

## 九、预期效果

### 视觉提升
- ✅ 更清晰的层次结构
- ✅ 更舒适的阅读体验
- ✅ 更专业的整体感观

### 可用性提升
- ✅ 更大的点击区域
- ✅ 更明确的交互反馈
- ✅ 更流畅的操作体验

### 可维护性提升
- ✅ 统一的设计语言
- ✅ 可复用的组件系统
- ✅ 易于扩展的变量系统
