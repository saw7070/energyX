# 选择单实例试点部署边界

Type: grilling
Status: open
Blocked by: none
Label: needs-triage

## Question

哪一种部署目标以及持久化、备份和恢复契约，足以让 Ngee Ann 试点在服务重启和最小故障恢复后继续工作，同时不引入生产 SaaS 级复杂度？

## Expected evidence

- 明确试点运行目标、数据库与文件资产的持久化位置。
- 明确最小备份频率、保留策略和恢复步骤。
- 通过一次从干净环境部署、重启和恢复演练。
- 列出明确延期的 HA、横向扩展、复杂监控与多环境发布能力。
