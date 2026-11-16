# 开发计划 — 0.2.18-agent.2（已施工，待产品出口验收）

> 状态：**T01–T08 已施工，自动化 369/369 绿；Web RPC 与 Desktop 动态 Auto 冒烟均已通过，Desktop 安装后完整重启并验证轮末零写回；产品出口视觉与剩余边缘矩阵待出品人验收**。基线为 `0.2.18-agent.1`；本轮只修有复现证据的行为缺陷，不做感觉型重写。实际 push/tag 须出品人另行批准。
>
> 需求优先级：`REQUIREMENTS.html` > 已批准技术路线 > `ROADMAP.md` > 旧测试与旧注释。旧测试若锁定与需求冲突的行为，应按需求改写，不得为了保绿继续保留错误行为。

## 1. 审查结论

1. **继续 current() 同步 capture，不恢复逐步 select。** 需要截弯取直的是同一步 raw revision 变化后的 `null`、modern 轮末 `restore:'auto'`、以及把 store 遥测当人工接管证据的残留；不是推翻 capture 路线。
2. **modern 与 legacy 继续分开。** modern 以原生 raw selection/pending 为事实，legacy 保留 request interceptor 与既有 echo 兼容。不得为减少重复代码把两条路径重新合并。
3. **brief 去重应是物理 occurrence 的一一认领，不是全局文本布尔。** 当前同文第二条真实消息会被吞，projection-first、projection-only 与 replaceGeneration 重放均受影响。
4. **anchors 已有 finished 缓存，但 merged fallback 绕过了它。** 另外，100 项 `sessionRefs` 引用被误当作永久 live，导致 finished 缓存持续失效；这里应接回已有缓存，不是另建缓存系统。
5. **客户端只需局部清理与休眠。** 同一 `tr` 被移除重插会遗留旧 caption；hidden 文档仍扫描并续期。保留现有 observer、generation、single-flight 与 per-root 隔离，不重写客户端。
6. **不做无证据重写。** gzip、store debounce、signals ring、anchors 上限、分类词典、徽标轮询及 skin 观察器均保留。`poll-guard.js` 的 `updateHint/hint`、`ids.js` 的 `sessionIdFromUrl` 是生产不可达残留，但纯删除不与本轮行为修复混改，另做小步清理即可。

## 2. 施工任务与验收目标

### T01 — 同一步选择 revision 变化必须重新 capture（P0）

- **技术路线：** `lib/turn-auto.js` 的 raw selection 变化时，只作废旧 capture 及其恢复状态，再按新的 provider/model/effort 走正常 capture；Auto→manual 仍立即直通，Auto(模型 A)→Auto(模型 B) 则重新规划并缓存新结果。相同 raw 的重试继续复用，真正 unresolved Auto 的 pre-step fail-closed 守护不变。
- **验收：** 在真实 `runStep → pre-step → request` 链中，第一次 capture 为 high 后切换到另一模型的原生 Auto，最终请求使用新模型和 concrete high，private Auto 不泄漏且不 reject；重复 `current()` 不重复调度。

### T02 — modern 人工所有权与原生 Auto 零写回（P0，路线截弯取直）

- **技术路线：** modern 不再用 `store.last` 遥测反推 concrete `lastUsed` 是插件 echo；没有真实原生 Auto pending 时，它就是人工选择。删除 scheduled modern 的 `restore:'auto'` 及轮末 `model.select(auto)`，但保留人工不支持档的 `restoreDurable`；legacy 的 `isSelectionEcho` 与 request 写法不动。
- **验收：** Auto 首步得到 low 后，用户在同一步改选 low 且 pending 被 request 消费，后续工程轮仍保持 low；concrete `lastUsed` 恢复后不借旧 decision 重调度。原生全局 Auto 连续两轮 `selectCalls=0`、`selectionEvents=0`，人工不支持档仍能安全省略并恢复。

### T03 — 同文 brief 按 occurrence 双向认领（P0）

- **技术路线：** 在 `lib/signals.js` 用有界的待认领 occurrence 计数/队列替代全局 `claimed` 文本布尔；projection 消费一个匹配 claim，迟到 claim 也只消费一个 projection brief，不能再额外留下会造成后续误去重的记录。沿用现有 longWindow 生命周期、多行消息归一化、warm-up 与 replaceGeneration 原子重建。
- **验收：** projection-only 的两条同文真实消息计两次；projection-first 两条同文消息与两个迟到 claim 仍只计两次；replaceGeneration 从 0 重放两条同文消息也计两次。既有 claim-first/projection-first 单条物理消息不双计，late claim 不重复重启 warm-up。

### T04 — finished anchors 统一走 cachedSnapshot-first（P1，性能截弯取直）

- **技术路线：** `lib/index.js` 的 merged candidates 复用 `cachedAnchorsOfSession`，cache miss 才读持久日志，不再每轮对 capped 8 个会话全部 `stateOf/readSession`。stored 查询只被真实 live projection 活动失效，100 项 hook/session 引用本身不代表 live；保留 stored→live→stored 失效、64 项 LRU、5 秒失败退避与 single-flight。
- **验收：** 8 个 finished 会话连续两轮 merged 查询，`readSession` 总调用保持 8 而非 16；被 hook 记住但已 finished 的会话两次 stored 查询只读 1 次且 projection 读为 0。已有 live 恢复、错误退避、hint 与 unknown-session 防串绘测试全部不回归。

### T05 — trajectory prune 必须同时清理真实 DOM（P1）

- **技术路线：** `src/client/trajectory.ts` 的 `pruneRow` 复用 `shedRow` 的 caption、`DONE_ATTR`、pending 清理，再释放 `anchorIds/captions` 等行状态；不改 decorator 主流程。清理只作用于 owning root，不能碰并排会话的同名行。
- **验收：** 同一 `tr` 在 high caption 存在时被移除，再以 medium anchors 重插，旧 caption 已删除且最终只有一个 `#1 · … · medium`；B root caption 保持不变，普通 sweep/dispose 不回归。

### T06 — hidden 时休眠，visible 时按 root 单次唤醒（P1）

- **技术路线：** visibility 判断前移到手写行扫描和 AbortController 创建之前；hidden 不创建新轮询计时器，visible 时由 decorator 级共享 listener 唤醒各 live root。保留 per-root single-flight/abort，最后一个 root 清理后移除 listener，不为每个 root 各挂一个全局监听器。
- **验收：** hidden tick 的行扫描、请求和 timer 增量均为 0；visible 后 A/B 各新增且只新增 1 次请求，重复事件不突破 single-flight；dispose 后 listener 为 0，迟到响应仍不能重绘。

### T07 — 文档与验收证据清直（P1）

- **技术路线：** 同步修正 `lib/turn-auto.js`、`lib/index.js` 中仍描述 modern durable select 的旧注释，以及 README/MAINTAINER-TESTS 中“人工后下一轮自动恢复 Auto”的 modern 旧表述；明确 legacy 可以有不同恢复语义。实机记录统一写插件版本、DSH 版本、Web/Desktop、commit、session、时间、预期/实际和是否完整重启，不再把不同版本的证据混成一行。
- **验收：** 文档不再与 FR-041/073/076 冲突；旧 Desktop 与 legacy 待验项明确标为待验，不用 Node 测试冒充实机。纯注释/文档修正不伪造产品红灯。

### T08 — 构建、实机与交付验收（P0，最后执行）

- **技术路线：** 依次执行全量测试、`pnpm build`、真实 pack 与 `plugin_check`，再按 `MAINTAINER-TESTS.md` 做 Web 安装/RPC 和 Desktop smoke。成熟项目 Web 预算 15 分钟；环境阻塞如实记录，不能用单元测试替代实机结论。
- **验收：** 标准测试全绿、0 skip，bundle 与源一致、tarball 完整。实机至少覆盖连续 Auto、同一步人工接管、跨轮/重启人工保持、双模型 Auto 切换、finished history、多会话轨迹与后台标签休眠；版本保持 `0.2.18-agent.2`，不自行 push/tag。

## 3. 已写好的测试与红灯基线

- `test/next-host.test.mjs`：同一步 Auto 模型切换、已消费人工选择在后续轮不借 store witness、原生 Auto 连续轮零 select。
- `test/f01/dual-path.test.mjs`、`test/f02/turn-auto.test.mjs`：旧 concrete-lastUsed 合同按 FR-073 改为人工保持；这两项是改向后的需求红灯，不是装配错误。
- `test/helpers/host-0.2.2-harness.mjs`：新增 `run.afterFirstCapture`，在真实 runStep 内复现第一次 capture 后的原生选择 revision。
- `test/f01/legacy-path.test.mjs`：rc.2/rc.5 连续 Auto、人工接管、再次 Auto 与人工不支持档省略；这是现有行为的绿色正向控制，禁止被 modern 清理误伤。
- `test/next-engine.test.mjs`：projection-only、projection-first+late claims、replaceGeneration 三组同文 occurrence 红灯。
- `test/index.smoke.test.mjs`：merged finished 缓存复用、hook-remembered≠永久 live 两项红灯。
- `test/optimization-client.test.mjs`：同 `tr` 重插无 orphan caption、hidden 零工作、visible 双 root 单次唤醒；只扩展 fake timers/document 夹具。

**基线：** 施工前原始全套为 **356/356**。当前标准命令 `node --test "test/**/*.test.mjs"` 实测 **369 tests / 356 pass / 13 fail / 0 skip / 0 cancelled**：宿主 5、brief 3、anchors 2、客户端 3；legacy 新增 2 项正向控制为绿。施工目标是同批 **369/369**，不得 skip、删除红灯或把测试装配错误算作产品缺陷。

## 4. ROADMAP 后续与出品人决策门

### R01 — 第二周期校准：先做数据合同，不直接调参

- 建议先定义不含正文的 session/turn/step 决策索引、累计直方图与 outcome 标注合同，再收集独立第二周期样本。现有 20 decisions/session、200 sessions 裁剪会丢失分布，不能假装是全量样本；词典 shadow 与任务 outcome 也需要额外证据，不能由错误数推断。
- 是否增加本地无正文聚合采集、保存周期与人工 outcome 标注方式，需出品人批准后再写实现测试。没有新样本前不改词典、gzip 或 ramp。

### R02 — F-03 自定义模型写权限：建议本轮保持现状

- 建议继续“确认无档才补写、永不覆盖 user layer、未知只诊断”，不引入隐式 tombstone，也不在本轮把默认行为改成 opt-in。若真实出现“用户删除后又被回填”，再在持久 tombstone、显式写开关之间裁决；这属于新权限语义，须先批准再写测试。

### R03 — F-05 能力来源：建议宿主事实优先，静态知识库兜底

- 已解析宿主能力仍是第一事实；若宿主长期缺少元数据，再评估仓库内、可审查的静态知识库。暂不接动态供应商列表或网络注册表，不自动覆盖用户限制；是否值得承担静态库维护成本由出品人决断。

### 暂不进入本轮

- F-07 徽标迁移、F-08 词典校准、F-09 gzip、F-10 子代理 frugal 新开关、F-11 重启旧错误关联、F-12 研究公开/脱敏。没有新实证或独立产品裁决，不提前写实现代码。

## 5. 明确不做

- 不推翻 current() capture，不恢复逐步 concrete `model.select()`，不删除人工不支持档恢复。
- 不为“代码好看”合并 modern/legacy，不重写 gzip、store、signals ring、anchors projection 或客户端 observer。
- 不把 store 决策遥测当作原生人工选择事实，不建立第二份模型偏好库。
- 不提前实施 F-03/F-05，不新增设置 UI，不扩大客户端写权限。
- 不在本轮改 minor/major，不自行 push/tag。

## 6. 交付状态与出品人验收

- **代码与自动化：** 提交 `79adfa3`，并在交付复核后以 `c8089d9` 清理一处生产调试残留；标准命令 **369/369、0 skip**；`pnpm build` 产出 `lib/client.js` 32,761 bytes。
- **发布包：** `artifacts/dsh-effort-router-0.2.18-agent.2.tgz`（20 files，SHA256
  `8A5C683AC39DC04AE8D8375225F5014DDA81845F1909A628C81BD751C76F7727`）。
- **Web 已验：** 完整重启后安装 `.2`，13 个 `lib/*.js` 哈希与源码一致；清理调试残留
  后重新安装最终包并通过 RPC 读取 modelCatalog（13 个 auto 入口）。连续 Auto
  `session-f65bf558…` 三步均为 `auto/low`，宿主日志只有建立时一条显式 `select auto`，
  `turn/end` 后无补写；人工接管 `session-7b2c00e9…` 在 step 1 后显式切 `high`，
  后续步及下一轮保持 `manual/high`，无回写 `auto`。
- **Web 证据限制：** 人工接管会话的 step 1 被分类器判为 `high`，并非“从 low 接管”；
  后续档位来自插件 full 视图，宿主只记录了 step 1 的 `request/header`。报告未把缺省
  header 当作通过。
- **Desktop 已安装：** 2026-11-17 04:22（Asia/Shanghai），出品人重启 Desktop 后，经
  `plugin_manager` 的 `install_bundle` 安装
  `<repo>/artifacts/dsh-effort-router-0.2.18-agent.2.tgz`。结果为 stage=enable、
  application=applied；desktop profile 依赖已指向该 artifact，安装版本
  `0.2.18-agent.2`，13 个 `lib/*.js` 哈希与源码一致；`/effort-router/state?view=config`
  返回 enabled=true、defaultLevel=auto、trajectoryAnnotate=true。
- **Desktop 动态 Auto 已验：** 安装后由出品人完整重启 Desktop（DSH 0.2.2-rc.3）。
  当前会话 `session-8666b805…` 使用原生 Auto；重启后唯一 `model/selection` 是
  seq 3251 的显式 `select auto`。turn 9 从 seq 3253 启动，到 turn 9 结束、turn 10
  启动之间新增 284 条 session 事件，**没有新的 `model/selection`**；turn 9 / step 26
  路由为 `auto/high`（targetRank=3，nearest-up），`request/header` 为
  `reason=resume, reasoningEffort=high`。由此确认 scheduled Auto 在轮内与 `turn/end`
  均无写回，请求仍按 concrete 档位发出。
- **仍待产品出口验收：** same-step 双模型切换、finished history、多会话轨迹、
  hidden 后台标签与徽标视觉仍需出品人实机确认；不把自动测试或安装成功当作已验收。
- **未做：** 未 tag；产品出口视觉仍归出品人验收，push 以出品人明确批准为前提。
