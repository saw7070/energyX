# Records 实施记录与验收证据

- [2026-09-17 AI 预评估补齐验收](2026-09-17-AI预评估补齐验收.md)：最新可用窗口、用户补充信息、版本保留及真实 Pi 条件性预测验证。

这里放已经发生的开发、联调、排障、浏览器验收和部署记录。它们回答“实际改了什么、如何复现、证据到哪里、还缺什么”，不能自动替代当前决策或生产验收。

阅读方式：

- 按主题从 `../decisions/` 找设计边界，再到本目录看实现证据；
- 按日期阅读最新记录，但必须同时检查 frontmatter 的 `status`；
- `implemented`、`accepted` 或 `done-engineering` 只代表文档所声明的那一层证据，不自动代表真实 Provider、浏览器、部署或客户人工验收。

最新记录优先从根目录 [EnergyIQ 文档索引](../README.md) 的“实现证据”表进入。

- [2026-09-14 行动反馈生产发布与在线验收](2026-09-14-action-production-acceptance.md)：main 合并、备份恢复、生产三条行动反馈链路、个人/共享权限及质量边界。

- [2026-09-13 报告 Skill 与产品内 Creator](2026-09-13-report-skills-and-product-creator.md)：Tuya 方法更新、通用结论置前、产品内查看/提取/保存与待集成边界。

- [2026-09-12 Tuya 与 Charles 参考报告对比](2026-09-12-tuya-charles-report-quality-comparison.md)：空间资料补充、分析与呈现差距、不能照搬的结论和真实重生成验证。

- [2026-09-12 Agent 真实资料初始化与同源报告](2026-09-12-agent-project-onboarding-live-validation.md)：真实 Excel 导入、映射、发布、Explorer 与无手动附件报告数字核对；包含未完成边界。

- [2026-09-01 Tuya Office 动态决策 Overview 实施记录](2026-09-01-Tuya-动态决策Overview实施记录.md)：八段动态页面、真实数据健康/异常、缺口与低覆盖降级；真实 Tuya AI 仍不在本次范围。

- [2026-09-12 Agent 项目配置与可读预览](2026-09-12-agent-project-configuration.md)：Pi 配置工具、草稿渲染、真实模型与本地浏览器验证及未接入边界。
- [2026-09-12 主流程联调](2026-09-12-core-report-loop.md)：自动取数状态核对、正式配置输入、真实报告到 Skill 到跨日期自动报告验证。

- [2026-09-12 Pi 报告工作台生产发布](2026-09-12-report-production-deployment.md)：生产运行环境、英文报告与 Skill 提取、权限验收、备份和仍待确认的边界。
- [2026-09-12 Explorer 下级空间与电表展示](2026-09-12-explorer-child-meters.md)：修复空间树与挂载混用，Tuya DB1/Space 真实 API 和浏览器验收，官方口径与缺失读数边界。

- [Action feedback first slice](2026-09-14-action-feedback-first-slice.md)：行动记录与照明估算首个开发切片，未部署；自动反馈与客户闭环仍待实现。

- [Project Action continuity](2026-09-15-project-action-continuity.md): multi-report sources, shared progress inputs and remaining integration boundaries.
# 最新验收

- [2026-09-16 AI 预评估首轮验收](2026-09-16-AI预评估首轮验收.md)：真实 Pi、保存复用、中断后保留已验证；最新窗口、回答入口和 UI 仍需补齐，未发布。
