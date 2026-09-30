---
title: "Preschool 数据与三层目标结构"
summary: "区分 Charles 数据已确认的 Centre×Circuit 事实与待管理员确认的 Block→Room→Circuit 目标层级。"
doc_type: decision
tags: [Preschool, Charles模板, 数据接入, Tier映射]
updated_at: "2026-08-01"
related:
  - "决策-项目专属模板与决策型分析.md"
  - "灵活项目结构与计量点模型.md"
status: accepted
---

# Preschool 数据与三层目标结构

## 已确认的数据来源

Charles 的完整工作区位于：

~~~text
D:\Projects\EnergyIQ\data\Preschool Analysis
~~~

权威目标报告：

~~~text
ideal-brief/final-report/Energy_Report_May2026_FINAL.html
~~~

真实构建链：

~~~text
Preschool_Database_30centres_May2026.xlsx
→ analyze.py
→ analysis.json
→ report_template.html
→ Energy_Report_May2026_FINAL.html
~~~

数字和口径优先依据 ideal-brief/data-contract.md 与 Excel 重算，不信任 HTML 中硬编码结果。

## 两个必须分开的事实

### 数据当前明确到哪里

现有数据契约明确：

- 30 个 Centre；
- 每个 Centre 有 9 个 Circuit；
- 能源事实粒度是 Centre × Day × Circuit，再展开到小时；
- Circuit 包含 Aircon、Lighting、Plugload、Heater 等标签；
- Centre 有 GFA、人数/客户和营业时间等元数据。

因此当前可信导航是：

~~~text
Project → Centre → Circuit
~~~

### 产品目标要配置成什么

已接受的业务目标是三 Tier：

~~~text
Project
└── Tier 3 alias: Block
    └── Tier 2 alias: Room
        └── Tier 1 alias: Circuit
~~~

但源数据没有给出每个 Centre 对应哪个 Block、Room，也不能仅凭 Kitchen Lighting 或 Living Room Lighting 自动推断出正式 Room 节点。这个映射需要 admin 根据真实项目/硬件资料确认。

## 当前处理决定

- 保留 preschool-demo 的 Centre → Circuit fixture，用于验证数据、Project 切换、Explorer 和 AI 可信范围；
- 把 Block → Room → Circuit 作为正式 Admin 配置目标；
- 不声称当前 fixture 已完成三层交付；
- 映射补齐后创建新的 Hierarchy Revision，不覆盖旧运行；
- Charles 报告继续作为 Project Overview Preset，而不是所有项目的通用页面。

## Charles 模板值得吸收的内容

- Executive-first，而不是图表堆砌；
- Overall Consumption；
- EUI 与 per-pax 双维比较；
- Standby Wastage；
- Operating Hours；
- Spike/SOP 异常；
- 最差节点优先与证据下钻；
- X = kWh/person、Y = kWh/m² 的四象限；
- 每个数字可追到确定性查询。

不能直接沿用固定 30 Centre、07:00–19:00、费率、Forecast、静态建议和日期。它们必须来自 Project 配置或明确标记 Preview。

## 当前数据验收基线

May 2026 fixture 可用于回归：

| 契约 | 结果 |
| --- | ---: |
| Centre | 30 |
| Circuit | 270 |
| 能源源行 | 8,370 |
| 规范小时事实 | 200,880 |
| 总用量 | 24,921.8123 kWh |
| 非营业用量 | 3,103.7840 kWh（12.45%） |
| 缺失小时值 / 负数 / 重复键 | 0 / 0 / 0 |

June actual 属于模拟；Forecast 只可标 Preview。

## 正式发布前缺少

1. Block 与 Room 的真实实例清单；
2. Centre 与目标 Project/Block/Room 的语义关系；
3. Circuit 到 Room 的人工确认；
4. 哪些面积、人数和营业时间是正式值及其有效期；
5. 正式 Tariff；
6. 是否继续使用 Centre 作为一个业务 Tier，还是将其等价映射为 Block。

第 6 项不是产品架构争议，而是该样板 Project 的实施输入。Admin 应允许配置，不应在代码中写死。
