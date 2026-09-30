# 尼安正式报告与关联登记验收

状态：隔离生成、自动审阅、静态产物及临时数据库登记通过；未发布生产，真实网站点击链路未通过本轮验收。

## 产物与输入

- 报告：outputs/ngee-demo-20260920/report-v2/outputs/report.html。
- 模型：gpt-5.6-sol。隔离候选 harness 使用本轮年度审阅要求，不替换生产版本，不修改线上清单。
- 数据：冻结的 2026-04-21 至 2026-08-20 尼安 Level 6/7 数据，18 条序列，210,778 区间。沿用此前已独立复算的三个情景。
- 报告 SHA256：29b1fcb996f4bad6fbcc610f19648f30e00a7681834a43714ed2079ffe72fe69；对应 review-receipt.json。

## 验证

1. 模型生成首稿并自动修订，v2 审阅通过。人工检查保存的 1440px 首屏截图，三项明确编号、年度金额和条件可见。生成工具记录 1440/390px 布局检查通过；不等于完整交互验收。
2. 首稿引用 charts/*.svg，与网站 srcDoc 预览不兼容。由 Agent 生成修正版，图表嵌入 HTML；新增静态资源依赖检查通过，原始首稿保留，不手工美化报告 HTML。
3. 当前应用校验器验证 sourceQuote 存在于 HTML、真实 meter ID、annualBenefit 脚本/结果一致、候选一对一引用与最多三个重点。
4. 在内存 SQLite 中走实际 registerReportActions → selectReportKeyPoints → KeyPointStore.publish。baseline 使用冻结 CSV 的真实区间经 actionDays 计算，未伪造用电数据。首次 created=3 / linked=0 / needsReview=0；重复 created=0 / linked=3 / needsReview=0；最终3个发现、3个行动、3个首页重点。此登记没有写生产数据库。
5. 单一精确情景取整改为“about SGD 576”，不再人为显示为575–576范围。金额/条件原值保留在年度情景。

## 仍需完成

- 用户可判断这些是否值得安排现场核查，但设备用途、可关闭性和未来日历/电价未确认，不能称确定节省。三项金额为条件模拟，不是已实现收益。
- 内置浏览器安全策略拒绝打开 file URL；未绕过。使用既有截图和文件进行有限验收，未现场点击 Key Points → Action → Report。
- 本轮产物未进入线上 Report/Key Points 清单；代码未部署。
- 新增资源检查是常见静态引用的包装检查，不是完整 HTML/CSS/JavaScript 解析器或安全过滤器。

证据：report-v2/registration-validation.json、review-receipt.json、browser-check.json、browser-1440.png；验证脚本 outputs/ngee-demo-20260920/validate-report-v2.mjs。
