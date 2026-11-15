# dsh-effort-router 开发计划

> 基线：`0.2.16-rc.2` · 编制日期：2026-10-31 · 配套需求文档：[REQUIREMENTS.html](REQUIREMENTS.html)
>
> 本计划把**可直接推进的技术工作**与**必须由出品人裁决的功能/发布策略**分开。排序不代表已获实施授权；尤其不得以“代码优化”为名改变默认路由、词典、配置所有权或宿主支持范围。

**English abstract.** DSH 0.2.2 support is now approved, important and urgent, and must lead the next implementation cycle together with continuous whole-turn Auto semantics and preserved DSH 0.2.1 behavior. Official 0.2.2 Auto means omitted effort resolved by adapter defaults; it is not an evidence-driven scheduler and does not replace this project. The implementation must probe the exact pre-preparation selection seam: selection is captured before `agent/pre-step`, so calling `select()` there must not be assumed to affect the current step. Other technical work includes fixing multi-line brief deduplication and unknown-effort mapping, tightening configuration parsing, adding cancellation and accessibility to existing client behavior, and creating host-contract probes. Cross-session last-effort memory remains approved; custom-model fill ownership, model knowledge bases, and UI relocation remain producer decisions. F-08 through F-12 are deferred as low-importance, low-urgency items with current behavior unchanged.

---

## 0. 当前基线与执行原则

### 0.1 已核实的现状

- 当前版本：`0.2.16-rc.2`；核心需求已经落地，本轮不重新设计产品。
- 自动化基线：`node --test "test/*.test.mjs"` 实测 **212/212 通过**。
- 客户端源码与 `lib/client.js` 经独立内存重建逐字一致；未发现源码/产物漂移。
- 非技术性产品需求已补写：[REQUIREMENTS.html](REQUIREMENTS.html)；只使用自然语言、流程和验收场景，不以代码变量描述需求。
- 本轮已形成开发计划与完整先行测试，未修改运行时代码、未安装新 bundle、未改 profile、未提交或推送。
- 本次产品决策更新：**F-01 已批准，重要且紧急，是下一施工首要目标；整轮 Auto 持续调度必须随 F-01 保留；不做 think-level 共存兼容；跨会话“上次档位”记忆已批准；插件 Auto 不改名；F-03/F-05 为中等重要、中等紧急的延期项，F-07 的 Badge 迁移与 F-08～F-12 为低优先延期项，全部维持现状。**
- F-01/F-02 已先写 **33 项**离线合同/回归测试：`test/f01/` 25 项、`test/f02/` 8 项，共用 `test/helpers/host-0.2.2-harness.mjs`。最终红灯复核为 **28 红 / 5 绿 / 0 跳过**；红因包括固定选择拒绝旧路径改档、续步无事前选档、版本门未收紧、缺少现代生命周期路径和 dispose 后仍调度，5 绿为既有手动、手动子代理继承、手动恢复、旧路径与禁用 Default 保护。尚未修改运行时代码。
- 测试宿主已按官方 0.2.2 源码实现同步 claimed→选择捕获、pre-step waterfall、固定 selection、prepareCall 解析、请求头去重、stream retry、turn/step finally 与 abort；Auto 用例先经真实插件公开 resolver 预热能力。宿主契约与测试期望两路独立复核均已结论“可移交”。它不是实机验收，也不得代替真实宿主探针。
- 新套件命令：`node --test "test/f01/*.test.mjs" "test/f02/*.test.mjs"`。施工期间与原 `node --test "test/*.test.mjs"` 分开运行，避免把预期红灯混入旧基线；实现后由 T-F01-7 将两个显式 glob 纳入标准命令和 CI。
- **施工状态更新（2026-11-16，本轮）：** F-01/F-02 已施工完成并转绿，版本 `0.2.17-rc.1`。标准命令改为递归 glob `node --test "test/**/*.test.mjs"`，实测 **245/245**（原 212 + 新 33，未跳过）。新增 `lib/runtime.js` 做运行时契约分派（白名单：`0.2.1-rc.2`/`0.2.1-rc.5` 走 legacy，`0.2.2-alpha.2`/`0.2.2-rc.3` 走 modern；未实测版本拒绝加载），新增 `lib/turn-auto.js` 承载整轮 Auto（claimed 同步 select → step/end 预选 → turn/end 恢复），旧 `agent/request` 只对 legacy 注册，两条路径都在 dispose 后停止写入。
- **真实宿主证据：** 0.2.2-rc.3 契约已由独立探针按安装目录与桌面 asar 逐字节核实（报告含机器路径，按 COLLABORATION 隐私约定不入库）：claimed 同步段内 `agent.model.select()` 被接受且对本步生效；`step/end`/`turn/end` 在 publish 中禁止同会话 append，因此工具续步的再调度晚一拍、于下一步前补写——这是实测契约边界，已公开在 ROADMAP 与 MAINTAINER-TESTS。
- **Web 实机（已完成）：** web profile 已装 `0.2.17-rc.1` 并逐文件哈希比对一致；宿主 0.2.2-rc.3 上用 `session/create` + `session/selectModel(auto)` + `session/prompt` 驱动会触发工具的多步任务，证据见 `MAINTAINER-TESTS.md` §5（会话 `session-943f7265…`：第一轮冷缓存安全省略 `mode=unsupported`，第二轮 `mode=auto effort=low`，轮末回 Auto，只读路由 200，宿主日志无选择改写报错）。冷缓存首轮已登记为 ROADMAP 后续小项。
- **仍待完成：** Desktop 安装（本轮已写入 desktop profile，需出品人重启 Desktop 后按第 5 项验收）；本地 commit 后另行申请 push/tag。T-01 的“适配前拒绝 0.2.2”已在实现前验证，现已按实测版本放宽为可安装。

### 0.2 变更分类

| 类别 | 含义 | 决策规则 |
|---|---|---|
| **T / 技术项** | bug 契约修复、版本门、测试、观测、生命周期、文档同步；不改变已声明的产品语义 | 可直接纳入后续开发批次，仍须测试先行和完整验证阶梯 |
| **F / 功能裁决项** | 新能力、配置所有权、控制面、默认路由/参数、宿主支持策略 | **出品人最终裁决后才能转为实施任务** |
| **R / 研究项** | 只读分析、shadow、反事实重放、契约探针、样本积累 | 可先研究；不得直接改生产默认值 |
| **A / 接受残留** | 已有证据表明收益不足或风险可控，暂不处理 | 保留在 ROADMAP/本文，不静默删除，不无谓重构 |

### 0.3 统一工程约束

1. 所有 bug 修复先写能复现问题的红灯测试，再实现；纯文档任务豁免测试先行，但要说明豁免原因。
2. 保持手动档直通、Auto 不泄漏、普通 Auto 不路由 off、无设置 UI、客户端只读、profile 隔离和可删除性。
3. 优先最小修复，不开展无问题证据的“架构清理”；公开 subpath 的废弃导出不能当普通死代码删除。
4. 每次代码交付依次完成构建、全量测试、覆盖率、打包与元数据检查、Web 安装/实机、Desktop 安装、出品人验收；push/tag 仍需单独批准。
5. 公开文档不记录本机绝对路径、token、账号、provider 凭据或会话全文；研究产物只使用聚合数值。

---

## 1. 后续开发总顺序

```text
P0【已批准·重要且紧急】F-01/F-02：DSH 0.2.2 双路径 + 整轮 Auto 持续调度 + 保留 0.2.1
  → 同批修复与新旧路径直接相关的安全边界、契约缺陷和回归探针
  → P1 客户端生命周期、观测与文档/CI 债务
  → 已批准的 F-06 跨会话记忆独立小功能批次（须兼容新逻辑 Auto 状态）
  → P2 独立周期的校准研究与低风险测试补强
  → F-03/F-05 中等重要、中等紧急但延期；F-07 Auto 不改名、Badge 迁移低优先延期；F-08～F-12 低优先延期
```

下一次施工必须包含 F-01，不能只修版本号，也不能把官方“省略 effort、采用适配器默认”的 Auto 当作本项目调度器。先以真实宿主探针确定合法的事前选档接缝，再实现双路径；其余当前版本缺陷按与迁移的耦合程度分批进入，不借迁移做无证据重构。

---

## 2. 可直接列入开发的技术工作

### P0 — 阻断已知高风险与错误行为

#### T-01：在 0.2.2 适配完成前收紧宿主版本门

- **依据：**只读契约比对表明 `0.2.1-rc.5` 接触面兼容；`0.2.2-alpha.2` 在 step preparation 固定 selection 后，禁止 `agent/request` 添加、修改或清除 reasoning effort。当前 `<0.3.0-0` 会错误允许安装。
- **位置：**`package.json` 的 `engines.dsh`、现有 6 个宿主包 peer，以及新增公开运行时 API `@deepseek-ai/dsh-app-boot` peer，共 7 个 peer range；同步 lockfile。
- **最小动作：**施工初期先把上界收紧为 `<0.2.2-0` 并同步 lockfile，防止中间态误装；F-01 验收通过后再按实际覆盖版本放宽。不要把 `enabled=false` 当 0.2.2 兜底，因为剥离 Auto 同样改变请求；新路径下禁用插件应保持官方选择不变。
- **验收：**适配前 0.2.1-rc.2/rc.5 被接受、0.2.2-alpha.2 被版本门拒绝；`plugin_check`/管理器版本门验证通过。F-01 完成真实双路径验收后，再按已测版本放宽并验证 0.2.2 可安装，不能仍停留在只拒绝状态。

#### T-02：修复多行真实简报的重复开启与重复计量

- **证据：**`lib/signals.js:400-408, 518-520, 690` 将 claimed 文本用换行拼接，再逐行与完整简报比较；多行简报无法匹配自身，projection 再次打开任务，重复 brief volume 并重置暖启动。
- **最小动作：**claimed ownership 按完整文本/消息身份比较，不再把“多条 claimed 记录”和“一条多行简报”混为换行字符串。保持现有多条 claim 合并能力。
- **回归测试：**同一多行简报只 openTask 一次；briefVolumeRaw 不翻倍；暖启动不重置；两个不同 turn 的相同文本仍按各自消息处理；单行行为不变。

#### T-03：修复全未知 selector 词表的 rank 冲突与不可达项

- **证据：**`lib/routing.js:45-49` 对全未知 ID 的插值结果取整；8 个 ID 会得到重复 rank，导致同 rank 的中间 ID 在 `effortForRank` 中不可达。
- **最小动作：**保留未知词表的顺序语义，使用不碰撞的分数 rank 或等价的稳定全序；已知规范 rank 与 mixed-known 插值行为不变。
- **回归测试：**至少覆盖 1、2、3、8 个全未知 ID、重复 ID、mixed known/unknown、allow-list 交集与三种 fallback；验证每个广告项在其对应目标上可达且 Auto 永不入选。

#### T-H1：修复第三方包装后 WRAPPED 遗留标记阻断 Auto 自愈

- **证据：**`lib/capability.js:135,148-150,158-166` 在第三方覆盖 `resolveModel` 后保留旧 WRAPPED 标记；下次广告只看标记真值便跳过，当前函数已不是我方 wrapper，Auto 仍不会恢复。
- **最小动作：**只有“标记存在且等于当前 resolveModel”才幂等跳过；保留 dispose 的 identity guard，旧 dispose 不得覆盖第三方函数，新 registration dispose 应恢复到第三方函数。
- **回归测试：**我方包装→第三方覆盖→readvertise，Auto 恢复且委托第三方；新旧 dispose 顺序均不 clobber。

#### T-H2：请求跨越卸载点时不得再写 store 或持久化 Auto

- **证据：**`lib/index.js:805-818,924-969` 的 interceptor 在 `await next()` / `await capability.resolve()` 后没有 disposed guard；卸载期间已运行 handler 仍可能 record、重启 debounce，甚至 append durable Auto。
- **最小动作：**两个 await 后分别 `if (disposed) return stripAutoEffort(seed)`；后续同步副作用段无需引入复杂关闭协议。
- **回归测试：**deferred next 与 deferred capability 各一例：启动请求→dispose→release；Auto 被剥离，无 model/selection append，无新 decision/flush。

### P1 — 局部正确性、生命周期与可验证性

#### T-04：让数字字符串配置真正执行“整向量非法则整体回退”

- **证据：**`lib/index.js:273-276` 在 `normalizePolicyConfig` 之前过滤非法数字，导致 `errorDecay='1,x,0.5'` 被接受为 `[1,0.5]`，绕过 `lib/policy.js:407-410` 的整向量回退契约。
- **最小动作：**解析阶段不丢弃非法元素，把完整结果交给统一 sanitizer；保持空白的 undefined 语义。
- **回归测试：**errorDecay/briefRamp/toolRamp 的非法 token、空片段、全非法、负值、重复 rung 与合法 CJK 分隔符；分别验证回退和告警行为。

#### T-05：修复已声明为“词干”的英文分类词匹配

- **证据：**`lib/policy.js:231-238, 383-394` 对 `migrat/optimiz/diagnos/integr` 等词干仍施加双侧 `\b`，`migration/optimize/diagnose` 等常见形式无法命中。7 天研究也复现了该边界问题。
- **最小动作：**仅对明确声明的词干采用受控前缀匹配，普通英文词继续双侧边界；不要简单放开 `auth` 等会误伤 `authority` 的短词。
- **回归测试：**migrate/migration、optimize/optimization、diagnose/diagnosis、integrate/integration 等应命中；capital→api、sparse→parse、authority→auth 等不得误伤。此任务恢复文档已声明的词干语义，不新增或剪枝词典。

#### T-H3：恢复会话不得把 tool-result 当真实用户简报

- **证据：**`lib/signals.js:117-133,816-824` 的 resumed fallback 未像主扫描一样排除 source-less user-role tool-result；没有真实简报时会对工具输出分类并计 brief volume。
- **最小动作：**`lastUserText` 跳过含 tool-result 的 content；保留 source-less 纯文本 legacy brief，找不到时按 standard。
- **回归测试：**只有 tool-result + notice→standard；真实用户文本在前、tool-result 在后→仍选真实 brief；更新反而锁定旧行为的现有测试。

#### T-H4：关闭 subagentReturnBump 期间不得积累可回放事件

- **证据：**`lib/signals.js:429-432,509,831-850` 仍记录 return，只在输出端屏蔽；shortWindow 内重新启用会补放旧 +1，与 todo/compaction 的盲关语义不一致。
- **最小动作：**记录处检查开关，disabled collect 清空 subagentEvents 并建立新 baseline；新 return 才可触发。
- **回归测试：**priming→禁用→return→重开仍 0→新 return 为 1；禁用前旧事件也不复活。

#### T-H5：以可靠 branch/projection generation 隔离改写后的证据

- **证据：**`lib/signals.js:456-463,572-576` 在 branch switch 时只移动长度/seq 水位；旧分支 origin、ring、briefs、事件继续生效，新分支前缀还可能不重放。same-length rewrite 更无法由长度发现。
- **前置研究：**先通过 T-07 确认宿主可靠的 branch/projection generation；不得把所有 shrink 粗暴清零，否则会把 compaction 与 branch 混为一谈，也不得用文本相似度猜测。
- **最小动作：**仅在确认 branch 改变时重置 projection-derived state 并重放当前消息；compaction 保持既有语义。没有可靠代际信号前保持现状并公开边界。
- **回归测试：**A 分支证据→较短 B 分支→A 证据消失且 B 前缀只折一次；same-length rewrite；compaction shrink 不意外重置长窗。

#### T-H6：自定义模型填充必须尊重 user provider 层显式 compat=false

- **证据：**`lib/custom-models.js:102-107,177-181` 只看 baseProfile；base 为 openai-completions 而 user provider 显式 `compat.supportsReasoningEffort:false` 时，可能在 model row 写回 true。
- **最小动作：**仅对 compat 判定构造 base/user effective provider（api/compat 以 user 为准）；候选和 models 数组 materialization 不变。
- **回归测试：**user provider compat=false→不写 true；base/user 均未声明→按现规则补 true；row 已显式声明→不覆盖。

#### T-H7：消除同一模型在 models[] 与 modelOverrides 中的重复解析和计数

- **证据：**`lib/custom-models.js:190-213` 可返回重复 provider/model，导致重复 capability 解析和 filled 数量夸大；两处实际写入策略可保留。
- **最小动作：**解析前按 key 去重，planFill 返回的 filled 同时去重；不得把两处 row 写成“两个模型”。
- **回归测试：**同 ID 同时存在→candidate/resolve/filled 每 key 一次，两处行仍符合预期，输入不被 mutate。

#### T-H8：结构损坏但 JSON 合法的 store 行必须可恢复

- **证据：**`lib/store.js:42-58,110-127` 只校验最外层；`sessions[sessionId]` 为字符串/数组等时 record 会抛错，调用方吞错后该会话决策、echo/delegation/manualOff 来源持续缺失。
- **最小动作：**加载或 record 时按行规范化，非普通对象 row 替换为 `{last:null,recent:[]}`，并确保 recent 为数组；无需引入大型 schema 框架。
- **回归测试：**null/string/array row 均可 record、last/recent 可用、flush+reload 正常；补真正 corrupt 文件用例，而非只测文件不存在。

#### T-06：取消不再需要的客户端请求，并补齐现有 chip 的键盘语义

- **位置：**`src/client/Badge.tsx:41-76`、`src/client/trajectory.ts:430-483,591-601`、`src/client/index.tsx:53-74`。
- **动作 A：**为 Badge、trajectory、一次性 config fetch 增加 AbortController，在会话切换或 cleanup 时 abort；保留 stopped + generation + session ownership，不能用 abort 替代旧响应防护。
- **动作 B：**`src/client/trajectory.ts:322-335` 的可点击边界 chip 增加 `role=button`、tabIndex、Enter/Space 激活；Space 阻止默认滚动，鼠标和键盘均只转发一次到原生请求按钮。
- **验收：**deferred fetch 证明 signal 被取消、迟到响应不回写、无新 timer；Tab/Enter/Space 可达且不重复触发。原生按钮仍是独立入口，不新增业务控制面。

#### T-07：建立真实宿主契约探针/快照，而非只增加 fake-host 数量

- **依据：**现有 212 个测试主要验证自身 fake host，未能提前发现 `prepareRequest` 的 0.2.2 契约变化。
- **最小动作：**把已确认的关键契约变成小型版本夹具/快照：`agent/request` 可改字段的旧行为、0.2.2 的拒绝断言、`AgentModel/select` 存在性、projection register/stateOf 形态、tokenUsage v2、modelSelection v3、实际 UI 锚点。
- **CI 方向：**按 0.2.1-rc.2、0.2.1-rc.5 与已获批准的 0.2.2 目标版本分组；alpha 版本不作为默认安装矩阵，只作为契约预警。
- **验收：**契约被移除或改变时测试必须红；真实 Web 实机仍在后续验证阶梯执行，不用快照替代。

#### T-08：只增加观测，不改变 gzip 或路由参数

- **依据：**7 天样本中 2,536 次实际压缩 p99 约 0.417ms、max 2.019ms、>4ms 为 0；没有证据支持立即 async zlib 重写，但极大输入仍有理论尾部。
- **动作：**记录轻量数值观测（调用耗时、输入字节、>4ms/>8ms、>64KiB/≥1MiB 等计数或可重建这些指标的字段）；不记录工具正文。
- **同步补强：**为长期校准设计滚动聚合或独立导出，弥补 20 条/会话 suffix 丢失中段峰值；为后续研究保留错误是否解决、是否重试、用户是否重问等 outcome 数值/枚举字段。
- **约束：**观测字段不得在本批次反向参与路由；`gzipSync`、`briefRamp/toolRamp`、错误/重复阈值和 `sessionTokenBudget=0` 均保持现状。

#### T-09：同步 ROADMAP、验收记录与交付自动化

- **ROADMAP 文档同步：**将“校准和 T6 shadow 尚未运行”更新为“首轮已完成、等待独立周期”；把 toolRamp 48k 改为“稀有但可达”，128k 改为“本周期无样本”；记录 shadow 14/113 全为升级但项目集中，因此本周期不增删词典、不调阈值。
- **窗口口径同步：**README/配置注释明确 `longWindow` 对 brief 按 step、对 tool 按 batch，tool ring 保留 N 个 sealed + 当前 open；补 age=N-1/N/N+1 与 sealed/pending 边界测试。现有 N+1 有测试背书，不得当作 off-by-one 顺手改掉。
- **验收记录：**`MAINTAINER-TESTS.md` 的 0.2.16-rc.1/rc.2 仍有“待验收”项，而 rc.1 已打 tag、origin 已含 rc.2。只列出差异，由出品人补验收结论；AI 不得代标通过。
- **CI：**在现有 Node/OS 测试矩阵之外增加 build 与 pack 检查；build 后用 `git diff --exit-code -- lib/client.js` 拦截过期产物，pack 校验 files 白名单；依赖声明变更时先更新 lockfile，再做 frozen install。至少一个矩阵输出覆盖率报告，workflow 增加合理 timeout 和 `contents: read` 最小权限；`plugin_check` 按协作规范保留为交付证据，不把它当功能测试。

#### T-10：消除本地研究“伪脱敏”暗示，默认所有挖掘产物私有

- **证据：**`scripts/session-mining/schema.mjs:55-56,130-160` 的 `DSH_MINING_TEXT=0` 只清 `text`，`args/argKey/err/meta` 仍可能含正文；manifest 还记录 root/outDir 等绝对路径，但 README 曾建议分享前仅重跑该开关。
- **最小动作：**立即撤掉“TEXT=0 即可分享”的措辞，明确 events、sessions、manifest 全部默认私有；同步给 README 中“当前 v4 工具证据通道废置”的历史段落加已修复横幅，并链接现行 v4 测试。
- **后续边界：**真正可分享的 redaction 必须单独覆盖 text/args/argKey/err.msg/err.tail/meta/cwd/root，并用 canary 验证；不得复用 TEXT 开关冒充脱敏。是否公开任何研究结果见 F-12。
- **验收：**TEXT=0 文档不再声称安全；若以后实现 redact，唯一 canary 不得出现在任何输出或 manifest，且不含用户名/绝对机器路径。

### P2 — 低风险测试补强与研究维护

#### T-11：补小型 DOM 生命周期测试，不引入大型浏览器框架

- **覆盖：**新增行→rAF 标注、移除行→跟踪 Set 释放、row-key 复用、caption 被 React 移除后的恢复、dispose→observer/timer/rAF/abort 清理、旧会话迟到响应不画。
- **同时验证：**trajectory 在稳定 pass 中 compare-before-write，不因自身 caption mutation 形成自激循环。
- **边界：**当前 WeakMap + 可清理 Set、增量 observer + rAF + 慢速全量兜底均保留；没有实测泄漏证据，不重写该模型。

#### T-12：开展独立第二周期校准，先研究后裁决

- **样本要求：**不同日期、尽量不同项目，避免与首轮高度重叠；区分 auto/manual/unsupported、root/subagent 和版本。
- **研究内容：**targetRank/mapping/最终 effort 联合分布、brief/tool ramps、error/repeat、frugal、contextPressure、sessionTokens、todo 有效样本和 outcome。
- **词典：**复核零命中第二周期、`高并发`冗余候选、`参考`观察项；`项目/你是`继续观察，`代理/读取`不加入；当前不新增、不迁移、不剪枝。
- **出口：**只产出聚合报告与 F-08 裁决材料，不直接修改生产参数。

#### T-13：修正本地 session-mining 的口径与溯源，不擅动冻结 schema

- **位置：**`scripts/session-mining/schema.mjs:30-31,78-82` 与 `scripts/session-mining/README.md:73-75`。
- **问题：**仍称 400 字符 argKey 与运行时同源；运行时已改为完整参数稳定序列化 + SHA-256。多个研究模块还直接 import 当前 `lib/policy.js`，使“冻结”口径会随运行库变化。
- **动作：**先修文档，明确挖掘 schema v1 是冻结的历史研究口径、与当前运行时不同；manifest 增加 package version/commit/policy SHA-256 以便追溯，不改算法。是否升级 schema v2、共享/冻结算法并重挖见 F-12。
- **验收：**key-order 与 >400 字差异夹具明确展示 v1 限制；同一冻结语料可凭哈希追溯所用 policy。

#### T-14：把诊断脚本和研究 runner 的失败语义改得可判定

- **`scripts/verify-live.mjs`：**降为 diagnostic；多档不再直接等于 scheduler active（人工换档也会多档），恒定档也不单独判失败；无样本输出 INCONCLUSIVE，空日志根返回非零。大会话读取增加流式/上限，避免整文件解压与多份字符串复制。
- **`scripts/session-mining/run.mjs`：**未知 source、适配器 import/初始化错误应非零，不得吞错后冒充完整统计；确实允许缺源时使用显式 `--allow-missing`，workbuddy 已存在后不再保留“可能未交付”的吞错兼容。
- **验收：**varied-manual 不判 Auto active，constant-auto 不单独判失败，空目录和损坏 adapter 均非零；正常六源结果不变，大 fixture 有明确资源上限。

#### T-16：单文本 piece 的 gzip 免去一次整输入 Buffer 拷贝

- **证据：**`lib/compress.js:48-60` 对单个 buffer 也无条件 `Buffer.concat`，会产生额外分配和 memcpy；常见 foldVolume 输入就是单 text block。
- **最小动作：**`buffers.length===1` 直接传给 gzipSync，多块路径保持 concat；不得引入采样、截断或 ratio 变化。
- **验收：**单块/多块 gzip 字节与现有 compress 测试一致，并用典型大结果做分配/耗时基准；这不改变 gzipSync 的同步性质。

#### T-17：分类器按分支需要计算线索，保持返回结果完全不变

- **证据：**`lib/policy.js:774-798` 在 strong 已足够决定 engineering/hard 时仍提前扫描 cheap/normal/structural；但 origin 每任务只分类一次，收益预期低。
- **最小动作：**先 strong，按需 structural，只有进入 cheap/wish 路径才计算 cheap/normal；不引入复杂自动机，不改变分支顺序和 reason。
- **验收：**现有 policy 全套与分类语料 deep-equal，再做微基准；若无可测收益，可只保留测试而不合并此微调。

### P3 — 独立清理项，避免与行为修复混合

#### T-18：减少测试脆弱性和本地维护噪声

- 将 `test/integration.test.mjs` 固定 50ms 等待改为可 await 的明确条件 + deadline；workflow 设置 timeout 与最小权限，发布前将 actions 钉到完整 SHA。
- `test/capability.test.mjs` 与 `test/rc5.test.mjs` 的 transient-resolution 重试用例重复；保留覆盖更完整的一处，删除另一处并同步实际测试基线，不改历史 CHANGELOG 数字。
- 测试创建的临时目录用 `t.after/after` 清理，且只清理本测试自己的目录。
- 根目录 35 个 tgz 均未跟踪，不构成 Git 仓库膨胀；其中 `0.2.0-r4` 与 `0.2.0` 内容完全重复。**任何删除都必须先确认精确路径和哈希**，仅清理重复别名及明确不再需要的回滚包。
- `.gitignore` 的 `docs/ops/` 已被 `docs/` 总规则覆盖，可在下次触碰该文件时合并冗余行，保留“公开文档放根目录”的说明。

---

## 3. 代码审计结论：优化边界与不做事项

### 3.1 审计判断总表

| 分类 | 结论 | 处置 |
|---|---|---|
| 已复现正确性问题 | 多行简报重复计量、英文词干失效、未知档位不可达、非法数字字符串绕过回退 | T-02～T-05，测试先行修复 |
| 宿主契约与生命周期 | WRAPPED 遗留阻断 Auto、dispose 后副作用、恢复简报误读、分支证据混合、compat 覆盖、store 损坏行等 | T-H1～T-H8；T-H5 先确认可靠 generation |
| 资源生命周期 | 客户端只阻止回写但未取消 fetch；Badge 快速切换可积累悬挂请求 | T-06，小范围增补 abort |
| 可访问性 | 可点击 chip 只有鼠标语义 | T-06，保留原行为并补键盘等价入口 |
| 运行效率 | 当前证据不支持重写 gzip、投影或 DOM 引擎；仅单块 Buffer 与分类求值顺序可行为保持地小改 | T-08、T-16、T-17；不预设 async/cap |
| 测试缺口 | 真实宿主契约和 DOM 生命周期缺直接覆盖 | T-07、T-11 |
| 文档与隐私债务 | ROADMAP 校准状态过期、session-mining 同源/脱敏声明失真、验收记录待核 | T-09、T-10、T-13 |
| 脚本判据 | verify-live 可假阳性/假阴性，研究 runner 可静默缺源 | T-14 |
| 冗余与脆弱性 | 一组重试测试重复、固定 sleep、临时目录未清理、重复本地 tarball | T-18；删除文件须先确认 |
| 轻微重复 | trajectory 与 annotations 的 route label 格式化相似，但默认文案语言不同 | 仅在下次触碰该区域时提取接收 defaultLabel 的小 helper；不单开重构批次 |

### 3.2 明确保留、不要“优化掉”的设计

1. **保留选择回声与血缘证明：**pending + decision store + parentSession 的保守判断，不能为缩短代码而改成 pattern 猜测。
2. **保留纯 policy/routing 与宿主装配分离：**这保证了分类、量化和窗口逻辑可单测；不合并回大型 index。
3. **保留有界窗口、增量水印和 single-flight：**anchors 的浅拷贝有 500 上限，长窗有 32 默认上限，不是无界复杂度问题。
4. **保留客户端代次、会话所有权和 WeakMap/Set 清理：**Abort 只能补充，不能替代；不要退回每次 mutation 全文档扫描。
5. **保留公开兼容导出：**`ERROR_TEXT`、`clampTier`、`mapEffort` 及旧配置键属于公开/迁移契约，删除需单独版本治理。
6. **保留当前透明 chip 与无设置 UI：**已注释的历史皮肤和 localStorage 单值读取不构成运行瓶颈；无需为“干净”制造视觉变化。
7. **保留同步 gzip 与 store/anchors 现状：**没有真实阻塞证据时，异步化引入的有序采集或单 writer 复杂度大于收益；store 的全量同步写有 200×20 上限和 debounce，先 profiling。anchors 的 500 项浅拷与历史全日志 fold 已有上限、TTL 和 single-flight。
8. **保留诊断与兼容字段：**`consecSameTool` 服务下轮校准，`tier/targetTier` 是兼容别名；raw/effective、当前 brief/window sum、projection availability 也不是同义冗余，不能为减少字节顺手删。
9. **同 profile 多进程写入先明确部署前提：**若可能并发，需要锁或 read-merge-write；只换 unique tmp 不能解决 lost update。未证明存在该部署前，不重写单进程原子写。
10. **微小重复扫描不独立重构：**state route 对最多 8 张 capped 表的 hint 有一次重复查找，成本有界且很小；只在下次改 route 时顺手消除，并保持 ambiguity-safe merge 结果不变。

---

## 4. 调研结论、已决事项与功能裁决项

### 4.1 综合判断

- 社区 `dsh-model-think-level` 与本项目在产品定位上不同，但**出品人已明确不考虑共存兼容**。不再安排冲突实测、自动让位、联合声明所有权或互操作文档工作。
- DSH 0.2.2 官方 Auto 已有直接文档证据：省略 effort，由适配器默认解析。它没有本项目公开需求中的任务分类、错误/重复、信息量与节俭证据调度，因此不是功能替代；0.2.2 的关键影响是宿主请求装配契约变化。
- 后续主线已调整为：**首要实施 F-01/F-02 的 0.2.2 双路径并保住整轮 Auto 与 0.2.1 → 修当前契约缺陷 → 实施已批准的跨会话记忆 → 再评估声明权扩展**。
- [REQUIREMENTS.html](REQUIREMENTS.html#decisions) 已保留完整 F-01～F-12 裁决登记册；本节提供技术背景，两处状态应同步维护，不能把待裁决项当作已删除需求。

### 4.2 本次已明确的产品决策

#### F-01：DSH 0.2.2 支持已批准，重要且紧急，下一施工首要交付

**批准边界：**下一施工必须包含 F-01，并同时交付 F-02 的整轮 Auto 持续语义与 0.2.1 既有路径兼容；不允许只放宽版本范围后发布。初始契约探针固定到已取证的 `0.2.2-alpha.2`；manifest 的兼容安装区间与运行时精确支持名单分开管理，实际调度路径只对实测版本启用。

**官方 Auto 的一手证据与项目定位：**

- `@deepseek-ai/dsh-agent@0.2.2-alpha.2` 的 Model selection 文档明确写着 `Omitted effort uses adapter defaults`，并说明 Web/ACP 用户选择直接调用 `select()`，因此省略 effort 意味着 Auto。
- `@deepseek-ai/dsh-agent-loop@0.2.2-alpha.2` 文档说明：步骤准备前固定 provider/model/可选 effort；省略项由 `prepareCall()` 的适配器默认解析。
- 因而官方 Auto 是**省略具体档、采用适配器默认**的选择语义，不是本项目注入的实体 `auto` selector，也不含任务起点、错误/重复、信息量和节俭证据计算。官方 API 是迁移接缝，不是本项目调度器的替代品。
- `@deepseek-ai/dsh-client-ui-model-selection@0.2.2-alpha.2` 的实际界面代码进一步证实：省略具体档时，`effort.providerDefault` 在选项、当前档位标题与中英文字典中均显示 **Default**，不是 Auto。因此 F-07 的命名问题已裁决为**插件 Auto 不改名**，不做 ID、存量选择或 echo-guard 迁移。

**必须先纠正的一条技术假设：**源码与文档共同证明，loop 在进入 `agent/pre-step` 前已经调用 `agent.model.current()` 并捕获 `selection`，随后把同一个 `decision.selection` 交给请求准备；`select()` 记录的是尚未准备步骤使用的后续选择。因此不能声称“在 pre-step 调 select 就会改当前步”。禁止依赖直接修改传入对象、拒绝步骤后侥幸重试等私有行为。

**真实版本分派入口也已取证：**`@deepseek-ai/dsh-app-boot` 公开导出 `getDshRuntimeVersion()`，直接读取 app-boot manifest 的精确 semver；0.2.1 与 0.2.2 均提供该入口。实现必须在 apply 时按真实版本选择路径，未知版本及落在宽 manifest 区间内但未实测的版本均 fail loud，不得靠事件形状或 loop 包版本猜宿主。测试仅用 Node loader hooks 替换这个公开入口的返回值，不伪造 `ctx.version`。

**测试先行的施工 Todo 与验收目标：**以下测试编号已经落到 `test/f01/`、`test/f02/`，不是待补的测试名称。施工者可以补真实宿主探针，但不得删除或放宽这些公开行为断言来迎合实现。

1. **T-F01-1：确认真实宿主契约与事前接缝。**
   - 技术路线：固定当前 Desktop 基线 0.2.1-rc.2、调研目标 0.2.1-rc.5 与 0.2.2-alpha.2，用公开事件、请求头和适配器实际配置记录时序。已有一手源码证据支持“有输入步骤在同步 `agent/inbox/claimed` 段选档；普通工具续步在上一步 `session/event(step/end)` 乐观预选；若仍有续步则保留该 turn 的执行状态，只有 turn 真正结束才恢复逻辑 Auto”，但仍须真实包探针确认，不能把离线 harness 当作实机验收。实机通过 `ctx.agents.create()` + `followup()` + `whenIdle()` 驱动，用安装版公开 LLM 注册接口挂 ProbeAdapter；不要直接 new 非入口导出的 ReactLoopAgent、Session 或调用 private step。
   - 验收目标：首步、连续工具步骤、同 step retry、resume 都有“选择捕获→事前事件→请求头→工具结果”的证据；pre-step 内改选不被误当作当前步生效；retry 不换档。claimed 不同步等待异步任务。最小 retry 探针应在 claimed 同步选 high，让首次正常 stream 留下 error finish chunk、第二次成功，经 `agent/request-error` 返回 `{kind:'retry'}`，断言实际请求为 `['high','high']`、`preSteps===1`、`retries===1`；retry 可再次 prepareRequest/prepareCall，不能错误要求 prepareCall 只调一次。prepareRequest/prepareCall 直接 throw 与 stream throw 按宿主语义直接抛出，不伪造成 request-error。
   - 先行测试：F01-02～04、F02-01，另跑真实宿主公开行为探针与 Web/Desktop 时序验收。当前证据包缺少完整 0.2.2 Session/LLM/Tools/SystemPrompt 构造签名，因此不另写伪精确的独立全服务图单测。

2. **T-F01-2：分离逻辑 Auto 与单步实际档。**
   - 技术路线：会话内保存自身逻辑选择及预期选择事件守卫，实际 concrete 只对应一个步骤。优先复用现有 decision store 的同会话 Auto witness；步后恢复的每次写回都必须核对自身预期值，不能覆盖用户新选择。
   - 验收目标：整轮结束或静置后原生选择器显示 Auto；自身 witness 可修复崩溃留下的 concrete，真手动 concrete 永远优先。公开 API 无法保证“崩溃任意瞬间 durable 日志都只有 Auto”，不得伪造此保证；瞬态预选、恢复和 resume 限制须写入验收记录。
   - 先行测试：F01-02、F01-06、F01-14～15、F02-02～03、F02-07。

3. **T-F01-3：实现同步事前选档与续步预选。**
   - 技术路线：在 claimed 的同步调用段使用已经缓存的能力和证据完成计算，多条输入逐条累积、最后一次选择反映整批；step/end 根据当时可得证据预选可能的下一续步，continues:true 时不在 turn 中途恢复 Auto。没有能力缓存时保持官方 provider default（省略 effort）并尽快返回，禁止在 claimed 中 await，也禁止把上一步陈旧档位静默当成下一步新决策。测试通过独立 manual concrete 步骤走公开 resolver 预热，不能偷读/伪造 capability cache。
   - 验收目标：首步工程任务直接为 high；普通任务首步 low、下一步出现工具错误后为 medium；default 固定档也走事前路径但不伪装成 Auto；无续步时在 turn/end 恢复 Auto；未决 capability 不等待且发送安全省略值，恢复后不得留下 poisoned cache。
   - 先行测试：F01-02～03、F01-08、F02-01、F02-05。

4. **T-F01-4：建立互斥的 0.2.1 / 0.2.2 双路径。**
   - 技术路线：启动时调用 `@deepseek-ai/dsh-app-boot` 的公开 `getDshRuntimeVersion()` 获取精确版本，再以 `AgentModel` 能力检查为辅，只启用一条写入选档的路径；0.2.1 继续现有 request 瀑布，0.2.2 的 request 钩只校验不再改 provider/model/effort。未知版本及范围内未实测版本明确报错；当前运行时 allowlist 仅为实测的 0.2.1-rc.2、0.2.1-rc.5、0.2.2-alpha.2，新增版本必须先补契约与实机证据。0.2.2 缺少 `select()` 时在 pre-step fail-closed，不回退到必然被宿主拒绝的旧写法。
   - 验收目标：旧路径保持既有输出且不调用新选择写入器，即使旧宿主意外暴露同名 select 也不误入新路径；新路径没有固定选择拒绝、双写或互兜底。禁用时官方 omitted/Default 完全不动，插件私有 auto 在进入固定选择前被剥离。最终 engines 与 7 个 peer/lock specifier 同步，只在矩阵通过后把兼容安装包络设为 `<0.2.3-0`；该宽上界不替代上述运行时精确版本白名单。
   - 先行测试：F01-01、F01-05、F01-07、F01-16～18、F02-04。F01-01 是发布门红灯，不能提前只改 manifest 冒充功能完成。

5. **T-F01-5：完成接管、重试、子代理与生命周期防护。**
   - 技术路线：重试复用本步选择且不重复收集证据；手动改选立即使自身恢复写回失效。取消、dispose、session 切换、branch/resume 使用代次和会话所有权守卫；子代理沿用既有血缘判定，不把父 concrete 当子人工选择，也不向父写回。
   - 验收目标：Auto→manual→Auto 可往返；step/end 与 turn/end 之间的手动 max 不被覆盖；父 Auto/手动分别得到正确子行为；取消、prepareCall 中 dispose、旧路径 capability 未决时 dispose、session 切换与 branch/resume 后无陈旧选择、decision record、定时器或跨会话写入。
   - 先行测试：F01-04、F01-06、F01-11～15、F01-19～21、F01-24～25、F02-02～03、F02-06～07。

6. **T-F01-6：保留能力映射与请求安全。**
   - 技术路线：双路径复用同一 capability→rank→实际档量化结果，不重写分类器；不支持、空能力、off-only、allow-list 与 default/fallback 都走明确安全分支。实际请求只携带当前步 concrete 或安全省略值，遥测/Badge 继续区分逻辑模式与实际档。
   - 验收目标：allow-list 和 nearest-up 结果不变；普通 Auto 不发送 off，私有 auto 不到达适配器；unsupported 子代理安全省略继承档，不匹配父决策的子代理 concrete 保持人工档；显式固定子代理 off 直通。暂时能力失败不阻塞同步 claimed，恢复后不使用 poisoned cache。
   - 先行测试：F01-07、F01-09～10、F01-22～23、F02-04～05、F02-08，以及既有 routing/rank/capability 全套回归。

7. **T-F01-7：完成矩阵、构建和四级发布验收。**
   - 技术路线：施工期间分开运行旧基线与新红灯套件；实现后把 `test/f01/*.test.mjs`、`test/f02/*.test.mjs` 两个显式 glob 纳入 package script 与 CI，再同步测试数。真实宿主版本矩阵、构建、pack、plugin_check、Web/Desktop 逐级执行，不能用 fake host 替代实机。
   - 验收目标：当前目标为原 212 项 + 新 33 项，合计 **245/245**（若真实宿主合同测试加入默认套件则同步增加）；覆盖率、客户端产物一致性、包内容与版本元数据全通过。Web/Desktop 分别验证新旧宿主首步、续步、接管、禁用、unsupported、子代理、取消和重启。
   - 先行测试：完整新旧套件；红灯基线为 **33 项中 28 红、5 项既有行为回归通过，0 跳过**。发布前同步 README、ROADMAP、MAINTAINER-TESTS、CHANGELOG 与 COLLABORATION 的测试命令/数量。

#### F-02：整轮 Auto 语义已明确；问题来自 DSH 0.2.2 的请求装配顺序变化

**出品人语义：用户在一轮开始时选择 Auto，整轮就应持续 Auto 调度，直到用户主动改选。**

DSH 0.2.1 中，本项目可以在 `agent/request` 瀑布里先取得宿主请求，再把 Auto 换算为当前步骤的具体档。DSH 0.2.2-alpha.2 改为先在 step preparation 固定 `provider/model/reasoningEffort`，再调用旧的 `agent/request`；只要该钩子添加、修改或清除 effort，就会拒绝整个步骤。因此，现有“每步把 Auto 写成具体档”的路径会直接报错，连禁用后的剥离 Auto 也不例外。

公开迁移点是**在 step preparation 之前调用 `agent.model.select()`**；但 `agent/pre-step` 本身已经拿到捕获后的 selection，在那里调用 `select()` 只能服务尚未准备的后续步骤。当前可验证的公开组合是：有输入步骤在同步 claimed 段选档，普通工具续步在上一步 step/end 乐观预选，pre-step 只校验并在缺少公开 select 能力时 fail-closed；仅 terminal turn/end 按自身守卫恢复 Auto。`select()` 会留下 durable selection，因此必须同时保存“用户的逻辑 Auto 意图”和“单步实际执行档”，并承认无续步崩溃窗口无法由公开 API 完全消除。

F-01 已获批，技术方案必须满足：

1. 原生选择器在整轮结束/静置后显示逻辑 Auto，本产品记忆只保存逻辑 Auto；步骤间受控 concrete 预选必须能被自身 Auto witness 识别和恢复，不得被当成人工定档。
2. 每一步的具体执行档只服务当前请求，不得反过来成为下一步的人工选择证据。
3. 采用“自身决策记录证明 Auto 连续性 + 步后按守卫恢复 Auto”的组合；公开 API 不能保证崩溃任意瞬间 durable 日志都无 concrete，这一限制和 resume 保守回退必须明确验收。
4. 用户中途改选具体档必须立即接管，不能被记忆或 Auto 恢复覆盖。

**F-02 不再需要裁决产品语义；其实施已随 F-01 获批，并属于下一施工首要交付的一部分。**

#### F-04：不考虑 think-level 共存兼容（已关闭）

- 不做双方 autofill 协调、启动竞态适配、Auto 可见性适配、显式让位或联合 UX。
- 不安排原调研建议中的两项共存实测，也不新增互操作文档。
- 保持本项目独立交付与既有“无第二控制面”原则；原 F-04 工作项删除，不转入技术 backlog。

#### F-06：跨会话“上次档位”记忆已批准

需求契约已写入 [REQUIREMENTS.html](REQUIREMENTS.html#memory) 的 FR-070～FR-078，实施按 §4.3 独立功能包执行。F-01/F-02 已另行批准并先于本功能包施工；本项不扩大模型知识库、配置声明权或其他待定功能的范围。

### 4.3 F-06 实施功能包：跨会话“上次档位”记忆（已批准）

#### A. 保存什么、不保存什么

- 按 **provider + model** 保存最近一次**明确人工逻辑选择**：`auto` 或一个具体 selector effort，以及必要时间戳。
- **不得从 decision store 的实际执行结果反推偏好。**Auto 调度产生的 concrete effort、固定 default、子代理继承和宿主回声都不能更新记忆。
- 使用独立、可版本化的 profile-local preference 状态；可与现有 `.effort-router/` 生命周期共置，但与诊断 decision log 分字段/分文件，避免把两种语义混用。
- 默认开启，建议配置键 `rememberLastEffort`（默认 `true`），只允许配置文件控制，不新增设置 UI。不同 profile 不共享；删除插件数据时一并删除。

#### B. 恢复优先级与异常分支

| 场景 | 必须行为 |
|---|---|
| 当前会话已有明确人工选择 | 当前选择最高优先，立即生效并更新该 provider/model 的记忆 |
| 子代理有明确继承或显式覆盖 | 遵循血缘/覆盖，不用根会话记忆抢占，也不把继承写成人工偏好 |
| 当前模型有记忆 | 恢复 Auto 或具体档；Auto 在原生选择器中仍显示 Auto |
| 当前模型无记忆 | 使用现有 `defaultLevel`；未配置时才交给宿主默认，不从别的模型借具体档 |
| 记忆中的具体档不受当前模型支持 | 忽略该记忆并回退现有 `defaultLevel`，一次性提示；不得用 nearest 映射冒充人工选择 |
| Auto 每一步产生不同实际档 | 只改当前请求，不改变 durable Auto，也不更新记忆 |
| 用户中途改选 | 立即退出旧模式、覆盖旧记忆，后续不得自动切回 |

#### C. 测试先行的实施步骤

1. **T-F06-1：先写偏好纯函数与失败用例。**覆盖记忆读写、按模型隔离、只接受显式人工来源、非法/过期数据恢复、无正文与无跨 profile 共享。
2. **T-F06-2：接入显式选择来源。**复用现有人工/回声/血缘判定，确保只有真实人工选择写偏好；先证明 Auto concrete echo 不会写。
3. **T-F06-3：在新会话模型确定后恢复。**实现上表优先级，不阻塞原生选择器交互；恢复失败使用现有 default，不引入第二套 UI 状态。
4. **T-F06-4：保持整轮 Auto。**恢复 Auto 后，每一步仅换算实际档；连续步骤、工具调用和中途手动改选均不得破坏逻辑 Auto。
5. **T-F06-5：补配置与迁移。**默认开启、可配置关闭；旧版本无偏好文件时零迁移、按现有默认运行；状态结构有版本和损坏降级。
6. **T-F06-6：真实验收。**Web/Desktop 各验证 Auto 重启恢复、具体档重启恢复、双模型独立记忆、不支持档回退、子代理不污染、profile 隔离和删除清理。

#### D. 版本与依赖边界

- 这是**小功能演进**，正式交付时按协作规范提升第 3 位并将 rc 重置为 1；不得塞进纯 bugfix rc。
- F-01/F-02 先于本功能包施工；F-06 必须复用其“逻辑选择”状态，并在 0.2.1 与 0.2.2 两条路径共同验证，不能只针对旧路径恢复具体档。
- 完成标准新增：原生选择器、Badge、实际请求和持久偏好四者对“Auto vs 具体档”的表述一致。

### 4.4 待定名词解释

#### F-03：“自定义模型 fill ownership”是什么

它指**谁有权给一个手写自定义模型补上推理档位声明**。候选主体包括：本项目自动填充、用户在 Models 页手动管理、以及其他可能写同一配置的组件。当前项目只在“看起来从未配置”时补 `{low, high, max}`；一旦用户层已经拥有该模型，就跳过，避免把用户主动关闭重新打开。

难点是：配置里“没有档位表”可能同时表示两件事：

1. 用户从来没有配置过，希望插件补一套默认值。
2. 用户曾经在 Models 页主动关闭，系统通过删除档位表来表达关闭，希望以后都别再补。

这两种意图在外观上可能一样，所以当前策略宁可不填，也不愿覆盖用户选择。

#### F-03：“持久墓碑”是什么

持久墓碑不是删除模型，也不是一块真实文件墓碑，而是**随模型配置长期保存的一条否定性标记**，含义类似“这个模型已被明确处理过，后续自动填充不要再碰”。

示例：

1. 模型 A 最初没有档位，插件补默认值，并记录“这次由插件补过”。
2. 用户随后在 Models 页关闭推理档位；关闭动作保留/写入“不要再自动补”的标记。
3. 下次启动时，即使配置看起来又是“没有档位表”，插件看到墓碑就会跳过，而不会每次重启都复活档位。
4. 用户以后明确重新开启或清除标记，才允许再次自动填充。

其价值是区分“从未配置”与“主动关闭”。风险是：标记必须能穿过宿主 schema、Models 页保存和重启而保留；写错标记会长期阻止合法填充。因此先做只读持久性 spike，再决定是否采用。

#### F-05：“知识库”是什么

这里的知识库不是 RAG、文档检索或训练数据，而是**本地静态模型能力表**：按供应商/模型家族记录支持哪些推理档，以及每个档在供应商线上的实际拼写。例如“模型 A 支持低/高/最高，高档在网关上叫 ultra”。它用于弥补固定 `{low, high, max}` 无法覆盖的模型差异，代价是持续维护、版本陈旧和错误声明风险。

#### F-05：“raw /models 能力探测”是什么

**F-03 与 F-05 的关系：**二者共同背景确实是“模型真实可接收的 effort 词表与固定 low/high/max 不一致，需要识别并映射”。但 F-03 负责**配置声明权**——能否写、由谁写、如何尊重主动关闭；F-05 负责**能力发现来源**——从哪里知道真实词表与 wire 拼写。能力发现再准确，也不能自动获得配置写权限；拥有写权限，也不代表能力数据可靠。因此保留两个裁决编号，不合并实施。

它指**直接读取供应商模型列表接口的原始响应**，寻找其中是否包含推理能力或档位信息，而不是只读 DSH 已整理过的模型目录。DSH 的统一目录可能为了跨供应商一致而丢弃供应商特有字段，所以静态调研提出 raw listing 作为另一种信息来源。

- `raw` 指未经宿主归一化的响应，不是“原始模型”或额外下载模型。
- 应答应按三态理解：明确支持、明确不支持、没有足够信息；接口沉默不能直接当成不支持。
- 代价包括额外网络请求、供应商差异、鉴权/隐私、延迟和把非能力字段误判成能力声明的风险。F-05 是否承担这些复杂度延期再裁决，当前不启动实施。

### 4.5 其余功能裁决状态（不进入下一施工）

F-01 已批准并移入 §4.2 首要施工包，F-06 是另一条已批准功能主线。F-03、F-05 均为**中等重要、中等紧急、延期裁决**，有很高讨论价值；F-07 的 Auto 不改名已裁决，Badge 迁移与 F-08～F-12 均为**低重要、低紧急、延期裁决**。所有延期项当前保持不变，不进入下一施工。

| ID | 功能/策略问题 | 当前状态与建议 | 裁决后才可做的技术工作 |
|---|---|---|---|
| **F-03** | 自定义模型 fill ownership 是否改为持久墓碑 | **延期裁决 · 中等重要/中等紧急。**有很高讨论价值，暂时保持现状；未来先只读验证标记能否经 schema、Models 页保存/重载持久化。与 F-05 共享能力不一致背景，但此项只决定配置声明权 | 重新裁决后才做墓碑写入/迁移/清除、fill 判定、并发与回归测试；不可持久则回到 ROADMAP 选项 1/3 |
| **F-05** | 是否引入知识库 + raw `/models` 能力探测 | **延期裁决 · 中等重要/中等紧急。**有很高讨论价值，暂时保持现有能力来源；未来重新权衡维护、网络与假能力风险。与 F-03 共享背景，但此项只决定能力发现来源 | 重新裁决后才做按需加载、tri-state、同源探测、知识库优先级及绝不自动写 off |
| **F-07** | 是否迁移 Badge 到 `conversation.input.model.label`；插件 Auto 是否改名 | **Auto 不改名（已裁决）。**0.2.2 官方 UI 对省略 effort 显示 `Default`，不是 `Auto`，无同名字样冲突；不做 ID/存量选择/echo-guard 迁移。**Badge 迁移延期裁决 · 低重要/低紧急**，保留动态 Badge 与当前位置，不用静态 `model.badge` 替代 | Auto 名称无后续工作；仅未来重新裁决 Badge 位置时，才做跨版本显示适配 |
| **F-08** | 是否调整 ramps、error/repeat、frugal、budget 或词典 | **延期裁决 · 低重要/低紧急。**全部保持现状；未来以 T-12 独立样本和 outcome 重新讨论 | 裁决后才修改默认值、词典或配置，并做 shadow/反事实对照 |
| **F-09** | 是否启用 512KiB gzip cap + raw fallback | **延期裁决 · 低重要/低紧急。**维持现状；未来出现 >8ms 或 ≥1MiB 真实结果时再讨论 | cap、raw fallback、映射语义变化与性能/路由回归 |
| **F-10** | 是否给子代理固定节俭降档增加 opt-out | **延期裁决 · 低重要/低紧急。**维持固定行为；未来出现实际用例再讨论 | 若批准，新增 schema/default/文档与父子代理测试 |
| **F-11** | 是否处理重启重放首桶与 manual-off 精确关联 | **延期裁决 · 低重要/低紧急。**继续接受残留并维持现状；未来有实际影响证据再讨论 | 持久 watermark/时间衰减，或 record↔message 延迟关联 |
| **F-12** | 是否公开研究产物、升级挖掘 schema v2 并重跑冻结基线 | **延期裁决 · 低重要/低紧急。**维持私有和现有格式；`TEXT=0` 不是脱敏；未来再讨论公开或重跑 | 显式全字段 redact、公开脱敏聚合摘要，或 schema v2/冻结算法/全量重挖 |

### 4.6 明确不建议引入的方向

- 不采用社区插件的大型单体、巨型文件或与其规模对齐的“功能补齐”路线。
- 不用 DOM 注入替换官方模型选择器，不在 Composer 再建滑条或设置页。
- 不引入密钥池、余额、生图、自动继续、指纹等与 effort 路由无关的功能。
- 不用静态官方 model badge 代替本步实际 effort/mode。
- 不把测试数量、DOM 快照规模或覆盖率本身当作架构质量目标。

---

## 5. ROADMAP / 项目记忆遗漏核对

| 来源 | 原事项 | 当前核对结论 | 计划位置 |
|---|---|---|---|
| ROADMAP Deferred calibration | 体积斜坡、词典 shadow “尚未运行” | 首轮已跑完，文档过期；真正遗留的是**独立第二周期与 outcome** | T-09、T-12、F-08 |
| ROADMAP gzip | `gzipSync` 同步尾部风险 | 首轮实测无生产阻塞；先观测，不直接 async/cap | T-08、F-09 |
| ROADMAP custom fill ownership | 未配置与用户关闭同形 | 仍是开放功能决策；两份调研中的墓碑方案可与原选项 2 合并评估 | F-03 |
| ROADMAP R5 residual | 子代理节俭固定开启 | 未遗忘，当前无新证据要求变化 | F-10 |
| ROADMAP R6 residual | 重启后历史错误首桶权重 1 | 已缓解、残留接受；未遗忘但不值得无证据改造 | F-11 / A |
| ROADMAP R2 residual | manual-off 与具体 tool message 未精确关联 | 罕见、可逆、保守方向；继续接受 | F-11 / A |
| ROADMAP Maintainer UI gate | chatAnnotate 只有静态缝核对，轨迹视觉需人工验收 | 仍需一次集中人工复测，不是每版开发任务 | T-09 验收记录、发布闸门 |
| T6 / 项目记忆 | 连续两周期零命中剪枝、`参考/项目/你是`观察、`代理/读取`候选 | 第一周期后未达执行条件；淘汰仅指不加入候选，不是从现有词典删除 | T-12、F-08 |
| 7 天研究 | decision store suffix 偏倚、outcome 缺失、压力/todo 有效样本不足 | 属于观测与样本债，不能直接推出调参 | T-08、T-12 |
| 兼容性调研 | engines 允许实际上不兼容的 0.2.2 | F-01 已批准为重要且紧急；下一施工同时完成双路径、整轮 Auto 与版本门修正 | T-01；F-01/F-02 首要施工包 |
| 社区插件调研 | autofill/UI 冲突与 Auto 可见性 | **已裁决不考虑共存兼容**；不再安排实测、让位或互操作工作 | F-04（关闭） |

---

## 6. 建议批次与验收出口

### 批次 A：DSH 0.2.2 双路径与整轮 Auto（F-01/F-02 已批准，首要且紧急）

1. **测试已经先行：**33 项新测试及 28 红 / 5 绿证据已登记在 §0.1 和 §4.2；施工者先复现同样红灯，再按 T-F01-1～T-F01-7 实施。不得先改生产代码后补测试，也不得删除红灯或标记 skip/expected-failure。
2. 第一步用真实宿主公开行为探针确认公开运行时版本分派、同步 claimed 选档 + step/end 预选续步 concrete + pre-step 校验 + terminal turn/end 恢复 Auto 的组合；保留 0.2.1 单路径。T-01 的版本门随实际适配结果调整，未完成矩阵前不得放宽 engines/peer。
3. 本批次只交付 F-01/F-02 及直接相关的 dispose/版本门安全修复；**不提前实施 F-06**，只保留其所需“逻辑选择而非实际档”的接口语义。F-03/F-05、F-07 Badge 与 F-08～F-12 均不启动。
4. 验收首步、工具续步、同轮换档、手动接管、重试、禁用插件、unsupported、子代理、取消/重启；两条路径均不得出现请求契约拒绝或 Auto 泄漏。崩溃瞬态 concrete 的公开 API 限制必须如实记录，不得私改宿主对象规避。
5. 构建、全量测试与覆盖率、pack、插件元数据检查；Web/Desktop 分别完成新旧宿主安装与实机验收。当前自动化出口为 245/245，若加入更多合同测试则同步更新数量。
6. 同步 REQUIREMENTS、README、ROADMAP、MAINTAINER-TESTS、CHANGELOG、COLLABORATION；push/tag 仍需出品人另行批准。

### 批次 B：当前支持范围内的技术修复

1. T-02～T-06、T-H1～T-H4、T-H6～T-H8；每项先红灯后修复，避免把多个 bug 塞入一个无差别重构。T-H5 等可靠 generation 契约确认后进入后续批次。
2. 同步 T-09 的可公开文档项；出品人验收记录只登记事实，不代签。
3. 与批次 A 共用构建、测试和双宿主验收阶梯；如果与迁移共享代码，必须先证明两条路径都通过，不能只在旧宿主验证。

### 批次 C：观测与契约保障（可并行准备，不抢先发布）

1. T-07、T-08、T-10、T-11、T-13、T-14、T-H5；T-16/T-17 仅在行为等价与基准收益成立时合并，T-18 单独清理。
2. 证明观测不改变既有行为基线及决策输出；新增字段有版本兼容策略。
3. 用真实宿主契约探针补足 fake-host 盲区，而不是只增加 mock 数量。

### 批次 D：跨会话“上次档位”记忆（F-06 已批准，独立小功能版本）

1. 按 §4.3 的 T-F06-1～T-F06-6 测试先行实施，不与纯 bugfix rc 混合。
2. 复用批次 A 的逻辑 Auto 状态；先完成偏好来源、恢复优先级和整轮 Auto 的双路径自动化矩阵，再进入 Web/Desktop 实机。
3. 验收必须覆盖：Auto 与具体档重启恢复、双模型隔离、不支持档回退、用户中途改选、子代理不污染、profile 隔离和删除清理。
4. 同步需求文档、README、配置说明、MAINTAINER-TESTS、CHANGELOG；版本按小功能规则提升第 3 位并重置 rc。

### 批次 E：独立周期研究

1. T-12 只读收集与 shadow；仅为未来 F-08/F-09 讨论准备材料，不代表这两项已恢复实施。
2. 未经重新裁决，不把研究建议合并进生产默认值。

### 批次 F：待定与延期项（不进入下一施工）

- F-03/F-05 为中等重要、中等紧急但延期裁决，当前不启动只读 spike、能力探测或实施；共同背景不等于合并裁决。
- F-07 的 Auto 不改名已裁决，无命名迁移工作；Badge 位置迁移为低优先延期项，不启动实施。
- F-08～F-12 均为低重要、低紧急、延期裁决，暂时保持不变，未来有讨论价值时重新评估。
- F-04 已关闭且不再转入任何批次。

---

## 7. 完成定义（Definition of Done）

一个技术任务只有同时满足以下条件才可标记完成：

- [ ] 红灯回归证据与最小实现齐全；没有为通过测试而改坏断言。
- [ ] 既有手动/Auto/off/unsupported/子代理安全矩阵无回归。
- [ ] 构建产物与源码同批更新；依赖声明变化时 lockfile 同步且 frozen install 通过。
- [ ] 全量测试数、覆盖率、打包和插件元数据检查有实际输出。
- [ ] Web/Desktop 按阶梯验证，实机结论明确区分“已验 / 未验 / 阻塞”。
- [ ] 公开文档无个人隐私或机器专属信息；ROADMAP 中已知残留没有静默消失。
- [ ] 功能裁决项没有混入技术批次；版本、CHANGELOG 和 README 同步。
- [ ] 本地 commit 与远程 push/tag 分开报告；push 前再次获得出品人明确批准。
