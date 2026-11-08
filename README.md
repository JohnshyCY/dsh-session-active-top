# 进行中会话上浮插件（dsh-session-active-top）

本会话为解决「多个对话同时进行时，正在运行的对话不会浮到工作区会话目录上方、翻阅困难」而开发了这个 DSH 插件，并装入当前实例验证。

## 它做什么
纯前端（client）插件：正在运行（`running === true`）的会话自动排到所在工作区会话目录**最上方**，方便选中；一旦浮上来就**保留在该位置**（运行结束也不归位）。其余会话保持内核原有的手工/时间顺序。

上浮块内部按**真实活跃时间**（`updatedAt`）降序排列，所以正在对话的那个会话永远在最前，其次是刚结束的。

不写持久化置顶（不动 `workspaceRegistry.pinnedSessionIds`）、不显示图钉图标、用户手动置顶的会话仍然在图钉分区里更靠前；上浮名单只记录在浏览器 `localStorage`（`dsh-session-active-top:raised`）。

## 为什么这样实现
内核（`dsh-client-ui-workspace`）没有任何会话列表排序扩展点，排序在组件里写死，且**两种排序模式落点不同**：

| 目录排序模式 | 实际生效的顺序来源 | 插件做法 |
| --- | --- | --- |
| 时间（`orderBy:"updated"`） | `orderByRecency` 读快照里的 `updatedAt` | 包装 `sessions.list.getSnapshot()`，给上浮会话一个远大于真实时间戳的合成 `updatedAt`（只存在于运行时副本） |
| 手动（`orderBy:"manual"`） | `reconcileManualOrder` 回放持久化的 `sessionOrderByAccount` | 调用视图 store 自己的 `setSessionOrder(accountKey, order, orders)`，把上浮会话前置进已保存顺序 |

手动模式下只改快照是无效的（这正是第一版「看不出上浮」的原因），必须写持久化顺序；写入走内核自己的 action，等价于用户拖动一次，所以刷新/重启后位置仍在，且运行结束不会自动回落。

每次快照变化都会重排**上浮块内部**：块内按 `updatedAt` 降序，你正在对话的会话就在最前。上浮块之外（你自己拖过的顺序）完全不动。

## 安装

从 npm（推荐）：
```
dsh plugin --profile desktop add dsh-session-active-top
```

从本地目录开发调试：
```
dsh plugin --profile desktop add link:<本插件目录的绝对路径>
```

`dsh` 指 DSH 安装目录下的 `resources/runtime/cli/bin/dsh.cmd`。安装会写 profile 目录（`$DSH_HOME/profiles/<profile>`），若该目录在工作区外需放开沙箱权限。核心已启用 HMR，Host 侧实时重组，client 侧经 `plugins/events` 的 `type:"graph"` 帧交付；若页面未自动加载，刷新一次 Web GUI 即可，仍无效才重启桌面应用（重启会中断当前会话）。

## 验证
1. 设置→插件列表可见 `dsh-session-active-top` 且为启用；`/plugins/events` 的 graph 帧含插件条目。
2. 让第二个会话进入 running（发送一条消息），该会话应立刻跳到会话目录顶部；运行结束后**保持在顶部**，不会回落。
3. 其余会话顺序不变；手动置顶的会话与图钉图标不受影响。

## 已验证（本机，2026-11-08）
- 插件已装入 desktop profile：`package.json` 的 dependencies 与 `dsh.profile.bundles` 均含 `dsh-session-active-top`，`node_modules` 为指向插件目录的 junction；`plugin_manager` 显示 `enabled:true / installed:true`。
- 当前实例（`http://127.0.0.1:5763`）的 `/plugins/events` graph 已含本插件条目（rev 随文件改动变化），`GET` 该 bundle URL 返回 200 且为本插件脚本 ⇒ 改盘即热重载，未重启应用。
- 运行痕迹（`localStorage` 的 `dsh-session-active-top:diag`）最新值：`{"attach":"attached","orderBy":"manual","fronted":6,"raised":3}` —— 视图 store 已挂上、当前目录确为手动模式、本插件已写入 6 次前置。
- 持久化顺序核对：读 Electron profile 的 leveldb 内 `dsh.workspace.view.v5`，6 个 account（含 `__flat_session_order__`）的顺序前三位都是三个上浮会话，且**按活跃时间排序**（当前对话 `session-cac621f3` 在最前，其后 `d60d63bf`、`0658a78e`）。
- 时间模式下的纯函数自测（`_tools` 下临时脚本，已清理）：时间降序 → 运行中上浮 → 停止不归位 → 多会话按上浮先后；快照身份稳定、真实 `updatedAt` 未改写。

## 卸载
```
dsh plugin --profile desktop remove dsh-session-active-top
```
注意：卸载不会还原已写入的手动顺序（等价于你曾经拖动过），上浮名单留在 `localStorage`；如需清空可在 DevTools 执行 `localStorage.removeItem('dsh-session-active-top:raised')`。

## 已知限制 / 上游建议
见 [FEEDBACK.md](./FEEDBACK.md)：内核没有「会话列表排序」扩展点，本插件只能运行时包装内部 store 并调用未写入文档契约的内部 action。
