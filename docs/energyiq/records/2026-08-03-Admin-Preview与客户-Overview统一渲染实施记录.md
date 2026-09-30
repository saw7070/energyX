---
title: "2026-08-03 开发记录：Admin Preview 与客户 Overview 统一渲染"
summary: "完成 Template Schema v2、共享 Render Plan、受控布局视觉协议，以及 Admin Preview/客户 Overview 的同源 Renderer。"
doc_type: runlog
tags: [开发记录, Template Schema, Render Plan, Admin Preview, Overview]
updated_at: "2026-08-03"
related:
  - "../decisions/决策-项目专属模板与决策型分析.md"
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "2026-08-02-Admin-Component-Catalog与Template-Draft实施记录.md"
---

# 2026-08-03 开发记录：Admin Preview 与客户 Overview 统一渲染

## 1. 结果

本轮消除了两套页面实现：Admin Draft Preview 与客户 Overview 现在都执行同一条链路。

~~~text
Template Document + Component Catalog + Readiness
                         ↓
                 Shared Render Plan
                         ↓
                EnergyTemplateRenderer
                    ↙             ↘
          Admin Draft Preview   Customer Overview
~~~

Admin Preview 读取可编辑 Draft；客户 Overview 只读取 customer-authorised Published Template endpoint。两者共享 Renderer，但配置权限和数据来源仍然分离。

## 2. Schema v2

`EnergyIQ Template Schema v2` 当前包含：

- Template：`schema_version`、Project/Tier target、有序 Section；
- Section：稳定 `section_id`、标题、左侧导航标签、可选说明；
- Placement：稳定 `placement_id`、`component_revision_id`、启用状态和 `section_id`；
- Layout：12 列网格的 `span = 4 | 6 | 8 | 12`，高度为 `compact | standard | tall`；
- Presentation：受控 `visual_preset`、`density`、`tone`、图例、Top N、可选标题和说明。

协议不接受任意 CSS、React props、ECharts option、SQL 或 JavaScript。旧版只有 `component_revision_id + enabled` 的 Draft 在读取和再次保存时会补齐默认 Section/Layout/Presentation，不要求一次性迁移数据库 JSON。

## 3. 代码入口

| 入口 | 作用 |
| --- | --- |
| `packages/metadata/src/energyiq-template-store.ts` | v2 类型、默认 Section/Placement、旧 Draft 对账、持久化校验和不可变 Revision 文档 |
| `apps/api/src/energy/energy-api.ts` | 解析 v2 Draft；增加 customer-authorised `published-template` endpoint |
| `apps/web/src/app/energyiq/_components/energy-template-render-plan.ts` | 将 Template、Catalog 和 readiness 编译为共享 Render Plan |
| `apps/web/src/app/energyiq/_components/energy-template-renderer.tsx` | 按 Section 和 12 列布局渲染；Recharts 承担小时趋势和排名图 |
| `apps/web/src/app/energyiq/admin/project-setup-workbench.tsx` | Admin 配置 Section、宽高、preset、密度、tone、标题、Top N 和图例 |
| `apps/web/src/app/energyiq/admin/template-draft-preview-model.ts` | Admin Preview 调用共享 Render Plan，并保留 Draft readiness |
| `apps/web/src/app/energyiq/_components/published-decision-dashboard.tsx` | 客户 Overview 加载发布模板和确定性分析，生成同一 Render Plan |

## 4. 客户 Overview 语义

- Project 切换后，Template 和 Scope Analysis 都按新的 `projectId` 重新加载；旧 Project 的响应不会被当成当前结果；
- Yesterday、Last 7 days、Last 30 days 和 Custom 只改变 Query Context，不修改 Template Revision；
- 左侧导航由发布 Template 的 Section 自动生成；
- Electricity 已接入共享 Renderer；Water 只显示协议预留状态，不再展示无来源的 mock 结论；
- 客户页不读取 Admin Draft。

当前本地 Ngee Ann 与 Preschool 是在 Template Revision 发布闭环完成前创建的 Published Project，`energyiq_template_revisions` 还没有记录。为避免读取可变 Draft，endpoint 返回标记为 `compatibility-default` 的受控默认 v2 文档。管理员重新执行 Review & Publish 后，客户页自动切换到固定 `published-revision`。

## 5. 验证证据

~~~powershell
npm run typecheck
npm --workspace @datafoundry/web run test
npx vitest run packages/metadata/src/energyiq-store.test.ts
npm run build
Invoke-WebRequest http://127.0.0.1:3001/energyiq/overview
~~~

结果：

- 全仓 TypeScript project references 检查通过；
- Web 全量 `69 files / 624 tests` 通过；
- Metadata Catalog/Template 定向 `1 file / 8 tests` 通过；
- 全仓构建通过；
- 重新构建并重启 API 后，`/energyiq/overview` 返回 HTTP 200，3001 与 8787 均保持监听；
- Admin 密码账号登录、两个 Workspace 的 Project 切换、发布模板读取和默认自定义时间范围分析均通过真实 API 链路验证；
- Ngee Ann 默认范围返回 5,328.2073 kWh、2 个子 Scope、18 个 Circuit；Preschool 默认范围返回 24,921.8123 kWh、30 个子 Scope、270 个 Circuit，返回的 `projectId/scopeId` 均与选择一致。

一次从仓库根目录混跑全部 Energy 测试时出现两个与本轮无关的环境问题：Settings 源码断言要求从 `apps/web` 工作目录运行；Ngee Ann golden test 与正在运行的 API 争用同一个 DuckDB 文件。Web 全量测试改在正确 workspace 运行后全部通过；未为测试停止客户正在查看的 API 服务。

## 6. Catalog 控制的视觉能力

Component Revision 现已持久化 `allowed_presentation`，它是 Admin 和未来 Agent 的共同能力边界：

- `layout.spans/heights`：该组件允许的 12 列宽度和受控高度；
- `visuals.presets`：Renderer 已真实实现的图表形式；
- `visuals.densities/tones`：允许的视觉密度与强调程度；
- `visuals.legend`：图例是否可配置及默认值；
- `visuals.limit`：Top N 是否可配置，以及最小值、最大值和默认值。

Admin 下拉框直接由 Catalog 生成，不再按 `view_key` 在前端维护第二份 allowlist。存储层对每个 Placement 做组件级校验；即使绕过 UI 直接调用 API，也不能给排名组件写入 `cards`，或给 Consumption Overview 写入未允许的 1/3 宽度。旧 Draft 在读取时会按 Catalog 收敛到合法默认值，再次保存后进入新协议。

这一步没有引入 ECharts、Superset 或低代码运行时；Catalog 只声明 Renderer 当前确实支持的能力，仍不接受任意 CSS、React props、ECharts option、SQL 或 JavaScript。

## 7. 仍未完成

- Ngee Ann/Preschool 需要重新发布正式 Template Revision，并进行登录态浏览器视觉验收；
- Section 编辑、Heatmap、Quadrant、Distribution 和 Recommended Actions 仍需进入受控 Catalog；
- Renderer 当前是共享 `view_key` dispatch；组件继续增长后再深化为 Registry，不提前建立只有一个实现的 Adapter；
- Analysis Run、Query Receipt、Rerun、Report 和 AI Template Proposal 尚未实现。

浏览器视觉验收本轮没有伪装成已完成：Codex 的 in-app Browser 控制运行时在初始化时报告本地 kernel assets 路径错误，因此本轮证据是登录/权限/模板/分析的真实 HTTP 链路、页面 HTTP 200、类型检查和自动化测试。恢复浏览器控制后仍需补做点击与截图验收。
