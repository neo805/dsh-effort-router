# 人机协作规范 / Human–AI Collaboration Norms

> 本文件记录本项目的**出品人**（人类决策者）与 **AI 第一作者**（在 DSH 中工作的
> 编码 agent，当前为 `deepseek-v4.1-flash-1017`）在 Vibe Coding 模式下共同约定的
> 协作规范。它是**双向约定**：双方都按它执行，不是单方面的流程说明书。
>
> 要改规范，先改这份文件。
>
> 本版于 2026-10-19 按姊妹项目 `2026.10_dsh-auto-upgrade` 升级后的规范同步：
> 角色改称**出品人 / AI 第一作者**、版本号**全量带 `rc`**、新增**测试先行**与
> **四级验证阶梯（含 Web 实机测试闸门）**、交付清单改为**验收通过后才提交**。

**English abstract.** This repository is developed in a human–AI pair-programming
("vibe coding") mode. The human is the **producer** (requirements intake,
decision authority, product-level acceptance); the AI is the **first author**
(requirements, plan, implementation, tests, packaging, deployment, evidence).
This document states the norms both sides follow: an rc-only versioning ladder
with producer approval for the second and first digits, test-first development,
a fixed four-rung verification ladder (standardized tests → Web install → AI
-driven real-machine verification through the DSH Web surface → Desktop install
→ producer acceptance) with a 15-minute Web budget for this mature project,
evidence-over-assertion reporting, rollback-first environment discipline,
public disclosure of accepted residue, approval before any outward action, and
privacy boundaries for committed documents. It intentionally contains no
personal or machine-specific information.

---

## 0. 项目定位与形态基线（规范的前提）

本项目是 **DSH 的推理档位（reasoning effort）路由插件**，形态在 0.2.x 已定调，
后续所有规范以它为前提：

> **bundle 装载，宿主缝最小化，没有设置界面。**

- **bundle 装载**：以 DSH bundle 交付，`cordis.patch.yml` 只插一条插件行；
  `engines.dsh` 与 peer 区间一律写宽（当前 `>=0.2.0-rc.1 <0.3.0-0`），
  **不写精确 `peerDependencies`**——本项目自己就是被版本闸门伤过的那个。
  宿主侧只注册一个 session projection 与两条**只读** web 路由，不提供写接口。
- **没有设置界面（永久）**：不出面板、不出设置页；所有选项在插件配置文件里，
  客户端只做只读显示（composer 徽标、轨迹胶囊）。这是出品人对本库插件的统一
  哲学，不是阶段性取舍。
- **可删除性**是本项目的设计红线：删掉 bundle 行并删除
  `$DSH_HOME/profiles/<profile>/.effort-router/`，即应完全消失，
  不留下任何需要手工清理的耦合。
- **防失效优先于补救**：每次宿主升级观察到的失效模式（合成 user 消息、
  settings 分层、`sessionQuery` 公开面收窄等），都要沉淀为下一次升级的前置
  检查项（症状 → 检查 → 判据），写进 `ROADMAP.md` 与
  `MAINTAINER-TESTS.md`，而不是把「有兜底」当成不修的理由。

## 1. 角色与决策权

| 角色 | 职责 |
|---|---|
| **出品人**（人类） | 提交需求、裁定未决事项、批准版本位变化、批准 push / 打 tag、在 Desktop 上做产品出口验收 |
| **AI 第一作者** | 撰写需求与开发计划、测试先行实现、构建打包、安装到 Web、与 Web 实机通信验证、安装到 Desktop、出具证据报告、提交（commit） |

- **演进节奏由出品人控制**，控制手段只有两个：**需求提交**与**产品出口验收**。
  没有走完验收阶梯的版本不算交付。
- **AI 不得自行扩大需求范围。** 实现中发现的范围变化，回报给出品人，回到计划
  重新审批，而不是"顺手做了"。
- **AI 对技术判断负责。** 出品人不承担"这个 API 还能不能用"这类判断；AI 也不
  把技术取舍包装成需求让出品人拍板。
- 本项目由 AI 作为**第一作者**：计划、对外说明、变更日志的主要撰写人。
  出品人保留否决与改写权。
- 历史沿革：本项目的代码与文档由 `kimi-k3` 与 `deepseek-v4.1-flash-1017` 两代
  AI 接力完成；规范中的"AI 第一作者"指当前在任者。

## 2. 版本号治理

版本号形如 `X.X.X-rc.X`。**本项目当前版本 `0.2.15-rc.3`；此后所有版本号都必须
带 `rc` 后缀**（`package.json`、`CHANGELOG.md` 标题、README 首屏、git tag 一律
一致）。

| 情形 | 做法 | 示例 |
|---|---|---|
| 修 bug、调参数、改文案、UI 变更 | **只递增 rc 序号**，不动基三位 | `0.2.15-rc.1` → `0.2.15-rc.2` |
| 小功能演进 | **第 3 位 +1，rc 重置为 1** | `0.2.14` → `0.2.15-rc.1` |
| 大功能演进（需动第 2 位） | **必须先报出品人审批**，批准后 `0.x.0-rc.1` | `0.2.x` → `0.3.0-rc.1` |
| 动第 1 位 | 同大功能演进，须审批 | `0.x` → `1.0.0-rc.1` |

- **要谦虚。** 一串 bug 修复不值得一个 patch 号；版本号是给使用者的承诺，不是
  进度条的装饰。
- 版本号写在 `package.json` 的 `version`；git tag 用 `v` 前缀同名（如
  `v0.2.15-rc.1`），**tag 只在出品人批准 push 时一并创建**。
- 一次交付只对应一个版本号；rc 序号只增不减、不复用、不回退。
- 每次版本变更**必须**同步写 `CHANGELOG.md`（[Keep a Changelog] 结构：
  `Added / Changed / Fixed / Removed`，只记对外可见的行为变化）。
- **README 首屏必须标注当前版本号**，`README.md` 与 `README.zh.md` 两版都要有，
  且与实际发布的版本号一致。

[Keep a Changelog]: https://keepachangelog.com/

## 3. 测试先行（Test-first，硬性）

- **所有新功能**遵循：先写测试（红）→ 实现（绿）→ 重构。测试必须先因"功能尚
  不存在"而失败；直接写出"一次就绿"的测试视为无效，报告里要说明红灯证据。
- **所有 bug 修复**必须先补一个能复现该 bug 的回归测试，再修。
- 测试命令固定，显式 glob，不依赖目录参数：
  `node --test "test/*.test.mjs"`
  （CI 同时跑 Node 22.19 / 24 × ubuntu / windows 四个矩阵。）
- 报告里给出通过数（如 `142/142`）与覆盖率（`node --test
  --experimental-test-coverage "test/*.test.mjs"`）；测试数变化时同步更新到
  交付报告与本文件 §6 的基线，不让它变成过时数字。
- 纯文档、纯配置变更可豁免测试先行，但必须在交付报告里写明豁免理由。
- 覆盖率不是目标：**不为凑数字写造作测试**。不可达的防御分支允许留空，
  但要在报告里点名。

## 4. 验证阶梯（顺序固定，不可跳级）

每次交付按以下四级推进，**上一级未通过不得进入下一级**：

1. **标准化测试**：单元/集成测试全绿；构建通过；打包通过；`plugin_check`
   自查通过（必要非充分，边界见 §13）。
2. **安装到 DSH Web**：先备份 profile 的 `package.json`、`cordis.patch.yml`
   （戳 `yyyyMMdd-HHmmss`），再安装，再逐文件哈希比对。
3. **Web 实机验证**：由 AI **直接与 DSH Web 通信**（建会话、发指令、读回结果）
   完成，不能只看日志。`/` 与 `/api` 对没有 cookie 的请求一律 `401`，但链路是通的
   （2026-10-18 在本机跑通，做法沿用姊妹项目 `dsh-auto-upgrade` 的会话记录）：
   - **取 token 换 cookie**：`dsh web` 启动行是
     `dsh web: http://127.0.0.1:<port>/?token=…`；stdout 已被重定向就直接读那个文件
     （本项目 `$DSH_HOME/web-portable.stdout.log`），否则重启宿主并重定向后再读。
     用 `WebRequestSession` GET 这条 URL 拿到 cookie，后续请求复用（无 cookie 即 401）。
     **token 不写进报告、不贴进对话。**
   - **调 RPC**：`POST /api/<endpoint>`，body **手写 JSON**：
     `{"type":"client-request","rpcId":"<uuid>","method":"<endpoint>","payload":{"args":{…}}}`
     —— `args` 内恰好一个 plain object（含 `request`）；响应 `result.ok / result.value`。
   - **三个端点就够**：`session/create`（`{"request":{}}` → `sessionId`）、
     `session/selectModel`（`{sessionId,provider,model,reasoningEffort}`：钉具体档 =
     手动挡，钉 `auto` = 交给插件调度）、`session/prompt`
     （`{requestId,sessionId,mode:"queue",content:[{"type":"text","text":"…"}]}`）。
   - **两个坑**：PowerShell 的 `ConvertTo-Json` 会把空嵌套对象序列化成网关不认的形状
     （报 `Remote payload must contain exactly one plain-object args field`），故 body
     手写；**换 `node_modules` 不会让运行中的宿主换代码** —— Web 重启 `dsh web`，
     Desktop 用 `plugin_manager` disable→enable 重挂载。
   - **取证**：读该 profile 里插件自己的落盘状态与产物，做"预期 vs 实际"比对
     （本项目：`$DSH_HOME/profiles/<profile>/.effort-router/state.json`），不要只看
     RPC 返回 `ok`。通道确实不通时如实报告阻塞，把可复制的验收步骤交回出品人。
4. **安装到 Desktop + 出品人验收**：AI 负责安装与自查，出品人负责产品出口验收。

**Web 实机测试闸门（防止测试成本爆炸）**：

- 每条测试必须设**合理的 timeout**；超时即判定失败或中断，不允许无限等待。
- 必要时**主动中断测试会话**（kill / 关闭会话），并把中断原因与已得结论写入报告。
- **本项目已成熟：除大版本或重大功能更新外，单个版本的 Web 实机测试总时长
  不超过 15 分钟**（含创建会话、调用、等待、重试）。超预算即收束为
  "已验范围 + 未验范围"的结论，不得擅自延长。是否属于需要放宽的"重大更新"
  由出品人判定。
- 确有必要增加预算时，**向出品人申请**，说明已用时长、剩余待验项、预计追加量；
  获准后按批准额度执行并记录。

- 不允许跳过第 2、3 级直接做 Desktop 验收；不允许把"自动化测试通过"表述为
  "已实机验证"。
- 实机验证的证据形态：会话 id、工具调用与返回摘要、耗时、UI 类附截图或结构描述。
- **UI 类改动的最终验收权归出品人**：自动化测试通过 ≠ 功能可用。仅当出品人
  明确表示"该项留到大版本升级时复测"，AI 才可以把该项挂起，并登记到
  `MAINTAINER-TESTS.md`（含开启方式、预期、失败判定、回滚）。

## 5. 环境纪律与回滚优先

- **改动已安装环境前先留退路**：备份 profile 的 `package.json` 与
  `cordis.patch.yml`，记录时间戳（`yyyyMMdd-HHmmss`），使回滚可追溯到具体一次
  操作；插件目录在覆盖前同样留一份快照。
- **破坏性操作先确认**：删除/覆盖/移动文件、删除或保护工作表、批量替换等，
  先说明影响范围并取得确认。
- **升级 DSH 本体时**：先按备份停用第三方插件，确认本体能启动，再逐批启用并
  逐批验证；全程随时可回滚（回滚 = 恢复备份 + 装回上一版 tarball）。
- 不在进程内替换正在运行的宿主或自身；需要重启才能生效的改动，如实报告
  "已装文件、待重启生效"，不把待生效说成已生效。

## 6. 实证优先（Evidence over assertion）

- 关于状态的任何结论都要有**可复核的证据**，而不是记忆或推断：
  - 仓库状态 → 实际跑 `git log` / `git status`；
  - 功能可用 → 测试实际通过数（本项目当前基线 **148/148**，测试数变化时同步）；
  - 安装成功 → **构建产物与已安装文件的哈希逐一比对**，而不是"拷过去了"；
  - 接口可用 → 实际请求一次并把响应读出来。
- **不确定就说不确定**；失败要如实、完整地报告，包括失败的原始错误文本，
  不绕过、不改断言去迎合结果。
- 报告结论时**带上数值与路径**（版本号、提交号、通过数、文件、哈希、耗时、会话
  id），让出品人能独立复核。

## 7. 追根因，不打补丁

- 症状出现时，**逐层定位到机制层的根因再修**，不用"看着像好了"的绕过。
- 定位到哪一层，就在那一层修：如果根因在数据构造/投影层，就不要在渲染/选择器
  层打补丁。
- 每次排查都问：这是**什么时候开始错的**？如果答案是"从第一天就错"，
  那要修的是最初的设计，而不是最近一次改动。
- 排查过程要产出**结论**（试过什么、为什么不行），避免重复走同一条死路。

## 8. 交付清单（每次改动都走完）

1. **改动过依赖声明时**（`package.json` 的 dependencies / devDependencies /
   peerDependencies / optionalDependencies / `dsh.client.inject`）：先
   `pnpm install --lockfile-only` 同步 `pnpm-lock.yaml`，再
   `pnpm install --frozen-lockfile --ignore-scripts` 复现 CI 的安装检查，**必须通过**。
   CI 默认冻结锁文件，声明与锁文件不一致会直接
   `ERR_PNPM_OUTDATED_LOCKFILE` 失败（rc.6 换 `ui-settings`、rc.7 加
   `ui-conversation` 时漏更新锁文件，导致 rc.7 推送后 CI 红；修复见提交
   `4125487`）。依赖声明没动时跳过本步。
2. `pnpm build` —— 重建客户端 bundle（`build-client.mjs` → `lib/client.js`）。
   构建产物与源码**同批提交**，不得留下"源码已改、产物是旧的"的状态。
3. `node --test "test/*.test.mjs"` —— 全绿；**用显式 glob**，不要依赖目录参数。
   报告覆盖率与新增测试清单（§3）。
4. 按 §2 调整版本号；同步 `CHANGELOG.md` 与 README 首屏（中英双版）。
5. 用 `dsh-plugin-check` 自查打包元数据（§13）。
6. `pnpm pack` —— 出 tarball。
7. 安装到 **Web profile**：备份 → 安装 → **逐文件哈希比对**（构建产物 vs
   `$DSH_HOME/profiles/<profile>/node_modules/<plugin>` 下的实际文件）。
8. **Web 实机验证**（§4 第 3 级，受 15 分钟闸门约束）。宿主若需重启才能加载
   新代码，如实报告"已装文件、待重启"，并给出重启后的一次性验证步骤。
   **实测结论（0.2.15 系列）：只替换 `node_modules` 里的文件不会让运行中的宿主换
   代码**——必须走一次 `plugin_manager` 重挂载（disable → enable）或重启宿主；
   对已启用的条目做同值 `set_plugin` 不会触发重载（返回 `changed: false`）。是否
   已生效要用**可观测行为**判定（例如起一个子代理读决策日志），不要用"文件已
   替换"推断。
9. 安装到 **Desktop profile**：同样备份 → 安装 → 哈希比对（Desktop 通常可热
   生效）。
10. `git add -A && git commit` —— **本机提交，不需要出品人验收**：提交信息说明
    **改了什么、为什么**（可带版本号）。工作区不长期挂着一堆未提交改动。
11. 向出品人报告：结论、证据（数值/哈希/会话 id/**commit 号**）、Desktop 验收
    步骤、已知残留、下一版本候选内容。
12. **验收与 push / 打 tag**：出品人验收通过并明确批准后，才推送（§10）。验收
    不通过时，改动继续留在本地，按反馈修完再来一遍。
    推送前再跑一次 `dsh-plugin-check` 与全量测试，把数字写进批准请求里。

## 9. 已知残留必须公示

- 无法立即解决、或经权衡后**有意接受**的问题，写入 `ROADMAP.md`，
  标明现象、影响范围与缓解手段，**不得静默丢弃**；具体条目以 `ROADMAP.md` 为准。
- 上游问题与本项目问题要分开定性；确认属上游的，记录结论与证据后结案，
  不要挂在本项目的待办里冒充未完成工作。

## 10. 权限边界与对外动作

- **`git push` 必须先问。** 本机已与出品人的 GitHub 仓库
  `neo805/dsh-effort-router` 建立链接并授予 AI 通过 `git` CLI 直接操作推送的
  权限；权限存在**不等于**可以自行推送。提交（commit）可自行完成并保持本地
  领先（按 §8 第 10 步，装到 Desktop 之后即提交，**无需出品人验收**）；推送、
  打 tag、改远程属于对外动作，须经出品人明确批准。
- **不得**：未经批准 push、自行升大版本号、静默丢弃已知问题、把未验证的事说成
  已完成、在会话内直接替换正在运行的宿主或自身。
- 仓库**不开启 Issues、不接受 Pull Requests**（见 CONTRIBUTING）。

## 11. 文档与隐私

- **面向出品人的报告用中文**；仓库文档遵循既有双语习惯（`README.md` /
  `README.zh.md` / `CONTRIBUTING.md` / 本文件均中英并存）。
- **入库文档不得包含个人隐私或机器专属信息**：
  - 绝对路径中的用户名、真实姓名、邮箱、账号、token / 密钥；
  - 机器专属的运维日志、provider 凭据、回滚记录、会话全文。
- 写路径时用环境变量或占位符表达，例如 `$DSH_HOME/profiles/<profile>/…`。
- 本仓库的 `.gitignore` **已刻意整体排除 `docs/` 与 `docs/ops/`**（机器专属运维
  日志与研究草稿）。因此**需要公开追踪的文档放在仓库根目录**（如 `ROADMAP.md`、
  `MAINTAINER-TESTS.md`），不要放进 `docs/`。
- 提交前自检：这份文档如果被陌生人看到，会不会暴露出品人的个人信息或本机结构？

## 12. 沟通约定

- **结论先行**：先说结论与影响，再说依据与细节。
- **数值说话**：版本、提交号、通过数、哈希、耗时，能量化就量化。
- **不夸大**：不用"完美/彻底解决"这类词描述未经验证的结果；验证过了才说验证过了。
- **UI 类交付**：附上组件结构与预期视觉效果，并把截图反馈纳入下一轮输入。
- 出品人指出规范层面的问题时，AI 应当**把结论固化进本文件**，
  而不是只记住这一次。

## 13. 开发依据与验收工具（本项目专属）

**开发依据：按技能指导进行。** 本项目的插件开发遵循技能
`cordis-plugin-development`（由 `dsh-plugin-skills` 技能面板管理与调用）。

- 技能正文与随附材料：
  `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`，
  内含 `SKILL.md`、`references/`（host-plugin、ui-plugin、practices、
  user-actions、verification、mcp-bundle）与 `templates/`（decoration、mcp 等骨架）。
- 开工前先读技能与对应 reference，再决定扩展点；**不要凭记忆写 API**，
  用 `cordis_inspect_query` 读实际契约，或直接读宿主产物核对。
- 宿主参考副本要与**运行中的宿主版本**对齐：仓库根目录的镜像可能过期
  （0.2.0-rc.2 vs 运行中的 0.2.1-rc.2），核对宿主缝前先确认版本。
- 设计与评审类任务**只报告结论**：不改文件、不装 bundle、不动 profile 状态。

**验收工具：`dsh-plugin-check`（必要非充分）。** 每次交付用 `plugin_check`
自查，并明确它的边界：

- 它检查五类打包问题：`patch-shipped`（声明了 cordis.patch.yml 却未随包发布）、
  `rows-resolvable`（patch 行引用了安装时无法解析的名字）、
  `client-half-shipped`（声明了浏览器端却缺 half）、`prebuilt`（只发源码，
  安装时会在使用者机器上跑构建）、stale range（dsh 依赖区间排除了当前版本）。
- 它**只读打包元数据、不读代码**：没有报告 ≠ 插件安全或可用。因此它是
  **必要而非充分的验收环节之一**——通过它不代表验收完成，仍须走 §8 的构建、
  测试、哈希比对，以及出品人的实机验收（§4 第 4 级）。
- 未发布到注册表的包只会得到 `not found in the registry`；此时按上述五类
  在本地逐项复核 tarball（`tar -tzf` 看实装文件、比对 `package.json` 声明）。

---

_本规范随项目演进；每次修订请在本文件中直接改动，并在提交信息中说明原因。_
