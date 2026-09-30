# 项目分析材料：隔离真实模型验收

关联：#249；设计与分阶段任务以 `decisions/2026-09-21-Project-understanding-and-analysis-design.md` 和 `handoff/agent/2026-09-21-Project-understanding-implementation-handoff.md` 为准。

## 验收边界

本轮验证 T2 的完整分析材料与报告生成，不登记线上 Insight/Action、不更换客户首页、不部署候选代码。生产仅提供只读模型配置和冻结输入，执行使用独立目录及候选 harness。

- 项目：Ngee Ann Polytechnic，2026-04-21 至 2026-08-21（不含），SGT。
- 冻结来源 run：`9c8510ea-eaf8-4547-9727-4d9e6449c060`。
- CSV gzip SHA-256：`ce94c6e3b5cbba95b0af0b73cd7d00e0e9e61c9c720d4e3d3c3a458a04b9620e`。
- 模型：GPT-5.6 Sol；各次 `execution.json` 保存实际模型及三份方法文件的 hash。
- 本地产物：`outputs/ngee-demo-20260920/analysis-package-v1`、`analysis-package-v2`，后续修订另起目录。
- 服务端隔离目录：`shared/backups/periodic-acceptance-20260920/ngee-analysis-package-v*`。

`source_integrity_checked` 只说明身份、文件、数值引用与契约一致；不等于独立计算和语义判断通过。`accepted-analysis.json` 是不可变材料收据，不是发布标记。

## v1：发现并修复系统输入口径冲突

模型生成完整材料并通过自动审阅，但独立重算发现它把规则间隔小计 25,540.489153 kWh 当成项目总量，遗漏已接受的跨间隔累计增量 6.059633 kWh。六月、七月及部分回路总量也因此偏小。

根因：`report-inputs.ts` 的 manifest.dataInstructions 要求总量仅使用 `quality_status=ok`，与正式 fact 层及现有 investigation/review Skill 的 `ok/gap` 总量口径冲突。

系统修正：总量保留 `official_aggregation_eligible`、非空用电量、`ok/gap`；规则 15 分钟曲线及峰值使用 `ok` 且 `elapsed_minutes=15`。两者分别计算，明确对账，不把 gap 增量伪装成规则采样或父子表相加。本次没有手改 HTML。

## v2：主要数字通过，证据元信息仍需修订

模型根据修正后的输入重新计算并生成材料、报告，自动审阅通过。当前本地契约校验也通过：7 条 findings，12 条 evidence，不要求每条发现必须有行动，不以首页数量限制完整分析。

独立脚本直接读取冻结 CSV 和发布的校历，不执行模型脚本。18 项核对通过：

- 正式总量 25,546.548786 kWh；L6 9,065.703394、L7 16,480.845392 kWh。
- 五月 4,968.394408、六月 6,207.300552、七月 7,670.275630 kWh；五月至七月 +54.38%。
- 三条诊断回路总量与原始累计增量一致。
- 普通上课一期、假期、上课二期、考试期的完整非公共假日工作日样本数分别为 36、9、34、3；相应日均数一致。

报告保留楼层/负荷结构、月趋势、工作日/周末/公共假日、学校阶段、24 小时曲线及诊断回路分析。第一屏截图人工查看；worker 的 1440/390 宽度检查通过，但这不代表所有交互与客户价值已验收。

独立复核还发现 profile evidence 的 sampleCount 写为 1960；如按 day-hour observations，应为 82×24=1968，聚合后 phase-hour 点则为 96，必须明确样本单位。月比较 evidence 也不应机械复用全历史 coverage。已在通用材料指令加入样本单位、计算产物计数和同窗口覆盖要求，启动 v3 模型修订；v2 不标记最终通过。

## 工程验证

`analysis-package`、`report-inputs`、`report-agent` 共 46 项测试通过；API TypeScript 构建通过。材料读入异常统一为稳定的 `REPORT_ANALYSIS_*`，harness 保留此错误类型，便于区分材料失败与模型运行失败。

首轮验证误用了 node test runner 和 pnpm；本仓库这些测试由 Vitest 执行。正式通过命令为：

```powershell
node node_modules/vitest/vitest.mjs run apps/api/src/report-agent/analysis-package.test.ts apps/api/src/report-agent/report-inputs.test.ts apps/api/src/report-agent/report-agent.test.ts
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
python scripts/energyiq/acceptance/verify-ngee-analysis-package.py outputs/ngee-demo-20260920/analysis-package-v2
```

最后一项在 v2 返回失败，原因是上述元信息问题；不能用前 18 项数字通过覆盖它。

## v3：本轮检查通过

GPT-5.6 Sol 修订了证据元信息：profile 为 1,968 个 day-hour 样本，明确来自 82 天、聚合成 96 个 phase-hour 均值；窄窗口月比较不再挪用全历史覆盖率，使用 null 并解释原因。7 条发现、12 条证据及报告内容保持完整。

本地当前契约校验通过；独立重算 18 项数值和本次发现的样本元信息检查通过，产物为 `outputs/ngee-demo-20260920/analysis-package-v3/independent-validation.json`。查看了第一屏截图；worker 布局检查通过。追加 harness 测试为 2 项通过、6 项按环境跳过，不能计为 8 项通过；API 构建再次通过。

这不是全面语义正确的证明：v3 是带有独立核对反馈的修订运行，不是无提示一次成功；真实设备用途和可执行收益仍待客户确认。T2 隔离用例通过，不代表 T3–T7 或整个新流程已上线。验收脚本针对这份冻结输入及证据文件布局，不是通用生产计算器。

## 后续边界

T3 仍需实现当前认识与旧 Insight/Action 的协调：独立发现入口、材料来源、稳定身份、revision 与幂等、明确授权发布，以及执行/拒绝状态保护。T4 的首页与报告同源发布、T5 两轮反馈复用尚未验收。旧客户报告和行动数据保持原样。
