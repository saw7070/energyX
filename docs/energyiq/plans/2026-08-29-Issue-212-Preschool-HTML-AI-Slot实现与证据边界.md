---
title: "Issue #212 Preschool HTML AI Slot 实现与证据边界"
summary: "六个 AI Slot 的静态 HTML 沙箱、服务端物化与真实 Provider 验收边界。"
doc_type: playbook
status: in-progress
tags: [Preschool, AI-Slot, HTML, Sandbox, DeepSeek]
updated_at: "2026-08-31"
---

# Issue #212 Preschool HTML AI Slot 实现与证据边界

Issue：[#212](https://github.com/Zion74/energyiq-datafoundry/issues/212)。本计划在当前基线 `911db47484298e3d120c762459001ae3f285d0a2` 上选择性吸收两个脏 WIP；不重置、清理、stash、覆盖或继续使用任一 WIP worktree。

## 实现范围

- 六个 Slot：`executive-summary`、`centre-benchmark`、`standby-wastage`、`operating-behaviour`、`planning-outlook`、`additional-insight`。
- 每个 Slot 一次服务端模型调用；确定性 Overview 仍是权威来源，失败回退到现有结构化 Slot。
- Prompt 顺序固定为通用 Evidence-first Charter/Skill → Slot Definition → audience/purpose/presentation intent → exact Snapshot/Release/Period/Evidence Context。
- V1 只接受静态语义 HTML（短文、KPI、表格、列表、callout、native `details`）；生成内容进入无 `allow-*` 的 opaque-origin sandbox iframe。为先稳定交付真实效果，模型 SVG/CSS、JavaScript、外部资源、表单、导航、storage/cookie 与主 DOM 均被拒绝；图形类输出留给后续 server-owned chart contract。文字的颜色、尺寸、位置、裁剪和 responsive layout 统一由 host stylesheet 控制。
- 复用现有 Overview AI Artifact Store；`GET .../html-slots` 始终只读。成功发布新 Overview Snapshot 或 Project Release 后，服务端在发布响应之外异步 ensure 当前 exact identity；显式 `POST .../html-slots/ensure` 保留为人工修复入口。Identity 命中 immutable Artifact 时不再调用 Provider。

## 吸收与排除

吸收 Codex WIP 的合同、server-only Slot runner、sandbox/presentation、Artifact acceptance 和 focused tests；吸收 Grok WIP 的 `aiPresentation=html` URL switch、六个明确标为 preview 的 fixture、页面 registry/dashboard wiring。Grok fixture 只能证明本地预览接线，不是模型质量或 Provider 证据。

历史 Codex WIP 中的 unrelated copy-prompt/identity rotation、旧计划和 metadata revision 旋转仍不吸收；本轮因 validator/security semantics 改变，当前 HTML Slot 的 prompt/validator/capability identity 必须显式旋转。排除 Grok WIP 中未连接服务端物化的 preview 结果及无关变更。A/B 脚本重写为调用现有显式 HTTP generation path，不直连进程环境 Provider，不复制密钥到 `.env`。

## Identity 与读写语义

HTML Artifact identity 必须同时绑定 Workspace、Project、Scope、Snapshot、Release、Period、Workspace default model profile/revision、Prompt revision 和 Slot Definition revision。Slot Definition revision 不能由浏览器提交；服务端从 Slot registry 生成。

普通 Overview GET、HTML Slot GET、项目切换和 Saved read 不触发 Provider、不 queue/claim/complete/fail，也不准备 builtin resources。HTML 页面在 focus/visible 或低频 revalidation 时只重读 server-owned binding；检测到 Profile、Prompt 或 Slot revision 变化即清掉旧展示并回到新 identity 的只读结果，不由读路径生成。成功发布 Snapshot/Release 后，服务端后台 ensure 新 identity；同一 identity 复用既有 Artifact，仅失败 Slot 进入已有 bounded retry。显式 POST 只用于管理员人工补生成或修复。

## 发布后自动物化（Issue #220）

- Snapshot materialize 与 Project Release publish 继续先完成确定性 Overview、Analysis Context 和既有结构化 AI 闭环；随后在 detach 前从刚发布的 immutable `ProjectAnalysisSnapshot` 捕获 HTML Slot 完整 identity，并把同一 Snapshot 一起交给 background workflow，发布响应不等待 Provider。后台不再追读 mutable current pointer；即使启动前又有更新发布，第一次发布仍用自己的 Snapshot/Release/Period 生成。
- background task 同时隔离同步 throw 与异步 rejection；失败写入既有日志/Artifact 状态，不回滚已发布 Snapshot/Release，也不把发布接口变成 500。
- workflow 仍是唯一幂等 seam：available Slot 不重算，failed Slot 才按已有上限重试；没有增加浏览器自动生成、定时轮询或新队列依赖。
- 公共 API 测试以永不 resolve 的 HTML execute 证明 materialize/publish 均不会等待 Provider，并覆盖失败隔离；workflow 回归继续证明 exact identity immutable hit 与失败 sibling 局部重试。

## 当前自动化证据

### Milestone A：默认 Overview 可见性与回滚

- 默认路由不依赖隐藏 query。发布的 Overview Definition 以
  `aiSlotPresentationMode: html | structured` 作为随不可变 Project Release 固定的上线/回滚开关。
- 管理员在 Template Change 面板使用确定性的 “Use accepted HTML Slots / Roll back to structured Slots” 操作；服务端鉴权后直接发布新的不可变 Release，并在 governed Definition diff 中显示标量 before/after。该操作不调用 AI，也不允许 AI 修改确定性 Definition。
- 只有当前 Snapshot、Project Release、时间范围和六个 canonical Slot revision 全部精确匹配，且六份
  Artifact 均为 accepted 时，Overview 才整体使用 sandboxed HTML Slots；排队中、缺失、读取失败或任何身份不匹配时，整组回退为结构化 Slots，避免混合新旧证据。
- `aiPresentation=html-preview` 仅保留为明确标注的非模型 fixture/debug 预览，不是生产上线开关。
- 普通 Overview GET 只做只读 Artifact lookup，保持 0 Provider、0 metadata mutation；本里程碑不触发生成。
- 管理员稍后可通过既有显式 HTML Slot generation API 为新 Release 生成并保存六份 exact Artifact；切换展示模式本身只发布 Release，不隐式排队、不调用 Provider。
- 本文前文记录的发布后 auto-ensure / background preparation 是独立 Issue #220 的后续设计，不属于本次 visible-only Milestone A；本次不带入 queue、server bootstrap、resume 或 publication workflow 变更。通用 Session lifecycle #228 也不在本次范围内。

- RED 阶段先运行了新增合同/API/页面测试；随后补齐实现并通过 focused contract、runner、workflow、Artifact store、API、server stage、renderer/dashboard tests。
- `npm run build` 和 `npm run build:web` 已通过；workflow test 已证明六次 Slot 调用、immutable hit 不增加调用，以及单个 Slot 失败不会拖垮其余五个 Slot。
- 页面 focused test 已覆盖 HTML 模式不重复显示旧结构化解释、单 Slot 失败的结构化 fallback，以及窗口 focus 后 binding revision 变化触发只读重读。
- 新增的大型 Snapshot 回归测试先复现了六个 Slot 在 runner 前被 `PRESCHOOL_HTML_AI_SLOT_PROMPT_TOO_LARGE` 拒绝的问题；修复后按 Slot 选择相关确定性事实、去除重复 source ref 展开，六个 prompt 均低于既有 120,000 字符硬上限，且不放宽该上限。html-slot 的 server conversation-message bound 与该合同统一为 120,000，并有 >24,000 字符尾部到 memory assembly 的回归测试。
- A/B 脚本：`scripts/energyiq/prototypes/preschool-html-ai-slot-ab.mjs`。它记录固定 binding、每个 Slot 的 latency/token/error/HTML bytes/SHA256/evidence refs/identity，并把结构化 baseline 与人工可读性、决策价值、证据正确性评分明确留为空待人工验收；真实 Provider 运行摘要见 [记录](../records/2026-08-29-Preschool-HTML-AI-Slot真实Provider验收.md)。
- 历史早期轮次曾有四个 Slot 被过严的 evidence/unsupported-fact 门拒绝；该结果不代表当前实现。随后建立了 failing-candidate replay/validator RED loop，修复了 claim-local conflict、确定性等价表达和空结构 prune，并把真实 Provider 记录更新到 round-10。后续 label-semantic 回归会局部丢弃数值与不相关 label 的错配而保留正确 sibling；同一静态合同也 fail-closed 拒绝 CSS 伪元素生成文本。

## Round-10 状态更新（2026-08-30）

- 固定同一 Snapshot/Release/Period/Workspace default DeepSeek V4 Flash identity，六个 Slot 均 `available`：`executive-summary` 与 `planning-outlook` 为 `accepted`，其余四个为 `accepted_with_warnings`；局部 dropped claim 已进入 Artifact 和页面 warning 清单，空 card/row/thead/tbody/details/container 已确定性清除。
- `beforeStatuses` 为 `[available, missing, available, available, available, missing]`，所以 round-10 实际发生 2 次新 Provider 调用（Centre benchmark、Additional Insight），另外 4 个是同 identity immutable Artifact hit。原始报告中的 `providerCallsExpected: 0` 是计数器修复前的陈旧字段，不能用作调用证据；metadata Run/Event 与 Artifact 时间戳已消除歧义。该轮是一组固定 identity evidence，不是三轮独立 Provider A/B 样本。
- 本地浏览器已检查六个真实 Artifact 的 opaque-origin sandbox iframe、无外部资源/脚本、响应式窄屏和无空结构；分面截图与每 Slot 工程观察见 [真实 Provider 验收记录](../records/2026-08-29-Preschool-HTML-AI-Slot真实Provider验收.md)。这不是独立产品负责人或无障碍签收。
- round-10 计数更正账本为 `scratch/energyiq-html-slot-trackb-20260830-v4-real-round-10/corrected-round-10-ledger.json`；旧 `report.json` 保留为 superseded raw。移动端合同测试覆盖 bounded vertical scroll、wide-table horizontal overflow 和四个真实 round-10 warning block ID 的页面呈现；未新增 Provider 调用。
- 为避免在首个可演示版本上继续扩张通用语义/图形推理，当前 contract 明确收口：模型 SVG 与全部自写 ARIA/title 通道拒绝；比较关系只接受一个 server-owned record 给出的完整 `presentationText` / canonical relation 原文，可加安全展示标签但不能改写。closed disclosure 不能为可见 sibling 授权。production current-main 六 Slot 失败样本进一步证明模型需要 server-owned atomic `presentationFacts`，而不是放松事实校验：每个可见 factual owner 复制同一 record 的完整句子，仍不得跨 record 组合或自行推导。治理 identity 因此显式旋转至 `prompt@15` / `workflow@10` / `validator@10` / capability `static-html-sandbox-v7`，六个 Slot Definition 同步旋转到 `@3`。round-10 ledger/artifacts 与 production 失败六件套均明确标记为旧 identity 历史证据；它们不能被当前 read path 当作新 identity 命中。生产 regeneration 必须在新版本部署后，由主 Agent 另行批准并固定新 Snapshot/Release/identity；本轮不伪造新 Provider 结果。

## 尚未完成且不能冒充完成的门

当前已形成一组固定 identity 的真实 DeepSeek V4 Flash 六 Slot evidence，但没有把它冒充成三轮独立 Provider A/B。尚未关闭的门是 fresh exact-head Standards+Spec review、远端 CI、独立产品/无障碍签收以及主 Agent 的 merge/deploy 决策；本轮不 merge、不 deploy。没有生成伪造 Artifact，也没有把 preview fixture 当模型结果。

真实 Provider 的完整 run IDs、计量、HTML hash、读路径计数、截图和逐 Slot 可读性/决策价值/事实安全观察见 [真实 Provider 验收记录](../records/2026-08-29-Preschool-HTML-AI-Slot真实Provider验收.md)。
