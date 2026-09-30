---
title: "EnergyIQ 前端界面示意图"
summary: "使用内置图片工具生成的 EnergyIQ 登录、分析、历史溯源、AI 问数和移动端高保真界面示意图。"
doc_type: concept
tags: [界面设计, Mockup, PRD, EnergyIQ]
updated_at: "2026-08-01"
related:
  - "../product/PRD-EnergyIQ-MVP.md"
  - "../product/三类核心界面设计.md"
status: superseded
---

# EnergyIQ 前端界面示意图

> **历史视觉稿。** 这些图片记录早期只有 Analysis / Ask AI 的方案，不是当前信息架构，也不可直接切图实现。当前客户入口已确定为 Overview、Project Explorer、AI Analyst、Data Map，视觉与交互以[最新界面设计](../product/三类核心界面设计.md)为准。

这些图片仍可用于参考数据状态、渐进式 Evidence 和移动端信息密度。

## 1. 登录页

![EnergyIQ 登录页](01-login.png)

## 2. Analysis 首页

![EnergyIQ Analysis 首页](02-analysis.png)

## 3. Analysis History 与 Calculation & Sources

![EnergyIQ Analysis 历史与溯源](03-analysis-history-sources.png)

## 4. Ask AI

![EnergyIQ Ask AI](04-ask-ai.png)

## 5. 移动端核心流程

![EnergyIQ 移动端核心流程](05-mobile-core-flow.png)

## 当时的设计假设（已被部分替代）

- 客户导航只有 Analysis 和 Ask AI；**已被四入口方案替代**；
- Analysis 是默认首页；
- 数据更新时间和质量始终可见；
- 固定报告自动保存并支持复跑；
- 来源与计算渐进展开，不占据主结果；
- Ask AI 展示直接答案、必要图表和可验证来源；
- 不向客户暴露模型或工具配置；客户可以看到受控 Task Console、Evidence 和 Trace；
- 移动端导航需按四入口重新设计，不缩放桌面侧栏。
