# EnergyIQ Ngee Ann Pilot Wayfinder Map

## Destination

形成一条可直接进入开发的、证据门控的 Ngee Ann 端到端试点路径：管理员完成项目配置与 Excel 数据接入，系统生成可追溯的 15 分钟事实数据并支持确定性复跑，Overview、Project Explorer 与 AI Analysis 共享同一份可信查询上下文和证据。

完成标准不是“平台功能齐全”，而是一个真实 Ngee Ann 项目可以在干净环境中从配置、导入、计算、发布一直运行到用户查看与追溯，并在服务重启后保持可用。

## Notes

- 本地图只用于确定开发路线，不直接实施业务代码。
- Ngee Ann 是首个纵向试点；Preschool 只作为模板与三层结构参考。
- 当前只区分 `admin` 与 `user`，用户侧界面使用英文。
- 优先简单、确定、可追溯；自由模板、复杂权限和高级运维以后再扩展。
- 原始工作区可能包含未提交改动，实施时必须保留无关改动。
- 开始任一票据前，先读根目录 `CONTEXT.md`、`docs/energyiq/CONTEXT.md` 与 `docs/energyiq/当前共识与新会话入口.md`。

## Decisions so far

- [确定 Ngee Ann 试点终点与边界](issues/01-define-pilot-destination-and-boundaries.md) — 首个目标是一条真实、可复跑、可追溯、可部署的纵向闭环，不是一次做完整平台。
- [证明 Ngee Ann 从源数据到事实表的领域契约](issues/02-prove-source-to-fact-contract.md) — Excel 与未来 Tuya 共用 Raw Reading 之后的事实链；SHA 幂等、实际时长、冲突留痕、Virtual Load 12 与官方排重已用真实数据验证。

## Not yet specified

- 当前可见的不确定项均已拆为下方开放票据；不在开放票据中的功能不应被默认纳入试点。

## Out of scope

- 正式 Tuya API Connector；本阶段只保留与 Excel 共用的 Source Adapter 接口。
- Preschool 的正式 Block / Room 数据映射与生产模板。
- 水、碳排、预测、Bell Curve、四象限等扩展指标。
- 自由布局模板编辑器，以及 AI 自动修改或自动发布模板。
- 复杂 RBAC、Partner Admin、多实例、高可用和完整 SaaS 运维体系。
- 正式电费结算、完整报告和责任人工作流；输入条件确认后再进入后续阶段。

## Open tickets

1. [原型验证首次数据源配置流程](issues/03-prototype-first-source-setup.md)
2. [锁定最小指标模板与 Analysis Run 契约](issues/04-lock-metric-template-and-run-contract.md)
3. [选择单实例试点部署边界](issues/05-choose-pilot-deployment-boundary.md)
4. [确定旧 Fixture 的切换策略](issues/06-choose-legacy-fixture-cutover.md)
5. [锁定端到端试点验收规范](issues/07-lock-end-to-end-acceptance.md)

## Current frontier

- 第一优先：[原型验证首次数据源配置流程](issues/03-prototype-first-source-setup.md)
- 已解除阻塞：[锁定最小指标模板与 Analysis Run 契约](issues/04-lock-metric-template-and-run-contract.md)、[确定旧 Fixture 的切换策略](issues/06-choose-legacy-fixture-cutover.md)
- 可并行决策：[选择单实例试点部署边界](issues/05-choose-pilot-deployment-boundary.md)

其余票据均依赖上述领域契约或前序原型结果，暂不应提前进入实现。
