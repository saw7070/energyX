# 确定旧 Fixture 的切换策略

Type: grilling
Status: open
Blocked by: 02
Label: ready-for-agent

## Question

当前 meter-as-node fixture 以及现有 Ngee Ann/Preschool 数据，应该怎样与新的 Meter Point 和 source-to-fact 模型共存或迁移，才能避免破坏现有客户页面与 golden baseline？

## Expected evidence

- 现有 fixture 消费位置与依赖清单。
- 兼容层、一次性迁移或并行读取三种方案的最小比较。
- 选定方案的回滚边界与移除旧路径的明确条件。
- 当前 Overview、Explorer 和 Admin 关键状态的回归基线。
