# dsh-effort-router 下一阶段开发计划（决断定稿版）

> 状态：规划与测试先行阶段；尚未施工生产代码。
>
> 当前发布基线：`0.2.17-rc.1`，原标准命令 `node --test "test/**/*.test.mjs"` 为 **245/245**。
> 下一施工版本：`0.2.17-agent.1`。本文件取代此前的 A/B/C 降级方案与插件 F-06 建设方案。

## 1. 本轮目标与已锁定边界

1. **G-01 已选 D：** DSH 0.2.2 不再依赖 `step/end` 后补写选择；按 Agent 包装 `model.current()`，把原生逻辑 Auto 同步解析为本次 capture 的 concrete effort。完整保留逐步 Auto，不做安全降级，不修改宿主。
2. **G-02 已选原生全局记忆：** 使用 DSH 原生最近全局 `provider/model/reasoningEffort` 选择；F-06 冻结，不开发插件偏好库、`rememberLastEffort` 配置或 provider+model 记忆表。
3. 先红后绿。测试必须执行真实行为或真实宿主时序；不得用文本检查冒充行为，也不得为了保留旧实现断言而要求新路线继续 `model.select()`。
4. 保留 0.2.1 legacy、手动直通、普通 Auto 不路由 off、profile 隔离、客户端只读、bundle 装载和无设置 UI。
5. 不无证据重写 gzip、轨迹投影、增量 DOM、store 或分类器；本轮只做计划、文档与测试，实际 push/tag 仍需出品人批准。

## 2. 审查结论与截弯取直方向

| 优先级 | 证据与根因 | 需求影响 | 已定修复方向 |
|---|---|---|---|
| P0 | 真实 0.2.2 loop 在 `agent/pre-step` 前 capture `model.current()`；`lib/turn-auto.js:224-238` 又在 append publish 内预选下一步，microtask 重试晚于下一次 capture | FR-040、FR-060；续步计划值不是请求实际值 | 在 capture 本身同步解析；移除逐步 `model.select`、step/end 预选和 turn/end 恢复，不再修补 append 时序 |
| P0 | `lib/index.js:900-1033` 主要按 claim 记录，continuation 没有独立实际记录 | FR-042、FR-060 | 每次 capture 只调度一次并记录实际 effective selection；request/header 用于一致性证据，不二次调度 |
| P1 | `lib/signals.js:400-409` 按行比较 claim，`:680-692` 按完整消息累加 | FR-010、FR-013 | 统一为完整消息/消息身份的一次性消费，不再增加逐行特判 |
| P1 | `lib/routing.js:45-50` 全未知分支取整，已知锚点分支使用严格插值 | FR-017 | 统一严格全序数学表达，保持 1..7、去重和 allow-list |
| P1 | 数字向量在 `lib/index.js:275-278` 与 `lib/policy.js:413-417` 双重且不同语义清洗 | 配置与告警真实性 | 配置边界一次严格整组解析；policy 不再抢救部分合法值 |
| P1 | `lib/policy.js:229-247` 声明词干，`:383-394` 却给所有英文词加双侧词边界 | FR-010 | 只对显式词干做受控前缀匹配，不扩词典、不改阈值 |
| P1 | resumed fallback 把 source-less user-role tool-result 当 brief；旧测试锁定该行为 | FR-010 | 真实用户文本优先；纯工具结果只表示恢复工作 |
| P1 | subagent 事件在开关关闭时仍累积，重开后 replay | FR-014 | 与 compaction/todo 一致：关闭即清空并重置水位 |
| P1 | `lib/capability.js:145,168-176` marker 与函数所有权脱节 | FR-005 | active flag 停用旧 wrapper；dispose 不覆盖第三方后包装 |
| P1 | `lib/runtime.js:73-83` 把所有 app-boot import 错误都解释为 0.2.1 | fail-closed | 只有目标模块自身 `ERR_MODULE_NOT_FOUND` 才 legacy，内部错误原样抛出 |
| P1 | 自定义模型两个入口重复解析，user provider `compat=false` 未优先 | FR-050～053 | canonical key 去重；先合并用户限制再补默认 |
| P1 | store 浅验根对象，坏行到 record 才爆，`__proto__` 可写原型 | NFR-003 | 行级 plain-object 校验、告警跳过、own/null-prototype 存储 |
| P1 | 三处 fetch 无取消；全局 style 不归 effect 所有；chip 仅鼠标 | FR-005、NFR-004/006 | 在现有 owner 中 abort；style 可更新且按 ownership 清理；补完整键盘语义 |
| P2 | CI 只 install/test | 交付真实性 | 增加 build、pack/diff、超时和最小权限 |

### 明确不重写的部分

- `src/client/trajectory.ts:493-601` 的增量 observer、WeakMap、rAF 与 DOM cleanup 保留。
- 同步 gzip 首轮压缩 p99 约 0.417ms，无生产阻塞证据，不引入 async zlib 或全局限额。
- longWindow 的 N 个 sealed + 1 个 open brief 有既有测试背书，不改窗口语义。
- F-06 原 20 项逐模型偏好测试不再是指引施工的红灯；它们改写为原生全局选择兼容契约。

## 3. 下一阶段任务、技术路线与验收

### T-01　现代 `current()` 同步解析与连续步真实记录（P0）

- **路线：** 以真实 0.2.2 harness 锁定 append 重入锁、`step/end → 下一 preStep` 无等待顺序、capture 早于 pre-step 及 claimed=[] 的工具续步。现代控制器按 Agent 保存 bound raw `current()`，并仅在 `turn/start` 后的真实 capture 窗口把 raw Auto 同步解析成 effective concrete；回合外 current 保持原生逻辑选择。raw concrete 直通，插件内部规划只读 raw selection，避免递归和人工误判。
- **截弯取直：** 新路线生效后，不再为每个 Auto step 调 `model.select()`，删除 step/end 预选、pendingWrite/retry 和 turn/end Auto 恢复。原生 pending/logical Auto 不因 concrete request/header 被清除；徽标继续表示 Auto，记录和轨迹使用本步 concrete。
- **先行测试：** 连续步实际 `['low','medium']`、每步 store 实际值、同一 capture 重复 current 不重复收集/记录、raw Auto 跨 header 保留、手动 concrete/off 即时接管、default/subagent/disabled/unsupported、无 select 但可 current 的宿主正常工作、无 current 或仍捕获 Auto 时 fail closed、dispose/HMR/第三方 wrapper 所有权。另测回合外 `applyConfiguredRoute` 读取 current 后仍恢复 Auto，不把 effective concrete 固化进原生选择。旧 F-01/F-02 中依赖补写和轮末恢复的断言同步改成新契约。
- **验收：** 不修改宿主、不发逐步 model/selection 写事件；立即续步的 capture/request/store 一致，Auto 不泄漏，手动接管不被后续 capture 覆盖，回合外公共 current 语义不被改写，卸载恢复原方法且旧 wrapper 不再调度。

### T-02　证据链与 rank 正确性（P0/P1）

- **路线：** 修复多行 claim/projection 重复计量、resumed tool-result、subagent 关闭期积累；统一全未知 efforts 的严格全序。保留有界窗口和公开导出。
- **先行测试：** 多行 brief 只开启一次且体积/warmup 不重复，不同 turn 同文仍各算；1/2/3/4/5/6/8 个未知 ID 全可达；工具结果不成为 origin；开关重开不 replay。
- **验收：** origin、briefVolumeRaw、warmup、rank/mapping/final effort 全符合断言；单行、已知锚点、重复 ID、allow-list 与三种 fallback 不回归。

### T-03　配置解析与英文词干（P1）

- **路线：** 数字字符串向量严格整组解析；显式 migrat/optimiz/diagnos/integr 等词干使用受控前缀匹配。其余词表与分类阈值不动。
- **先行测试：** errorDecay/briefRamp/toolRamp 的混合非法、空片段、全非法、负值、重复 rung、CJK 分隔符及告警；词干原形/派生词和 capital≠api 等反例。
- **验收：** 非法向量使用对应默认并告警；派生词命中而普通完整词不错误扩张。

### T-04　宿主装配、模型填充与存储硬化（P1）

- **路线：** wrapper active ownership；runtime import fail loud；custom-model 合并限制后按 key 去重；store 行级校验与原型安全。每项独立小改，不合并成重写。
- **先行测试：** 第三方包装后的重 apply/dispose、目标缺失/内部 throw/嵌套依赖缺失、compat=false、models[]/overrides 同 key、malformed JSON、scalar/array/null row、`__proto__`。
- **验收：** 卸载后不再注入 Auto，不覆盖第三方 wrapper；坏行可跳过且后续可写；profile 隔离与 compact JSON 保持。

### T-05　冷缓存首轮能力预热（P1）

- **路线：** 复用 `lib/capability.js` 的 resolve/peek/generation，把 fire-and-forget prime 前移到公开 `model/selection` 或 `agent/created`；`current()` 和 claimed 仍只同步 peek，不等待网络。
- **先行测试：** 新会话首轮不靠测试 helper 人工预热即可 Auto；失败不缓存、provider/model 切换 generation、dispose 后不回写。
- **验收：** 首次选模型后的首轮即可调度；保留 claimed/current 不 await 契约；Web 实机核对原生选择器、请求和日志。

### T-06　客户端资源、HMR 与键盘语义（P1）

- **路线：** Badge/trajectory/config 三处 fetch 在现有 effect/cleanup/session owner 中增加 AbortController；chip 增加 role/tabIndex/Enter/Space 与 focus-visible；styles 纳入 effect 所有权并允许 HMR 更新。
- **先行测试：** cleanup/session change abort 且 stale 不回写；键盘与点击等价且 preventDefault；style 更新、重复 apply 与卸载归属。
- **验收：** 不改变轮询频率、session guard、增量 DOM 与默认只读界面；键盘焦点可见，无重复监听和残留样式。

### T-07　DSH 原生全局选择兼容（F-06 冻结后的验收包）

- **路线：** 不新建 preferences store，不增加 `rememberLastEffort`。只让插件正确消费原生恢复的 concrete/Auto：concrete 按人工直通；Auto 在 modern 经 T-01 持续解析、在 legacy 走既有 request 调度；插件不写第二份全局或逐模型偏好。
- **先行测试：** modern+legacy 的原生 concrete/Auto 新会话与重启、Auto 不泄漏、手动改选优先、原生选择缺失时的既有 default、自动输出/default/子代理不写回、切换模型不恢复旧模型独立偏好、profile 隔离且无正文。
- **验收：** FR-070～078 按修订后的原生语义通过；同值 no-op 不伪造插件事件；原生全局记忆的清理由 DSH 负责，不再要求删除插件数据清除它。
- **实机门：** Web/Desktop 验证原生选择器在重启后显示最近 Auto/concrete；Auto 下选择器保持 Auto，Badge/轨迹显示各步实际档。若原生行为与代码契约不符，回报宿主差异，不另建插件偏好库绕行。

### T-08　工程闭环与文档对齐（P2）

- **路线：** CI 增加 build、pack/files、bundle diff、timeout、contents:read；清理临时目录与固定等待；更新 ROADMAP、MAINTAINER-TESTS、README/CHANGELOG/REQUIREMENTS 当前基线。
- **验收：** 标准测试、Node 22.19/24 × ubuntu/windows、build、pack、生成物一致；文档不再宣称旧 step/end 预选满足连续步，也不再把 F-06 描述为待开发插件功能。

## 4. 后续 backlog 与触发条件（不属于本轮施工 todo）

- **R-01 第二周期校准与私有研究：** 独立会话联合 targetRank/mapping/final effort；session-mining 先修脱敏说明、stale source 隔离和 INCONCLUSIVE/失败退出语义，原始正文不进公开仓库。
- **T-H5 同对象 branch rewrite：** 真实触发与可靠 generation 未证实；禁止用 length shrink 粗暴清零。
- **gzip 单 buffer、分类器 lazy clues、scan 复杂度：** 只有基准收益且全行为等价才合并，不写伪正确性红灯。
- **F-03/F-05：** 继续延期；**F-06：** 冻结，除非出品人明确重开；**F-07 Badge、F-08～F-12：** 保持低优先；**F-04：** 已否决。

## 5. 版本与交付阶梯

1. 本阶段施工从 `0.2.17-agent.1` 起；agent 修改可递增最后一段。
2. 出品人明确指示 push 时，按新规范 patch+1、agent=0，即 `0.2.18-agent.0`；不得由 agent 自行升 minor/major。
3. `package.json`、双语 README、CHANGELOG 当前版本同步；DSH 的 rc 宿主区间原样保留。
4. semver 中 `agent < rc`，同基三位不能被 npm 视为升级；本地精确 tarball 可用，对外发布通过 patch 推进消除歧义。
5. 每批执行：红灯证据 → 标准测试 → build/pack → Web 安装与 RPC 实机 → Desktop/出品人验收。
6. **实际 push/tag 前必须再次取得出品人批准。**

## 6. 测试先行移交说明

- `test/optimization-host.test.mjs`：真实连续 capture、raw/effective Auto、实际记录、runtime、capability/custom-model/store、冷缓存。
- `test/f01/**`、`test/f02/**`：保留行为编号，移除对逐步 model.select、step/end 补写和 turn/end 恢复的旧实现耦合。
- `test/optimization-engine.test.mjs`：claim/origin/subagent/rank/config/词干。
- `test/optimization-client.test.mjs`：abort、键盘与样式生命周期。
- `test/f06/preferences.test.mjs`：仅保留原生全局选择兼容；原逐模型自建偏好红灯全部移除。
- `test/version-policy.test.mjs`：下一施工版与文档/宿主区间约束。
- `test/signals.test.mjs`：修正原先把 resumed tool-result 当 trivial brief 的错误断言。

**最终红灯基线（2026-11-16，Node v24.22.1）：** 标准命令实测 **320 tests / 259 pass / 61 fail / 0 skip / 0 cancelled**。61 个预期红灯为：F-01/F-02 的 D 新契约 12；`optimization-host` 20（D 契约 6、runtime 2、H1 2、H8 6、H7 2、H6 1、冷缓存 1）；`optimization-engine` 18；`optimization-client` 7；修正后的 resumed tool-result 1；版本治理 3。原生全局选择兼容 **12/12** 为绿；unresolved Auto fail-closed 与无 `current()` 的 Agent 防护也为绿。测试语法和 `git diff --check` 已通过，生产代码未改。

施工者先运行定向红灯，再运行标准全套；逐组修复后更新本文件的实际计数与实机证据。G-01/G-02 已决断，不得再自行改成安全降级、宿主补丁或插件逐模型偏好库。
