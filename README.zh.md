# dsh-effort-router

[English](README.md) | 中文

**当前版本：** `0.2.10`（兼容 DSH 0.2.1-rc.2）· [更新日志](CHANGELOG.md) · [路线图](ROADMAP.md)

DSH（DeepSeek Harness）插件：**按上下文自动调节每一步的思考档位（reasoning effort）**，并让手写声明的 `llm-pi-ai` 自定义模型也能选档位。

- **漂移引擎**（0.2.8）：任务始发时只分类一次（`trivial / standard / engineering / hard`，取自用户任务书本身），随后证据驱动档位漂移——`档位 = 始发 + 错误通道 + 信息量通道 − 节俭`
- 错误通道（6 步短窗，窗内衰减加权）：工具报错、同参重试、事件升档（todo 刚完成、编排返回、压缩检查点——各 +1，每步合并一次）、上一任务未解失败的延续
- 信息量通道（32 步长窗）：简报与工具返回 token，经 **gzip 压缩率折扣**（循环重复不是信息量），双斜坡线性分级
- 暖启动地板：新任务开头几步（默认 3 步）不低于始发档；之后完全交给漂移——激进节省由短窗错误反馈兜底
- 许愿检测：零线索真空区里的委托式短简报（「帮我…」「can you…」）按 engineering 起步——信息不足的任务给个善意的起跑线
- 节俭信号：子代理 / 上下文压力 / token 预算超限时自动降一档
- 能力钳制：调度结果映射到目标模型**实际支持**的档位词表（含 `ultra` 等网关自定义值取最近档）
- 手动优先：选择器里选具体档位 = 完全直通；选 Auto = 交给调度器

## 为什么是 Auto mask 而不是面板

宿主原生模型选择器就是每会话的 effort 控制面。插件给每个支持思考的模型注入一个 `Auto` 档（广告进 `reasoning.efforts`，请求发出前被拦截器替换成具体档），所以**没有任何自建选择器**：选 Auto 走调度，选具体档直通，永不同步两份状态。

## 自定义模型（llm-pi-ai）

**DSH 0.2.1 起，Models 页已可在 UI 中为每个自定义模型配置推理等级**（开关 + 每级线上值），不再需要手改配置文件。本插件的自动补齐因此缩窄为**只补 profile 层声明、且设置层从未触碰过的模型**：某个模型只要已出现在设置文档的用户层（UI 编辑过），就视为用户自管——UI 的开关「关」是把字段删掉，若再补表就会静默覆盖用户的选择，故一律跳过。目录已带档位的模型解析后自带档位，天然跳过；`false`（非思考模型）与已有表一律尊重。显式 `openai-completions` 路由上补齐的模型还会自动带上 `compat.supportsReasoningEffort: true`。

补齐的表是 `{ low, high, max }`，**刻意不含 `off`**：选择 off 后再发工具调用会毒化后续所有思考请求，而调度器自身也永不路由到 off。想用 UI 管理或不想要任何自动补齐，把 `fillCustomModels` 设为 `false` 即可。

每模型的「档位 → 网关线上值」映射（如 `high → ultra`）在 Models 页编辑，或直接编辑 `llm-pi-ai` 配置中对应模型的 `reasoningEfforts` 表，由官方 schema 校验，下一请求生效。pi-ai 原生按表序列化，无需插件侧翻译。

## 配置（无设置界面，全部在 config 文件）

**本插件刻意不提供设置界面**（0.2.7-rc.6 起）：所有可选选项都在插件配置里，保存在 profile 侧，**升级插件包不会覆盖**。改动方式：直接编辑配置，或用自然语言让 Agent 代改（「关掉徽标」「允许 max」）。

- `enabled`：总开关（关 = 请求原样通过）
- `defaultLevel`：无显式选择时的档位（`auto` 或具体档）
- `subagentEffort`：子代理默认档（`inherit` 或具体档）
- `allowMax` / `maxFallback`：允许自动升到 max（**0.2.0 起默认开**）；关闭则回退到 maxFallback
- `wish` / `poisonRecovery` / `frugalDemote` / `contextPressure` / `sessionTokenBudget`：许愿检测、毒化恢复、节俭降档及其阈值
- `showBadge`：是否显示对话视图模型选择器左侧的徽标（默认开）
- `trajectoryAnnotate`：是否在原生轨迹视图投影每步的 `provider/model · 档位`（默认开；与其他插件冲突时可关）
- `chatAnnotate`：是否在对话视图为每个工具调用加一行 `provider/model · 档位` 小注（**默认关**，客户端加载时读取一次，切换后刷新页面生效）
- `fillCustomModels`：是否自动补齐自定义模型默认档位表
- `routes`：分类 → 档位路由表（trivial/standard 默认 low，engineering 默认 high，hard 默认 max）
- `shortWindow` / `longWindow` / `errorDecay`：错误通道的短/长窗口步数与窗内衰减权重数组（默认 6 / 32 / `1,0.8,0.6,0.5,0.4,0.3`）
- `briefRamp` / `toolRamp` / `compressDiscount`：信息量线性斜坡（有效 token，默认 `400,1600` / `48000,128000`）与 gzip 压缩率折扣开关
- `warmUpSteps` / `trivialLiftCap`：始发暖启动地板步长（默认 3）与 trivial 始发允许的总升档数（默认 1）
- `escalateOnErrors` / `escalateOnRepeats` / `maxEscalations`：错误通道阈值与通道总封顶
- `todoBump` / `subagentReturnBump` / `compactionBump`：通道①事件升档（短窗内 +1，每步合并触发一次）：todo 完成、子代理/workflow 结果落地（整合时刻）、压缩检查点落地（地图保真度风险峰值）
- `downAfter`：**已废弃**（0.2.8 移除迟滞）——键保留以兼容旧配置文件，值被忽略
- `cuesStrong` / `cuesNormal` / `cuesCheap` / `cuesWish`：自定义线索词典（追加在内置词典之上）
- `dictStrong` / `dictNormal` / `dictCheap` / `dictWish`：词典**全量替换**——非空时该列表就是整部词典（内置词全部失效，可增可删），对应的 `cues*` 追加仍叠加生效；留空（默认）= 内置词典。改动前先读 `GET /effort-router/dictionaries` 拿到当前生效全量（含 `builtin` 内置参照），改完写回 `dict*` 即可；让 Agent 代改时说「把 xx 从 strong 词典删掉」即可

## 会话内可见性

- **Composer 徽标**（模型选择器左侧，`showBadge` 可关）：当前会话最近一步的模式与档位（`Auto · high`），悬停显示分类与理由。只读——控制永远在原生的模型选择器里。
- **轨迹提级**（`trajectoryAnnotate`，默认开）：每一步的 `provider/model · 档位` 直接投影到**原生轨迹视图**的记录行上（以 `data-trajectory-row-key` 为锚的 DOM 投影——装配层路线，不动任何宿主包、不新增视图）。锚点表由宿主侧折叠 `request/header` + `assistant/message` + `tool/call` 事件生成，经只读路由提供给客户端。会话流默认保持零标注。
- **对话流小注**（`chatAnnotate`，**默认关**）：开启后每个工具调用下方显示一行 `provider/model · 档位`，数据来自同一张锚点投影表。

## 安全与降级

- 拦截器整体 try/catch，任何异常原样放行请求（fail-open）
- 不支持的模型一律剥离 `reasoningEffort`，绝不触发 `UNSUPPORTED_REASONING_EFFORT`
- 自动路由永不产出 `off`（严格 thinking-mode API 上的思考连续性）。仅当历史被**确证**毒化——存在无思考块的工具调用消息，且本会话决策日志记录过手动 `off` 步骤——才钉 `off` 并告警，直到压缩移除肇事消息。仅凭消息形态永不钉死：kimi-K3 这类模型思考开启时也可能不产生思考块（2026-10-10 实测）。路由全部非严格时可用 `poisonRecovery` 关闭
- 信号读取只走 `deriveMessages()` + `sessionProjections`；取不到样本会**显式告警**，不做静默降级

## 作者与维护声明

- **作者**：kimi-k3、DeepSeek-V4.1-Flash-1017（AI 模型，通过 DeepSeek Harness 联合设计与编码）。
- **出品人 / 仓库管理员**：KEI.NEO（@neo805）—— 人类出品人，对本仓库内容负责。
- **维护范围**：这是出品人的个人业余（Vibe Coding）项目。公开仅为分享，**不对项目本身承诺任何源于外部需求的维护与更新**。
- **协作政策**：本仓库**不开启 Issues，不接受 Pull Requests**。欢迎在 MIT 许可下 fork 后自由演进。
- **免责**：软件按"现状"提供，无任何明示或默示担保（详见 LICENSE）。生产环境使用前请自行评估。

## 致谢与许可

MIT。策略内核（分类 / 升级 / 迟滞 / 档位映射 / 信号采集 / 投影 / 存储）移植自 [@neptune810/dsh-model-router](https://github.com/Neptune810/dsh-model-router)（MIT © Neptune810）；能力层与 Auto mask 模式参考 [dsh-thinking-levels](https://github.com/drscrewdriver/dsh-thinking-levels)（MIT © drscrewdriver）；自定义模型默认档思路来自 [@hytime/dsh-thinking-effort](https://github.com/hytime/dsh-thinking-effort)（MIT © hytime）。
