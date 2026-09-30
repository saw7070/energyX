# 锁定最小指标模板与 Analysis Run 契约

Type: prototype
Status: open
Blocked by: 02
Label: ready-for-agent

## Question

什么样的版本化契约，能让受控 Ngee Ann Preset 与最小 Analysis Run 凭据共同驱动 Overview、Project Explorer 和 AI Analysis，并保证三处看到的是同一范围、时间、指标与证据？

## Expected evidence

- 固定最小指标包的输入、公式、单位、可比条件和质量状态。
- 定义 Template Revision 与 Analysis Run 的版本固定关系。
- 用同一 `projectId/scopeId/timeRange/metric` 在三个界面得到一致结果。
- 每个建议都能下钻到计算、SQL/公式、输入批次和质量警告。
