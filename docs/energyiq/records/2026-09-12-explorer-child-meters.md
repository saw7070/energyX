---
title: Explorer 下级空间与电表展示验收
summary: 修复空间树与计量挂载混用造成的空电表列表，记录隔离开发和本地验收边界。
doc_type: record
tags: [Explorer, Meter, Tuya, 验收]
updated_at: "2026-09-12"
status: implemented
related:
  - "../decisions/2026-09-12-Agent项目初始化与Skill复用产品基线.md"
---

# Explorer 下级空间与电表展示

代码基线 `43909991`，隔离分支 `codex/244-explorer-children`，实现提交 `fe6e6940`。原始工作树 WIP 未修改；没有部署或修改 main。

## 原因及修复

真实本地 Tuya Office 已发布层级有 Project、两个 Space、三个 DB，共六个空间节点。DB1 没有下级空间，但分析接口返回六个有读数的物理电表。原 Explorer 从空间树查找直接 meter/circuit 子节点，错误显示 0 direct meters，并让用户选择不存在的子节点。

分析接口增加仅 Explorer profile 使用的 `explorerMeters`，从同一 Query Context 的 Hierarchy Revision 中投影已发布 mapping，保留无读数项。导航归属使用 `navigation_scope_id ?? scope_id`，业务名使用 published display_name，不沿用旧 Fact 名称。无新增 SQL 或另一套计算；不改报告输入。

Explorer 展示直接下级空间的既有官方期间汇总，可展开对应电表；DB 页面直接显示挂载电表。物理表角色、reference coverage、virtual 类型和公式分别展示。无有效读数显示 No data；虚拟表输入不完整不显示数值。明细不相加，官方路线资格独立显示。标题保留已发布 Tier 名称，例如 distribution board，不统一误称 LEVEL。

## 自动验证

- 28 项 `energy-analysis.test.ts` 通过，包含 Ngee Ann、Preschool、重叠总分表、虚拟表输入缺失及期间数据健康。
- 14 项 Explorer 状态/时间窗口测试通过。
- 2 项目录投影与界面回归通过，覆盖挂载不在空间树中、无读数、reference、virtual、名称及不重复相加。
- Web 聚焦 TypeScript、API `tsc --noEmit`、diff check 通过。
- 独立 worktree 执行 `npm ci` 时仓库 postinstall 自动运行 TypeScript build；未启动服务。共享本地服务仅由 Integration 所有者更新。

## 本地真实验收

修复前只读 API 与浏览器均复现：DB1 默认窗口为 2026-08-14 至 2026-09-10，官方总量 642.024 kWh，覆盖约 89%，六个有读数电表，UI 显示 0 direct meters。

Integration 挑入为 `8e845e09`，由主 Agent 构建并更新本地 API 18769 / Web 3000 后，完成以下真实只读验收：

| 范围 | 官方期间用电 | 直接下级 | 已发布电表目录 |
| --- | ---: | --- | ---: |
| DB1 | 642.024 kWh，与修复前完全一致 | 无下级空间 | 8（7 物理、1 虚拟） |
| Space 1 | 642.024 kWh | DB1，89.0067% 覆盖 | 8 |
| Tuya Office | 2309.0651 kWh | Space 1：642.024；Space 2：1667.041 kWh | 23 |

浏览器从用户原始 DB1 URL 重新加载，DOM 断言八行电表成功；Meter 05 显示 `No data / Missing readings`，没有 `0.00 kWh`。DB1 Other Load 显示公式及 `No data / Inputs incomplete`。两只 total 电表标记 Included in official route，component 和 virtual 标记 Excluded / detail only。

通过面包屑进入 Space 1，DB1 子项显示 `642.02 kWh · 89.0% coverage`；展开 Meter details 后八行电表可读。真实截图检查确认列布局、数值与无数据提示正常。Space 使用已发布 SPACE，DB 使用 DISTRIBUTION BOARD 类型名。没有在导航中添加虚构 Circuit 空间。

本地原始 API 证据：`D:/Projects/energyiq-explorer-children/outputs/explorer-verification/live-before.json`、`live-after.json`；验收脚本 `verify-live.mjs` 使用既有本地登录，不输出凭据。复验浏览器：`http://127.0.0.1:3000/energyiq/explorer?projectId=tuya-office&scopeId=tuya-office-db1&resource=electricity&view=hourly`，然后从面包屑进入 Space 1 并展开 Meter details。

边界：本次真实浏览器验证覆盖 Tuya DB1 与 Space 1；Project 根通过真实 API 验证。Ngee Ann / Preschool 有自动 Golden 回归，本轮没有另行浏览器验收。没有生产部署，也不代表 Charles 的业务价值验收。

## 侧栏展开补充（用户纠正后的范围）

用户明确指出核心诉求是侧栏应从 Project → Space → DB 一直展开到 circuit。前次只修内容区，未完成这一交互范围。本次代码 `785c156c` 将同一已发布电表目录接入侧栏，DB 有展开状态、物理与虚拟电表作为可选叶子；已有 Circuit Scope 不重复添加。

点击新增 circuit 叶子时，后端仍按已授权的挂载 Scope 查询 canonical analysis，前端仅取选中 meter ID 的数据，专门展示该设备的期间 kWh、峰值、覆盖与公式，不把 DB 总量显示为电表值。链接保存 `scopeId=meter:<id>`，刷新恢复所选叶子及祖先展开。设备目录取同一已发布 Hierarchy Revision，不读取草稿。

新增验证：17 项 UI/导航相关测试和 3 项 hierarchy API 测试通过，API/Web TypeScript 通过。旧 no-template fallback 测试假设 bootstrap 不产生 template，与当前 bootstrap 不符；改为显式隔离 no-template 场景，未改变产品逻辑。

真实侧栏验收已完成：Integration 先挑入为 `c3ee39bf`，随后刷新链接补丁 `4d5416c4` 挑入为 `c712106d`，主 Agent 更新本地 Web 后实测：

- DB1 展开显示 8 个电表叶子；Meter 03 点击后为 20.21 kWh、0.04 kW、90.3% 覆盖，未显示 DB1 的 642.02 kWh。
- Meter 05 仍在树中，点击显示 No data / Missing readings，不显示零用电。
- Space 2 → DB2 展开显示 11 个电表叶子；Panel B Total 点击后为 1162.27 kWh、2.28 kW、90.3%。
- DB3 展开显示 4 个叶子；虚拟 Panel C Meter Total 可选，显示 344.88 kWh 及 Meter 01 + Meter 02 + Meter 03 公式。
- DB3 → Meter 01 显示 112.52 kWh、0.19 kW、90.2%；刷新后该 treeitem 的 aria-selected=true，DB3 的 aria-expanded=true，链接保留 meter:panel-c-meter-01，设备详情仍可见。
- 完整页面回归测试额外验证：叶子选择存入 URL，API 仍查询真实 DB scope。此次补充共 21 项聚焦测试通过。

设备目录原始只读证据：本 worktree `outputs/explorer-verification/sidebar-directory.json`。首次 Web 更新窗口内曾出现一次 Empty response body，随后 DB2/DB3 请求成功；未将该瞬时失败当作数据为零，也未操作共享服务。
