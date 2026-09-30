# EnergyIQ 交接材料

本目录用于维护交接人需要的系统说明、任务路径和本地部署信息。

## 推荐阅读

1. 优先打开 [HTML 交接手册](交接手册-架构任务路径与本地部署.html)，适合会议和日常查看；2026-08-27 状态快照包含 `main@752e09ed`、`dev@a437c07f`、测试服务器 retained deploy lock blocker 与后续任务顺序。
2. 需要修改内容时，编辑 [Markdown 源文件](交接手册-架构任务路径与本地部署.md)；第 0 节是当前交接状态的单一入口。
3. 按 Markdown 源文件重新生成 HTML 后，再把 HTML 发给交接人。

## 重新生成 HTML

在本目录执行：

```powershell
pandoc "交接手册-架构任务路径与本地部署.md" `
  --from=gfm `
  --to=html5 `
  --standalone `
  --toc `
  --toc-depth=2 `
  --embed-resources `
  --css="energyiq-handoff.css" `
  --metadata lang=zh-CN `
  --output "交接手册-架构任务路径与本地部署.html"
```

CSS 会嵌入生成的 HTML，HTML 可以直接在浏览器中打开或打印为 PDF。手册中的 Mermaid 架构图通过 CDN 加载；没有网络时仍可阅读对应的文字代码。

## 维护约定

- Markdown 是唯一维护源，HTML 是展示产物。
- 新增章节先补充 Markdown，再重新生成 HTML。
- 与当前实现不再一致的内容，不直接删除；先在文档中标明状态，确认过期后移入 `../archive/`。
- 修改架构、部署方式或任务入口时，同时更新主索引 `../README.md`。


