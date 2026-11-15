/** Task handles are opaque strings. They are not a new author-state scope. */
export const blueprintTaskCatalog = {
  throttle: { name: '节流（Throttle）', category: '流程控制', hint: '首次立即通过，冷却期间走“被节流”；重复触发不延长冷却。重置只清除冷却，不执行通过路线。' },
  debounce: { name: '防抖任务（Debounce）', category: '复用与参数', hint: '立即返回；同一节点在所选生命周期内只保留最后一次任务，安静指定秒数后调用模块。新的触发取消旧任务，输入按最后一次触发取快照。' },
  startTask: { name: '启动任务（Start Task）', category: '复用与参数', hint: '立即返回任务标识，后台合作式执行模块；等待不会阻塞其他任务。调用结束或所属页面关闭时取消。需要结果时用“等待任务”。' },
  cancelTask: { name: '取消任务（Cancel Task）', category: '流程控制', hint: '按任务标识取消待执行或运行中的任务及其调用内子任务；已完成的副作用不撤销。空标识或已结束任务不会误取消其他任务。' },
  waitTask: { name: '等待任务（Await Task）', category: '复用与参数', hint: '等待指定任务，按完成、取消、失败、标识失效分别继续；只有完成路线有模块结果。可选择模块公开类型化输出。' },
  taskStatus: { name: '读取任务状态（Task Status）', category: '状态与计算', hint: '读取 queued / running / waiting / completed / cancelled / failed / missing，不等待、不改变任务。任务标识不能当作长期存档业务数据。' },
} as const;
