# 完整分析底稿与报告对照验收

## 用户问题与改动

旧版尼安 report-v2 将报告压缩为三条时段控制建议的展开。用户要求保留完整项目分析；行动清单和首页数量限制不应变成正文内容限制。

改动：分析 Skill 0.7.0 先形成 analysis-brief.md；呈现 Skill 1.6.0 使用完整底稿组织项目概况、可比变化、深入发现与行动；审阅 Skill 0.5.0 检查分析覆盖和遗漏；Skill Creator 1.4.0 避免重新提炼出三条行动限制。完整报告服务提示同步改动。暂未修改线上数据库中的 Skill 绑定、发布代码或清单。

## 输入与隔离

同一份 Ngee Ann Level 6/7 历史数据，[2026-04-21, 2026-08-21)，Asia/Singapore。输入 gzip SHA256：ce94c6e3b5cbba95b0af0b73cd7d00e0e9e61c9c720d4e3d3c3a458a04b9620e。真实模型 gpt-5.6-sol，使用现有 Pi Harness 的隔离运行、正常生成及审阅，生产元数据只读。v2 原文件保持不变。

产物目录：outputs/ngee-demo-20260920/report-v3/outputs；修订另存 report-v4。没有手工修改模型 HTML。

## v3 发现

比 v2 增加了项目整体与楼层/类别构成、完整月份趋势、完整星期一至五样本的学期阶段对照、周六/周日曲线、子回路贡献。保留一个条件年度情景，未强制每项描述性发现登记为行动。自动审阅通过不等于本轮独立验收通过。

独立复算发现 analyze.py 全局排除了 quality_status=gap，导致发布快照中四条可用于总量的 30 分钟累计差值被丢弃。规则已补充到分析和审阅 Skill，并要求真实模型在 v4 修订脚本、数据、底稿、图表与全部受影响文字。规则区分累计能量可用于总量、非标准时长不能直接用于 15 分钟峰值/时型。

## 独立检查值

本地独立脚本：outputs/ngee-demo-20260920/verify-project-overview.py；结果 project-overview-independent.json。

- 官方非重叠总量：25,546.548786 kWh，其中跨采样间隔累计能量 6.059633 kWh。
- Level 6：9,065.703394 kWh；Level 7：16,480.845392 kWh。
- 全部父子通道简单求和为 50,867.752621 kWh，不能当作项目总量。
- 完整星期一至五样本 86 天，平均 243.609830 kWh；周六 17 天，142.367474 kWh；周日 16 天，95.063360 kWh。
- Teaching 1 / term break / Teaching 2 / study-exam 完整星期一至五样本分别 39/9/35/3 天，平均 216.283182 / 237.545236 / 273.169886 / 272.182718 kWh。星期一至五不是剔除公共假期的工作日；学期标签不证明出勤或关闭情况。

## 验证状态

- npm run test:energyiq:seams：7 文件、157 项通过。
- report-agent.test.ts 与 report-inputs.test.ts：2 文件、38 项通过。
- API TypeScript 构建通过；git diff --check 通过。
- v3 使用实际 Action/Insight/KeyPoint Store 的内存数据库登记：创建 1；重复登记新增 0、关联 1，无待核对项。
- v3 查看了 worker 生成的桌面截图；自动浏览器检查是版式检查，不等于网站点击链路验收。
- v4 模型修订完成，正常自动审阅通过；最终 HTML 哈希与审阅回执一致。独立复算通过官方总量、楼层总量、日型均值/样本数、学期阶段均值/样本数检查，记录于 report-v4/independent-validation.json。
- v4 六个正文部分、四幅 SVG 图：整体构成、月度及学期变化、日型曲线、回路贡献、行动证据与边界。相比 v2 的两组主要图表，增加了行动清单以外的项目解释。年度情景保持条件性质。
- v4 结构化产物登记检查通过：1 Insight、1 Action、1 Key Point；第二次新增 0、关联 1。数量不足三条不以泛化建议填充。费用情景及源引用通过现有校验。
- 最终结果：outputs/ngee-demo-20260920/report-v4/outputs/report.html；底稿同目录 analysis-brief.md。v2/v3 保留作对照。
- 尚未部署生产或改变项目默认 Skill 版本。未声称真实行动有效、网站点击链路通过或 Charles 已认可。图形布局检查及桌面截图核查不替代这几项验收。
