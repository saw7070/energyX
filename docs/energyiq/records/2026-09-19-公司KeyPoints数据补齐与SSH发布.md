# 公司服务器 Key Points 数据补齐与 SSH 发布方案（2026-09-19）

## 原因

生产代码已部署到 693edc13fa476890249d0491b031e86b80520cd3，API/Web 正常。Tuya 已有数据快照；空白首页来自 Key Points 发布表为空，而非原始读数未导入。代码部署不应隐式覆盖业务数据库。

## 本次迁移范围

将本地已授权 QA 报告及对应 Insight、Action、Key Points 发布记录增量归到现有 admin@energyiq.demo。已有生产主键记录不覆盖；运行仅迁入终态且清除 schedule_key，不激活本地自动任务。排除 QA 现场问答，不迁移账号密码、模型配置、数据源配置、调度和 Harness 认证状态。

批次：keypoints-import-20260919。服务器 shared/backups 下保留迁移前 SQLite 在线备份和清单；产物逐文件 SHA-256 校验，先事务回滚演练，再正式导入并写入审计表。

首页源报告：84fe2341-222a-492e-8b95-a28af2fe869a。原分析截止 2026-09-13，不将历史发现冒充最新分析。迁移包不纳入 Git。

## SSH 与云效

可以保留 GitHub/Codeup 代码托管，改用 SSH 发布；代码托管与部署渠道是两件事。当前仓库已有 build-release-artifact.mjs 和 deploy-release.mjs，可沿用校验、release 目录、健康检查和回滚能力。

建议固定路径：在 Linux 构建环境产出与目标运行环境匹配的发布包 → SFTP 上传指定 SHA 的包/清单/校验和 → SSH 调用发布脚本 → 健康检查并核对 current SHA。业务数据仅做独立增量迁移，常规代码发布继续使用 shared/storage。Windows 原生依赖不能直接复制到 Linux。

目前仍有 transitional-npm-ci 依赖安装步骤，改 SSH 本身不消除全量构建与安装成本。要提速，需单独验证固定 Linux 构建环境、依赖缓存或可复用依赖层。本次没有更改公司的流水线，也没有声称新快速发布命令已经验收。

流水线本次实测：Node 安装约 6 分钟 4 秒，工具安装约 41 秒；缓存恢复未命中，npm ci 与后续全量构建继续耗时。缓存路径使用 /root/.npm，而构建脚本另设 HOME，需要统一 npm 缓存位置。

## 验收状态

备份校验、事务演练、正式导入与网页检查结果在完成后追加。

## 实际完成结果

- 在线备份约 2.2 GB，SQLite quick_check 返回 ok。
- 事务回滚演练通过；正式增量导入 7 Session、10 终态 Run、936 Event、2 Action、2 Insight、13 来源关联和 1 Key Points 发布记录；289 个文件校验通过。
- 重跑返回 Already imported, manifest matches，未重复插入。
- 公司网站管理员浏览器验收通过：Key Points 三条带 1/2/3 编号的重点显示；LED 行动详情显示三个配置设备名；源报告 HTML、空间图、图表和文字可读取。
- 四指标中用电 2,482 kWh、峰值 7.4 kW 可显示；电费与营业时间外用电当前返回 Not available，需核对生产项目的已发布电价/营业时间与指标计算契约。本次未覆盖生产项目配置。
- 行动详情打开后自动启动 AI assessment；本次仅核验启动状态和关联，不宣称该次模型估算已经完成。
- 本次迁移没有重跑自动取数、无人值守报告或并发验收，也未发布新的 SSH 快速构建工具。

## 补充诊断：两个空指标（2026-09-19）

用同一个 archived report 的 computeKeyPointMetrics 分别在本地和生产只读执行，确认不是缺原始读数：本地 cost=792.011065 SGD（税前），outsideHoursPercent=60.6325074；生产报 TARIFF_VERSION_NOT_FOUND 与 OPERATING_CALENDAR_VERSION_NOT_FOUND。报告引用的 tariff-81f22e14-a77f-4295-a082-413e8e76e94a / calendar-949e57a8-98e4-440c-a5be-b0bc6354d002 未迁入生产，不能将该现象直接称为用户未配置电价/营业时间。

已修改前端：没有有限数值的指标不渲染；0 仍正常展示；所有指标缺失时不渲染整个指标区，有效卡片自适应占位。缺失指标 UI 回归先失败后通过，连同指标计算测试共 5 项通过。此项代码变更尚未部署生产。后续数据修复应补齐报告的不可变历史依赖或用受校验的归档配置计算，不能覆盖当前生产配置来凑数。
