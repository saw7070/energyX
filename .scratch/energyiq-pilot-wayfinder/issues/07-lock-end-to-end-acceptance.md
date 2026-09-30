# 锁定端到端试点验收规范

Type: prototype
Status: open
Blocked by: 03, 04, 05, 06
Label: ready-for-agent

## Question

什么样的干净环境场景、证据、界面状态与 golden output，能够证明 Ngee Ann 试点已经完整实现，而不是只完成若干互不连通的页面或接口？

## Expected evidence

- 从创建/配置 Project、导入 Excel、发布 Setup、运行分析到用户查看和 AI 追溯的单一验收脚本。
- 固定输入文件、预期 15 分钟事实、关键指标、异常与 `Virtual Load 12` golden output。
- 覆盖项目切换、时间范围传递、质量警告和证据下钻。
- 覆盖服务重启、重复导入、重新复跑及最小恢复演练。
