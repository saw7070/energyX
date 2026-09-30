---
title: "Preschool 与 Tuya 可复用报告 Skill 验证"
doc_type: record
updated_at: "2026-09-13"
---

# 目标与边界

用户要求把参考报告的分析结构、视觉组织和有用交互沉淀为系统 Project Skill，由系统 Agent 根据项目数据重新生成 HTML。参考页面不是被嵌入的产品，也不是数字事实源。本次方法来自参考成品及原型源码的可见行为，不声称完整还原 Charles 私有对话中的推理过程。

## 参考拆解

| 参考 | 保留 | 不直接继承 |
| --- | --- | --- |
| `docs/template/Preschool/Energy_Report_May2026.html` | 五节顺序；深蓝标题与粘性导航；宽白面板；总览 KPI 横带；按机构类型汇总；EUI/人数四象限；基准行展开；营业/非营业对称分析；下期展望位置 | 标题中的 31 中心错误、固定 30 中心、预填电价、模拟 June actual、未经确认的 phantom waste/SOP 判定、CDN 依赖 |
| `docs/template/Net-Zero Product/Software Prototype` | 日趋势与日类型/空间筛选；异常表到小时明细；电表分类贡献；小时热力图；章节展开/折叠；结论与行动 | 应用侧栏、账户、其他公用事业页、模拟聊天、占位操作；Ngee Ann/EliteIOT 固定值、seeded scaling、虚构曲线、原型固定 15% 阈值 |

原型 `netzero-prototype-share.html` 默认显示 Ngee Ann v2；本次为 Tuya 转移方法和交互，不转移该项目的事实。Preschool 原始数据和已发布配置当前明确为 30 个中心、270 个回路；数字必须从当前输入重新计算。

## Skill 构成与版本

- `../skills/preschool-portfolio-report/SKILL.md`：当前 1.0.2（保留 1.0.0 / 1.0.1）；Project Skill resource `3b007ece-742d-47e0-b811-94c5c1417fee`。
- `../skills/tuya-interactive-report/SKILL.md`：当前 1.0.1（保留 1.0.0）；Project Skill resource `48eccdfa-3fb7-4c52-9b3b-e10c3000138a`。
- Tuya 保留通用 investigation 0.4.1，移出本次活动设置中的旧 composition 0.4.0，以免与新布局互相冲突；之前的设置修订及历史报告保留。
- 项目事实仍来自 configuration/context；共享 presentation/review 继续由服务端加载。没有修改共享运行时或将这两份 Skill 安装成宿主 Codex 全局 Skill。

## 实验设计

使用普通成员账户、连接的项目数据与默认 Skill，只发送简短“使用默认 Skill 生成完整交互报告”请求，不附参考 HTML、不在单次 prompt 重复版式规格。

| 项目 | 期间（本地，结束不含） | Run | 默认 Skill 实际加载 |
| --- | --- | --- | --- |
| Preschool | 2026-05-01 → 2026-06-01 | `c20d634e-67bd-4923-b4bf-200868b1759d` | preschool-portfolio-report 1.0.0 |
| Tuya | 2026-08-16 → 2026-09-11 | `46466938-34c0-48bd-9cfc-51c62322e521` | tuya-interactive-report 1.0.0 + investigation 0.4.1 |

实际 run 的 `skillUsage` 已验证，source 为 default。旧报告不被覆盖。

第一轮 Preschool 在 10:07:38Z 成功（约 7 分 53 秒），Tuya 在 10:12:55Z 成功（约 13 分 10 秒）；都经过系统自动 review。自动 review 不代替真实浏览器验收。

## 第一轮浏览器反馈与 Skill 修订

Preschool 真实 Chrome：中心 A 选择显示 843.1 kWh、reset、类型展开和 kWh/share 切换有效，桌面无溢出。但 390px 展开状态中异常明细 grid 子项最小宽度撑开到约 615px；共享 findings-first 也改变了用户明确选定的 Charles 首页顺序。1.0.1 增加所有 split/grid 的窄屏约束，并仅对此项目明确 KPI→类型汇总→关键发现顺序优先，共享证据/英文/安全边界不变。修订 Run `fc0e83d4-422f-4c33-9f8a-98bad80763a8` 实际加载 1.0.1。

Tuya 真实 Chrome：DB1 完整日小计 616.7 kWh、周末 49.6 kWh，与独立 CSV 计算一致；分类过滤和 reset 有效。但打开 8 月 26 日再切 DB1 后，小时详情仍显示旧项目总量；切周末仍保留这个工作日详情。390px 峰值/筛选双栏也撑宽到 482px。1.0.1 增加父筛选变化时更新/清除下钻状态，以及展开态所有 grid 的窄屏检查。修订 Run `e7adcadc-a97f-4b7b-9266-b5ea5e7546af` 实际加载 1.0.1。

两项修订均经系统 Agent，未手工修改成品 HTML。浏览器问题反馈进入 Skill，而不是只补一次性 prompt。最终复核结果如下。

## 验收标准

1. 结构与参考对应，而非普通简报；不复制参考成品。
2. 数值来自当前输入，主/子表不双计，缺失与零读数分开，异常排除仅为敏感性情景。
3. Preschool：五段结构、四象限、类型展开、中心详情、非营业 kWh/share 切换可用；无未来实际数据时展望诚实缺省。
4. Tuya：DB 与日类型筛选确实更新对应图表/数值、日期明细、分类过滤、reset 和章节折叠可用；官方总量和局部筛选小计明确分开。
5. 离线脚本无需外部资源；桌面与 390px 页面不横溢；表格允许内部滚动；静态数据可读、交互有真实变化。
6. 日期由输入和系统元数据决定；不得模型猜测生成时间。

## 独立计算基线

Preschool 输入 200,880 条 eligible/ok 小时记录，24,921.8123 kWh；类型总量 Senior Care 11,656.9791、Active Aging 6,605.9141、Preschool 6,658.9191 kWh。全部中心 P75：年化 EUI 10.525439、月每人 20.845844；二者均高于阈值的中心为 G/J/M（仅作为当前示例的计算结果，未硬编码进 Skill）。

Tuya 输入 41,045 条，其中 16,920 条 eligible/ok，官方总量 2,309.0650833845584 kWh。范围、缺口、日类型样本和电价均需在结果中明确。

## 后续客户复用

将选定版本发布到新项目，提供该项目的映射、元数据、营业日历和有效电价；按实际数据生成，再由人员校准分析关注点。不能直接复制样板的 centre、日期、费率或异常结论。新客户的泛化效果尚需独立案例验证。本地技术验收不替代 Charles 的业务/审美验收，也不代表已部署生产。


## 最终实测与交付

| 项目 | 最终 Run | 成功时间 UTC | 默认 Skill |
| --- | --- | --- | --- |
| Preschool | `28f0338c-2392-45b0-b1e7-2a8b28ce9f37` | 2026-09-13 10:27:30 | preschool-portfolio-report 1.0.2 |
| Tuya | `e7adcadc-a97f-4b7b-9266-b5ea5e7546af` | 2026-09-13 10:23:14 | tuya-interactive-report 1.0.1 |

Preschool 1.0.1 修复双栏后，类型基准行的 nowrap 统计文字仍撑宽到 504px。1.0.2 将换行约束写入 Skill，再由系统 Agent 修订；最终 HTML 相较上一版仅新增两条 CSS，分析内容完全保留。真实 Chrome 1440px 页面及 390px 基准展开状态均无横溢；中心 A 843.1 kWh、reset、类型展开和 share 切换通过，无 JavaScript 错误。首页 KPI→类型表→关键发现符合参考组织。

Tuya 最终真实浏览器验证：点击 8 月 26 日后切 DB1，详情同步从项目 104.39 kWh 改为 DB1 33.60 kWh；再选 weekend 清除不匹配的工作日详情。DB1 全部完整日 616.7 kWh、周末 49.6 kWh，reset 恢复 2,206.1 kWh 完整日小计和空详情。Lighting 分类仅列 423.25 与 159.90 kWh 两个回路。390px 初始及章节展开状态 scrollWidth 均为 390，无 JavaScript 错误。最终 report-payload.json 与首版解析后完全相同；computed-facts.json 被 Agent 重组并补充覆盖检查，不能以文件哈希作为数值相等证明。

证据在 worker `outputs/project-skills/`：两项目 final-browser.json、final-desktop.png、final-mobile.png、独立计算 JSON 和 final-member-readback.json。报告由真实系统 Agent 生成和修订，未手工修改归档 HTML。此处确认本地系统调用与浏览器交互验收，不宣称跨客户泛化、Charles 业务认可或生产发布。
