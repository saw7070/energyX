# 证明 Ngee Ann 从源数据到事实表的领域契约

Type: prototype
Status: resolved
Blocked by: none
Label: ready-for-agent

## Question

什么样的最小领域契约，既能读取固定的 Ngee Ann Excel，又能在未来接入 Tuya API，并一致地表达 Raw Reading、Source Binding、Physical/Virtual Meter Point、Project Setup Revision、15 分钟事实、官方汇总规则、`Virtual Load 12`、数据质量与幂等性？

## Expected evidence

- 一张字段与实体关系图，明确 Source、Import Batch、Raw Reading、Interval Fact、Meter Point 与 Setup Revision 的边界。
- 用一个 Level 的 Load 1/Load 2 真实样例跑通累计值转 15 分钟增量及 `Virtual Load 12`。
- 覆盖重复导入、累计表重置、缺失输入、不规则间隔和官方汇总排重的可执行测试。
- 说明未来 Tuya `device_id + DP` 如何进入同一契约，而不改动分析层。

## Answer

已用两份真实 Level 6 Excel 和同一纯函数契约完成验证：

- 51,838 条 Raw Reading 规范为 50,111 条 Canonical Reading；去除 1,720 条同值重复，并保留 7 个重叠冲突键；
- `Virtual Load 12 = Load 1 + Load 2 = 396.579 kWh`，缺输入时标记 incomplete，不补零；
- Level 6 官方 Load 仍只来自 `l6-total-load`，为 3,186.762 kWh，Virtual Load 12 没有重复进入总量；
- 相同 SHA 重试不增加 Batch；gap 保留实际时长及能量并降级，reset 不生成用量；
- Excel 使用 `excel:<Device Name>`，未来 Tuya 使用 `tuya:<device_id>:<dp_code>`，两者从 Raw Reading 之后共用全部逻辑。

可运行原型位于 `scripts/energyiq/prototypes/source-to-fact/`，完整记录见[源到事实契约原型记录](../../../docs/energyiq/2026-08-01-Ngee-Ann-源到事实契约原型记录.md)。
