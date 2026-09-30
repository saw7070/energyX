# 确定 Ngee Ann 试点终点与边界

Type: grilling
Status: resolved
Blocked by: none

## Question

什么结果才算 EnergyIQ 下一阶段真正完成，并且能约束后续开发不重新滑向“把所有平台能力同时做完”？

## Answer

本阶段以一个真实 Ngee Ann 项目的端到端纵向闭环为终点，并确认以下边界：

1. 固定读取 Ngee Ann Excel 契约：`Device Name`、`Time`、`Active Energy`；下游通过通用 Source Adapter 与未来 Tuya API 解耦。
2. Raw Reading 保留原始累计读数；标准事实层存放清洗后的 15 分钟增量用电量，两者均可追溯。
3. 最小分析包只包含总量、日均、峰值与时刻、自身历史对比、Level 6/7 对比、Load/Light/Aircon/Other 分类、非营业时间异常、数据质量和来源证据。
4. 面积与人数指标在缺少正式属性时显示 `Data required`；预测、碳排、Bell Curve 和四象限暂不进入试点。
5. 从同事的 Ngee Ann 展示中吸收 Data Source Banner、Peak Breakdown、异常下钻、24 小时曲线/热力图及“建议 + 证据”；成本、完整报告和责任人工作流延期。
6. 试点包含 `Virtual Load 12 = Load 1 + Load 2`，用来证明 Virtual Meter 能力。
7. Virtual Meter 是 Meter Point，不是 Tier。默认只单独分析，不进入官方总量及会造成重叠的占比/排名；只有被明确指定为 official component 时才替换其输入项。缺失输入标记为 incomplete，不能当作零。
8. Analysis Run 最少固定 `project/scope/time range/data snapshot/setup revision/template revision/formula/metric pack/result/status`，作为复跑与追溯凭据。
9. 结构错误阻止发布；局部缺口、累计表重置或不规则间隔允许降级运行，但必须展示警告。
10. Admin 使用统一的 Connect Data Source 入口：现在走 Excel Import Batch，未来走 Tuya Sync Batch；两者共享 Mapping、Fact、Quality、Virtual Meter 和 Analysis Run。
11. API 映射必须依赖稳定 `device_id + DP`，设备名称只用于展示；Excel 映射当前由管理员确认，不使用大模型自动映射。
12. Ngee Ann 采用受控 Preset + Template Revision，不做自由布局或自由 SQL。
13. 项目配置简化为 Project Setup Revision，包含 Hierarchy、Meter Mapping 和 Virtual Meter Formula；Template Revision 单独存在，Analysis Run 同时固定 Setup、Template 与 Data Snapshot。
14. API 可用前由管理员手工导入 Excel，用户只读。Import Batch 按文件 SHA 幂等，后续导入复用已发布 Mapping。
15. 试点按单实例交付，但必须有持久化以及最小备份/恢复验证，不在本阶段引入 HA 或复杂运维平台。

这些决定优先保证真实闭环、确定性、可追溯性和后续 API 替换能力；任何新增能力都必须证明是完成该闭环的必要条件。
