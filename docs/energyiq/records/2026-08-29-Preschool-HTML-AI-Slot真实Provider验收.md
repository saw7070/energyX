---
title: "Preschool HTML AI Slot 真实 Provider 验收记录"
summary: "Issue #212 在固定 Preschool Snapshot/Release 下的受管 Profile、六 Slot Provider 运行和读路径证据。"
doc_type: record
status: "blocked-pending-human-review"
updated_at: "2026-08-30"
---

# Preschool HTML AI Slot 真实 Provider 验收记录

Issue：[#212](https://github.com/Zion74/energyiq-datafoundry/issues/212)。本记录只保存不可逆的运行摘要，不保存 API key、密文、完整模型输出或 `.env` 内容。

## 固定身份

- PR #213 接手时固定 exact head：`79220a6551e058cefc11e1c05af3e562b6fdcd66`；`afc7a0e0d387998144bf7d606cd085c7c75d40c6` 是早期历史审阅 head，已由本记录末节的 round-10 evidence supersede；基线/merge-base：`911db47484298e3d120c762459001ae3f285d0a2`。旧 Provider 证据还包括 runtime head `d858b4458e0af47f845113f3da22a1747e9debe1`；因后续把 Definition governance bindings 和 Report-time 三元组纳入 HTML identity，旧 head Artifact 不作为当前结果。
- Workspace / Project / Scope：`preschool-demo-org` / `preschool-demo` / `preschool-project`。
- Snapshot / Release：`energy-snapshot-63a6ababc1a86aa2a296e0d7` / `preschool-demo-template-v4`。
- Period：`2026-04-30T16:00:00Z → 2026-05-31T16:00:00Z`；API pin `2026-05-01 → 2026-05-31`。
- Model Profile：`workspace-default@1`，`deepseek / deepseek-v4-flash`，safe metadata `connectionStatus=connected`、`hasSecret=true`。解密发生在 server-only `run-config-resolver` → Metadata `EncryptedSecretStore` 路径；受管 EnvironmentFile 只注入隔离 API 子进程，密钥值未读取、复制、输出或提交。
- Prompt / workflow：`preschool-html-slot-prompt@6` / `preschool-html-ai-slot-workflow@3`。

## 早期 head 的一轮真实六 Slot Provider 结果（历史）

每一项都进入了真实模型 runtime；结果是“4 个拒绝、2 个可用”，不是 preview 结果。低风险 Executive probe 先独立跑过一次并被 `PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT` 拒绝；下表来自随后全新隔离副本中的完整六 Slot POST，因此六项均是该轮独立 Provider 调用。

| Slot | Provider Run | latency | input / output tokens | candidate HTML bytes / SHA256 | acceptance |
|---|---|---:|---:|---|---|
| Executive | `preschool-html-slot-executive-summary-024881c1-041d-4618-be16-bc62f9a4d33f` | 6.793s | 5,231 / 451 | 1,184 / `ef6e2dca0d0fc828159cb3633967faebfcd58f375a4fb3d191e5782b67a7d9e7` | available Artifact |
| Centre benchmark | `preschool-html-slot-centre-benchmark-a27c24b4-3006-4537-a82a-037143195477` | 19.212s | 8,457 / 2,288 | candidate hash only / `e2d55355de5c681cfee982da53169b1f1b13032cb7d0fdf6fd8ff1835c14b10e` | rejected: `PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT` |
| Closed-hours | `preschool-html-slot-standby-wastage-8831529a-401b-4aa0-9d18-4a2525a05dbe` | 13.790s | 5,430 / 1,528 | candidate hash only / `3b5f372a7951c2a0cfc90726f7714f81bd2da81efdb584da440cff51ef326426` | rejected: `PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT` |
| Operating behaviour | `preschool-html-slot-operating-behaviour-8b424e56-2c18-4fba-bf83-aca244adcfcc` | 7.311s | 5,759 / 828 | candidate hash only / `64328291eec5733598fe00d9bd57515284af98854f79ba536d16c5ca0a7bd180` | rejected: `PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT` |
| Planning outlook | `preschool-html-slot-planning-outlook-375561c0-c061-45b4-b7b9-ef6bb36a293d` | 4.726s | 2,656 / 183 | 432 / `0d5f41cc7fe71006393d57db83a1a3333f167a360bd501468b184f1eae0b598d` | available Artifact |
| Additional Insight | `preschool-html-slot-additional-insight-a9e8d1b7-03d0-4a5b-911b-19acf1e2bca5` | 33.946s | 8,649 / 1,067 | candidate hash only / `be9fad6a6f063f1571c6b87ac3c04b12c13746511bf0501501a55e4c355fc431` | rejected: `PRESCHOOL_HTML_AI_SLOT_UNSUPPORTED_FACT` |

## A/B、读路径与浏览器边界

- 结构化 Overview 始终作为权威 baseline；本轮 Provider 结果未达到全六 Slot Artifact acceptance，因此没有进行“可读性、决策价值、视觉形式、证据正确性”的通过评分，也没有 cherry-pick 或只挑选两个 available Slot 宣称整体通过。两个 available 结果仅证明静态 HTML 合同、Evidence acceptance 和 Artifact persistence 通过。
- 对同一 pin 的 HTML Slot GET 连续两次：HTTP 200，返回状态与五个 failed/一个 available 不变；metadata `runs=224`、HTML Artifact rows=17、最大 `updated_at=2026-08-29T13:52:34.279Z` 前后均不变，Provider mutation delta `0`、Artifact mutation delta `0`。
- 自动化 HTML/API/UI focused：最终 head 修复后相关合同/runner/workflow/API/页面测试与 build 已通过；失败 Slot 的 run/session/latency/token/HTML hash 也被保留。`npm run build`、`npm run build:web`、docs strict、docs link smoke 均通过；此前 EnergyIQ seams 7 files / 143 tests 通过。失败记录只保存受限运行元数据和 hash，不保存完整模型输出。
- 未完成三轮独立 Provider A/B：本记录只有一轮最终 head 的完整六 Slot Provider 样本，加一轮低风险 probe；稳定 immutable identity 下重复 ensure/read 只能验证 cache/read path。要取得三轮独立样本，必须由主 Agent批准三个独立隔离 Artifact Store/evaluation identity，并仍固定上述 Snapshot/Release/Profile。
- 当前运行没有 Browser/Chrome/Playwright 可调用插件或可用浏览器依赖；iframe sandbox/CSP/响应式/无障碍仅有源码合同和 Happy DOM 测试证据，不能声称本地浏览器或人工设备验收。

## 当前结论

历史结论已被下方 round-10 结果取代；本记录仍保留该早期失败样本以便追溯。

## 2026-08-30 claim/block acceptance 修复后的最终验收

本节是当前 Track B 的可复核结果。它不把多次修复尝试包装成三轮独立质量 A/B，也不把 preview fixture 当作模型证据。

### 合同与确定性 replay

- 硬拒绝：不安全 HTML、脚本/外部资源、identity 不匹配、虚构 Centre/KPI/实体、未知 Evidence ref、以及与 bound evidence 显著冲突的关键事实；这些仍 fail-closed。单一、明确标注的主事实冲突仍按关键事实处理；带有多个 claim 或明确标为 optional/note/hypothesis/provisional 的局部冲突则降级为 block warning，不拖垮整个 Slot。
- 确定性容错：`p75` / `75th percentile`、合法 ISO/本地日期、`23:00` / `11pm`、精确单位换算和普通显示舍入。比较、趋势和定性排名只能逐字使用同一 bound record 的 server-owned `presentationText` / `claimRelations`；校验器不再从两个数字、跨 record evidence 或模型措辞自行推导关系。
- 校验器现在按 DOM/text node/block 处理；不会对 flatten HTML 使用贪婪正则。已知但未绑定到当前 Slot 的局部数字、因果或 claim 会被该 block 局部删除/降级并记录 `dropped_claims`；空 card/row/thead/tbody/details/container 会确定性 prune。若 Slot 的核心可见内容被删空，则回到结构化 Slot fallback。
- RED→GREEN replay：Centre 的 `Centre Cohort` 表头/嵌套 portfolio 数值误报、Additional 的 `p50` 尾数字及相邻同标签数值误报、Planning 的 `12.5%` 显示舍入误报，均已由 DOM entity token、最长标签/近邻同标签匹配和 percent precision 修复；unknown Evidence ref 仍保持硬失败。局部 unsupported labelled block 的 RED case 已变为 `accepted_with_warnings`，并验证不会跨比较分离的标签事实。
- Artifact Store 的 complete 与 read path 现在都要求 acceptance、generation latency/token ledger 和与最终 HTML 相符的 SHA256；缺失字段不再默认成 `accepted`，而是 fail-closed 为不可用/拒绝写入。

### 固定身份与 round-10 调用账本

- Workspace / Project / Scope：`preschool-demo-org` / `preschool-demo` / `preschool-project`。
- Snapshot / Release：`energy-snapshot-63a6ababc1a86aa2a296e0d7` / `preschool-demo-template-v4`。
- API pin：`2026-05-01 → 2026-05-31`；analysis period：`2026-04-30T16:00:00Z → 2026-05-31T16:00:00Z`。
- Model Profile：`workspace-default@1`，`deepseek / deepseek-v4-flash`；由受管 server-only Runtime 解密，密钥未读取、复制、输出或提交。
- 当前候选代码治理 identity：`preschool-html-slot-prompt@17` / `preschool-html-ai-slot-workflow@11` / `preschool-html-ai-slot-validator@13` / capability `static-html-sandbox-v7`；六个 Slot Definition 为 `@6`。output contract 仍为 `energyiq-ai-slot-html-artifact@1`，因为 JSON 形状未变。V1 仅接受静态语义 HTML；模型 SVG 暂不进入发布面，比较文本只接受 server-owned canonical 原文。既有 round-10 Provider 结果属于此前 contract 的历史 evidence，不能作为当前候选 identity 的生产验收证据。
- Fresh Standards P1 closure（不重跑 Provider/browser）：html-slot server conversation-message bound 与 120,000 字符 prompt 合同统一，并以 >24,000 字符 tail assembly test 证明 Context/Evidence/rules 不被 24,000 截断；label-semantic mismatch 改为 claim-local drop 且保留正确 label sibling；V1 静态合同拒绝 model CSS/SVG、CSS `content:`、嵌套 HTML entity 和 `<img>`，并要求比较逐字匹配 server-owned canonical relation。由于 validator/prompt/workflow/capability semantics 已旋转，round-10 Artifact、raw report 和 Provider counters 明确保留为 **pre-new-validator evidence**，未改写，不能作为当前 `validator@13` 生产结果。
- round-10 `beforeStatuses` 是 `[available, missing, available, available, available, missing]`，按 Slot 顺序 Centre 与 Additional 才是 missing；因此本轮实际只有 2 次新 Provider 调用，Executive、Closed-hours、Operating、Planning 是 immutable Artifact 命中。
- round-10 原始 report 的 `providerCallsExpected: 0` 是计数器修复前生成的报告字段，不能作为调用证据；它与 `beforeStatuses` 矛盾。现已修正 AB 脚本为 `beforeStatuses.filter(status => status === "missing").length`。metadata 的最终 Artifact 行和 Run/Event 记录解决了歧义：Centre row `created_at=2026-08-30T01:39:41.286Z`，Run `preschool-html-slot-centre-benchmark-f387346d-cb74-48e2-a7c3-590868e8862d`；Additional row `created_at=2026-08-30T01:39:52.362Z`，Run `preschool-html-slot-additional-insight-c323917b-b994-4ba2-81f9-d727b7cc1f51`。两 Run 均 `status=completed`、`model_name=deepseek-v4-flash`，各有 `RUN_STARTED`/`RUN_FINISHED` 和 1,924/1,763 个 `TEXT_MESSAGE_CHUNK`；四个命中 Artifact 的建立时间为 01:18:37–01:19:40Z。故这两项是新 Provider 成功调用，不是失败重试被误记、也不是缓存冒充；后续同 pin authenticated GET 的 target metadata counts `runs=238`、`run_events=277346`、`energyiq_overview_ai_artifacts=170` 前后完全不变。
- 已生成自洽的 corrected immutable ledger：`scratch/energyiq-html-slot-trackb-20260830-v4-real-round-10/corrected-round-10-ledger.json`。它明确保留并 supersede 原始 `report.json`，将 2 个 `missing` 解释为 Centre/Additional 新 Provider，另 4 个标为 immutable Artifact hit；不修改或删除旧 raw，也未产生新 Provider 调用。

### round-10 最终六 Slot

每个 Slot 的模型调用最多一次；本轮四个命中不再调用 Provider，且没有第二次 LLM 润色。最终 Artifact 与 Run/Event 中的 latency/token/hash 一致：

| Slot | status / acceptance | latency | input / output tokens | HTML SHA256 | dropped claims |
|---|---|---:|---:|---|---|
| Executive | `available / accepted` | 9.424s | 5,341 / 1,161 | `911971579aecf59166a7a1604190bafe8bc1a5d7e06b67dc6e4d8acb457f0455` | 0 |
| Centre benchmark | `available / accepted_with_warnings` | 11.053s | 8,445 / 1,923 | `7108cdfecb20576fbc659d46ebd4fb8358ee95893bad9b3e57a278064549b5a4` | `html-block-19 unsupported-fact` |
| Closed-hours | `available / accepted_with_warnings` | 9.224s | 5,546 / 1,326 | `015cca66179c1e0adaddc9c43611a7deb801fe0082eb7777a7e9d825e0f404cf` | `html-block-10 unsupported-fact` |
| Operating behaviour | `available / accepted_with_warnings` | 9.969s | 5,869 / 1,369 | `264f087aa364ee21c1244ed42859733cb0b6d3488e02d5191d3984d2a8c560c8` | `html-block-13 unsupported-fact` |
| Planning outlook | `available / accepted` | 6.607s | 2,771 / 855 | `3b9da25c31f864a69c8bec6ea1c22f3e6681c04ecb768a932f383ab0be840d9b` | 0 |
| Additional Insight | `available / accepted_with_warnings` | 12.736s | 8,633 / 1,762 | `2d88e2e27f4c8b889d59bb43445906ee9920c56f69a579e5c35e447ebe698e63` | `html-block-8 unsupported-causal-claim`; `html-block-12 unsupported-fact`; `html-structure-details-1 empty-structure` |

This is one complete fixed-identity six-Slot evidence set, not three independent A/B rounds. The old failed rows remain auditable in the isolated store; they were not relabelled as success.

### Structured baseline vs real HTML ledger

The following is the per-Slot comparison ledger for the same Snapshot/Release/Period and identity table above. “Readable/value” is an engineering review observation, not an independent product-owner or accessibility score.

| Slot | Old structured baseline | New real HTML result | Evidence correctness | Readable / decision value | Presentation form |
|---|---|---|---|---|---|
| Executive | `available` executive synthesis | `accepted`, no drops | Validator accepted; key claims retained | Readable, high value for first equipment checks | Structured narrative/cards → HTML KPI cards and callout |
| Centre benchmark | `available` section interpretation | `accepted_with_warnings`, `html-block-19 unsupported-fact` dropped | Retained KPI/table claims validator-accepted | Readable and value-retaining; local unsupported block visible | Structured narrative/rank view → HTML KPI cards and comparison table |
| Closed-hours | `available` section interpretation | `accepted_with_warnings`, `html-block-10 unsupported-fact` dropped | Retained spike/table claims validator-accepted | Readable and value-retaining for late-night checks | Structured narrative → HTML spike table and detail disclosure |
| Operating behaviour | `available` section interpretation | `accepted_with_warnings`, `html-block-13 unsupported-fact` dropped | Retained leading-circuit claims validator-accepted | Readable and value-retaining for operating review | Structured narrative → HTML measure table |
| Planning outlook | `empty` structured AI section; deterministic metrics remain | `accepted`, no drops | All retained claims validator-accepted | Readable watch signals; useful despite empty old narrative | Deterministic metrics → HTML watch-signal cards |
| Additional Insight | `unavailable` structured AI insight; deterministic metrics remain | `accepted_with_warnings`, `html-block-8 unsupported-causal-claim`, `html-block-12 unsupported-fact`, `html-structure-details-1 empty-structure` dropped | Retained intensity table validator-accepted; unsupported causal/detail blocks removed | Readable and value-retaining for intensity review | Deterministic metrics → HTML intensity table and warning callout |

### Structured vs HTML、浏览器与只读边界

- Deterministic Overview remains authoritative; HTML is only the presentation layer and the structured Slot remains the safe fallback. The comparison ledger records identity, prompt/workflow/validator, latency, tokens, hash, acceptance, dropped claims, evidence correctness, readability, decision value and presentation form.
- Engineering/manual visual observations for the round-10 real artifacts: Executive is readable with high decision value and all key claims retained; Centre is readable/value-retaining with KPI/table content and one local block dropped; Closed-hours is readable/value-retaining with the spike table and one local block dropped; Operating is readable/value-retaining with the spike measure table and one local block dropped; Planning is readable/value-retaining with watch-signal cards and no drops; Additional is readable/value-retaining with the intensity table while its causal/unsupported/details blocks are visible as dropped warnings. Factual safety is the validator result above; these observations are not an independent product-owner or accessibility sign-off.
- Browser review uses only the six round-10 real Artifact payloads, never preview fixtures. Desktop integrated A/B views are `scratch/energyiq-html-slot-trackb-20260830-v4-real-final/structured-vs-html-real-provider-desktop-a.png` and `.../structured-vs-html-real-provider-desktop-b.png`; mobile integrated A/B views are `.../structured-vs-html-real-provider-mobile-a.png` and `.../structured-vs-html-real-provider-mobile-b.png`. Each A/B page was visited slot-by-slot with `scrollIntoView` and a frame-ready wait before capture. Per-slot desktop/mobile captures are retained under the same directory as `integrated-scroll-*-slot-*.png` and `slot-0*-desktop.png` / `slot-0*-mobile.png`. The earlier all-six full-page captures are diagnostic only because the browser did not paint every opaque-origin iframe until it was scrolled into view; they are not acceptance evidence. Warning badges explicitly show `accepted_with_warnings` and dropped block IDs.
- Browser mechanical check: 6 outer iframes, each `sandbox=""`, `referrerpolicy="no-referrer"`, no `src`, zero outer scripts, zero external links; every frame has zero scripts, non-empty text, headings, and no empty card/table/details/container after rendering. This proves local rendering/sandbox and absence of the previously observed blank structures, not human device approval.
- Responsive contract: the host ignores model `preferredHeightPx`; desktop/mobile use bounded width-bucket iframe heights with internal vertical scrolling. The opaque-origin document wraps model HTML in `.ai-slot-html-content`, uses horizontal overflow for wide tables, and applies the complete host-owned layout stylesheet; model CSS is rejected before persistence. No model JavaScript, parent-DOM reads, or resize messaging is used.
- Fresh local Chromium capture harness consumed the six stored round-10 Artifact JSON payloads (no Provider call) and wrote `scratch/energyiq-html-slot-trackb-20260830-v4-real-round-10/browser-capture/real-<slot>-desktop.png` plus `real-<slot>-mobile.png`. The four warning Slots visibly show `accepted_with_warnings` and their dropped IDs; Centre/Closed-hours/Additional show mobile overflow affordances. This is a browser rendering check of real payloads, not a production-route, device-accessibility, or product-owner sign-off.
- Authenticated exact-pin GET returned HTTP 200 with six `available` Slot entries. Read-only counters before/after were unchanged: `energyiq_overview_ai_artifacts=170`, `runs=238`, `run_events=277346`; therefore this GET caused 0 Provider calls and no target Artifact/Run/Event mutation.

### 当前结论与边界

当前实现已把四类拒绝根因收敛到同一 immutable identity 下 6/6 可见安全结果：2 `accepted`、4 `accepted_with_warnings`，无 fallback Slot、无 validator 放松、无第二次 LLM；但这些 round-10 结果属于旧 `prompt@8`/`validator@3`/`sandbox-v1` identity。当前候选 `prompt@17` / `workflow@11` / `validator@13` / `sandbox-v7` 只完成了确定性 replay/合同验证，生产环境必须在部署新 identity 后重新生成并验收，不能把旧 Provider ledger 晋升为当前证据。正式产品/设备可读性、决策价值及 merge gate 仍需独立 Standards+Spec、CI 与产品签核。PR #213 继续 no-merge/no-deploy。

## 2026-08-30 production current-main 失败样本与本地确定性闭合

- 在 production `main@49ac0914576c88e19b48a49ccf011cbfd0e6c164` 上显式物化六个旧 identity Slot，`model_request_snapshots` 由 85 增至 91；六次调用顺序执行总计约 26.6 秒。该调用由主发布线发生，本轮修复只读 Run/Event，不再次调用 Provider。
- 旧结果为：Executive `UNSAFE`；Centre、Closed-hours、Operating、Additional 为 `EVIDENCE_INVALID`；Planning 可用但三个事实 block 被 `unsupported-fact` 局部删除并留下空 disclosure。完整模型输出、prompt 和证据包未写入本文或聊天。
- 确定性 replay 证明三类根因：Executive 只使用了安全语义 `<h1>`，旧静态 allowlist 未收录；四个 Evidence 错误来自不同 pack record 共享同一低层 query ref 后被全局 collision 误杀，而它们使用的直接 Evidence item id 唯一且已返回；Planning 的 summary/change/off-hours 记录没有 server-owned `presentationText`，模型的正确可读表达无法通过 exact relation gate。
- 修复不放松脚本、事件、外链、CSS、SVG、图片、伪元素、Evidence 或比较事实边界：V1 增加安全 `<h1>`；Evidence 索引只把本次实际返回的直接 id/alias 纳入唯一性检查；server 为 deterministic facts 与 Section pack 提供 atomic `presentationFacts`，并要求模型逐句原样复制到各自 anchored owner。Presentation facts 只格式化同一 record 已有数值/日期/实体，不做跨 record 推导或第二次 LLM 改写。
- 因静态合同、prompt projection、validator 与 workflow semantics 改变，当前候选治理 identity 已旋转为 `prompt@17` / `workflow@11` / `validator@13` / `sandbox-v7`，六个 Slot Definition 旋转到 `@6`。上述六个 production 旧结果只作为历史失败证据；当前候选 identity 仍须在合并部署后重新生成，才能得到真实 6/6 production acceptance 结论。

## 2026-08-31：Evidence anchor 归一化修复

部署后的真实六 Slot 生成曾达到 4/6；Executive 与 Additional 以
`PRESCHOOL_HTML_AI_SLOT_EVIDENCE_INVALID` 失败。只读回放证明这不是模型内容整体不安全：Additional 的 HTML 已锚定
server allowlist 内的 summary ref，但模型漏把该 ref 重复写进顶层 `evidenceRefs`；Executive 的直接 deterministic fact id
与 pack record provenance alias 同名，旧单遍索引把合法直接 id 当成 collision。

修复后，服务端从最终静态 HTML DOM 收集实际 `data-fact-ids`，只把已经在 server allowlist 中、但顶层遗漏的 anchor
并入最终 `boundEvidenceRefs`；未知 anchor 仍 fail closed。Evidence index 改为两遍：本次返回的直接 record id 优先，
provenance alias 不覆盖直接 id，真实 alias 冲突仍拒绝。没有新增第二次模型调用，也没有放松脚本、外链、CSS、SVG、
实体或事实边界。新增两条真实失败形状的 RED→GREEN，HTML runner/workflow 共 111 tests 与 API build 通过。该修复仍须
在新 Release 上重新生成六个 Slot，生产 6/6 才算最终验收。

## 2026-09-02：最终 validator@13 / Slot Definition@6 的 v7 重新生成

本轮闭合上一节明确留下的 identity 门，不复用旧 Artifact。Milestone A 固定实现 head 为
`4be66ad2d3648cf9ca60f80de12c564e5baa7d74`，base/merge-base 为
`65d94c9c57d5f42f96575660b5a9b551bfb49cf8`；fresh Standards 与 Spec 均为
`0 P0 / 0 P1 / 0 P2`。启动迁移检测到六个 Definition 与 validator identity 变化后，发布新的不可变
`preschool-demo-template-v7`，而不是原地改写旧 Release。完整 Overview projection 随后显式预热到 v7，耗时
`14.653s`，没有把该计算塞回普通 Overview GET。

固定身份：

- Workspace / Project / Scope：`preschool-demo-org` / `preschool-demo` / `preschool-project`；
- Snapshot / Release：`energy-snapshot-63a6ababc1a86aa2a296e0d7` / `preschool-demo-template-v7`；
- API pin：`2026-05-01 → 2026-05-31`；analysis period：
  `2026-04-30T16:00:00.000Z → 2026-05-31T16:00:00.000Z`；
- Prompt / validator：`preschool-html-slot-prompt@17` / `preschool-html-ai-slot-validator@13`；
- 六个 Slot Definition 均为对应的 `@6`。

第一次全六 Slot 显式 POST 中 Closed-hours 被 `PRESCHOOL_HTML_AI_SLOT_UNSAFE` 拒绝，其余五项可用；只对该失败
Slot 做了一次显式 retry，得到可用 Artifact。最终固定 read model 为 6/6 available：

| Slot | status / acceptance | latency | input / output tokens | HTML bytes / SHA256 prefix | dropped blocks |
|---|---|---:|---:|---|---:|
| Executive | `available / accepted` | 3.487s | 5,813 / 226 | 489 / `657d09718538` | 0 |
| Centre benchmark | `available / accepted_with_warnings` | 5.243s | 25,178 / 722 | 1,367 / `7398286f68ca` | 1 |
| Closed-hours | `available / accepted_with_warnings` | 5.215s | 6,910 / 949 | 1,568 / `d289342f1d77` | 5 |
| Operating behaviour | `available / accepted_with_warnings` | 8.645s | 7,695 / 1,453 | 1,741 / `98d090775290` | 4 |
| Planning outlook | `available / accepted_with_warnings` | 3.027s | 3,238 / 246 | 405 / `7bdad5e70f9b` | 1 |
| Additional Insight | `available / accepted_with_warnings` | 3.997s | 34,065 / 272 | 414 / `bfdb2ed8ffed` | 1 |

读路径采用同一 exact pin 连续 GET 两次：两次均 HTTP 200、`41,088` bytes，完整 payload SHA256 都是
`953344ab1c9b6cd06b418395e1db8e02d7baf8abb39af4c9c0a8abf8bf98a007`。同一 read-only SQLite
连接观测 `model_request_snapshots 84 → 84`、`PRAGMA data_version 2 → 2`，所以这两次普通读取为
`0 Provider / 0 metadata mutation`。

本地完整页面位于 `http://127.0.0.1:13006`。浏览器 exact v7 页面确认：六个 Slot 均进入非空 sandbox
iframe；`iframeCount=6`；无 HTML fallback、unsafe 或 unavailable；页面仍显示权威确定性 Overview 与
`1 May 2026–31 May 2026` Report window。五个 warning Slot 显示局部 unsupported claim 被删除的提示，
没有把一个局部问题升级为整 Slot 失败。

边界：这是当前 `validator@13 / Definition@6` 候选在本地真实模型、真实 Snapshot、完整读路径和浏览器中的
6/6 工程验收；尚未 push、PR、CI、merge 或 production deploy，不能称生产已上线。
