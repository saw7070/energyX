---
title: "2026-08-02 开发记录：Admin Metric 与 Rule Registry"
summary: "完成受控 Metric/Rule Revision、项目级 Draft 选择、就绪判定和 Registry 驱动的确定性建议。"
doc_type: runlog
tags: [开发记录, Metric Registry, Rule Registry, Admin]
updated_at: "2026-08-02"
related:
  - "../plans/开发计划-Admin与模板运行闭环.md"
  - "../decisions/决策-项目专属模板与决策型分析.md"
  - "CONTEXT.md"
---

# 2026-08-02 开发记录：Admin Metric 与 Rule Registry

## 1. 目标与范围

本次把“指标与规则”从页面文案变成可持久化、可选择、可追溯的受控定义，并保持 Admin 简单：管理员只能启用受批准的版本，不能在 UI 写任意 SQL、公式或规则代码。

不在本次范围：Component Catalog、Template Layout、Draft Preview、Template Revision、Analysis Run 和正式 Publish。

## 2. 代码改动

| 模块 | 改动 | 说明 |
| --- | --- | --- |
| Metadata | 新增 Metric/Rule Revision 与 Project Config | 定义不可变；项目选择使用乐观 revision 保存 |
| Energy API | 新增 Metric/Rule Config GET/PUT | 仅 admin 且受 Project/Workspace 范围约束 |
| Admin Templates | 新增 Metrics/Rules 两步配置 | Enabled 与 Ready 独立，第三步 Template Layout 暂不开放 |
| Readiness | 增加项目条件判断 | 检查已启用 Metric、Calendar、子项数量、同级面积/人数可比性 |
| Analysis | Rule Revision 驱动执行 | 阈值和最低样本从 Registry 读取，不保留第二份硬编码参数 |
| Provenance | 增加 `ruleRevisionIds` | 记录本次结果实际使用的规则版本 |

初始规则共 5 条：无有效数据、非营业时段占比过高、最高耗电子 Scope、单位面积异常、单位人数异常。它们都是确定性规则，不使用机器学习或 LLM 猜测。

## 3. 验证证据

自动化验证：

```powershell
npm --workspace @datafoundry/web exec vitest run src/app/energyiq/admin/analysis-configuration-model.test.ts
npm --workspace @datafoundry/metadata exec vitest run src/energyiq-store.test.ts
npm --workspace @datafoundry/api run build
npx vitest run apps/api/src/energy/energy-analysis.test.ts
```

结果：

- Admin readiness 模型：7/7 通过；
- Metadata Metric/Rule 持久化：7/7 通过；
- API TypeScript build：通过；
- Preschool 与 Ngee Ann Golden Analysis，加 Registry 驱动规则测试：3/3 通过。

浏览器验收：

- Ngee Ann 显示 9/9 Metric、5/5 Rule；
- 面积/人均 Rule 因只有 2 个可比 Level，显示 `Not ready · 2/3`，但保留 Enabled；
- 保存规则选择后 Draft revision 0 → 1；恢复默认后 revision 1 → 2；
- 刷新后选择持久化。

对应提交：

- `fd1007c feat(energyiq): show metric calculation readiness`
- `3dee90a feat(energyiq): add deterministic rule configuration`
- `bbc39f9 feat(energyiq): drive findings from rule revisions`

## 4. 问题与取舍

- `Enabled` 只代表管理员允许未来模板引用；`Ready` 才代表当前项目具备运行条件，两者不能合并。
- Project Metric/Rule Config 当前仍是 Draft。修改它不会直接影响客户页面，必须在后续 Review & Publish 中冻结为 Template Revision。
- 只判断真实同级组，不把不同父节点下的节点凑成一个比较样本。
- Ngee Ann 只有两个 Level，因此可展示描述性横向对比，但不发布至少需要 3 个样本的归一化异常结论。
- 全量 Web TypeScript 检查仍有仓库既有错误；本次变更涉及的文件没有新增 TypeScript 诊断。

## 5. 复现与排查

1. 启动 API（8787）和 Web（3001）。
2. 使用 admin 账户打开 `/energyiq/admin?section=templates`。
3. 在顶部切换 `Metrics` 与 `Rules`。
4. 观察每项独立的 Enabled 复选框和 Ready/Not ready 原因。
5. 修改选择并保存，确认 Draft revision 递增；客户页面此时不应发生变化。

## 6. 后续

下一步按已批准批次 3 实现 Component Catalog 与 Project/Tier Template Draft。完成真实 Project/Scope/Period Preview 后，才进入批次 4 的不可变 Template Revision、Analysis Run、Rerun 与 Publish。
