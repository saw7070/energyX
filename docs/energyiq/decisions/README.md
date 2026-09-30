# Decisions 架构与产品决策

- [Insight、行动、模拟与经验闭环](2026-09-16-Insight行动模拟与经验闭环.md)：最新确认的 AI 预评估、文字执行反馈、数据观察与站内提醒；包含分阶段开发清单和公司服务器增量数据迁移要求。

> **新版产品执行入口（2026-09-12）：** [2026-09-12-Agent项目初始化与Skill复用产品基线](2026-09-12-Agent项目初始化与Skill复用产品基线.md)。新版 Agent 初始化、报告与 Skill 权限以此为准；旧 Overview 文档保留为旧版说明。

这里放当前有效的架构、产品边界、数据模型和治理决策。新开发遇到冲突时，先看文档的 `status`，再以 [当前共识与新会话入口](当前共识与新会话入口.md) 及其 accepted 专题为准。

推荐阅读顺序：

1. [当前共识与新会话入口](当前共识与新会话入口.md)
2. [MVP 底座 + 双功能 + 协同架构](决策-MVP底座双功能协同架构.md)
3. [Overview 改造与 AI Analysis 打通最终方案](决策-Overview改造与AI-Analysis打通最终方案.md)
4. [项目 Renderer、Recipe 与时间上下文](决策-项目Renderer-Recipe与时间上下文.md)
5. [Harness 逻辑控制面、Run Event 与可替换 Runtime 边界](决策-Harness逻辑控制面、Run-Event与可替换Runtime边界.md)

决策文档回答“为什么这样设计、边界是什么、什么情况需要复审”；它不替代具体 ticket 的验收标准。

## 待批准提案

- [受保护模型请求 Payload、保留与重建权限边界](决策-受保护模型请求Payload与重建权限边界.md)：`proposed / target / not implemented`；内容审核接受不等于生产决策或实现授权，#102 继续打开，#122/#123/#105 继续等待各自的显式门。
