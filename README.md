<div align="center">

# dsh-session-active-top

**让正在运行的会话自动浮到工作区会话目录最上方，多会话来回翻找不再费劲。**

[![npm version](https://img.shields.io/npm/v/dsh-session-active-top?style=flat-square)](https://www.npmjs.com/package/dsh-session-active-top)
[![npm downloads](https://img.shields.io/npm/dm/dsh-session-active-top?style=flat-square)](https://www.npmjs.com/package/dsh-session-active-top)
[![GitHub stars](https://img.shields.io/github/stars/JohnshyCY/dsh-session-active-top?style=flat-square)](https://github.com/JohnshyCY/dsh-session-active-top)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)

[特性](#特性) · [安装](#安装) · [验证](#验证) · [实现原理](#实现原理) · [故障排查](#故障排查) · [已知限制](#已知限制) · [反馈](./FEEDBACK.md)

</div>

---

## 快速开始

```powershell
dsh plugin --profile desktop add dsh-session-active-top
```

装完即时生效（HMR，无需重启桌面应用）：让任意会话进入运行态，它就会跳到会话目录顶部。完整说明见[安装](#安装)。

## 这是什么

DSH 工作区左侧的会话目录默认按时间或手动顺序排列。多个对话同时进行时，正在对话的那条常常沉到列表中间甚至底部，来回滚动才能找到。

本插件把处于 `running` 状态的会话提到**所在工作区**会话目录的最上方，并在它停止后**保留这个位置** —— 不自动归位，方便随时切回来。它只调整显示顺序，不改动任何会话内容。

## 特性

- **运行即上浮**：会话一进入 `running`，立刻排到所在工作区目录最上方。
- **停止不归位**：浮上来后一直留在那里，运行结束也不会掉回去。
- **块内按活跃度**：上浮的会话之间按真实 `updatedAt` 降序，当前正在对话的那条永远在最前。
- **不占用置顶**：不写 `pinnedSessionIds`、不显示图钉图标；用户手动置顶的会话仍在图钉分区里更靠前，两者互不干扰。
- **保留手动顺序**：上浮块之外（你自己拖过的顺序）完全不动。
- **刷新 / 重启仍在**：位置写入内核自身的排序状态，刷新页面或重启应用后依旧生效。
- **纯前端、零运行时依赖**：只有 client 半个插件，Host 侧是空实现；不启后台进程、不联网、不碰会话数据。

## 安装

要求：DSH 客户端及其 `dsh` CLI（随 DSH 安装，位于安装目录 `resources/runtime/cli/bin/dsh.cmd`）。已在 DSH `0.2.2-rc.1` 上验证。插件作用于浏览器侧的 Web UI 层，无构建步骤。

### 方式 A：命令行（npm，推荐）

```powershell
dsh plugin --profile desktop add dsh-session-active-top
```

从 npm 拉正式包注册进 profile。核心已启用 HMR，Host 侧实时重组、client 侧经 `plugins/events` 的 `type: "graph"` 帧交付，装完即时生效；若页面未自动加载，刷新一次 Web GUI 即可。

> `--profile` 指向你正在使用的 profile；若 `dsh` 已默认选中它，可省略该参数。profile 目录一般在 `$DSH_HOME/profiles/<profile>`，若在工作区之外，安装时需放开对应目录权限。

### 方式 B：插件市场

在 DSH 插件市场搜索 `dsh-session-active-top`，一键安装（社区收录审核通过后可用）。

### 方式 C：本地目录（开发调试）

```powershell
dsh plugin --profile desktop add link:<本插件目录的绝对路径>
```

以 junction 链接本地目录，改文件即热重载，适合边改代码边验证。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-session-active-top
```

注意：卸载**不会还原**已写入的手动顺序（等价于你曾经拖动过一次），上浮名单也会留在 `localStorage`。要彻底清空，可在 DevTools 执行：

```js
localStorage.removeItem('dsh-session-active-top:raised');
```

## 验证

1. 设置 → 插件列表可见 `dsh-session-active-top` 且为启用；`/plugins/events` 的 graph 帧含该插件条目。
2. 让另一个会话进入 running（发一条消息），它应立刻跳到会话目录顶部。
3. 停止该会话：仍留在顶部，不会回落。
4. 其余会话顺序不变；手动置顶的会话与图钉图标不受影响。

## 实现原理

内核（`dsh-client-ui-workspace`）没有提供「会话列表排序」扩展点，排序在组件里写死，且**两种排序模式落点不同**：

| 目录排序模式 | 实际生效的顺序来源 | 插件做法 |
| --- | --- | --- |
| 时间（`orderBy: "updated"`） | `orderByRecency` 读快照里的 `updatedAt` | 包装 `sessions.list.getSnapshot()`，给上浮会话一个远大于真实时间戳的合成 `updatedAt`（只存在于运行时副本，不回写真实数据） |
| 手动（`orderBy: "manual"`） | `reconcileManualOrder` 回放持久化的 `sessionOrderByAccount` | 调用视图 store 自己的 `setSessionOrder(accountKey, order, orders)`，把上浮会话前置进已保存顺序 |

手动模式下**只改快照是无效的** —— 这正是第一版「看不出上浮」的原因：老会话都在已保存的手动顺序里，改 `updatedAt` 只会影响「其余」段。必须写持久化顺序；写入走内核自己的 action，等价于用户拖动一次，所以刷新 / 重启后位置仍在，且运行结束不会自动回落。

每次快照变化都会重排**上浮块内部**（按 `updatedAt` 降序），你正在对话的会话就在最前；上浮块之外完全不动。

- **Node 半**（`lib/index.js`）：空实现，不做任何事。
- **客户端**（`lib/client.js`）：注入 `sessions` 与 `slots`，解析视图 store、包装快照、订阅变化并重排上浮块；卸载时还原包装。
- 上浮名单只记在浏览器 `localStorage`（`dsh-session-active-top:raised`），按 profile 隔离。

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 装了没反应 | 确认 `--profile` 指向当前实例、刷新一次 Web GUI、检查插件列表为启用；`/plugins/events` 的 graph 帧应含该插件 |
| 当前对话没在最前 | 上浮块按 `updatedAt` 降序，给该会话发一条消息刷新活跃时间即可 |
| 置顶会话的顺序没变 | 置顶会话属于图钉分区，本插件只在普通分区排序，两者互不影响 |
| 想清掉上浮名单 | DevTools 里 `localStorage.removeItem('dsh-session-active-top:raised')` 后刷新 |

## 已知限制

- 内核没有「会话列表排序」扩展点，本插件靠运行时包装内部 store 并调用未写入文档契约的内部 action；DSH 升级若改动这部分实现，插件可能需要跟进。详见 [FEEDBACK.md](./FEEDBACK.md)。
- 手动模式下写入的持久化顺序不会因卸载而还原（等价于用户拖动过一次）。
- 上浮名单存在浏览器 `localStorage`，换 profile 或换机器不会同步。

## 发布

在 GitHub 上创建 Release 会触发 `.github/workflows/publish.yml`，经 OIDC 可信发布自动推送到 npm。版本号以 `package.json` 为准。

## 许可证

[MIT](./LICENSE)
