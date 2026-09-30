---
status: implemented-local
updated_at: 2026-09-13
---

# 报告 Skill 更新与产品内 Skill Creator

## 已执行

- Tuya 本地项目设置 revision 14：分析方法 `energy-report-investigation` 0.3.0、项目呈现 `tuya-report-composition` 0.3.0、项目主方法 0.2.0。通过受保护设置 API 保存并读回；原 contextNotes、附件、频率和自动化提示未变。旧运行仍保留原指令版本。
- 从旧方法移出写死的项目事实、旧附件名和旧结论，引用当前项目配置与独立资料。补入工作日情景加权、完整跨夜样本、共同覆盖与最后读数区分、功率量纲、正式映射优先等已验证改进。
- 分析规则明确探索候选、按影响/证据/可行动性/新增信息筛选、在篇幅预算内替换低价值内容。每期发现记入分析记录；有可复用证据才提出方法修订，不自动覆盖已接受 Skill。
- 通用 `report-presentation` 1.0.0：首屏 3–4 条结论（证据不足时减少）、正文 2–3 个研究问题、一张行动表；完整报告目标 1,200–1,500 个可见英文词。图表/章节随当前发现调整，不固定五章。
- 通用呈现文件由实际输入准备流程写入每个项目的新运行，并记录 manifest 哈希；报告和对话生成 HTML 的指令都要求读取。现有历史输入不回写。
- 产品内 `report-skill-creator` 1.1.0：保留对话到草稿的功能，补充更新既有方法、事实/方法分离、版本与变更说明、探索筛选和结论置前规则。运行使用的内容与 Skills 页展示同源。

## 产品入口与边界

Skills & Tools → General methods 新增 **Report presentation** 与 **Skill Creator**，可查看完整内容及版本。内置通用方法目前只读，避免编辑按钮误覆盖项目主 Skill。平台全局方法的在线编辑/发布尚未实现。

实际制作与项目维护在产品内进行：报告会话的 **Extract Skill** 或明确的聊天请求 → Agent 生成英文草稿 → 预览 → **Approve and save Skill**。已有项目 Skill 也可在 Skills 页编辑保存。生成草稿不等于已激活；并非每次会话都应创建一个新方法。

本次更新由用户明确授权，因此直接更新本地 Tuya 已接受设置；另行调用 Skill Creator 的验收草稿不自动替换该设置。完整的通用方法发布治理、跨项目共享权限，以及自动任务对历史分析记录的自动选择/回灌，仍不是本次完成项。Skill 中有历史跟踪规则，不代表每个自动运行已经提供了历史记录。

## 验证

- 输入准备、库 API、库 UI 共 43 项测试通过。包含任意测试项目收到通用呈现、哈希一致、两个内置条目只读、查看 Creator 不触发项目写入。
- TypeScript 与 Next 构建通过，本地 API/Web 已更新。
- 真实产品 Skill Creator 验证运行：`1788431a-74b1-42d3-ae2e-2e9225236f3b`，来源为 Tuya 修订报告 `bc482b1e-0b3b-499c-99f0-3eb5fe10aef6`。已核对真实输入包含两份 0.3.0 引用、带匹配哈希的通用呈现和新版 Creator。运行成功，产出英文 `project-skill.md`：项目方法 0.3.0 候选，明确为未激活草稿，包含探索筛选、结论置前、篇幅预算及已验证计算改进；没有覆盖正式项目方法 0.2.0。
- 浏览器确认 Skills 页面显示 5 个条目：3 个通用方法（分析、呈现、Creator）和 2 个项目方法（主方法、Tuya 呈现）。共享方法只读，项目方法仍可编辑。
- 本轮没有再生成不同时间窗口的完整报告，因此不能把 Skill 更新称为跨窗口稳定质量验收或 Charles 验收。

## main 与其他 Agent 提交

本轮 fetch 后，main / origin/main 为 `ed97d07f`。Integration 包含初始化和报告改进，尚未合入 main、未生产部署。

待集成：S2 `bf41706a` → `3a12e15c`（电表分类、质量说明）；UI `26514594`（Admin 精简）。S2 presentation 配置发布前还需核实 source_manifest 的既有草稿差异，不能把它顺带发布。以上为 Skill 更新时的状态。后续 2026-09-13 集成已完成：三个提交分别映射为 d8d56949、c2c8dac3、ef812e2a，并已合入 main。Tuya 草稿差异确认为同步产生的 source_manifest；与 36 个已物化批次逐一核对后，本地已发布 23 个电表的展示字段，计量关系不变。生产发布验收另行记录。

## 维护源

- [通用分析](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/skills/builtin/energy-report-investigation/SKILL.md)
- [通用呈现](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/skills/builtin/report-presentation/SKILL.md)
- [产品 Skill Creator](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/skills/builtin/report-skill-creator/SKILL.md)
- [Tuya 呈现](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/skills/project-presets/tuya-office/tuya-report-composition/SKILL.md)
- [Tuya 项目主方法](https://github.com/Zion74/energyiq-datafoundry/blob/main/packages/skills/project-presets/tuya-office/project-skill.md)
