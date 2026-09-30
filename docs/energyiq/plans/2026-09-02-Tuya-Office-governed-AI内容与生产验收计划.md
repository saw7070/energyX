# Tuya Office governed AI 内容与生产验收计划

状态：代码候选阶段；尚未执行真实 AI Provider、生产浏览器或部署验收。

## 1. 用户可见合同

Tuya Office 保留已发布的八段确定性 Overview。确定性指标、图表、数据健康、覆盖率阈值和业务结论 withholding 继续由服务端规则控制；AI 不改写这些事实，也不决定 Snapshot 是否可发布。

AI 的首个受控范围是三个 Tuya 专属 Section：

1. `data-readiness`
2. `consumption-and-demand`
3. `meter-contribution-and-operations`

页面上的 Key Findings、三个 Section 与 Additional Insights 不在 Adapter、React 或 Server 中维护第二份顺序。它们由 exact Project Release 上的已发布 Overview Definition `aiSlots` 编译；缺槽、改名、换序、错误 revision、错误 region、Skill、Method、Context、Tool Policy、Output、Validator、Presentation 引用或外来 Release 一律 fail closed。Template/Definition 负责“有哪些分析单元、落在哪个 Overview Section、使用哪套受治理引用”，运行时 Artifact 只负责“这个 exact Snapshot 的结果是什么”。客户页只做一次只读恢复，再按已发布 `regionIntent` 把 Key Findings、局部 Section 解释和 Additional Insights 放回各自 Section。

Definition 可以在已挂载的 Tuya AI region 中调整 label、placement 与 order；Renderer 将同一 region 内所有角色按发布 order 合并排序。Generation 引用必须匹配服务端已注册且实际可执行的 Tuya capability tuple，未挂载 region、重复 order 或任何未支持的 generation revision 都在 Provider dispatch 前 fail closed，不能发布一个声明与实际 Run 不一致的 Artifact。

每个 Section 的 AI 结果必须来自与页面完全相同的 `workspaceId / projectId / scopeId / dataSnapshotId / projectReleaseId / analysisPeriod / modelProfile`，并显式携带 `reportTime policy/revision/current-overview window/from/to/phase`。Section Summary、Section Insight、Key Finding 与 Additional Insight 都必须能追溯到 `current-overview`，不得用一个泛化日期范围代替命名窗口。页面普通打开只读取已经保存的 Artifact，绝不触发 Provider 或写入；只有 Admin 的 `Generate missing analysis` 才能生成缺失结果。

三个 Section terminal 后，Key Findings 从至少两个 Section 的 accepted Insight 进行跨 Section synthesis。Tuya Key Findings 不重复数字，避免把同值误绑到另一 Circuit；数值仍由上方确定性 metrics 与图表承担。Additional Insights 使用当前 governed Method set 和只读 Evidence tools 寻找尚未被 Section/Key Findings 呈现的新角度；`energyiq-open-discovery` 在这里是受治理 Method，不是本次 Run 实际加载的 Skill，发布 Definition 与 Artifact 必须记录 `skillId=none`。没有独立价值时发布 `empty`，不得为了填满页面而重复结论。

Section Insight 的公开身份使用 `sectionId::insightId` 复合键。不同 Section 即使返回相同局部 `insightId`，也不能在 Executive synthesis、Evidence 追溯或页面 DOM anchor 中互相覆盖。只有同时具有可执行且不超过 AI Analyst 接收上限（800 字符）的 `howToVerify`、Evidence refs、命名 window 和完整 ReportTime binding 的 Finding 才显示 `Investigate with AI Analyst`。跳转携带 exact Artifact、target、Finding、Evidence、scope/resource、Snapshot、Release、analysis period、命名 window 与 ReportTime policy；AI Analyst 必须逐项核对这些 pin，并确认 Finding 的每个 `windowId` 都存在于 ReportTime windows，不能退化为只带 projectId 的泛化提问。Tuya 专属的 `windowIds` 与 Finding relationship lineage 属于 `energyiq-additional-ai-insights-v3`；Preschool 与 Ngee Ann 保持既有 v2 合同，不能以同一 immutable revision 接收新增字段。

当前 Snapshot 若仍低于 95% 覆盖率或包含不完整日：

- 确定性事实和数据健康继续显示；
- 平均日用电、周期比较、业务异常结论、节能/节费建议继续 withholding；
- AI 解释也不在客户 Overview 发布，不能绕过确定性阈值；
- 不把零值自动解释为故障、安全问题或设备停用。

## 2. 内容审查矩阵

| 维度 | Provider 可以做什么 | 必须拒绝什么 | 人工验收问题 |
| --- | --- | --- | --- |
| 能耗 / 节能 / 节费 | 解释已发布总用电、峰值、类别和 Circuit 贡献；提出需要验证的调度或控制问题 | 无 tariff 时给出金额；把 component/virtual meter 再加到 official total；把持续负荷直接称为浪费 | 所有数字是否能回到 exact claimRef；建议是否明确要求先验证设备用途和日历 |
| 安全 | 把异常或持续需求描述为“需要检查的能耗信号” | 宣称过载、线路故障、保护装置不合规或已构成危险 | 是否明确说明能耗数据不能替代合格电气检查 |
| 异常 | 解释已发布 rule/anomaly evidence，区分 observed、inferred、speculative | 用不完整日计算异常；把相关性写成原因；引用另一个 Circuit 的同值数字 | 日期、时间、Circuit、数值与 claimRef 是否属于同一实体和同一 Snapshot |
| 数据健康 | 解释 coverage、insufficient history、no readings 和 missing evidence | 把 no readings 等同于零用电或设备故障 | 是否把缺失、不足历史和真实零值分开 |

内容审查以三个 Section 各至少一个 `available` 或有依据的 `empty` 结果为通过条件。任何 unsupported number、错误 Evidence ref、错误本地时间或同值错实体候选都必须被局部拒绝；其他合格候选仍可发布。

## 3. 真实 Provider Gate（需要主 Agent 明确授权）

前置条件：候选代码已合并并部署到明确环境；目标 Snapshot/Release 已记录；环境中的模型 Profile 与候选 identity revision 一致。

执行一次 Admin `Generate missing analysis`，记录：

- 请求前后的 Provider run count；
- exact Snapshot、Release、period、model Profile 与三个 Section Artifact ID；
- 每个 Artifact 的 status、runId、accepted/rejected/published count；
- 原始 Provider 输出的受限审查副本，不把密钥或完整 prompt 写入仓库；
- 以上内容审查矩阵逐项结论。

随后连续刷新客户 Overview 和 Admin 页面，Provider run count 必须保持不变。再次执行 `Generate missing analysis` 时，已经 terminal 的 exact Artifact 不得重跑。

## 4. 生产浏览器 Gate（与 Provider Gate 分开）

只在部署得到单独授权后执行：

1. 登录生产环境，打开 Tuya Office Overview；记录页面显示的 Snapshot、Release、日期区间和 data-through。
2. 在当前约 49% 覆盖率场景，确认 deterministic 图表仍显示、所有业务结论与 AI 解释均处于 withholding，且页面没有把 partial data 表述为完整结论。
3. 在未来满足阈值的 complete Snapshot，确认三个已保存 AI Section 显示，页面刷新不产生 Provider 请求。
4. 检查桌面和窄屏的换行、overflow、空/失败/生成中状态、控制台错误与网络请求。
5. 抽查 Ngee Ann、Preschool 和另一个同 rendererKey/不同 projectId 的请求，确认 Tuya Adapter 不会被错误选中。

浏览器通过仅证明生产 UI 与只读行为，不替代 Provider 内容质量、服务部署健康或用户验收。

## 5. 下一次同步 A → B Artifact 隔离 Gate

用两个合法、不同的已发布 Snapshot 验证：

1. Snapshot A 的三个 Section Artifact 可读取，记录 A 的 exact identity。
2. 新数据原子发布为 Snapshot B；普通 Overview GET 先显示 B 的确定性事实，但只读取 B 的 Artifact identity。
3. B 未生成前显示 missing/withheld，绝不能回退显示 A 的 AI 文本。
4. 明确生成 B 后得到新的 Artifact ID；A 保留为历史，但永远不作为 B 的 current result。
5. 失败的 B 生成不改变 Snapshot/Projection publication，也不删除 A；修复后对 B 重试可成功。
6. 无新数据的日更不生成新 Snapshot，也不重算 AI。

## 6. 当前证据边界

候选只提供本地 deterministic Pack、受控 prompt、严格结果校验、exact Artifact Store、跨 Section Key Findings、governed Additional Insights、Adapter、Admin 显式生成接线和客户页只读恢复。没有真实 Provider、生产浏览器、服务部署、生产写入或用户内容签收证据；在这些独立 Gate 完成前不得把候选描述为生产验收完成。

客户页读取已保存结果时，Summary、Summary Evidence 状态和 limitation 直接可见；完整 finding 正文、epistemic state、Evidence refs、report window、来源 Section/Insight、Additional relationship/origin/alert 与下一步验证问题在原位展开，不截断为前三个标题，也不把结果复制成第二套静态文案。
