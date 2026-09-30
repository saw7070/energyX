---
title: "2026-08-02 开发记录：Admin Component Catalog 与 Template Draft"
summary: "建立受控分析组件目录、Project/Tier 模板草稿和真实事实预览，并完成保存复载、时区与双项目验证。"
doc_type: runlog
tags: [开发记录, Admin, Component Catalog, Template Draft, Tier]
updated_at: "2026-08-02"
related:
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../decisions/决策-项目专属模板与决策型分析.md"
  - "2026-08-02-Admin-Metric-Rule-Registry实施记录.md"
---

# 2026-08-02 开发记录：Admin Component Catalog 与 Template Draft

## 1. 目标与范围

本次把已经完成的 Metric/Rule Registry 接到受控页面模块上，使管理员能够为每个 Project 配置：

- 一套 Project Overview Template；
- 每个 Tier Definition 一套共享 Tier Template；
- 模块启用状态和显示顺序；
- 每个模块在当前项目中的 `Ready`、`Partially ready` 或 `Not ready` 状态。

本次不做自由画布、任意 SQL、任意 HTML/React、Prompt 编辑、AI 自动改模板、正式 Template Revision、Analysis Run 或发布。

## 2. 代码改动

| 文件/模块 | 改动类型 | 说明 |
| --- | --- | --- |
| `packages/metadata/src/energyiq-template-store.ts` | 新增 | 定义 10 个受控 Component Revision、默认 Project/Tier 模板和 Draft 保存、校验、乐观 revision、目录/Tier 演进对账 |
| `packages/metadata/src/energyiq-schema.ts` | 修改 | 增加 migration 0022 与 `energyiq_project_template_drafts` |
| `packages/metadata/src/index.ts` | 修改 | 将 Template Store 接入 EnergyIQ metadata 深模块 |
| `apps/api/src/energy/energy-project-setup-routes.ts` | 修改 | 增加 admin-only `GET/PUT /api/v1/energy/projects/:id/template-draft` |
| `apps/web/src/app/energyiq/energy-api.ts` 等 | 修改 | 增加 Component Catalog 与 Template Draft DTO/client |
| `apps/web/src/app/energyiq/admin/analysis-configuration-model.ts` | 新增 | 根据 Metric、Rule、Calendar、Tier 子节点、面积、人数和 Meter Mapping 计算模块可用性 |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | 修改 | Admin `Templates` 形成 Metrics、Rules、Template layout 三步配置 |

初始目录包含 10 个模块：Executive action summary、Consumption overview、Child scope comparison、Area/People-normalised benchmark、Off-hours analysis、Operating pattern、Meter and category breakdown、Data quality and coverage、Exceptions and evidence。

Project Template 默认包含 9 个模块；Tier Template 另包含 `Meter and category breakdown`，合计 10 个。模板只保存受控 Component Revision 引用、启用状态和顺序，不复制计算公式。

## 3. 关键设计结果

1. Project 和 Tier 使用相同 Component Catalog，但目标范围不同；不做 per-node override。
2. 管理员可关闭和排序模块，但不能修改底层 SQL、公式或页面代码。
3. `Enabled` 与 `Ready` 分离。启用表示管理员想展示，Ready 表示当前数据与配置足以可靠计算。
4. 同级比较至少需要 2 个子项；面积/人数归一化比较至少需要 3 个具备对应元数据的同级子项。
5. 不满足时显示最佳可用数量，例如 `best available group 2/3`，而不是只给模糊错误。
6. Meter breakdown 按目标 Tier 的真实 Meter Mapping 判断；部分节点有映射时显示 `Partially ready`。
7. 已保存 Draft 会与新的 Tier 或 Catalog 对账：保留已有顺序/开关，追加新模块和新 Tier，避免项目结构演进后丢失配置。

## 4. 验证证据

自动化验证：

~~~powershell
npm --workspace @datafoundry/web run test -- --run src/app/energyiq/admin/analysis-configuration-model.test.ts
npx vitest run packages/metadata/src/energyiq-store.test.ts
npm --workspace @datafoundry/metadata run build
npm --workspace @datafoundry/api run build
~~~

结果：Web readiness 10/10 通过；Metadata Store 8/8 通过；Metadata 与 API build 通过。

浏览器验证路径：`/energyiq/admin?section=templates`，选择 Ngee Ann Polytechnic 后进入 `3 Template layout`。

- Project Overview 显示 9 个组件；
- Level 与 Circuit 各显示 10 个组件；
- Level 的 Meter breakdown 因当前只有 1/2 个 Level 存在映射，显示 `Partially ready`；
- 面积和人数同级比较显示最佳可用组 `2/3`；
- 关闭 Level 的 People benchmark、保存、刷新后仍保持关闭；随后恢复启用并保存，Draft revision 从 0 增至 2；最终 10/10 模块为启用状态。

完整 Web TypeScript 检查仍被仓库其他既有测试类型问题阻断；日志位于 `.scratch/energyiq-web-tsc-component-catalog.log`，本次变更文件没有出现在报错列表中。

## 5. 问题与取舍

- 当前 `Reset` 只撤销未保存变更，不代表恢复系统默认。后续若管理员确实需要“恢复推荐模板”，应使用明确的 `Restore recommended preset` 动作，避免语义混淆。
- 当前 Draft 是可变配置，不是正式版本。不能把它当作客户已发布模板，也不能据此宣称复跑闭环完成。
- Ngee Ann 的 2 个 Level 不足以支撑 3 个同级样本的面积/人数基准，因此正确行为是降级提示，不是为了展示效果降低统计门槛。

## 6. Draft Preview 增量

提交 `7625ec5` 已完成批次 4 的第一段：管理员可在 `Templates → Template layout` 中选择 Project Template 或 Tier Template，再选择真实 Scope 和时间范围运行 Draft Preview。

关键边界：

- Preview 直接调用既有可信范围分析接口，不新增第二套计算逻辑；
- 默认时间范围来自 canonical `energy_interval_facts` 的实际覆盖，不依赖是否存在 Excel Import Batch，因此 Excel 与未来 Tuya API 共用同一逻辑；
- 时间标签和 Custom 日期默认值统一按 Project timezone 解释；
- Component Catalog 的顺序和启用状态直接驱动预览；`Not ready` 模块不伪造结果，而显示 `Preview withheld` 与缺失条件；
- Preview 是 admin-only 临时运行，不创建 Template Revision 或 Analysis Run，也不会影响客户页面；
- canonical 范围可能包含多个导入批次，因此界面显示“日期范围 + interval 数量”，不误标成来自某一个 Excel 文件。

新增或修改的主要入口：

| 文件/模块 | 作用 |
| --- | --- |
| `apps/web/src/app/energyiq/admin/template-draft-preview-model.ts` | 生成 Project/Tier 预览计划、推荐可用 Scope、解析真实事实覆盖和请求参数 |
| `apps/web/src/app/energyiq/admin/template-draft-preview.tsx` | Admin 的 Scope/Period 控件、运行状态与草稿预览容器 |
| `apps/web/src/app/energyiq/_components/energy-template-renderer.tsx` | 按 Component `view_key` 渲染十类受控分析模块 |
| `packages/data-gateway/src/energy-scoped-datasource.ts` | 读取 Project/Resource 的 canonical fact 覆盖范围和 interval 数量 |
| `apps/api/src/energy/energy-api.ts` | 增加 admin-only Project 数据覆盖查询接口 |

验证证据：

~~~powershell
npx vitest run apps/web/src/app/energyiq/admin/template-draft-preview-model.test.ts apps/web/src/app/energyiq/admin/analysis-configuration-model.test.ts
npx vitest run packages/data-gateway/src/energy-fact-writer.test.ts
npm --workspace @datafoundry/data-gateway run build
npm --workspace @datafoundry/api run build
~~~

- Web preview/readiness：16/16 通过；Data Gateway：2/2 通过；两个 workspace build 通过；
- Preschool Project Preview：`1 May 2026–31 May 2026`，`24,921.81 kWh`；
- Ngee Ann Project Preview：`21 Apr 2026–17 Jun 2026`，`10,209.87 kWh`；
- Ngee Ann Level Template：能选择 Level 6/7，并按各自 Scope 重算；
- 全量 Web TypeScript 仍被既有 Data Tasks 测试类型错误阻塞；本次新增预览文件未出现在错误列表。

## 7. 后续

2026-08-03 后续已完成不可变 Template Revision 存储、Schema v2、共享 Render Plan，以及 Admin Preview/客户 Overview 的同源 Renderer；详见[统一渲染实施记录](2026-08-03-Admin-Preview与客户-Overview统一渲染实施记录.md)。下一步先为本地 Ngee Ann 发布正式 Revision，再建立 Analysis Run、Evidence、历史结果与 Rerun。客户页面不读取可变 Draft。
