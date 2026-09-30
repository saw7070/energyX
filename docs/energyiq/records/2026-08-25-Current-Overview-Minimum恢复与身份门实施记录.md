---
title: "Current Overview minimum 恢复与身份门实施记录"
summary: "记录无 pin Overview 的快速恢复、minimum/full 精确身份校验，以及 Preschool Resolver 昂贵路径的确定性性能门。"
doc_type: implementation
tags: [overview, performance, identity, preschool, release]
updated_at: "2026-08-25"
status: in-progress
---

# Current Overview minimum 恢复与身份门实施记录

## 用户问题

从 `/energyiq/overview` 无 pin 进入时，完整分析可能长时间处于 Resolving，导致当前 Project 的标题事实和 Explore / AI 入口均不可用。Preschool 的 versioned Snapshot 还可能在营业日历不可用时执行与当前页面无关的 planning analysis，使这个等待进一步放大。

## 当前合同

- 页面先读取服务端发布的 `energyiq-current-overview-minimum@2`，展示当前 Project 的最小标题事实；完整分析继续在后台按同一 Snapshot、Project Release 与不可变 Report-time basis 读取。服务端同时声明 Overview Definition 的 `primaryReportWindowId`，前端不再猜测或写死 Project 的主窗口名称。
- minimum 的网络失败仍是可选降级；但 minimum 已返回却与当前 Workspace 或 Project 不匹配时，属于身份错误，必须 fail closed，不能把未校验的 full result 当作当前报告。
- 身份错误若在 full result 之后到达，页面清除该 full result 与 minimum，并显示诚实的不可用状态；错误 minimum 不参与导航或渲染。
- Minimum 与 Full 除了比较 Workspace、Project、Snapshot、Release 和日期，还会比较 Report-time policy、primary report window、accepted data cutoff、resolved windows，以及 Snapshot 内重复的 Report-time binding；Release ID 不变但时间政策变化时也会定向重读或 fail closed。Ngee Ann 的 `current-month-progress` 与 Preschool 的 `current-overview` 都由各自发布的 Overview Definition 决定。
- 没有 Template Revision 的 Preschool legacy Release 固定使用 `preschool-report-time@2` 的自然月 `current-overview`，并把 Release identity 旋转为 `legacy-profile:preschool-demo:2`；不得读取可变的 latest policy，也不能再把 rolling 28-day pin 与自然月 Report-time basis 混在同一个 minimum 合同中。
- Published Release 显式携带 `reportTimePolicyRevisionId`，分析缓存合同 `project-analysis-result-cache@3` 也把该 revision 纳入 key；发布未来 policy 不会改变旧 Release 的含义，也不会让 minimum 与缓存中的 Full 使用不同政策。
- Overview minimum、Full Resolver 和 AI Artifact 统一通过服务端 canonical Release identity 解析；自然月切换后的 `legacy-profile:preschool-demo:2` pin 可直接进入 Explore / AI，旧 `:1` pin 只触发 current Overview 的一次受控恢复，不能冒充当前 Artifact。
- Minimum 与 Full 共用一个服务端 Report-time Context 构造入口，避免两条读取路径分别拼装 cutoff、policy 与 binding 后发生漂移。late matcher 遇到畸形 Full payload 时也必须清除可疑 Full、保留已验证 minimum，并显示诚实的详情不可用状态。
- Project Explorer 与 AI Analyst 分别使用独立 pathname，并携带 Project、Scope、Resource、Custom 时间范围、Data Snapshot 和 Project Release。
- Preschool 只有在当前 analysis 的 off-hours 事实可用时才计算 planning analysis；不可用路径由 SQL 调用次数测试直接约束，不依赖机器速度或放宽 timeout。

## 自动化边界

红测覆盖 minimum 身份在等待预算内和预算后到达的两种竞态、Ngee Ann 正式主窗口名称、late matcher 异常，以及 planning guard 被移除时新增的 5 次 SQL。Node 22 focused、EnergyIQ seams、root build 与 Web production build属于候选门；它们不等于生产部署、真实浏览器、Provider 或多账户验收。
