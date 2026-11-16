# 文档目录 / Documentation

本目录存放**面向维护者**的文档；根目录只保留随 npm 包发布或 GitHub 首页必需的
文件（`README.md`、`README.zh.md`、`CHANGELOG.md`、`LICENSE`、
`THIRD_PARTY_NOTICES.md`、`package.json`、`cordis.patch.yml`、`CONTRIBUTING.md`）。

## 已发布（入库）

| 文件 | 用途 |
|---|---|
| [COLLABORATION.md](COLLABORATION.md) | 人机协作规范：角色与决策权、版本号治理、测试先行、四级验证阶梯、环境纪律、交付清单、权限边界、隐私边界 |
| [DEVELOPMENT-PLAN.md](DEVELOPMENT-PLAN.md) | 当前施工批的技术任务与验收口径 |
| [ROADMAP.md](ROADMAP.md) | 已交付批次、已接受残留与待推进项（公开追踪） |
| [MAINTAINER-TESTS.md](MAINTAINER-TESTS.md) | 只能由维护者人工执行的实机验收备忘（自动化测试覆盖不到的宿主缝与渲染项） |
| [REQUIREMENTS.html](REQUIREMENTS.html) | 需求登记册：已提供能力、已批准/已否决/冻结/延期选项 |

## 仅本机（`.gitignore` 排除）

| 路径 | 内容 | 为什么不入库 |
|---|---|---|
| `ops/logs/` | 安装与修复日志、会话数据统计、通道汇总、投影缺口诊断 | 含机器路径、provider 凭据、会话全文 |
| `ops/reports/` | 词典与参数统计审计建议、t4/t6 参数字典推荐报告 | 由真实会话日志统计得出，属研究草稿；只有经维护者明确清除的结论才提炼进 `ROADMAP.md` 或需求登记册 |
| `archive/` | 已被取代的规划草稿（`t2-*`、`t3-*`） | 历史过程材料，结论已并入 `ROADMAP.md` / 需求登记册 |

## 约定

- 文档之间用**相对链接**，移动文件时同步改链接；`node --test` 里
  `test/version-policy.test.mjs` 会读取 `COLLABORATION.md` 的版本声明，改路径需同步。
- 不写机器专属信息（见 `COLLABORATION.md` §11）：路径用
  `$DSH_HOME/profiles/<profile>/…` 表达。
- 本目录文件保持**准静态**：记录当前生效的约定；变更内容与原因写进
  `CHANGELOG.md`，不在正文里堆历史批注。
