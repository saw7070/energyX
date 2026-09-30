---
title: "2026-09-01 开发记录：Tuya Office 动态决策 Overview"
summary: "在 exact Snapshot/Release 上实现 Tuya 专用八段 Overview、真实数据健康与异常证据，并对缺口、低覆盖和缺少受治理 AI 的状态诚实降级。"
doc_type: runlog
tags: [Tuya, Overview, data-quality, anomaly]
updated_at: "2026-09-01"
related:
  - "2026-09-01-Tuya-Overview原子投影发布实施记录.md"
  - "../plans/2026-08-29-Issue-212-Preschool-HTML-AI-Slot实现与证据边界.md"
---

# 2026-09-01 开发记录：Tuya Office 动态决策 Overview

## 1. 目标与范围

本次把 Tuya Office 从通用模板切换到项目专用、但仍由服务端已发布事实驱动的决策 Overview。页面包含 Key Findings、Overall performance、Energy composition、Trend、Operating pattern、Circuit/data health、Decision lenses 和 Recommended actions 八段。

范围内：exact Snapshot/Release 身份、真实 meter health、exact-pinned daily anomaly、完整/部分/不可用日的可视区分、低于 95% 覆盖时停止业务结论、Project Explorer 与 AI Analyst exact handoff。

范围外：真实 Tuya Provider 调用、生产部署、受治理 Tuya AI Artifact 生成。没有 accepted Tuya AI Artifact 时，页面明确显示 unavailable，不制造 AI 结论；该能力仍由 #100 跟进。

## 2. 代码改动

| 文件 | 改动类型 | 说明 |
| --- | --- | --- |
| `apps/api/src/energy/project-analysis-resolver.ts` | 修改 | Tuya 复用现有 meter-health 投影；旋转 resolver revision，避免旧 immutable projection 被误命中。 |
| `apps/web/src/app/energyiq/_components/tuya-office-overview-renderer.tsx` | 新增/修改 | 专用八段 renderer；缺口、partial coverage、anomaly 与 AI unavailable 的诚实呈现。 |
| `apps/web/src/app/energyiq/_components/project-renderer-registry.tsx` | 修改 | 注册 Tuya customer renderer。 |
| `apps/api/src/energy/energy-bootstrap.ts`、`packages/metadata/src/energyiq-overview-definition-store.ts` | 修改 | Tuya bootstrap 与 Published Definition 存储指向专用 renderer。 |
| 对应 API/Web tests | 修改 | 固定 exact identity、meter health、gap、partial policy、anomaly 与无硬编码拓扑。 |

## 3. 验证证据

- Tuya renderer + Dashboard focused：2 files / 95 tests PASS（第一轮候选）。
- EnergyIQ seams：7 files / 157 tests PASS，单 worker，无 timeout 调整。
- Root TypeScript build PASS。
- Web production build PASS，17/17 pages。
- Docs link smoke / MkDocs strict / `git diff --check` PASS。
- 本地 0-Provider synthetic preview：`tuya-office` exact Snapshot/Release 页面可见八段内容、20/20 meter health 与所有 exact Explore/AI 链接。
- Fresh review 后补充：partial/unavailable day 不再生成平均日用电与周期比较；低于 95% coverage 隐藏 Findings、anomaly conclusions 和 recommendations。

以上是本地候选证据，不等于 PR CI、合并、生产部署或真实 Provider 验收。

## 4. 问题与取舍

- **日/小时缺口**：旧呈现会把缺口连接成趋势或显示最小蓝柱；现按 complete、partial、unavailable 三态展示，不插值。
- **不完整周期的日均值**：旧 summary 会在 partial/unavailable day 存在时仍显示日均和比较；现 fail closed 为 unavailable。
- **低覆盖业务判断**：覆盖率低于 95% 时只保留事实与数据健康，不显示业务异常和行动建议。
- **真实 AI**：仓库当前没有 Tuya accepted AI adapter/Artifact。页面只显示明确 unavailable；不使用测试 fixture 冒充受治理 AI。
- **Project 通用性**：meter health、anomaly identity、partial policy 和 exact handoff 均复用共享合同；Tuya renderer 只负责该项目的信息架构与呈现。

## 5. 复现与排查

使用 exact candidate checkout 启动 API/Web，并用 Tuya Published Snapshot/Release URL 打开 `/energyiq/overview`。普通读取不得调用 Provider 或写 metadata。重点检查：

1. `data-tuya-office-overview="true"` 与 exact Snapshot/Release；
2. daily coverage legend 的 complete/partial/unavailable；
3. `<95%` 时 `data-tuya-coverage-policy="partial"`，且无 Findings/anomaly/recommendations；
4. meter health 不存在时显示 unavailable，不能推断为零；
5. anomaly pins 不匹配时 fail closed；
6. 无 accepted AI Artifact 时显示明确 unavailable。

## 6. 后续与关联

- Fresh Standards + Spec 对最终 exact head 复审；0 P0/P1 后才 push/open PR。
- PR CI 通过后由主 Agent决定合并；合并不自动授权生产部署。
- #100 单独实现真实 Tuya governed AI adapter/Artifact。
- 真实 Tuya 同步、浏览器、多账户与生产验收必须保持为独立证据。
