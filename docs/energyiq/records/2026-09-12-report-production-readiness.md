---
status: historical-preflight
date: 2026-09-12
---

# AI 报告闭环：现有 Skill 与生产发布准备

后续已执行生产发布，请以 [生产发布记录](2026-09-12-report-production-deployment.md) 为当前状态；下文保留发布前检查事实。

## 当前成果

本地已验证：项目已发布配置与选定时段数据进入 Pi；真实模型生成英文 HTML；Skill Creator 从对话提取方法；隔离测试中选用该 Skill 后由调度器生成下一期报告。两份报告的主要能耗总数与独立计算核对通过。证据见 [核心闭环记录](2026-09-12-core-report-loop.md)。这不是 Charles 对报告价值、风格的验收，也不是生产部署证明。

配置页现可将 Agent 保存的日历/电价候选选入下一次发布，并进入原有 Review & Publish。代码候选：90f43d1a9aeeeb550a4facdb7aeec5e31f6e678b。只选候选不会改变当前正式版本。

## “Charles 的 Skill”准确指什么

目前本地 Tuya 绑定的内容仍是候选/草稿，不能称为 Charles 已确认的方法：

| 名称 | 职责 | 当前状态 |
| --- | --- | --- |
| energy-report-investigation | 从电量去向、持续负荷、运行规律、变化与费用场景中找到值得行动的问题 | 0.2.1-review-candidate；从 Charles 的 Tuya HTML 与 Pi 试跑审阅提炼，未取得原始 Charles/Claude 对话 |
| tuya-report-composition | 报告章节、图表、英文 HTML 的组织与呈现 | 0.2.1-review-candidate |
| tuya-office-project-skill | Tuya 报告复跑方法，当前还混合了项目事实 | 0.1-draft；后续应将固定事实留在项目配置中 |

本地自动报告频率仍为 off。最新隔离测试提取出的 Skill 没有替换真实项目的绑定。今后的流程应是 Charles 在系统内完成满意的报告，再提炼/编辑方法并明确选用；后续运行重新计算，保留新的探索角度，不复制旧报告结论。

## 生产只读核查

- SSH 可连接，API/Web 服务 active。
- current 仍指向 0a1c8f76b81be96a5b31e6d903b88a591b400e3b。
- 尚未安装 Docker，新报告 Agent 尚未启用。
- 空闲磁盘约 9.1 GB；releases 约 11 GB，shared/storage 约 2.7 GB，备份目录约 11 GB。内存约 3.7 GB，另有约 2 GB swap。不得因此直接删除旧发布或备份。
- 系统模型配置启用且有凭据引用，模型 ID 为 deepseek-v4-flash；本地实测 ID 为 deepseek-flash。上线前需验证生产实际调用，不以配置的 connected 字段代替调用证据。
- 9 月 6–12 日的 7 次最近定时取数记录 succeeded；最新成功时间 2026-09-11T17:00:10.298Z。旧日志的失败在随后旧分析预热阶段，不能误报为 API 抓取失败。本地代码已将发布后的预热失败单独处理。

## 上线执行顺序

1. 固定候选提交，在干净发布工作树完成构建与 Artifact/Manifest/checksum；不包含本地测试账号、数据库、测试 Skill 或 outputs。
2. 准备受限 Pi Docker 运行环境，核对镜像内容、调用进程权限、磁盘余量与单任务资源。模型 Key 仍由服务器模型配置保管，不写入镜像或给 Agent。
3. 用生产配置完成模型连接验证；明确正确模型 ID。
4. 执行现有 Shared Storage 备份和发布 Runbook，记录不可变发布身份及回滚点；不在生产进行 full build。
5. 管理员账号验证配置读取、Tuya 数据窗口、一次英文 HTML 生成、Knowledge 阅读、Skill 提炼。验证账号隔离、Explorer 与已有页面未退化。
6. Charles 确认报告后才选定正式 Skill 和自动报告周期；以该配置验证定时新报告。

本记录只证明预检与本地功能进展。尚未上传发布产物、安装生产 Docker、切换生产服务或修改生产项目策略。
