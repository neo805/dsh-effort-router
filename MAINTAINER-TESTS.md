# 维护者实机验收备忘录 / Maintainer's on-device test memo

> **用途。** 本文件记录**只有维护者**（在真实客户端里）才能确认的检查项。
> 自动化测试覆盖不到的宿主缝、渲染与跨宿主行为都登记在这里；
> **AI 协作者不重复申请这类复测**，维护者在**大版本号升级时**（如 0.2 → 0.3）
> 或在涉及 UI 宿主缝的改动后，挑一次集中确认即可。
>
> **English abstract.** A running list of acceptance checks that only the human
> maintainer can perform in a real client (host seams, client rendering,
> cross-host behaviour). Automated tests cannot reach these; they are re-checked
> once per MAJOR version bump, not per release. Every item states how to enable
> it, what to expect, how to judge a failure, and how to roll back.

---

## 0. 通用约定

- **改配置**：本插件**没有设置界面**，所有开关都在 profile 侧的插件配置里
  （`$DSH_HOME/profiles/<profile>/…` 的插件配置行，或直接让 Agent 代改）。
  改完需要**刷新页面**才生效（客户端只在加载时读一次开关）。
- **回滚**：把配置改回原值即可；插件本身不含数据迁移，回退版本不会损坏状态
  （决策日志在 profile 目录下，格式向后兼容）。
- 判定原则：**渲染类问题先怀疑宿主缝，不要先当插件 bug**。宿主升级可能改动
  插槽名、props 形状或 DOM 锚点，这三者的核对结论都写在下面对应条目的
  「静态核对」里，出问题时可据此快速区分责任方。

## 1. 轨迹视图胶囊（`trajectoryAnnotate`，默认开）

- **怎么开**：默认即开，无需操作。打开任意会话的**原生轨迹（轨迹）标签页**。
- **预期**：每个请求的边界行下方/旁边出现 `#N · provider/model · effort`
  小胶囊（等宽 9px，透明底，压在请求圆点右侧）；点击胶囊会打开原生「请求 #N」
  摘要。
- **历史会话**：服务端在会话非 live 时改读持久化日志（`sessionQuery`
  的公开读接口），因此**Desktop 与 Web 双向**都应能看到对方打开的会话胶囊。
- **静态核对（2026-10-18，宿主 0.2.1-rc.2）**：`data-trajectory-row-key`（1 处）、
  `data-request-run-index`（1 处）、`--request-boundary-offset`（2 处）均在
  `dsh-client-ui-trajectory` 里存在，DOM 锚点未变。
- **已知实测**：0.2.14 起双向跨宿主读取已实测通过（Web 读 Desktop 持有的会话
  返回 `resolved=stored`，锚点 3 个；反向在 0.2.14 交付时于 Desktop 实测通过）。
- **失败判定**：胶囊完全不出 + 路由返回 `anchorsError` 非空 → 按该字段的文本
  定位（服务缺失 / 会话日志读不到 / 日志为空）；胶囊出现但**串会话** → 属于
  0.2.11 已修的归属问题，记录现象与两个会话 id 反馈。

## 2. 对话流小注（`chatAnnotate`，**默认关**，仅大版本升级时复测一次）

- **怎么开**：把插件配置的 `chatAnnotate` 设为 `true`，刷新页面。
- **预期**：对话视图里，每个**工具调用**下方多一行灰色的
  `provider/model · 档位` 小注；没有工具调用的回合不变；关掉开关并刷新后消失。
- **历史结论**：约 0.2.7 时测过一次，**没有渲染出任何行**；此后一直默认关，
  未再复测。
- **静态核对（2026-10-18，宿主 0.2.1-rc.2）**：`conversation.chat.node`
  插槽在 `dsh-client-ui-chat/lib/client.js` 中命中 **61 处**，宿主自身的节点视图
  用的正是本插件相同的注册形状（`slots.inject` + `slots.register({ name, key,
  locale })`），`useProjection` 亦为 `ChatView` 的 props。**结论：这条缝在当前
  宿主上存在，值得一次性复测**，而非继续当作坏缝。
- **失败判定**：开启后刷新，工具调用下方仍无任何一行 → 记为宿主缝问题（不是
  插件 bug），把宿主版本号记在本文件第 5 节，并保持 `chatAnnotate: false`
  直到有结论。
- **注意**：该开关只在**页面加载时**读取一次，改完必须刷新，不要用热更新判断。

## 3. Auto 档与「手动优先」（每次大版本升级顺带确认）

- **怎么开**：默认即用。打开原生模型选择器（对话输入框右侧）。
- **预期**：
  1. 支持思考的模型，档位列表里**多出一个 `Auto`**（宿主原生列表，不是插件自绘）；
  2. 选 `Auto` → 输入框左侧徽标显示 `Auto · <具体档>`，悬停能看到分类与理由；
  3. 选某个具体档位 → 请求**原样直通**，徽标显示 `手动 · <档>`；调度器不再介入；
  4. 不支持思考的模型 → 选择器不出现档位，且请求里不会带 `reasoningEffort`
     （否则宿主会报 `UNSUPPORTED_REASONING_EFFORT`）。
- **失败判定**：`Auto` 不出现 → 可能是另一个同时注入档位的插件（例如
  `dsh-thinking-levels`）在抢同一插槽，先确认 profile 里没有并存的同类插件。

## 4. 子代理与会话状态（低频，可选）

- 起一个子代理，确认父会话的调度不被影响、子代理能正常返回。
- **0.2.15-rc.2 起，子代理按父会话的选择分流**（ROADMAP R5）：
  - 父会话跑 **Auto** → 子代理按**自己的始发简报**调度（始发分类 + 暖启动地板 +
    节俭降档），不再继承父级的具体档位；
  - 父会话选了**具体档位** → 子代理**原样继承**该档，不重新调度。
- **怎么验**：把模型选择器切到某个具体档位（如 `max`），在该会话里起一个子代理，
  然后在轨迹视图里看子代理那几步的档位应保持 `max`；再把选择器切回 `Auto` 起一个
  子代理，子代理的档位应由它自己的任务决定（可能与父会话不同）。
- **AI 已实测（两半都做了）**：0.2.15-rc.2，在 **Web 宿主**上用 session-controller
  RPC 建会话（`session/create` + `session/selectModel` + `session/prompt`）：
  - 父会话钉 `max`（manual）→ 子代理 `manual/max`，原样继承；
  - 父会话选 Auto → 子代理 `auto/high`，理由含 "subagent inherited the parent's
    scheduled level; scheduled from its own brief"。
  更早一次在 Desktop 宿主（0.2.15-rc.1，会话 `b653563f`）同样走通了 Auto 那一半。
  这条**不再需要你在 GUI 里点**，除非想复验 UI 路径本身。
- **失败判定**：父会话手动选 `max` 后，子代理那几步出现 `low/high` 等被改写的档位
  → 视为回归，记下两个会话 id 反馈。

## 5. 复测记录（维护者填写）

| 版本 | 日期 | 第 1 项 轨迹胶囊 | 第 2 项 对话小注 | 第 3 项 Auto/手动 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 0.2.14 | 2026-10-18 | 通过（双向跨宿主） | 未测 | 通过 | 第 2 项待大版本升级时复测 |
| 0.2.15-rc.2 | 2026-10-18 | 未复测（无相关改动） | 未复测 | 未复测（无相关改动） | 第 4 项两半均已由 AI 在 Web 宿主实测：父 auto → 子 auto；父手动 max → 子 manual max |
|  |  |  |  |  |  |

---

_新增条目请写清「怎么开 / 预期 / 失败判定 / 回滚」，让任何一次复测都不需要
重新阅读代码。_
