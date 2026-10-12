# 人机协作规范 / Human–AI Collaboration Norms

> 本文件记录本项目的**维护者**（人类决策者）与 **AI 协作者**（在 DSH 中工作的编码
> agent）在 Vibe Coding 模式下共同约定的协作规范。它由 0.2.x「轨迹提级」开发周期的
> 实际摩擦与复盘凝结而成，是**双向约定**，不是单方面的流程说明书。
>
> 约定一旦写在这里，双方都按它执行；要改，先改这份文件。

**English abstract.** This repository is developed in a human–AI pair‑programming
("vibe coding") mode. This document states the norms **both** sides follow:
restrained versioning (rc‑level for fixes, maintainer approval for real version
bumps), explicit permission before `git push`, evidence‑over‑assertion reporting,
root‑cause‑first debugging, a fixed delivery checklist, and public disclosure of
accepted residue. It intentionally contains no personal or machine‑specific
information.

---

## 1. 版本号治理

| 情形 | 做法 |
|---|---|
| 修 bug、调参数、改 UI 细节 | **不动基数位**，只在既有版本后递增 `-rc.N`（如 `0.2.5-rc.1`） |
| 需要变更 `major.minor.patch` 基数位 | **必须先报维护者审批**，批准后才动 |
| 已经把版本号加上去了 | **不追改**。既往不咎，从下一次开始按本规范执行 |

- **要谦虚。** 一串 bug 修复不值得一个 patch 号；"从 0.2.2 到 0.2.5 只是修 bug，
  连 0.0.1 都不该加"。版本号是给使用者的承诺，不是进度条的装饰。
- 每次版本变更**必须**同步写 `CHANGELOG.md`（遵循 [Keep a Changelog]：
  `Added / Changed / Fixed / Removed`，同版本内只记对外可见的行为变化）。
- 版本号写在 `package.json` 的 `version`；`engines.dsh` 与 `peerDependencies`
  的区间必须能覆盖维护者当前运行的 dsh 版本。

[Keep a Changelog]: https://keepachangelog.com/

## 2. 权限边界

- **`git push` 必须先问。** 提交（`commit`）可以自行完成并保持本地领先；
  推送到 GitHub 属于对外动作，需维护者明确同意后才能执行。
- **破坏性操作先确认**：删除/覆盖/移动文件、删除或保护工作表、批量替换等，
  先说明影响范围并取得确认。
- **改动已安装环境前先留退路**：覆盖 profile 的 `package.json` 等文件前先备份，
  并记录时间戳（`yyyyMMdd-HHmmss`），使回滚可追溯到具体一次操作。
- AI 协作者**不得**：未经批准 push、自行升大版本号、静默丢弃已知问题、
  把未验证的事说成已完成。

## 3. 实证优先（Evidence over assertion）

- 关于状态的任何结论都要有**可复核的证据**，而不是记忆或推断：
  - 仓库状态 → 实际跑 `git log` / `git status`；
  - 功能可用 → 测试实际通过数（本项目基线 **77/77**）；
  - 安装成功 → **构建产物与已安装文件的哈希逐一比对**，而不是"拷过去了"；
  - 接口可用 → 实际请求一次并把响应读出来。
- **不确定就说不确定**；失败要如实、完整地报告，包括失败的原始错误文本。
  例：`node --test` 裸跑报 `SyntaxError: Octal escape sequences are not allowed
  in strict mode`，定位到是测试里 `'\03'` 的写法问题，修正为 `join('\0')`，
  而不是绕过或改断言。
- 报告结论时**带上数值与路径**（版本号、提交号、通过数、文件、哈希），
  让维护者能独立复核。

## 4. 追根因，不打补丁

- 症状出现时，**逐层定位到机制层的根因再修**，不用"看着像好了"的绕过。
- 每次排查都问：这是**什么时候开始错的**？如果答案是"从第一天就错"，
  那要修的是最初的设计，而不是最近一次改动。
- 排查过程要产出**结论**（试过什么、为什么不行），避免重复走同一条死路。

**范例（0.2.5-rc.1 的锚点键修复）**：轨迹胶囊一直不显示。表面症状在客户端 DOM
装饰层，但逐层排查后发现路由正常、投影正常、DOM 行结构也正常——真正的原因是
**宿主锚点投影用 `message.id` 做键，而轨迹视图的助手行键是
`assistant\0<turn>\0<step>`**，两侧从未对齐。修复因此落在投影的键构造上，
而不是客户端的选择器上。

## 5. 人机分工与验收闭环

| 角色 | 职责 |
|---|---|
| **AI 协作者** | 实现、构建、测试、打包、安装、自查、提交、写变更说明、给出验证步骤 |
| **维护者** | 重启后实机验收（截图反馈）、拍板版本号、批准 push、裁决取舍 |

- **实机验收权归维护者。** 自动化测试通过 ≠ 功能可用；UI 类改动必须由维护者
  在真实客户端里确认。
- **每次交付必须给出可执行的验证步骤**：打开哪个页面、看哪个位置、预期看到什么、
  出问题怎么回滚。只说"已修复"不算交付。
- 维护者反馈问题时，AI 先**复现并定位**，再动手改；一轮只解决被指出的问题，
  同时报告是否顺带暴露了别的问题。

## 6. 交付清单（每次改动都走完）

1. `pnpm build` —— 重建客户端 bundle（`build-client.mjs` → `lib/client.js`）。
2. `node --test "test/*.test.mjs"` —— 全绿；**用显式 glob**，不要依赖目录参数。
3. 按 §1 调整版本号；同步更新 `CHANGELOG.md`。
4. `pnpm pack` —— 出 tarball。
5. 安装到**所有相关 profile**（桌面端与 Web 端都要），安装前备份 profile 的
   `package.json` 并记录备份戳。
6. **逐文件哈希比对**：构建产物 vs `$DSH_HOME/profiles/<profile>/node_modules/<plugin>`
   下实际安装的文件，全部一致才算装成功。
7. `git add -A && git commit` —— 提交信息说明**改了什么、为什么**（可带版本号）。
8. 向维护者报告：本次结论、证据（数值/哈希/提交号）、实机验证步骤、已知残留。
9. push —— 等维护者批准（§2）。

## 7. 已知残留必须公示

- 无法立即解决、或经权衡后**有意接受**的问题，写入 `ROADMAP.md`，
  标明现象、影响范围与缓解手段，**不得静默丢弃**。
- 例：R2 的毒化钉死修复留下一个已接受残留——manual-off（无工具调用）叠加特定模型
  形态时，仍可能钉到 compaction 才释放，已在 ROADMAP 中登记。
- 上游问题与本项目问题要分开定性；确认属上游的，记录结论与证据后结案，
  不要挂在本项目的待办里冒充未完成工作。

## 8. 文档与隐私

- **面向维护者的报告用中文**；仓库文档遵循既有双语习惯
  （`README.md` / `README.zh.md` / `CONTRIBUTING.md` 均中英并存）。
- **入库文档不得包含个人隐私或机器专属信息**：
  - 绝对路径中的用户名、真实姓名、邮箱、账号、token / 密钥；
  - 机器专属的运维日志、provider 凭据、回滚记录。
- 写路径时用环境变量或占位符表达，例如 `$DSH_HOME/profiles/<profile>/…`。
- 本仓库的 `.gitignore` **已刻意整体排除 `docs/` 与 `docs/ops/`**（机器专属运维
  日志与研究草稿）。因此**需要公开追踪的文档放在仓库根目录**，不要放进 `docs/`。
- 提交前自检：这份文档如果被陌生人看到，会不会暴露维护者的个人信息或本机结构？

## 9. 沟通约定

- **结论先行**：先说结论与影响，再说依据与细节。
- **数值说话**：版本、提交号、通过数、哈希、耗时，能量化就量化。
- **不夸大**：不用"完美/彻底解决"这类词描述未经验证的结果；验证过了才说验证过了。
- **UI 类交付**：附上组件结构与预期视觉效果，并把截图反馈纳入下一轮输入。
- 维护者指出规范层面的问题时，AI 应当**把结论固化进本文件**，
  而不是只记住这一次。

---

_本规范随项目演进；每次修订请在本文件中直接改动，并在提交信息中说明原因。_
