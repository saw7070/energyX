---
status: implemented-local
date: 2026-09-12
---

# Agent 项目配置与可读预览：本地实施记录

## 已实现

- Pi Chat 提供 project_setup_read、project_setup_save_draft、project_context_read、project_context_update 四个工具。
- 用户、工作区和项目由服务端 Session/Run 绑定；每次调用重新检查权限。草稿沿用现有配置服务、字段验证和版本冲突检查。
- 项目结构继续使用现有 JSON 配置；补充背景继续使用 contextNotes。避免另建一份与 DB 脱节的配置文件。
- Configure project 预填请求，不自动发送；View project configuration 将草稿解析为项目名称、时区、层级树、电表归属表、虚拟电表计算式。补充说明渲染 Markdown，界面不展示原始 JSON。
- 明确区分已发布版本与未发布草稿。Agent 修改 contextNotes 后刷新设置；用户尚未保存的编辑不会被静默覆盖。

## 验证

- API 与 Web 构建通过。
- 高层回归：7 文件、157 项通过。
- 配置工具与渲染最终定向检查：7 项通过；此前面板、API、输入绑定等定向检查 62 项通过。
- 新 Docker 镜像的 Pi 工具桥接与原有行为：6 项通过。
- 隔离测试数据库中，真实 Pi + DeepSeek 完成读取、修改草稿、保存学校假期测试说明、再读取核对。
- 本地真实 Tuya API 对话只读验证成功，没有修改 Tuya 正式配置。
- 桌面与窄屏浏览器检查通过，无页面异常或整页水平溢出。Tuya 显示 20 个电表、3 个虚拟电表、5 个层级节点（含空间和配电箱）。
- 本地证据：源工作区 outputs/report-integration-20260911 下的 project-tools-latest.json、project-tools-online-evidence.json、project-configuration-ui.json 及预览截图。凭据文件不属于可分享证据。

## 明确边界

这是本地联调结果，不代表生产部署或 Charles 人工验收。当前工具保存草稿，不自动发布；现有已发布版本保持有效。API 凭据管理、正式 Tariff / Holiday 策略写入、自动创建新项目尚未交给 Agent。

School holiday 等资料可通过项目说明保存并渲染，供报告参考；目前不等同于正式日历规则。后续正式接入策略接口时，继续读取同一权威数据源进行可读展示，避免报告参考信息与生效规则混淆。

## 独立配置入口补充

2026-09-12：侧栏增加 Project configuration，独立页面默认展开完整的层级和电表配置，提供刷新与 Edit with Agent 入口；后者打开新对话并预填配置修改请求，不自动发送。继续沿用当前项目权限和数据源，无第二份配置副本。

用户澄清：School holiday 的业务案例是尼安，不是 Tuya。移除所有项目通用的空 Calendar 占位，避免让 Tuya 看起来缺少必填假期配置。正式尼安假期策略工具仍待接入，不能用项目说明替代已生效策略。

## 可读配置工作区与运营规则工具

本地增量：Project configuration 改为项目概况、Spaces & meters、Project notes、Hours & tariffs。按实际位置展开电表，隐藏内部 ID 和技术枚举，显示面积、人数、虚拟计算公式；项目说明仍用 Markdown 渲染。正式配置继续由 JSON/现有 DB 服务管理。

Pi 新增 project_policy_read、project_calendar_save_revision、project_tariff_save_revision。写入沿用正式元数据校验，但保存为未激活版本，不改变项目当前策略绑定。写入前检查最近版本，拒绝过期覆盖和跨项目范围。学期阶段独立于公共假期，不能把 school holiday 当作自动停业日。保存版本可在 Hours & tariffs 查看状态；激活/发布入口仍待后续完善。

验证：32 项定向检查与 API/Web 构建通过；真实 Pi + DeepSeek 在隔离项目里保存运营时间、学校 term break、电价并重新读取，当前绑定仍为空；桌面/手机三分区和 Edit with Agent 浏览器检查通过。证据见 outputs/report-integration-20260911/project-policy-tools-latest.json 和 project-profile-ui.json。

第一次真实测试缺少税率细节时，模型补了默认税率。现已补充明确的校验错误提示，要求询问缺失信息；随后以完整、明确的测试税率复跑成功。此提示不能代替对用户原始材料的核查，不宣称从此消除了模型推测。所有学校日期与税率写入仅在隔离测试项目，未修改 Tuya/尼安正式配置。

## 配置页交互重设计

2026-09-12：用户明确拒绝依赖长说明小字的配置表。现改为紧凑项目头部、分段导航、左侧位置选择与右侧电表详情。点击位置更新详情；技术字段按需展开；结构、电表、项目说明、日历和电价的入口分别预填对应 Agent 任务，不自动执行。补充位置 metadata 以标签和值渲染，复用结构适配不同项目。

本地验证：25 项组件回归与 Web 构建通过，浏览器验证 DB1/DB2 切换、三个区块、针对电表的 AI 入口、桌面和移动端无整页横向溢出。没有改变正式项目配置。该界面不是任意 JSON 渲染引擎：现有结构字段自动渲染，自定义描述可存项目说明/metadata，新业务语义仍需扩展工具、校验和展示。

剩余优先事项：配置差异查看与正式发布/激活；发布后 Explorer 与报告输入的一致性验收；数据源连接管理与独立自动化管理界面。已存在的取数/报告调度能力不可因界面缺失被描述成从未实现，也不能以历史测试替代最新线上验收。


## 将 Agent 候选策略接入正式发布

新增管理员端 `POST /projects/:projectId/operational-policies/select`：选择已保存的日历或电价版本，校验项目权限、版本归属与预期的当前绑定。操作只改变下一次发布选择，不修改已发布的项目版本。过期选择返回 409，避免覆盖其他操作。

配置页 Hours & tariffs 增加 “Use for next publication”，并提供到现有 Review & Publish 的入口；最终发布继续使用原有完整性校验。正式报告的 project-configuration.json 已读取发布版本，未选用的候选不会进入正式数据配置。

验证：4 项 API/组件测试通过；API/Web 构建通过；浏览器从 Tuya 配置页进入 Review & Publish 成功，未点击正式发布。既有测试的日历种子期望由 v1 更新为当前 bootstrap 实际使用的 v2。没有修改真实项目的策略或发布状态。
