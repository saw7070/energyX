---
status: deployed-admin-trial
date: 2026-09-12
---

# Pi 报告工作台生产发布与验收

## 已上线

- 发布版本：`a0de6f7f9c3ff77c55ae2d9e51fa66eae184e8af`；来源为干净发布工作树，构建 Node 与生产一致为 v22.23.2，Web BUILD_ID 与提交一致。
- Artifact SHA256：`5fce4c0760d4274bb807b7dc4f2f0ad3495929ce3513b3d3bc8495effc533ac4`。
- 按 deploy-release.mjs 的 transitional-npm-ci 路径发布；API/Web active，/ready 正常，部署锁已释放。
- 生产已安装 Docker 29.1.3；Pi 镜像 `energyiq-report-agent:pi-project-tools-20260912`，image ID `sha256:83a1c1bab73b684ef16e8aa8fff12d7625e6344c3b1922fd3d1280971ffad0de`。与本地验证镜像完全一致，分析和文件解析依赖检查通过。
- API systemd drop-in：`/etc/systemd/system/energyiq-datafoundry-api.service.d/60-report-agent.conf`。仅 API 服务获得 docker 组，Agent 容器仍无网络、不挂载宿主数据目录、以非 root 用户和资源限制执行。
- `ENERGYIQ_REPORT_AGENT_ENABLED=true`；Harness=pi；`ENERGYIQ_LEGACY_ANALYSIS_PREWARM_ENABLED=false`。停止每日取数完成后的旧分析预热，保留取数、确定性数据投影、Explorer 和旧页面读取；不是关闭整个 API，也没有删除 Mastra 或封禁所有旧版手动分析入口。
- 系统模型改为 `deepseek-flash`，生产模型配置 revision 5，正常文本探针返回 OK。实际 /models 只有 deepseek-flash、deepseek-v4-pro，不宣称存在 V4.1 ID。

## 验证结果

- 构建通过；取数、报告输入、报告调度定向检查 31 项通过；三条高层回归共 157 项通过。
- 浏览器使用已有登录会话打开生产新对话，项目数据 Connected；Project configuration 展示 20 个电表及结构；Explorer 展示总量和图表。
- 生产 Pi + DeepSeek 实际生成英文 HTML：Run `cd5de110-a282-4af0-af78-3e4010e46a67`，Session `ac089fe3-322d-4bb0-ae53-2babafbb1151`；分析窗口 2026-09-11 至 2026-09-12（右端不含）。报告在 Knowledge 列表可见、右侧预览与放大可用。
- 读取生产统一快照，1534 行区间数据，其中 648 行属于有效正式汇总路线。独立求和 94.86331948438486 kWh；报告 94.8633 kWh，误差小于 0.001 kWh。
- Skill Creator 在同一生产对话中生成草稿，Run `0938a6ba-dc35-4858-800f-b7a390d81bb4`，8440 字符，draft-skill API 返回 200。草稿名称 tuya-office-energy-verification-report；未自动接受或开启周期报告。
- 真实普通用户接口检查：所属项目 Knowledge 200；管理员聊天 403；未授权项目 Knowledge 403。所有为验收创建的短期认证会话已撤销，不修改用户密码。
- 初次测试 401 的原因是测试脚本选择了无个人工作区的定时取数服务账号。改用已有且具备个人工作区的管理员账号后通过，没有修改认证逻辑。报告首次设置保存使用空 Skill、数据连接开启、frequency=off。

## Skill 边界与未完成事项

旧的三份方法保留，不迁入新版生产设置。新版 Tuya 当前使用空基础 Skill 起步，新方法来自生产对话提取，需 Charles 查看、调整并选用后再安排周期。隔离环境已验证 Skill 驱动跨日期自动生成，但本次没有为生产开启周期或冒充 Charles 已验收。

本次是管理员试用上线，不是最终报告质量验收。生成样例仍偏重数据验证说明，部分关于无人/闭店时段的措辞需结合项目营业资料核实。应先由 Charles 在系统内调整报告，再沉淀正式方法。

数据仍有缺测：Explorer 默认窗口覆盖约 89.9%；9 月 11 日正式汇总渠道覆盖约 96.4%，最新区间截止 23:45，不能把未接收区间当零。页面恢复及 API 定时运行成功不代表历史数据完整。

后续备份脚本需要将新 energyiq_report_runs 的 running 状态纳入停写预检；本次备份发生在报告功能启用之前，没有运行中的新报告。当前备份停止 API 会触发其正常 drain/cancel，暂不把运行中的报告视为无中断备份保证。

用户另行要求整体 UI 重设计，已提交独立 Codex 工作树任务创建；不包含在本次生产发布中，不允许该任务自行部署。

## 备份、空间与回滚

- 发布前完整备份：`/var/backups/energyiq/managed-daily/backup-20260912T112350Z/storage.tar.zst`，受管备份服务成功。
- 原发布回滚点：`0a1c8f76b81be96a5b31e6d903b88a591b400e3b`。回滚代码不自动恢复模型配置或 systemd drop-in；如需完整回退，应记录并恢复旧模型 deepseek-v4-flash，暂停新增 report Agent 配置，并按 Runbook 处理数据迁移兼容性。
- 清理可重新下载的 root npm 缓存、apt 安装缓存及本次镜像传输临时文件后，磁盘可用约 9.1 GB。未清理旧发布或额外删除正式备份；备份服务自身按已有策略保留最近七份。
- 本地证据：源工作区 `outputs/report-integration-20260911/production-deployment-evidence.json`、release-tests.log、release-seams.log、release-web.log，以及不可变发布产物。
