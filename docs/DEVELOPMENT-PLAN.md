# 开发计划 — 0.2.18-agent.1（已交付）

> 状态：**已交付（0.2.18-agent.1，2026-11-16）**。基线为 `0.2.18-agent.0`，全量测试由 320/320 推进到 356/356。本文件保留本轮的施工契约与验收依据；交付记录见 `CHANGELOG.md`，决策与已接受残留见 `ROADMAP.md`。实际 push/tag 须出品人批准。
>
> 需求优先级：`REQUIREMENTS.html` > 已批准技术路线 > `ROADMAP.md` > 旧测试与旧注释。旧测试若锁定与需求冲突的行为，应按需求改写，不得为了保绿继续保留错误行为。

## 1. 审查结论

1. **继续 current() 同步 capture 路线，不再逐步 select 是正确方向。** 需要截弯取直的是现代路径中遗留的轮末 durable 恢复、store witness 猜测和跨轮 echo 残态，不是推翻 capture。
2. **现代与 legacy 的宿主缝必须分开。** 0.2.1 的 request interceptor 可以保留原有 echo/fixed 兼容；0.2.2 以原生 raw selection、pending 与 capture 为准。不得为了去重把两条路径重新揉成一条。
3. **本轮有实证，不做感觉型重构。** 保留有界 signals ring、store debounce、客户端增量 observer、anchors 上限与 current 路线；不重写 gzip、分类器、store 或徽标轮询。
4. **基线：** 原始 `node --test "test/**/*.test.mjs"` 为 320/320。新增测试必须只因下述缺失行为而红；施工结束后全量转绿，不能 skip 或删除红灯。

## 2. 施工任务与验收目标

### T01 — 现代路径不再写 durable 选择（P0，路线截弯取直）

- **技术路线：** modern Auto 只投影到本次 `model.current()` 返回值；删除 scheduled Auto 的 turn/end `model.select(Auto)` 恢复。modern 的 fixed `defaultLevel` / `subagentEffort` 也只走本次 projection，不写全局选择；legacy 的 request 写法和人工不支持档恢复保持不变。pending 标记只描述真实 logical Auto，不记录插件计算出的 concrete effort。
- **验收：** Auto 轮结束后原生选择保持原样；无原生选择/defaultLevel:auto 不被写成 Auto；fixed 默认值与 concrete 子代理不写全局记忆；DSH 原生最近全局 provider/model/reasoningEffort 只由用户明确选择更新。对应 modern durable/restore 测试与 FR-070～078 测试全绿。

### T02 — modern capture 与人工接管只认当前原生事实（P0）

- **技术路线：** capture cache 除 `turn:step` 外核对 raw source selection，raw 改变立即重算。删除 modern `lastDurable` 跨轮 echo 和 `store.last` witness 猜测；replacement 没有 pending 时以 raw selection 为准，legacy `isSelectionEcho` 不动。
- **验收：** 同一步 Auto→插件 high→用户 max 后，再次 `current()` 必须返回 max；fixed default 第二轮不被第一轮残留误判为 Auto；replacement 的人工 low 不被旧 decision 再调度；raw 未变的重复 capture 仍复用缓存。

### T03 — delegation 与自定义模型安全边界（P0）

- **技术路线：** delegation echo 只扫描最近连续 auto/subagent 时代，遇 manual/default 即停止，保留 non-blocking delegation 正例。自定义模型只有确认 `efforts:[]` 才可自动补档；`resolveModelInfo` 返回 null/undefined 或异常时只警告、不写 settings，已解析 `reasoning:null` 的正常 fill 不受影响。
- **验收：** 人工时代之后迟到的 child echo 不恢复 Auto；连续 auto/subagent echo 仍能路由。信息未知时 `settings.update` 调用为 0，确认无档与已解析无 reasoning 的现有行为不变。

### T04 — final-id allow-list 与严格 effort 全序（P0）

- **技术路线：** 显式 `allowedEfforts` 按最终 selector ID 过滤，不能再只转成 rank；legacy `deprecatedAllowMax` 继续按 rank ceiling。`normalizeEfforts` 在 known/unknown 混合边界使用严格有序的内部插值表示，避免 clamp 造成同 rank；保留 canonical 优先、fallback 矩阵和公开返回形状。
- **验收：** `allowed=['medium','max']`、`levels=['low','vendor-3','vendor-4','vendor-5','max']` 在 modern/legacy 均选 max，不能泄漏 vendor-3；legacy allowMax 仍可选 vendor-4。`['a','b','low']` 与 `['max','a','b']` 均严格升序，每个广告档位的精确映射可达，现有全未知/canonical 测试不回归。

### T05 — evidence 分支代际与 brief 双向去重（P0）

- **技术路线：** 使用宿主 `session.surface.replaceGeneration` 识别 projection replacement；代际变化时原子重建 origin、seen、ring、error、brief 等派生状态，同 generation 的 append/compaction 继续增量。brief 用“projection 待 claimed 认领计数”抵消同一条物理消息，不按 turn/text 全局去重。
- **验收：** 同对象等长替换和 shrink 都不保留旧 effort/error/brief；同 generation compaction 不重置信号。claimed→projection 与 projection→claimed 的同一多行 brief 均只计一次，同 turn 两条真实同文消息仍各计一次。

### T06 — stored history 不做周期性强制的全史重读（P1）

- **技术路线：** 非 live 的 finished stored session 成功折叠后复用缓存，取消成功项 30 秒强制过期；一旦该 session 进入 live projection 就删除旧 stored 项，避免恢复会话后重新成为历史时读到旧快照。失败仍保留 5 秒退避，64 项 LRU、single-flight 和 hint 安全规则不变。插件代际外或外部进程同时写同一持久日志的新鲜度不在本轮扩展。
- **验收：** 连续三次 anchors 轮询并两次越过旧 30 秒 TTL，`readSession` 仍只调用 1 次；stored→live→stored 后必须重读，不得复用 live 前旧表；已有 unreadable/error、observeSession fallback、single-flight 与 view 裁剪测试不回归。

### T07 — 多会话并排轨迹隔离（P1）

- **技术路线：** 将全局单 session/table/controller 改为按 conversation root 管理的独立状态；每行归属最近 conversation root，owner 不明时安全省略。每个 root 独立 load、observer、abort/dispose，不引入跨会话共享 concrete cache。
- **验收：** A/B 并排展示不同 session/effort，B 的请求实际发生；A 切换或卸载不影响 B；重复 mount/dispose 无重复 observer、定时器或跨会话误绘。现有增量 DOM、20 秒 sweep 与 keyboard 行为不回归。

### T08 — client style 所有权与键盘语义（P1）

- **技术路线：** style 元素按 create/refresh 获取引用、按 dispose 释放，最后引用归零才删除，并覆盖世代刷新与重复 dispose。chip 使用原生 button，或严格实现 Enter keydown、Space keyup 且过滤 repeat，保持现有样式与 aria-label。
- **验收：** G1 create→G2 refresh→G1 dispose 后 style 仍存在，G2 dispose 后才删除；三代与重复 dispose 不提前删除。Enter/Space 各激活一次，Space 长按不重复触发，鼠标点击不回归。

### T09 — CI 真实 pack 门禁与文档清直（P1）

- **技术路线：** CI 执行真实 `pnpm pack`，枚举 tarball 并核对 package manifest 承诺的入口、bundle、patch 与发布文档，不再只检查工作树 `existsSync`。同步修正 turn-auto durable 注释、trajectory assistant\\0turn\\0step/inline selector 注释，以及 ROADMAP 中“恢复已 retired”与旧路线互相矛盾的描述；纯注释修正不伪造红灯。
- **验收：** pack 契约测试先红后绿；Node 22.19/24 × ubuntu/windows、bundle diff 与 15 分钟门禁保留。文档不再声称 modern 依赖轮末恢复，也不再把历史计划当作当前状态。

### T10 — 构建、实机与交付验收（P0，最后执行）

- **技术路线：** 先全量测试，再 `pnpm build`、真实 pack、`plugin_check`；随后按 `MAINTAINER-TESTS.md` 做 Web 安装/RPC 与 Desktop smoke。成熟项目实机预算 15 分钟，环境阻塞要明示，不能用单元测试替代实机结论。
- **验收：** 标准测试全绿、0 skip，bundle 与源一致，tarball 完整；验证 Auto 不写全局记忆、人工立即接管、fixed/subagent、多会话轨迹、history route 与禁用插件消失。版本只升至 `0.2.18-agent.1`；push 时若获批再由出品人规则转为 `0.2.19-agent.0`。

## 3. 测试清单

- `test/f01/dual-path.test.mjs`：final-id allow-list；modern 原生记忆、capture raw 变化、replacement/fixed/manual 行为。
- `test/f01/legacy-path.test.mjs`：final-id allow-list 与 legacy allowMax 守护；legacy echo 兼容不因 modern 清理而改。
- `test/next-host.test.mjs`、`test/f02/turn-auto.test.mjs`：durable 写、capture/replacement、delegation 时代、自定义模型未知信息；`test/f01/lifecycle.test.mjs`、`test/f06/preferences.test.mjs`、`test/optimization-host.test.mjs` 做邻近回归。
- `test/next-engine.test.mjs`：严格 rank、brief 双向认领、replaceGeneration 重置与 compaction 守护；`test/rank-v2.test.mjs`、`test/optimization-engine.test.mjs`、`test/policy.test.mjs` 做邻近回归。
- `test/optimization-client.test.mjs`：双 root 并排、style 引用所有权、chip 键盘契约；`test/client-ids.test.mjs`、`test/client-state.test.mjs` 做邻近回归。
- `test/index.smoke.test.mjs`：stored history 越过 TTL 不重读，以及 stored→live→stored 的缓存失效。
- `test/ci-pack-contract.test.mjs`：真实 tarball 门禁及既有 CI matrix/bundle 守护。

**红灯基线（2026-11-16，Node v24.22.1）：** 标准命令 `node --test "test/**/*.test.mjs"` 实测 **356 tests / 326 pass / 30 fail / 0 skip / 0 cancelled**。30 项失败全部属于上述待施工行为：宿主与原生记忆 13、final-id allow-list 2、严格 rank / brief / replaceGeneration 8、客户端 4、stored history 2、真实 pack 门禁 1。施工目标为同批及既有测试全部转绿，不得 skip、删除红灯或把测试装配错误算作产品缺陷。

## 4. ROADMAP 后续与决策门

### R01 — 第二周期校准：先观察，不直接调参

- 收集独立第二周期真实日志，联合审查 briefRamp/toolRamp、error/repeat/frugal/todo 的分布。旧样本 453 条中 toolRamp 两档均 0 触发不足以证明阈值错误；没有新样本前不改词典、gzip 或 ramp。

### R02 — F-03 自定义模型配置写权限：建议保持“诊断，不写用户配置”

- 当前 FR-050～053 已允许在“确认无档”时补档，但 F-03 的持久 tombstone / 显式 opt-in 仍是新产品权限。建议默认保持现状，只有出现真实重复诊断成本时再讨论显式 opt-in；不引入隐式 tombstone 或第二偏好库。

### R03 — F-05 能力来源：建议“已解析宿主能力优先，静态知识库兜底”

- 暂不接供应商动态列表。未来若接入，也只把供应商元数据作为能力证据，不自动覆盖用户限制；需另立兼容与失败安全测试。

### 暂不进入本轮

- F-07 徽标迁移、F-08 词典校准、F-09 gzip、F-10 子代理 frugal 新开关、F-11 重启旧错误关联、F-12 研究公开/脱敏。F-09 当前 p99 约 0.417ms，未达到 ROADMAP 的 >8ms 或 ≥1MiB 门槛；其余项缺少新证据或属于独立产品决策。

## 5. 明确不做

- 不推翻 current() capture，不恢复逐步 concrete `model.select()`。
- 不为“代码好看”合并 modern/legacy，不重写 gzip、store、signals ring、anchors projection 或客户端 observer。
- 不因 cold capability 省略合法人工 concrete 档；人工直通优先。
- 不提前实施 F-03/F-05，不新增设置 UI，不扩大客户端写权限。
- 不在本轮改 minor/major，不自行 push/tag。
