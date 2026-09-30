# ChatBI 与可复跑看板方案调研

> **状态：历史调研。** 本文基于“用户编辑多组件看板”的旧范围保留候选证据；当前需求已收敛为每日同步、固定结构分析与独立 AI 问数，现阶段决策以 [基于 DataFoundry 二次开发](../decisions/阶段技术选型-基于DataFoundry二次开发.md) 为准。
>
> 调研日期：2026-07-27
> 目标场景：用户在聊天中问数并迭代看板；满意后保存为个人分析模板；以后更换数据或周期后复跑。
> 证据范围：仅使用项目官方仓库、官方文档、官方许可证与 GitHub 官方 API 的当日状态；星数只作生态规模参考，不作为技术质量结论。

## 结论先行

这个需求的产品表面确实更接近 **ChatBI**，而不是需要多智能体自主规划、协作和碰撞的通用 Agent 系统。核心闭环应是：

```text
自然语言问题
  → 受语义层约束的 QuerySpec
  → 图表 / 看板 patch
  → 用户确认
  → 不可变的模板版本
  → 绑定新数据快照与参数复跑
```

其中 LLM 负责理解意图和提出结构化修改；查询、权限、指标计算、看板状态和版本保存都应由确定性组件承担。也就是说，Agent 是后台控制面，不应成为整个产品的数据面。

本次最重要的新发现是：**Apache Superset 6.1 已经比旧印象更接近目标产品。** Superset 5.0+ 官方 MCP Server 支持列出数据集、运行 SQL、生成/更新图表、生成 dashboard、向已有 dashboard 追加图表；官方用户流程还明确采用“先预览、对话迭代、满意后保存”的方式。这与目标闭环高度重合。[Superset AI 用户指南](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)｜[MCP 部署与工具权限](https://superset.apache.org/admin-docs/configuration/mcp-server/)

推荐顺序：

1. **首选：DataFoundry + Apache Superset sidecar。** DataFoundry 保留聊天、数据接入、文件、Session、审计和模板编排；Superset 承担图表、dashboard、布局、过滤器、权限与嵌入。不要 fork Superset 前端到 DataFoundry。
2. **最快验证完整 ChatBI UX：Lightdash。** 它的 AI Agent 已能基于 dbt 语义层连续追问并生成完整 dashboard，但 AI 与嵌入都是商业功能；适合先购买/试用验证，而非默认作为自由二开底座。
3. **传统 BI 优先时：Metabase。** 产品成熟、问数门槛低；Metabot 能生成图表并保存到 dashboard，但尚不是完整的“对话修改整个 dashboard”，且 AGPL、白标嵌入和嵌入式 AI 有明确商业边界。

如果甲方强烈要求“模板本身必须是 Git 可审查的文件”，可把 **Evidence 或 Rill** 作为渲染/模板引擎候选，但两者目前都不如 Superset 直接满足业务用户在聊天里修改并保存 dashboard 的闭环。

## 评分口径

评分采用 0–3：

- `0`：无官方能力；
- `1`：能通过代码或二开实现，但不是产品的一等对象；
- `2`：已有主要能力，但闭环不完整或有明显限制；
- `3`：官方直接支持该闭环。

| 候选 | 聊天问数 | 对话生成/修改看板 | 保存与复跑 | 语义约束 | 嵌入 | 许可适配 | 总体判断 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Apache Superset 6.1 | 3 | 3 | 2 | 2 | 3 | 3 | **首选 sidecar** |
| Lightdash | 3 | 3 | 3 | 3 | 3 | 1 | **能力最贴合，但关键能力付费** |
| Metabase | 3 | 2 | 2 | 2 | 3 | 1 | **成熟备选，需先算许可证账** |
| Rill | 3 | 1 | 3 | 3 | 3 | 2 | **模板即代码备选，Chat 改看板不足** |
| Evidence | 1 | 1 | 3 | 1 | 2 | 3 | **适合模板渲染，不是现成 ChatBI** |
| Wren AI（当前主线） | 3 | 1 | 2 | 3 | 2 | 3 | **适合语义层，不适合直接拿 UI** |
| DB-GPT | 3 | 2 | 1 | 1 | 1 | 3 | **仍偏 Agent 平台，方向不收敛** |
| Vanna | 3 | 1 | 0 | 1 | 2 | 3 | **仓库已归档，不采用** |

> “许可适配”评的是“能否在商业项目中低摩擦二开与嵌入”，不是许可证本身优劣。商业产品的最终使用方式仍需法务确认。

## 1. Apache Superset：最适合作为 DataFoundry 的 BI sidecar

### 已核实能力

- **聊天问数**：Superset 5.0+ 内置独立进程的 MCP Server，可连接 Claude、ChatGPT 或自研 MCP Client；能发现数据库/数据集、执行 SQL、读取图表和 dashboard。[官方 MCP 部署文档](https://superset.apache.org/admin-docs/configuration/mcp-server/)
- **生成、修改、保存**：官方 AI 指南明确给出 preview-first 流程：AI 先生成 Explore 预览链接，用户继续要求调整，满意后再说“save it”；还可生成 dashboard、自动排版、向已有 dashboard 添加图表。[官方 AI 用户指南](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)
- **人工编辑**：Explore 是成熟的可视化编辑器，图表可保存到 dashboard；dashboard 有草稿/发布、布局、过滤器、权限等完整对象。[创建第一个 dashboard](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/)
- **语义层**：Dataset 支持指标、计算列、Virtual Dataset 与认证指标，能给 AI 稳定的可查询对象；但它不像 Lightdash/dbt 那样把跨模型语义作为产品北极星，应把这一项视作“够用但不深”。[Dashboard 教程中的 Dataset 与指标](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/)
- **嵌入**：`@superset-ui/embedded-sdk` 使用 guest token 嵌入 dashboard，可隐藏标题和控制过滤器；Apache 版本即可使用。[官方嵌入指南](https://superset.apache.org/user-docs/6.1.0/using-superset/embedding/)
- **权限与审计**：MCP 工具复用 Superset RBAC；生成/更新图表、dashboard、SQL 分别检查相应权限，工具调用写入 action log。[官方 MCP 权限与审计](https://superset.apache.org/admin-docs/configuration/mcp-server/#access-control)

### 许可证、技术栈与活跃度

- Apache-2.0，适合商用修改、独立部署和嵌入；仍须保留许可证与 NOTICE。[官方仓库与 LICENSE](https://github.com/apache/superset)
- 主体技术栈为 Python 后端与 TypeScript/React 前端。
- 2026-07-27 快照：约 74k stars；未归档；主分支在 2026-07-26 仍有提交；最新稳定版为 [6.1.0（2026-05-13）](https://github.com/apache/superset/releases/tag/6.1.0)。

### 与目标的差距

- Superset 提供的是 **MCP 能力面**，不是可直接嵌入 DataFoundry 的完整原生 Chat UI；聊天界面与 Session 应继续由 DataFoundry 提供。
- MCP 的 dashboard 生成是“把图表组合成 dashboard”，还不等于本项目需要的强类型 `TemplateRevision`。仍需在宿主侧保存：
  - dashboard / chart 固定 ID；
  - 参数与数据源绑定；
  - 指标和字段契约；
  - 数据快照或周期；
  - Superset 导出的 dashboard bundle 或内容哈希。
- 不能把 Superset metadata database 当成模板领域模型的唯一真相，否则未来迁移、审计和跨环境部署会受其内部结构牵制。

### 推荐接法

```text
DataFoundry Chat / Session / Memory
        │
        ├─ Template Compiler：自然语言 → DashboardPatch
        ├─ Superset MCP：预览、生成/更新 chart、生成 dashboard
        ├─ Template Registry：保存 Revision、参数、数据绑定、外部资源 ID
        └─ Web：Superset Embedded SDK 显示 dashboard
```

Superset 应作为独立服务运行，通过 MCP、REST API 和 Embedded SDK 集成。这样能复用成熟 BI 能力，又不会把 DataFoundry 改造成 Superset fork。

## 2. Lightdash：现成能力最接近，但商业边界最明显

### 已核实能力

- **聊天问数与连续追问**：AI Agent 能从 chart 或 dashboard 上下文发起会话，保留同一会话上下文，自动选择语义指标和维度并生成图表。[AI Agent 总览](https://docs.lightdash.com/guides/ai-agents)｜[使用 AI Agent](https://docs.lightdash.com/guides/ai-agents/using-ai-agents)
- **生成完整 dashboard**：官方明确声明 Agent 可一次生成多个相关可视化组成完整 dashboard；输出为 semantic query，而不是裸 SQL，因此可以在聊天与标准 Explore UI 之间切换。[使用 AI Agent](https://docs.lightdash.com/guides/ai-agents/using-ai-agents)
- **看板保存与人工编辑**：dashboard 是正式对象，可在 dashboard 内创建/保存图表、添加已有图表、拖拽布局、添加过滤器和 tab。[创建 dashboard](https://docs.lightdash.com/get-started/exploring-data/dashboards)
- **语义层**：指标、维度和关系主要定义在 dbt YAML 中；这对“模板换周期复跑”和指标一致性很有利。[官方仓库](https://github.com/lightdash/lightdash)
- **模板即代码**：chart 与 dashboard 可导出为 YAML，并有 JSON Schema 校验与 CI/CD 部署工作流。[Dashboards as code](https://docs.lightdash.com/guides/developer/dashboards-as-code)
- **嵌入**：支持 dashboard iframe 与 chart React SDK，JWT 可携带 user attributes 做行级过滤。[嵌入指南](https://docs.lightdash.com/guides/embedding/how-to-embed-content)

### 许可证、技术栈与活跃度

- 官方自托管文档称核心为 MIT，可自行部署；代码仓主体是 TypeScript，前后端均在同一 monorepo。需要注意 `packages/backend/src/ee` 另有 Source Available License，生产使用要求有效 Enterprise Subscription，不能把整个 monorepo 笼统视为 MIT。[自托管文档](https://docs.lightdash.com/self-host/self-host-lightdash)｜[主 LICENSE](https://github.com/lightdash/lightdash/blob/main/LICENSE)｜[EE LICENSE](https://github.com/lightdash/lightdash/blob/main/packages/backend/src/ee/LICENSE)
- **关键限制**：
  - AI Agent 是 Cloud Pro / Enterprise add-on；
  - 自托管嵌入只提供给 Enterprise On-Prem；
  - 企业功能通过 license key 开启。
  [AI 能力与计划](https://docs.lightdash.com/guides/ai-overview)｜[嵌入计划限制](https://docs.lightdash.com/guides/embedding/how-to-embed-content)｜[Enterprise License Key](https://docs.lightdash.com/self-host/customize-deployment/enterprise-license-keys)
- 2026-07-27 快照：约 6.0k stars；未归档；主分支在 2026-07-26 仍有提交；最新 release 为 [0.3476.1（2026-07-24）](https://github.com/lightdash/lightdash/releases/tag/0.3476.1)。

### 判断

Lightdash 是本轮中 **产品能力最像目标成品** 的候选，但并不是“拿开源代码回来就免费拥有 AI Chat + 商业嵌入”。适合：

- 用官方 Cloud/Enterprise 做 1–2 周体验验证；
- 甲方接受 dbt 语义建模；
- 采购成本小于自行补齐 dashboard builder 的成本。

如果必须无商业授权依赖地进行深度二开，则不应把 Lightdash AI/Embedding 写进既定交付范围。

## 3. Metabase：成熟易用，但不是完整的对话式 dashboard builder

### 已核实能力

- **聊天问数**：Metabot 能用自然语言回答问题、生成 Query Builder 查询与图表、生成/编辑 SQL、分析已有图表。[Metabot 官方文档](https://www.metabase.com/docs/latest/ai/metabot)
- **AI 开源边界**：从 v60 起，Metabase 将 AI 工具放入开源版；自托管实例可接入自己的 Anthropic API key 使用内部 Metabot。AI 审计、按组 token/工具控制、定制 system prompt 等治理能力仍在 Pro/Enterprise。[AI 设置](https://www.metabase.com/docs/latest/ai/settings)｜[AI 版本说明](https://www.metabase.com/releases-ai)
- **保存**：Metabot 生成的图表可保存到 dashboard 或 collection；dashboard 是成熟的一等对象，支持 tab、过滤器、订阅、导出 PDF 和人工布局。[Metabot](https://www.metabase.com/docs/latest/ai/metabot)｜[Dashboard 介绍](https://www.metabase.com/docs/latest/dashboards/introduction)
- **明确不足**：官方限制列出 Metabot 不能调整颜色、坐标轴标签、数字格式等 visualization settings，也不能生成带变量的 SQL。它能“生成图表并放入 dashboard”，但官方证据不足以支持“在一个会话中任意修改整个 dashboard 结构”。[Metabot 当前限制](https://www.metabase.com/docs/latest/ai/metabot#current-limitations)
- **语义层**：Model、Metric、Segment、Glossary、Verified Content 能提供一定业务语义；其中把 Metabot 限制到已验证 model/metric 是 Pro/Enterprise 能力。[AI 设置](https://www.metabase.com/docs/latest/ai/settings)
- **嵌入**：dashboard、chart、query builder 和 Metabot chat 均有嵌入路径；但 SSO、交互式/模块化高级嵌入和 AI chat 有计划限制。[嵌入能力对比](https://www.metabase.com/docs/latest/embedding/introduction)

### 许可证、技术栈与活跃度

- OSS 代码（`enterprise/` 外）为 AGPL；Enterprise 目录使用 Metabase Commercial License。官方说明：免费 iframe 可选择遵守 AGPL，或遵守带 “Powered by Metabase” 的 embedding license；白标、完整交互式嵌入和企业功能需要商业许可。[仓库 LICENSE](https://github.com/metabase/metabase/blob/master/LICENSE.txt)｜[官方许可证说明](https://www.metabase.com/license/)｜[计划对比](https://www.metabase.com/pricing/compare-plans)
- 主体技术栈为 Clojure 后端与 TypeScript/React 前端；与 DataFoundry 的 TypeScript 服务栈并不一致，建议独立服务集成，不建议 fork 后深改。
- 2026-07-27 快照：约 48k stars；未归档；当天仍有提交；最新 release 为 [v0.63.1（2026-07-21）](https://github.com/metabase/metabase/releases/tag/v0.63.1)。

### 判断

Metabase 适合“80% 是成熟传统 BI，20% 是 AI 辅助”的甲方。如果目标是白标产品内嵌、嵌入式 AI、租户隔离，则应先取得正式报价和许可证意见，再决定技术路线；不要先二开后补许可证。

## 4. Rill：治理与模板即代码很强，但终端用户 Chat 改看板不完整

### 已核实能力

- AI Chat 在 Rill Cloud 中直接工作于 dashboard 上下文，理解当前 filters、time range 和 comparison；回答基于预定义 metrics view，并返回带相同过滤器的 dashboard 链接以便核验。[Contextual AI Chat](https://docs.rilldata.com/guide/ai/ai-chat)
- 有 Explore Dashboard 与可自由布局、多 metrics view 的 Canvas Dashboard；项目以 SQL/YAML 定义 connector、model、metrics view 和 dashboard，天然便于版本控制和复跑。[Dashboard 类型](https://docs.rilldata.com/developers/build/dashboards/dashboards-101)｜[开发文档总览](https://docs.rilldata.com/)
- 支持 Cloud iframe 嵌入、后端生成短期 token、按用户属性做安全策略，并有 `postMessage` API 读取/修改 dashboard UI 状态。[嵌入文档](https://docs.rilldata.com/developers/embed/dashboards)｜[iframe API](https://docs.rilldata.com/developers/embed/iframe-api)
- **关键缺口**：官方 Chat 文档强调问数、解释和跳转到现有 Explore dashboard，没有证据表明业务用户能在同一 Chat 中持续修改 Canvas dashboard 并保存成新模板。开发者可以用 coding agent 修改 YAML，但那不是甲方用户工作流。[AI 功能总览](https://docs.rilldata.com/guide/ai)

### 许可证、技术栈与活跃度

- 核心 Apache-2.0；主要技术栈 Go + TypeScript/Svelte。[官方仓库](https://github.com/rilldata/rill)
- AI Chat、正式分享与 embedding 主要依赖 Rill Cloud；本地 Rill Developer 更偏开发工具，因此需要确认 Cloud 商业方案，而不能只看核心许可证。
- 2026-07-27 快照：约 2.8k stars；未归档；最新 release 为 [v0.88.4（2026-07-24）](https://github.com/rilldata/rill/releases/tag/v0.88.4)。

### 判断

若模板必须是 SQL/YAML、主要由实施人员维护、业务用户只问数与筛选，Rill 很合适；若核心卖点是“业务用户聊天改看板并保存”，它不应排在 Superset、Lightdash、Metabase 前面。

## 5. Evidence：优秀的模板渲染器，不是开箱即用的 ChatBI

### 已核实能力

- Evidence 用 SQL + Markdown 生成交互式数据产品、报告和 dashboard；templated pages、循环与条件语句很适合把一个模板应用到不同参数和数据范围。[官方文档](https://docs.evidence.dev/)
- 可自托管到 Vercel、Netlify 或自己的基础设施；MIT 许可，适合商用二开。[官方仓库](https://github.com/evidence-dev/evidence)
- Evidence Studio 提供 AI 辅助编写 Evidence Markdown、检查 schema 和修复错误，但官方定位更像开发 IDE 中的 coding agent，不是面向业务用户的“对话问数并直接修改 dashboard”。[Evidence 官网](https://evidence.dev/)
- 技术栈为 JavaScript/Svelte/TypeScript；产物是 Web 应用/站点，嵌入容易，但用户、权限、会话、语义层与 Chat 编排需由宿主补齐。
- 2026-07-27 快照：约 6.8k stars；未归档；最后代码推送为 2026-02-18；最新 release 为 [40.1.8（2026-02-06）](https://github.com/evidence-dev/evidence/releases/tag/%40evidence-dev%2Fevidence%4040.1.8)。

### 判断

Evidence 最适合成为 `TemplateRevision → deterministic dashboard` 的 renderer：AI 生成结构化 Markdown/SQL patch，服务器校验后发布。但如果把它作为完整 ChatBI 产品，仍需自己开发聊天、看板编辑状态、权限、语义绑定和模板 registry，节省的主要只是可视化与报告渲染层。

## 6. Wren AI：当前主线是语义/上下文层，旧 GenBI UI 不宜作为新产品底座

### 已核实能力

- 当前主线已经转型为面向 AI Agent 的 open context layer：MDL 描述模型、关系、计算与访问语义；Rust/DataFusion 内核把 modeled SQL 展开并查询 20+ 数据源。[当前主线 README](https://github.com/Canner/WrenAI)
- 当前开源核心可作为 Python SDK、CLI 或 WASM 使用，适合补强 DataFoundry 的语义理解与受控查询。[架构说明](https://docs.getwren.ai/oss/reference/architecture)
- 当前 OSS 仍提供 `wren genbi`：由外部 coding agent 基于 MDL 生成并部署浏览器端 dashboard app；它是开发者/Agent 驱动的生成工作流，不是面向甲方业务用户的内置 ChatBI 编辑器。[GenBI 指南](https://docs.getwren.ai/oss/guides/genbi)
- **重要版本变化**：2026-05-07，原 Wren Engine 合并到当前仓库；过去有完整 UI 的 WrenAI GenBI App 被保留到 `legacy/v1` 分支和 `v1-final` tag。不能把旧截图或旧教程当成当前主线产品能力。[官方 README 的迁移声明](https://github.com/Canner/WrenAI/blob/main/README.md)
- 商业版文档仍展示 GenBI Apps，可从自然语言创建 dashboard、选择元素局部修改并回到 thread 继续 refine；Embedded Threads 是 Enterprise Beta，且不支持 Agentic Mode。[GenBI Apps](https://docs.getwren.ai/cp/guide/agentic/querying/genbi-apps)｜[Embedded Threads](https://docs.getwren.ai/cp/guide/integrations/embedded-threads)

### 许可证、技术栈与活跃度

- 当前 `core/**`、`sdk/**`、`skills/**`、`examples/**` 为 Apache-2.0；`docs/**` 为 CC BY 4.0；仓库预置 AGPL 文本供未来模块使用，必须按路径确认，不应笼统说整个仓库只有一种许可证。[官方路径级许可说明](https://github.com/Canner/WrenAI/blob/main/README.md#license)
- 主要技术栈 Python + Rust，另有 WASM/JavaScript 接口。
- 2026-07-27 快照：约 16.7k stars；未归档；最新 release 为 [wren-v0.13.1（2026-07-21）](https://github.com/Canner/WrenAI/releases/tag/wren-v0.13.1)。

### 判断

可以评估拿 Wren Core 的 MDL、planner 和校验能力补强 DataFoundry，但不建议从 `legacy/v1` fork 一套正在退出主线的 dashboard 产品。它是“语义底座候选”，不是“成熟看板拿来即用”的首选。

## 7. DB-GPT：能力很多，但仍偏 Agent 平台

### 已核实能力

- 官方定位是 agentic AI data assistant，能连接数据库和文件、自然语言写 SQL、运行 Python/skills、生成 chart、dashboard 和 HTML report。[官方仓库](https://github.com/eosphoros-ai/DB-GPT)
- 有 Chat Data API、AWEL workflow、Agent、sandbox 和可独立运行的 Web UI；最新主线也强调 reusable skills 和 reproducible artifacts。[Data Source API](https://docs.dbgpt.cn/docs/api/datasource/)｜[官方仓库](https://github.com/eosphoros-ai/DB-GPT)
- 但官方资料没有给出与 Superset/Lightdash 同等级的稳定 dashboard 领域模型、布局编辑器、dashboard revision、参数绑定、嵌入 SDK 或“从会话保存为可复跑模板”的完整契约。其 dashboard 更接近 Agent 输出的一类 artifact。

### 许可证、技术栈与活跃度

- MIT；主体为 Python 后端 + TypeScript Web。[官方仓库](https://github.com/eosphoros-ai/DB-GPT)
- 2026-07-27 快照：约 19.6k stars；未归档；主分支在 2026-07-26 仍有提交；最新 release 为 [v0.8.1（2026-06-18）](https://github.com/eosphoros-ai/DB-GPT/releases/tag/v0.8.1)。

### 判断

它与 DataFoundry 在 Agent runtime、data chat、skills、文件与报告上高度重叠，而目标甲方需求又正在从 agentic system 收缩到 ChatBI。引入 DB-GPT 会形成第二套 Agent 平台，增加而不是减少架构面积。

## 8. Vanna：适合参考 Text-to-SQL 交互，不应作为新项目依赖

### 已核实能力

- Vanna 2.0 能做自然语言 → SQL → 表格/Plotly 图表/摘要，提供 `<vanna-chat>` Web Component，可嵌入 React、Vue 或普通 HTML；MIT 许可。[官方仓库](https://github.com/vanna-ai/vanna)
- 它没有成熟 dashboard builder、dashboard 模板版本、跨周期复跑和语义指标层；其“训练”主要是检索 schema、文档、DDL 与成功 SQL 例子，不等于 BI semantic layer。
- **决定性风险**：官方仓库已于 2026-03-29 归档并只读，最新 release 是 [v2.0.2（2026-02-02）](https://github.com/vanna-ai/vanna/releases/tag/v2.0.2)。官方文档多个页面还明确标注为 AI 生成的 placeholder，要求以源码为准。[Web UI placeholder](https://vanna.ai/docs/placeholder/web-ui)

### 判断

不要以 Vanna 为新功能底座。可以参考它的流式 UI component、user-aware tool 和 NL2SQL retrieval 设计，但复制这些局部思路比承担归档依赖更安全。

## 对 DataFoundry 的建议方案

### 方案 A：DataFoundry + Superset（推荐）

职责边界：

| DataFoundry 保留 | Superset 承担 |
| --- | --- |
| Chat、Session、Memory、文件接入 | chart / dashboard CRUD |
| 数据源登记与 Data Snapshot | Explore 编辑器与图表渲染 |
| TemplateDraft / Revision / Run | dashboard 布局、filter、tab |
| AI 意图解析与结构化 patch | MCP / REST 执行 patch |
| 运行审计与证据回执 | dashboard RBAC 与嵌入显示 |

模板不要只保存 Superset dashboard ID，建议最少包含：

```ts
type AnalysisTemplateRevision = {
  id: string;
  version: number;
  title: string;
  requiredFields: SemanticFieldRef[];
  metrics: MetricRef[];
  parameters: ParameterSpec[];
  queries: QuerySpec[];
  dashboard: {
    provider: "superset";
    externalDashboardId: string;
    exportedBundleDigest: string;
  };
  evidencePolicy: EvidencePolicy;
};
```

执行时将 `TemplateRevision + DataSnapshot + Parameters` 解析为一次 `TemplateRun`，再更新或克隆 Superset dashboard。这样换数据/周期复跑仍由 DataFoundry 控制，而不是依赖 LLM 每次重新写 SQL。

### 方案 B：Lightdash 企业试点

若甲方愿意接受商业授权和 dbt：

1. 用其 AI Agent 直接验证“问数 → 追问 → 生成完整 dashboard”是否符合用户习惯；
2. 用 dashboard-as-code 导出 YAML，评估能否映射到本项目 `TemplateRevision`；
3. 单独验证中文问法、复杂指标、行级权限、嵌入和 AI token 成本；
4. 试点通过后再决定购买还是仿照交互在 DataFoundry + Superset 上实现。

### 方案 C：Evidence/Rill 模板即代码

如果甲方实际交付更像“固定模板自动填数与解释”，而不是自由拖拽 BI：

- Evidence：适合 SQL + Markdown 报告/看板模板；
- Rill：适合 YAML metrics view + 高性能 Explore/Canvas dashboard；
- DataFoundry：只负责聊天提炼模板 patch、数据映射和运行审计。

这个方案更确定、更易版本化，但要接受“用户聊天修改看板”的能力需要自己做。

## 建议的两周技术验证

不要先选一个项目大规模 fork。并行做三个薄验证即可：

1. **Superset Golden Slice**
   - DataFoundry 发起一个 MCP 会话；
   - 用一份甲方样例数据生成两张图；
   - 对话修改维度、时间范围和图表类型；
   - 保存并嵌入一个 dashboard；
   - 序列化为本项目的 `TemplateRevision`；
   - 换下一周期数据复跑。
2. **Lightdash 产品验证**
   - 使用官方 AI Agent 做同一任务；
   - 记录交互满意度、语义准备成本、中文效果和商业报价。
3. **许可证门禁**
   - Superset Apache-2.0 路线作为默认基线；
   - Metabase/Lightdash 只有在商业许可、白标和嵌入条款确认后才能进入交付承诺。

通过标准应是“同一模板换数据后，指标一致、布局不丢、来源可回查、无须 LLM 重新发明查询”，而不是只看第一次生成的 dashboard 是否好看。

## 最终判断

- **需求判断是对的**：这不是需要完整多 Agent 系统才能成立的场景；受约束的单 Agent / tool-calling 加成熟 BI 内核即可。
- **可以继续在 DataFoundry 上二开**：它已有 Chat、Session、数据接入、审计和 artifact 基础；但不应继续自研一整套成熟 dashboard builder。
- **最合理的复用不是“把一个 ChatBI 仓库拷进来”，而是 sidecar 集成**：首选 Superset 6.1 的 MCP + Embedded SDK；Lightdash 用于最快产品验证；Metabase 作为传统 BI/商业采购备选。
- **Wren、DB-GPT、Vanna 不适合作为本次看板底座**：Wren 当前主线已变为上下文/语义层，DB-GPT 与现有 Agent 能力重叠，Vanna 已归档。
