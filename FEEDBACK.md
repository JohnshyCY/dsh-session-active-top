# 反馈：会话目录缺少「按进行中状态排序」的扩展点

（路径均指 DSH 安装目录下归档 `resources/app.asar` 内的 `dsh/node_modules/@deepseek-ai/`）

## 现象与根因
多个对话同时进行时，正在运行的对话不会浮到工作区会话目录上方。会话目录默认按 `orderByRecency` 的 `summary.updatedAt` 降序排列：

- `dsh-client-ui-workspace/lib/client.js:897-909` `function orderByRecency(sessionIds, summaries)` 以 `rank: summary.updatedAt` 排序、相同时按 sessionId 字典序；`:1270` 视图 store 初始 `orderBy: "updated"`，`:1281` `setOrderBy` 仅支持 `"updated"`/`"manual"`。
- 后端投影同序：`dsh-api-session-controller/lib/types/list.js:156` `items.sort((left, right) => right.updatedAt - left.updatedAt);`。
- `updatedAt = Math.max(createdAt, lastPromptAt)`（`dsh-api-session-controller/lib/types/list.js:335`）只在建会话或用户发 `user/message` 时推进，**模型执行期间不变**。于是「切到另一会话发消息」会把那一会话顶上去，仍在前一个会话里跑的任务反而下沉。
- `running` 是布尔字段（`dsh-api-session-controller/lib/client.js:4169` `byId[entry.sessionId] = {... running: entry.running, ...}`、`:4237` `list.set(...)`；真值 `dsh-api-session-controller/lib/types/list.js:113` `running: this.ctx.agents.get(session.id)?.status === 'running'`），但只用于 `sessionNode` 行内状态点，`sectionMembers`（`dsh-client-ui-workspace/lib/client.js:979`）分区只认 blank / pinned / archived，**从不参与排序或分区比较**。

## 诉求
运行中的会话自动排到目录最上方方便选中；上浮后保留该位置（不归位）；其余会话按上一次对话时间降序。用户明确**不要**复用「手动置顶」语义：不要图钉图标、不要写持久化置顶集合、不要和用户手动置顶混在一起。

## 为什么只能运行时包装
对归档内 409 个 `lib/{client,index}.js` 全局检索，`defineSlots|slotRegistry|registerSlot|orderSlot|sortSlot` 与 `*.comparator|*.rank|*.sorter` 贡献点**零匹配**：内核没有任何会话列表排序 / 比较器扩展点，`sidebar.workspaces` 根 slot 及其子 slot 也不能插入「分组前」的独立分区。已装 `dsh-better-sidebar` 同样只提供文件树排序。

内核虽有 `uiWorkspace.pinSession/unpinSession`（`dsh-client-ui-workspace/lib/client.js:1551`/`:1559`），但那会把会话写进 registry-global 的 `pinnedSessionIds`（`dsh-workspace/lib/index.js:245-246`，持久化、带 PinnedIndicator），与诉求冲突。

本插件的落点分两种排序模式：

- **时间模式**：`dsh-client-ui-session/lib/client.js:1120-1122` 把全局 `useSessions` 钩子绑定到 `ctx.sessions.list`；`WorkspaceBrowser`（`dsh-client-ui-workspace/lib/client.js:3669`）用 `useSessions((state) => state)` 取得快照，`orderByRecency` 读 `list.byId[id].updatedAt`。插件包装 `sessions.list.getSnapshot()`，给上浮会话合成一个远大于真实时间戳的 `updatedAt`（按上浮先后递增），其余行保持原值。
- **手动模式**：`reconcileManualOrder`(`:919-947`) 只回放持久化的 `sessionOrderByAccount`（顺序 `pins → 已保存顺序 → 其余按 updatedAt → 归档`），改快照完全不生效。插件因此解析 `sidebar.workspaces` 的视图 store（`:5766-5772` 的 `viewStore.create()` 直接返回 `WorkspaceBrowser` 实际读取的那个实例），调用其 action `setSessionOrder(accountKey, order, orders)`（`:1297-1310`，内部会 `write d.sessionOrderByAccount[accountKey]`）把上浮会话前置到每个 account 的已保存顺序最前；上浮块内部按真实 `updatedAt` 降序排列，块外顺序（用户自己拖的）不动。

## 给上游的建议（三选一）
1. 在 `createWorkspaceViewStore`（`dsh-client-ui-workspace/lib/client.js:1270`）增加 `orderBy: "activity"`（running 优先且保留上浮位，再按 updatedAt），相应改 `orderByRecency`(`:897`)、`deriveGroups`(`:1094`)、`deriveFlat`(`:1149`)。这是最贴合诉求的做法：瞬时、不落盘、不污染手动置顶语义。
2. 增加 `sessionComparator` / `registerComparator` 之类的贡献点，允许插件注入排序比较器而不必改核心排序函数。
3. 暴露可配置的 `sessionRank`（cordis.patch.yml 已支持 `- id: <rowId>` + config 覆盖）。

## 本插件的已知限制
- 依赖真实但**未文档化、非稳定契约**的内部 API（`sessions.list.getSnapshot/subscribe`、`byId[id].updatedAt`、`slots.entriesOfSlot` / `hostFace().storeOf`、视图 store 的 `setSessionOrder`），未来内核升级可能失效；包装 `getSnapshot` 时需保证快照对象身份稳定，避免 `useSyncExternalStore` 无限重渲染。
- 时间模式下合成的 `updatedAt` 只存在于 `getSnapshot()` 返回的副本中，真实 store 数据不被改写；但内核行尾时间标签（`sessionNode`:1071 → `timeLabel`:2633 → `relativeTime` = `Math.max(0, now - updatedAt)`）也读同一字段，因此上浮会话的时间标签固定显示「刚刚」。手动模式下不伪造该字段，无此副作用。若上游采纳 `orderBy: "activity"` 建议，可彻底消除此副作用。
- 手动模式下插件用内核自己的 `setSessionOrder` 写入持久化顺序（等价于用户拖动一次），因此刷新/重启后仍生效，且卸载不会还原；这与「不写持久化」的诉求在该模式下无法两全（内核没有其他落点）。
- 上浮名单存于浏览器 localStorage（非 workspaceRegistry），多窗口共享同一 origin 时以同一名单为准；不会写 `pinnedSessionIds`。
- 首次安装能否免重启取决于 client bundle 热更：仅当 `pnpm run dev:web` 同时运行时 HMR 无需刷新；否则至少刷新一次页面，最坏需重启一次桌面应用。
