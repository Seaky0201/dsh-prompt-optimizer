# Changelog

本项目版本号遵循 `0.x` 阶段的语义化：`0.<minor>.<patch>`；预发布版本带 `-beta.N` 后缀（面板中显示为 `0.1.1beta1`）。

## v0.1.1-beta.5 — 2026/09/13

作者：啃轮胎的西狐

接管计数徽标**改为落盘**：刷新页面 / 重启 DSH 不再归零（`lib/client.js` + `lib/index.js`）：

- **问题**：计数此前只活在内存（`store.intercepts`），刷新或重启即清零，徽标随之消失。
- **改法**：新增按会话的落盘计数表 `store.sendsBySession`，权威来源是 host 状态文件的 `perSession[sid].sends`。
  - client：`bumpSends()` 在每次拦截时 +1 并 `POST /state { sends }`；`interceptedSends()` 直接读表；状态载入时从 `st.perSession[*].sends` 回灌。
  - host：`sanitizePerSession` / `savePluginState` 接受并校验 `sends`（非负整数、小数取整、上限 1e9，非法值一律丢弃）。
- **计数语义不变**：仍与「拦截事件」同源（`keydown-enter` / `click-send` 各算一次，`optimize-start` 不算），仍按会话独立。`store.intercepts` 保留为原始事件流水（自检探针依赖它），但不再是徽标的数据源。
- **新增回归自检**：`evidence/sends-counter-check.cjs` —— 从真实源码提取函数、在桩环境跑真实路径，**20/20 通过**，覆盖「一次发送只算 1」「按会话独立」「刷新回灌不归零」「host 侧非法值丢弃」。

## v0.1.1-beta.4 — 2026/09/13

作者：啃轮胎的西狐

接管计数徽标的「**会话维度**」修正（承接 v0.1.1-beta.3；改动集中在 `lib/client.js`，+7/−3）：

- **修复：徽标数字跨会话串台**。`store.intercepts` 是**跨会话共用**的数组，beta.3 只修了"口径"（一次发送被算成 2 的问题），没修"会话维度" —— 结果是 A 会话拦过 1 次，切到 B 会话徽标**照样显示 1**，与本插件"档位 / 权限 / 迷你窗按会话独立"的一贯语义不符。
- 现在 `interceptedSends()` 按当前会话过滤（`store.viewSessionId`，无会话归一为 `null`）；`keydown-enter` / `click-send` 两条记录补写 `sessionId` 字段（此前只有 `optimize-start` 带）。
- 会话切换走 `onViewSessionChange` → `emit()`，徽标随新会话**即时重算**；该会话 0 次时徽标自动隐藏。
- 同时收录上一版之后的文档改动：README（中/英）补充 **DSH Desktop 安装方式**（`--profile web` 换成 `--profile desktop`）。

## v0.1.1-beta.3 — 2026/09/13

作者：啃轮胎的西狐

控件行「接管计数徽标」的可读性修正（改动集中在 `lib/client.js`，+14/−4）：

- **口径修正**：徽标此前直接显示 `store.intercepts.length`（record 条数）。而一次发送会同时记 `keydown-enter` / `click-send` 与 `optimize-start` 两条 ⇒ **1 次发送被显示成 2**。新增 `interceptedSends()` 只统计拦截事件（`keydown-enter` + `click-send`），徽标与迷你窗「拦截累计 N」两处共用同一口径，数字从此对得上真实发送次数。
- **新增悬浮提示**：鼠标停在徽标上显示「本会话已接管 N 次发送」（与徽标同源，都是 `interceptedSends()`）。
- **视觉对齐**：徽标边框与填充改为与「?」帮助按钮（`.dpo-help`）同款 —— `border:1px solid var(--dpo-line)` + `label-primary 5%` 的顶部微光渐变，文字色改用 `label-secondary`；不再使用强调色块（原来那套 accent 底色正是它"看起来像个按钮"的原因）。形状仍保持小药丸，尺寸不变。
- `store.intercepts` 的记录行为**未改动** ⇒ 自检探针（E1/E3 断言 `intercepts.length` 增量）不受影响。

## v0.1.1-beta.2 — 2026/09/13

作者：啃轮胎的西狐

自 v0.1.1-beta.1 起的修复与界面打磨。改动集中在 `lib/client.js`（+273/−8）：

### 修复

- **自动档 + 手动放行/确认提交 → 同一条意图被提交两次**（先原文、后优化稿）。
  - 根因：`releaseOriginal()` / `confirmSubmit()` 此前只把 `store.run` 置空（清了读取方），既没有 `es.close()` 也没有 `POST /run/abort`；而 SSE 回调用闭包 `const cur = run` 持有同一个 run 对象，于是优化继续收流，终态 `done` / `error` 到达时又按 `store.permission === "auto"` 触发一次 `autoSend`。
  - 修复：新增 `cancelRun(run)` —— 关流 + 宿主 `POST /run/abort` + 置 `released` 标记（仅对仍在飞的运行收尾，已到终态的不再发 abort）；`done` / `error` 分支遇 `released === true` 直接作废并留 `terminal-after-release` beacon，绝不再发第二次。审查档下浮层也不再被终态重新打开。
- **档位滑块"点最高档却选中中间档"**：取档由 `Math.round(t * (n - 1))` 改为 `Math.floor(t * n)`，与"格子"边界（第 i 格 = `[i/n, (i+1)/n)`）对齐。原先 1/6 分界与 1/4 格边界错位，点第 4 格左半会被算成"高级"。
- **滑块填充比例**：新增 `fillPct = (idx + 1) / n`，选到第 i 档即填满前 i+1 格；此前复用 `idx / (n - 1)` 会让最高档只填到 `(n-1)/n`（4 档时 66.67%），最后一格永远空着。`pct` 仍按 `idx / (n - 1)` 计算，仅保留给把手定位语义。

### 界面

- **档位条改为等宽"格子"语义**：轨道总宽 = 格数 × 格宽（`cell` 默认 30px，由内联样式给出，避免 `@media` 覆盖破坏等格）；4 档 120px、2 档 60px，即"审查条恰为等级条的一半"。
- `dpo-controls` 外层新增 `dpo-controls-wrap` 容器。
- 追加 +222 行 CSS（v53 主题层与浮层细节）。

### 验证

- 最小复现脚本（从真实 `lib/client.js` 提取函数体、桩环境执行真实路径）：修复前 1/3 场景失败，修复后 **3/3 通过**。

## v0.1.1-beta.1 — 2026/09/11

作者：啃轮胎的西狐

首个对外分享版本。核心能力：

- **发送接管**：捕获阶段拦截回车与发送按钮（`Shift+Enter`、`/` 命令、空草稿、卡片外回车一律放行）。
- **传话者语义**：优化 AI 明确是"把用户意思转达给工作 AI"的传话器 —— 不回答用户、不替用户干活、不向用户提问；产出是**可直接发送的命令正文**，无「优化后的提示词 / 改动说明」这类元话语。
- **三档强度**：普通（语言精确化，约 3 秒）／高级（补"显然需要"的约束与验收，约 20 秒）／极端（只读查证项目结构 → 分阶段行动计划 + 验收标准 + 多情况预案，约 20 秒）。
- **两种权限**：需要审查（产出可编辑，确认后发送）／自动输出（完成即发送；失败也按原文发出，绝不静默吞消息）。
- **迷你窗**：可拖动、可改尺寸（记忆）、按会话隔离、常驻底部操作栏（窗口再小按钮也不消失）、思考/产出双通道流式 + 流式光标 + 自动跟随滚动、**思考 token 计数**。
- **按会话独立的档位与权限**：A 会话的设置不影响 B。
- **模型独立**：优化模型与对话模型互不影响；目录预热 + 双层缓存 + 单家超时，死模型自动回退。
- **使用帮助**：控件行 `?` 面板（怎么用 / 档位 / 权限 / 迷你窗按钮 + 推荐组合）。
- 测试与证据：`ACCEPTANCE.md` 逐格验收清单；`evidence/` 内为自检报告、三档对照、几何与产物形态回归等机器留痕。

### 已修复的典型缺陷（详见 `ACCEPTANCE.md`）

- 回退 / × 点击无效（pointerdown 的 `preventDefault` 抑制了 click）。
- 审查态看不到确认提交 / 重新生成（浮层内容被裁且不可滚动）。
- 浏览器缩小后弹窗出现在不可见坐标（开窗未夹紧）。
- 开启档位后"无法发送"（优化模型不可用 + 失败被静默吞掉）。
- 弹窗不再显示（React #310：hook 写在 early return 之后）。
- 模型目录加载不出来（客户端从未拉取 `/models`）。
- 右下角拖不动改尺寸（手柄被常驻底栏盖住 + `onSizeUp` 丢掉最后一次位移）。
- 优化 AI 误以为在跟用户对话（角色与用户消息都缺少"传话"框架）。
