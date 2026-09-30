# EnergyIQ 历史调研

本目录保存需求收敛过程中的时点性调研。结论可能随范围、版本、许可证和商业策略变化；当前实施决策以 [阶段技术选型](../decisions/阶段技术选型-基于DataFoundry二次开发.md) 为准。

| 文档 | 内容 | 日期 |
| --- | --- | --- |
| [GitHub ChatBI、IoT 看板与 API 数据接入候选调研](github-chatbi-candidates-2026-07-27.md) | 比较 Superset、Rill、DataEase、ThingsBoard、Lightdash、Metabase、Wren 等候选 | 2026-07-27 |
| [ChatBI 与可复跑看板方案调研](chatbi-dashboard-options-2026-07-27.md) | 深入比较 Superset、Lightdash、Metabase、Rill、Evidence 等看板路径 | 2026-07-27 |
| [Explorer 可视化组件与 CopilotKit / Superset 评估](2026-08-02-Explorer可视化组件与CopilotKit-Superset评估.md) | 基于当前源码和官方资料，收敛 Recharts、CopilotKit、Superset、ECharts 与 TanStack Table 的复用边界 | 2026-08-02 |
| [EnergyIQ Prompt / Skill / Method 盘点与晋升标准](2026-08-24-EnergyIQ-Prompt-Skill-Method盘点与晋升标准.md) | 区分 formal Skill、Method/SOP、Stage Prompt、Context、Protocol/Validator 与 Tool/MCP，定义首个 governed Skill 纵切 | 2026-08-24 |
| [Pi 三层与 DeepSeek Harness 选择性吸收评估](2026-08-24-Pi三层与DeepSeek-Harness选择性吸收评估.md) | 区分 pi-ai、Pi Agent Core、Pi Coding Agent 与 DeepSeek Harness，记录 EnergyIQ 的验证顺序、兼容风险和采用门 | 2026-08-24 |
| [pi-ai Model Gateway 版本钉扎与兼容矩阵](2026-08-24-pi-ai-Model-Gateway版本钉扎与兼容矩阵.md) | 固定 pi-ai 版本与依赖身份，以 synthetic/fake-fetch 证据验证 Profile、stream、Tool、usage、error、catalog 与 request identity，并收敛为 adapter-only 结论 | 2026-08-24 |
