# dsh-effort-router

[English](README.md) | 中文

DSH（DeepSeek Harness）插件：**按上下文自动调节每一步的思考档位（reasoning effort）**，并让手写声明的 `llm-pi-ai` 自定义模型也能选档位。

- 任务形态分类：`trivial / standard / engineering / hard`，由任务书本身决定，而不是工具数量
- 证据升级：工具报错、同参重试自动升档（单任务有上限）
- 迟滞稳定：升档立即生效，降档需连续安静两步，防抖动
- 节俭信号：子代理 / 上下文压力 / token 预算超限时自动降一档
- 能力钳制：调度结果映射到目标模型**实际支持**的档位词表（含 `ultra` 等网关自定义值取最近档）
- 手动优先：选择器里选具体档位 = 完全直通；选 Auto = 交给调度器

## 为什么是 Auto mask 而不是面板

宿主原生模型选择器就是每会话的 effort 控制面。插件给每个支持思考的模型注入一个 `Auto` 档（广告进 `reasoning.efforts`，请求发出前被拦截器替换成具体档），所以**没有任何自建选择器**：选 Auto 走调度，选具体档直通，永不同步两份状态。

## 自定义模型（llm-pi-ai）

手写的自定义模型常常没有 `reasoningEfforts` 声明，选择器里根本没有档位行。本插件在启动与设置变更时扫描 `llm-pi-ai` 配置，并用**解析门控**精确补齐：每个缺表的模型先经 `resolveModelInfo` 解析，只有解析后确实没有思考档位的模型才补 `{ off: null, high, max }` 默认表（`off: null` = 线上省略该参数，与原生模型页写出的形状一致）——目录已带档位的模型解析后自带档位，天然跳过，绝不遮蔽目录能力；`false`（非思考模型）与已有表一律尊重。显式 `openai-completions` 路由上补齐的模型还会自动带上 `compat.supportsReasoningEffort: true`（该协议的 effort 需要这个 compat 开关才会上线）。

每模型的「档位 → 网关线上值」映射在 **设置 → 思考强度路由** 里编辑（如 `high → ultra`），直接写入 `llm-pi-ai` 配置，由官方 schema 校验，下一请求生效。pi-ai 原生按表序列化，无需插件侧翻译。

## 设置页

**设置 → 思考强度路由**：

- 启用 / 默认档位 / 子代理默认档
- 调度边界：允许 max（默认关，hard 落 high）、max 回退、节俭降档、上下文压力阈值、token 预算
- 分类 → 档位路由表（trivial/standard 默认 low，engineering 默认 high，hard 默认 max）
- 高级：降档迟滞、升档阈值（重启插件生效）
- 自定义模型编辑器：按提供方展开模型，勾选档位并填线上值，一键补齐缺失档位

## 会话内可见性

- **Composer 徽标**（模型选择器右侧）：当前会话最近一步的模式与档位（`Auto · high`），悬停显示分类、得分与理由。只读——控制永远在原生的模型选择器里。
- **工具调用标注**：会话流里每次工具调用下方标注该步实际使用的 `provider/model · 档位`。

## 安全与降级

- 拦截器整体 try/catch，任何异常原样放行请求（fail-open）
- 不支持的模型一律剥离 `reasoningEffort`，绝不触发 `UNSUPPORTED_REASONING_EFFORT`
- 自动路由永不产出 `off`（思考连续性：off 步骤的工具调用会毒化后续思考请求）；检测到已毒化历史时钉 `off` 并告警
- 信号读取只走 `deriveMessages()` + `sessionProjections`；取不到样本会**显式告警**，不做静默降级

## 作者与维护声明

- **作者**：kimi-k3（AI 模型，通过 DeepSeek Harness 完成设计与编码）。
- **出品人 / 仓库管理员**：KEI.NEO（@neo805）—— 人类出品人，对本仓库内容负责。
- **维护范围**：这是出品人的个人业余（Vibe Coding）项目。公开仅为分享，**不对项目本身承诺任何源于外部需求的维护与更新**。
- **协作政策**：本仓库**不开启 Issues，不接受 Pull Requests**。欢迎在 MIT 许可下 fork 后自由演进。
- **免责**：软件按"现状"提供，无任何明示或默示担保（详见 LICENSE）。生产环境使用前请自行评估。

## 致谢与许可

MIT。策略内核（分类 / 升级 / 迟滞 / 档位映射 / 信号采集 / 投影 / 存储）移植自 [@neptune810/dsh-model-router](https://github.com/Neptune810/dsh-model-router)（MIT © Neptune810）；能力层与 Auto mask 模式参考 [dsh-thinking-levels](https://github.com/drscrewdriver/dsh-thinking-levels)（MIT © drscrewdriver）；自定义模型默认档思路来自 [@hytime/dsh-thinking-effort](https://github.com/hytime/dsh-thinking-effort)（MIT © hytime）。
