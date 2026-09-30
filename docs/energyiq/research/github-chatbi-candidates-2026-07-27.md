# GitHub ChatBI、IoT 看板与 API 数据接入候选调研

> **状态：历史调研。** 本文基于“5分钟级更新和用户编辑多组件看板”的旧范围保留候选证据；当前需求已收敛为每日同步、固定结构分析与独立 AI 问数，现阶段决策以 [基于 DataFoundry 二次开发](../decisions/阶段技术选型-基于DataFoundry二次开发.md) 为准。
>
> 调研日期：2026-07-27
> 目标场景：Tuya 平台数据接入，约 5 分钟级更新；用户通过聊天问数、持续迭代多组件看板，满意后保存为个人分析模板，并在后续周期或新数据上复跑。
> 证据范围：项目官方仓库、官方文档、官方许可证和 GitHub API 快照。Stars 仅用于观察生态规模，不代表技术质量。

## 结论先行

当前需求不应按“通用多 Agent 平台”选型，而应拆成三条必须分别成立的主链：

1. **可靠数据链**：Tuya API / Message Queue → 鉴权、增量、水位线、去重、DP Code 映射、五分钟聚合 → 可查询存储；
2. **确定性分析链**：受控指标、查询、权限、证据和数据刷新；
3. **Chat-to-Dashboard 链**：对话生成/修改多组件看板 → 用户确认 → 保存版本 → 换数据或周期复跑。

没有一个纯开源候选能在闭源商用、Tuya 接入、ChatBI、多组件看板、模板复跑和嵌入六项上同时无缺口。当前最值得验证的不是一个方案，而是三条路线：

### 路线 A：长期自有产品，默认推荐

```text
Tuya Connector
  → PostgreSQL / 时序存储
  → DataFoundry Chat / Session / 审计
  → Rill 或 Apache Superset 看板内核
  → 自有 TemplateRevision / TemplateRun
```

- **Rill** 更适合“模板即 SQL/YAML、五分钟增量复跑”；
- **Superset** 更适合“成熟通用 BI、人工编辑、嵌入和后续扩展”；
- 两者都不负责 Tuya API 采集，必须保留独立 Connector；
- 该路线许可最干净、边界最可控，但需要自己补聊天到看板的编译层。

### 路线 B：最快验证甲方交互，优先做 PoC

```text
Tuya Proxy / PostgreSQL
  → DataEase
  → SQLBot + DataEase Skills
```

DataEase 官方已经证明可通过自然语言：

- 生成包含柱状图、折线图、饼图和明细表的多组件数据大屏；
- 继续提出修改意见；
- 自动发布并返回持久化预览 URL；
- 保存/导出模板并自动刷新。

这条路线最接近“尽快让甲方摸到真实产品”，但不能直接承诺为长期闭源底座：DataEase 是 GPLv3，SQLBot 许可证还禁止修改 Logo；DataEase Skills 仓库仅 29 stars、代码量和提交量都很小，README 虽称 MIT，但仓库没有 `LICENSE` 文件。必须先确认商业授权和 API 稳定性。

### 路线 C：购买 IoT 能力，最低化 Tuya 接入风险

```text
Tuya Message Queue
  → ThingsBoard PE
  → ThingsBoard Dashboard / Rule Engine
  → DataFoundry 或其他 ChatBI 层
```

ThingsBoard 官方已有 Tuya Integration，可直接订阅 Tuya Message Queue、自动建设备、转换 DP、存储 telemetry、做单位换算并支持 RPC 控制；其 AI Assistant 也能用自然语言创建和修改 Dashboard。但 Tuya Integration、AI、白标等关键能力属于 PE / Cloud，更像采购路线，不是免费二开路线。

## 选型硬门槛

| 门槛 | 必须确认的验收结果 |
| --- | --- |
| Tuya 接入 | Token 刷新、HMAC 签名、分页/游标、频控、失败重试可长期无人值守 |
| 增量正确性 | 以设备、DP Code、事件时间为键去重；重跑不会多算或漏算 |
| 五分钟级更新 | 数据入库与看板刷新是两件事；两者都需在 5 分钟 SLA 内完成 |
| 看板持久化 | Dashboard、Widget、布局、过滤器、数据绑定可保存并重新打开 |
| 模板复跑 | 同一模板换周期/设备/数据后无需 LLM 重新发明 SQL |
| 人工确认 | AI 提议修改，用户确认后才写入正式看板版本 |
| 可追溯 | 指标、查询、数据时间范围、数据版本和来源可回查 |
| 商用许可 | 闭源交付、白标、嵌入、再分发和 SaaS 使用均有明确授权 |

## 总体能力对比

符号说明：`✅` 已有官方能力；`△` 部分具备或需二开；`❌` 不具备；`$` 关键能力主要属于商业版。

| 候选 | Chat 问数 | 对话生成/修改多组件看板 | 模板/复跑 | API/IoT 与 5 分钟更新 | 嵌入 | 许可证与二开判断 |
| --- | --- | --- | --- | --- | --- | --- |
| **DataEase + SQLBot + Skills** | ✅ | ✅ 官方 Skills 可生成、继续修改并返回真实看板 URL | ✅ 模板、导出、草稿/发布、自动刷新 | ✅ 通用 API、分页、Token 提取、主键增量；Tuya HMAC 仍建议 Proxy | △ 公开分享可用；认证嵌入多为 `$` | GPLv3；SQLBot 有额外品牌限制；**最快 PoC** |
| **ThingsBoard PE** | △ 偏 IoT 配置问答，不是通用 ChatBI | ✅ AI 可创建/修改 Widget、布局、别名、时间窗口 | ✅ JSON 导入导出、版本、Solution 模板 | ✅ **官方 Tuya MQ Integration**、Rule Engine、时序存储 | △ 公开看板；白标/高级嵌入 `$` | CE Apache-2.0；关键目标能力 `$`；**采购型 IoT 首选** |
| **Apache Superset 6.1** | ✅ 通过 MCP 客户端 | ✅ 图表预览/修改/保存、生成 Dashboard、向已有 Dashboard 加图 | △ Dashboard 成熟，业务模板版本需自建 | ❌ 不负责 API 采集，Tuya 必须先入库 | ✅ Embedded SDK | Apache-2.0；**长期 sidecar 首选** |
| **Rill** | ✅ Rill Cloud AI Chat | △ 可 AI 生成初始 Dashboard；Chat 未证明可持续修改 Canvas | ✅ SQL/YAML、cron、增量模型天然可复跑 | △ 五分钟刷新成熟；Tuya API 仍需 Connector | ✅ Cloud iframe | Core Apache-2.0；AI/生产嵌入偏 Cloud；**模板即代码首选** |
| **Lightdash** | ✅ | ✅ 能生成、编辑、保存完整 Dashboard | ✅ 可保存并按 conversation 重跑 | ❌ 依赖数据库/dbt，不负责 Tuya API | ✅ `$` | MIT core，但 AI 和 On-Prem embedding 正好是付费能力 |
| **Metabase** | ✅ Metabot | △ AI 生成图表并保存至 Dashboard；未证明能持续修改完整 Dashboard | △ Dashboard 成熟；dashboard-as-code `$` | ❌ 不负责 API 采集 | △ 深度认证嵌入 `$` | OSS 为 AGPL；闭源二开需法务评估 |
| **Wren AI 当前主线** | ✅ 面向外部 Agent 的上下文层 | △ `wren genbi` 生成前端应用，不是成熟业务用户编辑器 | ✅ MDL 可版本化 | ❌ 仍需外部采集 | △ 非成熟多租户 embed 产品 | 核心路径 Apache-2.0；旧聊天产品已 sunset |
| **Evidence** | ❌ 终端用户 ChatBI | △ AI 辅助写 SQL/Markdown，不是业务用户聊天编辑 | ✅ 模板即代码、Git 版本化 | ❌ 仍需外部采集 | △ 生成数据网站 | MIT；适合 renderer，不适合完整主产品 |
| **Xpert AI** | ✅ ChatBI + 语义模型 | ✅ Story Copilot 可创建/修改页面、Widget、样式 | ✅ Story 模板与持久化对象 | △ 有 HTTP Workflow/定时任务，但不应替代可靠采集服务 | ✅ ChatKit / WebApp | Community AGPL；Dashboard Toolset 文档标为 PRO/开发中；平台明显偏重 |
| **Cube** | ✅ 商业 Analytics Chat | ✅ 商业 Workbook / Dashboard Agent | ✅ 商业产品完整 | ❌ 仍只消费 SQL 数据 | ✅ `$` | GitHub 的 Cube Core 仅 headless 语义层；完整产品为商业采购 |

## 关键候选核验

### 1. DataEase + SQLBot + DataEase Skills

#### 为什么这次必须提升优先级

此前容易把 DataEase 只看成传统拖拽 BI，但 2026 年官方已经给出更接近目标流程的能力：

- DataEase Skills 的 `multi_deploy.py` 可创建真实多图表仪表板；
- 官方示例展示 AI 自动选择指标、图表和布局；
- 用户可继续在同一对话中提出“图表种类多一点、维度多一点”等修改；
- 创建结果会自动发布并返回唯一 URL 和截图；
- 社区版可用账号密码接入，AK/SK 和组织能力属于专业版/企业版。

来源：[DataEase Skills 官方文档](https://dataease.cn/docs/v2/skill/)、[DataEase Skills 仓库](https://github.com/dataease/DataEase-skills)。

#### 数据接入与五分钟刷新

DataEase API 数据源官方支持：

- `GET` / `POST`；
- Header、Query、Body；
- 从响应提取参数，可用于 Token 获取；
- JSONPath；
- 页码与游标分页；
- 主键增量同步更新；
- API 数据源定时任务；
- Dashboard 手动/自动刷新，刷新间隔以秒配置。

来源：[API 数据源](https://dataease.cn/docs/v2/user_manual/datasource_configuration_api/)、[仪表板刷新与导出](https://dataease.cn/docs/v2/user_manual/dashboard_using_copy/)、[更新日志](https://dataease.cn/docs/v2/changelog/)。

但 Tuya 不是普通 Bearer Token API。Tuya 官方要求请求携带 13 位时间戳、access token，并基于 HTTP 方法、Body SHA256、URL 等计算 HMAC-SHA256 动态签名。DataEase 文档只明确证明 No Auth、Basic、参数提取和时间参数，**不能据此断言能无代码完成 Tuya 签名**。更稳妥的做法是：

```text
Tuya API
  → Tuya Proxy / Connector（签名、Token、重试、游标、去重）
  → 简单内部 API 或 PostgreSQL
  → DataEase
```

Tuya 签名来源：[Tuya 请求签名](https://developer.tuya.com/en/docs/iot/new-app-singnature?id=Kdnqza5d7iwkc)。

#### 主要风险

- DataEase 核心为 GPLv3；
- SQLBot 使用 FIT2CLOUD Open Source License，本质为 GPLv3，但额外要求不能替换 Logo，衍生作品需履行 GPL 开源义务；闭源、白标交付需商业授权；
- `DataEase-skills` README 声称 MIT，但仓库截至调研日没有 `LICENSE` 文件，GitHub API 也无法识别许可证；
- Skills 只有 29 stars，最后 push 为 2026-04-21，应当按早期官方自动化脚本看待，而不是稳定公共 API；
- Chat 生成看板目前更像 Agent 调用脚本，不等于已经存在正式的 `TemplateRevision / TemplateRun` 领域模型。

SQLBot 许可来源：[SQLBot 官方仓库](https://github.com/dataease/SQLBot)。

#### 判断

**最适合做 1～2 周甲方 PoC，不应在许可和稳定性核验前直接决定为长期闭源主工程。**

### 2. ThingsBoard：Tuya 场景最强，但属于采购路线

ThingsBoard 官方 Tuya Integration 已覆盖：

- 使用项目凭据订阅 Tuya Message Queue；
- 实时接收 `statusReport`；
- 自动创建 ThingsBoard 设备；
- 通过 Uplink Converter 映射 DP Code、处理单位；
- 将数据进入 Rule Engine 和时序存储；
- 通过 Tuya Device Control API 反向 RPC 控制；
- 提供可导入的 Tuya Smart Plug Dashboard。

来源：[ThingsBoard Tuya Integration](https://thingsboard.io/docs/user-guide/integrations/tuya/)。

其 Dashboard 是真正的持久化多组件看板：Widget、布局、状态、别名、过滤器和时间窗口均可保存；AI Assistant 可通过自然语言新建或修改 Dashboard，并逐项提出审批卡，允许在同一聊天中继续 refinement。

来源：[ThingsBoard Dashboard](https://thingsboard.io/docs/user-guide/dashboards/)、[ThingsBoard AI Assistant](https://thingsboard.io/docs/user-guide/ai-assistant/)。

#### 限制

- 官方 Tuya Integration 明确要求 ThingsBoard PE；
- AI、Integrations、白标、高级多租户等能力应按 PE / Cloud 商业能力评估；
- 它的聊天主要面向 IoT 配置、Dashboard、Alarm、Calculated Field 和 Notification，不是通用经营分析 ChatBI；
- “个人分析模板”还需要自有模板注册、权限和运行记录；
- 如果业务只需要五分钟分析而不需要设备管理、告警、RPC、数字孪生，完整 ThingsBoard 可能过重。

#### 判断

**如果甲方愿意采购，并且未来会扩展设备管理、告警、控制和实时 telemetry，ThingsBoard PE 是最低接入风险候选。若只是取数分析，它可能比自建 Tuya Connector 更重。**

### 3. Apache Superset：长期通用 BI sidecar 首选

Superset 6.1 官方 MCP 已支持：

- 数据集与 Dashboard 发现；
- 执行 SQL 和读取结果；
- preview-first 生成图表；
- 在对话中修改图表；
- 用户满意后保存；
- 生成 Dashboard 和向已有 Dashboard 添加图表。

来源：[Superset AI 使用指南](https://superset.apache.org/user-docs/using-superset/using-ai-with-superset/)、[MCP Server](https://superset.apache.org/admin-docs/configuration/mcp-server/)。

成熟 Dashboard、Explore 编辑器、RBAC、过滤器、Embedded SDK 和 Apache-2.0 许可证，使它非常适合以独立服务集成，而不适合把源码揉进 DataFoundry。

缺点同样明确：

- 它没有任意 REST/Tuya 数据采集层；
- MCP 已证明“图表迭代和组合 Dashboard”，尚不能等同于“聊天自由修改所有 Dashboard 布局属性”；
- 业务模板版本、数据快照、参数绑定和复跑仍应由宿主系统维护。

#### 判断

**适合 DataFoundry 长期路线的看板内核；不解决 Tuya ingestion。**

### 4. Rill：五分钟微批与模板即代码最匹配

Rill 的 Model、Metrics View 和 Dashboard 均以 SQL/YAML 定义：

- Canvas Dashboard 是真正的多 metrics-view、多 Widget 看板；
- Git 中的项目文件可以重建环境，天然具备审查、版本和复跑；
- Model 支持 cron / duration 刷新和 incremental refresh；
- 五分钟刷新可用 `every: 5m` 或 cron 表达；
- Rill Cloud AI Chat 在 Metrics View 约束下问数，保留当前时间、过滤器和比较上下文。

来源：[Canvas Dashboard](https://docs.rilldata.com/developers/build/dashboards/canvas)、[数据刷新](https://docs.rilldata.com/developers/build/models/data-refresh)、[AI Chat](https://docs.rilldata.com/guide/ai/ai-chat)、[Rill 官方仓库](https://github.com/rilldata/rill)。

限制：

- AI Chat 文档证明的是问数、图表/表格结果以及回到已有 Dashboard 的链接；
- 尚无官方证据证明业务用户能在同一 Chat 中持续修改 Canvas 并保存；
- Rill Cloud AI 和生产嵌入有商业服务边界；
- HTTP / SQL Connector 不应被视为完整 Tuya HMAC 采集服务。

#### 判断

**如果模板的本质是“受版本控制的可复跑分析定义”，Rill 比 Superset 更贴题；需要我们自己实现 Chat → YAML Patch → 校验 → 发布。**

### 5. Lightdash：产品能力最贴近，关键能力却在商业边界

Lightdash AI Agents 官方支持：

- 基于 dbt 语义层的多轮问数；
- 生成完整 Dashboard；
- 继续 refinement；
- 创建/编辑图表与 Dashboard；
- 保存并按同一 conversation 重跑。

来源：[Lightdash AI Agents](https://docs.lightdash.com/guides/ai-agents)、[使用 AI Agents](https://docs.lightdash.com/guides/ai-agents/using-ai-agents)。

但 AI Agents 是付费 add-on，On-Prem embedding 为 Enterprise；核心虽是 MIT，甲方最需要的 AI 和嵌入并不能默认免费 fork。

#### 判断

**最适合做商业产品体验标杆或采购比较，不适合作为“GitHub 拉下来就能低成本二开”的前提。**

### 6. Metabase：传统 BI 成熟，Chat 修改完整看板仍不充分

Metabot 可自然语言问数、生成图表、编辑 SQL，并把图表保存到 Dashboard；Dashboard 本身成熟易用。但官方没有充分证明 Metabot 能在一个聊天中生成并持续修改完整 Dashboard，部分 dashboard-as-code、治理和深度嵌入能力属于商业版。

来源：[Metabot](https://www.metabase.com/docs/latest/ai/metabot)、[Dashboard](https://www.metabase.com/docs/latest/dashboards/introduction)、[嵌入能力](https://www.metabase.com/docs/latest/embedding/introduction)。

OSS 为 AGPL，Enterprise 目录使用商业许可证。闭源深度二开、SaaS 和白标需单独法务评估。

#### 判断

**适合购买/独立部署传统 BI，不优先用于闭源深度二开。**

### 7. Wren AI：适合语义层，不适合直接拿现成 UI

当前 Wren AI 主线已经转型为面向外部 Agent 的 context layer，MDL 可定义模型、关系、计算和业务语义；`wren genbi` 可以由外部 coding agent 生成浏览器端 Dashboard 应用。

但是过去完整的 chat-first GenBI 产品已被迁至 `legacy/v1` 并 sunset，不能把旧截图当作当前主线能力。

来源：[Wren AI 官方仓库](https://github.com/Canner/WrenAI)、[GenBI](https://docs.getwren.ai/oss/guides/genbi)、[MDL](https://docs.getwren.ai/oss/engine/concept/what_is_mdl)。

#### 判断

**可以借鉴/复用语义层，不应 fork 旧 UI 作为本项目主底座。**

### 8. Evidence：优秀 renderer，不是 ChatBI 产品

Evidence 用 SQL + Markdown 构建 Dashboard 和数据应用，模板、参数和 Git 版本控制非常自然，MIT 也利于二开；但其 AI 更像开发者辅助写 Evidence Markdown，不是业务用户通过聊天持续修改看板。

来源：[Evidence 官方文档](https://docs.evidence.dev/)、[Evidence 仓库](https://github.com/evidence-dev/evidence)。

#### 判断

**适合固定报告模板或 renderer，不适合作为完整交互产品。**

### 9. Xpert AI：能力很全，但方向和许可都偏重

Xpert AI 的 Story Dashboard 已支持：

- 空白、模板和上传 Story 创建；
- Widget、页面和样式持久化；
- Story Copilot 通过 `/widget`、`/page`、`/story` 创建或修改看板；
- 多轮迭代；
- 语义模型、指标和 ChatBI Toolset；
- ChatKit / iframe 嵌入。

来源：[创建 Story](https://docs.xpertai.cn/en/bi/story-dashboard/create-story)、[Story AI Copilot](https://docs.xpertai.cn/en/bi/story-dashboard/ai-assistant)、[ChatBI Toolset](https://docs.xpertai.cn/en/ai/agent/toolset/chatbi-toolset/chatbi)、[Xpert AI 仓库](https://github.com/xpert-ai/xpert)。

但它本身是 Agent + Workflow + Knowledge + Semantic + Multi-Agent 的重平台，和当前“不要过度 agentic”方向相反；Community 为 AGPL，Dashboard Toolset 文档还标为 PRO / In Development。

#### 判断

**值得参考交互和领域模型，不建议再引入一套比 DataFoundry 更重的 Agent 平台。**

### 10. Cube：完整能力是商业产品，不是 GitHub 二开底座

Cube Core 是强大的开源 headless semantic layer，可通过 SQL、REST、GraphQL 给 BI 或 Agent 提供治理后的指标；但官方明确区分：

- Cube Core：无 UI 的开源语义层；
- Cube 商业产品：Analytics Chat、Workbook、Dashboard、嵌入、RBAC 和多租户。

来源：[Cube Core 与 Cube 产品边界](https://github.com/cube-js/cube#cube-core-vs-cube)。

#### 判断

**可作为商业采购候选或自研语义层组件，不是“GitHub 拉下来即获得完整 ChatBI”的候选。**

## 快速否决项

| 项目 | 否决理由 |
| --- | --- |
| Chat2DB | 核心是开发者 SQL 客户端；智能报告在 Pro，缺少目标模板生命周期 |
| DB-GPT | Text-to-SQL / Agent 能力与 DataFoundry 重叠，成熟 Dashboard 领域模型不足 |
| Vanna | 只有问数和单次图表，缺少 Dashboard composer；仓库已归档 |
| 原 Wren GenBI UI | 已进入 legacy / sunset，不应作为新产品长期依赖 |
| 仅用 Grafana | IoT 时序展示强，但不提供目标 ChatBI 与个人分析模板闭环 |
| 仅用 Cube Core | 只有 headless semantic layer，没有开源 Dashboard UI |

## Tuya 数据链的独立结论

### 五分钟需求不等于秒级流处理

五分钟级属于近实时微批，不需要一开始引入 Kafka 等复杂流平台。建议第一期：

```text
Tuya Status Log API（每 5 分钟）
  → overlap window
  → 游标分页
  → 幂等去重
  → raw_tuya_events
  → DP Code / 单位 / 设备映射
  → device_telemetry
  → device_telemetry_5m
  → BI / ChatBI
```

Tuya Status Reporting Log 官方接口具备 `start_time`、`end_time`、`last_row_key`、`has_more` 和 `event_time`，可以形成可靠增量采集。来源：[Tuya Status Reporting Log](https://developer.tuya.com/en/docs/cloud/269c6a6b6b?id=Kduvi4xnjhav2)。

如果未来需要更实时或设备量增大，可改用 Tuya Pulsar Message Queue。官方说明它可主动推送状态上报、上下线和告警，并提供持久交付。来源：[Tuya Message Service](https://developer.tuya.com/en/docs/iot/manage-messages?id=Ka49p7loog3ze)。

### 数据采集不应交给 Agent

无论最终选 DataFoundry、DataEase、Superset 还是 Rill，以下职责都必须由确定性服务承担：

- 签名和 Token 刷新；
- 频控、重试和超时；
- 游标、水位线和 overlap window；
- 幂等去重；
- DP Code 到业务指标/单位的映射；
- 原始响应留存；
- 同步运行日志和报警；
- 五分钟聚合。

AI 应在用户提问、异常解释或生成定时分析摘要时运行，而不是每五分钟负责搬运数据。

## 建议 PoC，不先做大规模 fork

### PoC 1：数据硬门槛

用真实 Tuya 项目完成：

1. 连续运行 72 小时；
2. 每五分钟采集；
3. Token 自动刷新；
4. API 失败后重试；
5. overlap window 后无重复、无漏数；
6. DP Code 和单位转换可审计；
7. 与 Tuya 控制台抽样对账。

未通过这一步，不进入 ChatBI 选型。

### PoC 2：DataEase 最快产品验证

1. Tuya Connector 输出到 PostgreSQL 或简单内部 API；
2. DataEase 建立固定 Dashboard；
3. SQLBot 完成三轮中文问数；
4. DataEase Skills 生成至少 4 个组件；
5. 连续对话修改维度、图表类型和布局；
6. 保存模板，换一天数据后复跑；
7. 验证社区版 API、脚本稳定性和商业授权。

### PoC 3：长期开放路线

对同一份数据分别验证：

- DataFoundry + Superset MCP + Embedded SDK；
- DataFoundry + Rill YAML Patch。

统一验收：

- 创建 KPI、趋势图、对比图和明细表；
- 用户确认后保存；
- 换周期复跑；
- 布局不丢、指标一致；
- 查询与来源可回查；
- LLM 不需要重新发明查询。

### PoC 4：ThingsBoard PE 采购对比

申请 Trial，直接跑官方 Tuya Integration，记录：

- 接入耗时；
- DP 映射工作量；
- 历史补数能力；
- 五分钟聚合；
- AI Dashboard 中文效果；
- 客户级权限和白标；
- 年度许可证与运维成本。

## GitHub 活跃度快照

| 仓库 | Stars | 最近 push | 最新 release | 许可证快照 |
| --- | ---: | --- | --- | --- |
| apache/superset | 73,994 | 2026-07-27 | 6.1.0 / 2026-05-13 | Apache-2.0 |
| metabase/metabase | 48,378 | 2026-07-27 | v0.63.1 / 2026-07-21 | AGPL + 商业目录 |
| OtterMind/Chat2DB | 27,097 | 2026-07-26 | v5.3.0 / 2026-07-17 | 多许可证/Pro 边界 |
| dataease/dataease | 24,252 | 2026-07-26 | v2.10.25 / 2026-06-25 | GPL-3.0 |
| thingsboard/thingsboard | 22,137 | 2026-07-24 | v4.3.1.3 / 2026-06-30 | CE Apache-2.0 |
| cube-js/cube | 20,497 | 2026-07-27 | v1.7.11 / 2026-07-26 | Core Apache/MIT |
| Canner/WrenAI | 16,651 | 2026-07-24 | wren-v0.13.1 / 2026-07-21 | 路径级许可证 |
| evidence-dev/evidence | 6,775 | 2026-02-18 | 40.1.8 / 2026-02-06 | MIT |
| dataease/SQLBot | 6,491 | 2026-07-24 | v1.10.0 / 2026-07-16 | FIT2CLOUD 限制型 GPL |
| lightdash/lightdash | 5,983 | 2026-07-27 | 0.3476.1 / 2026-07-24 | MIT core + EE |
| rilldata/rill | 2,770 | 2026-07-24 | v0.88.4 / 2026-07-24 | Apache-2.0 |
| xpert-ai/xpert | 419 | 2026-07-25 | 无 GitHub latest release | AGPL-3.0 + 商业版 |
| dataease/DataEase-skills | 29 | 2026-04-21 | 无 release | README 称 MIT，但无 LICENSE |

## 最终 Shortlist

### 建议进入 PoC

1. **DataEase + SQLBot + DataEase Skills**
   用于最快验证“聊天 → 多组件看板 → 修改 → 保存”的甲方体验，但必须同步做许可证和 API 稳定性核验。

2. **DataFoundry + Rill**
   用于验证长期自有、模板即代码、五分钟增量复跑路线。

3. **DataFoundry + Apache Superset**
   用于验证成熟通用 BI sidecar、人工编辑和嵌入路线。

4. **ThingsBoard PE**
   用于验证“采购现成 Tuya/IoT 能力是否比自研 Connector 更划算”。

### 只做商务/产品对比

- Lightdash；
- Cube；
- Metabase 商业版。

### 只复用局部思想或组件

- Wren AI：语义层；
- Evidence：模板 renderer；
- Cube Core：headless semantic layer；
- Xpert AI：Story Copilot 交互和对象设计。

### 不进入当前主线

- Chat2DB；
- DB-GPT；
- Vanna；
- 旧 Wren GenBI UI；
- 任何只有单次图表、没有 Dashboard / Template 生命周期的问数项目。

最终决策不应是“哪个项目功能最多”，而应比较同一份 Tuya 数据在四个 PoC 中能否稳定完成：

> 五分钟更新正确 → 对话修改真实看板 → 保存不可变模板版本 → 换周期确定性复跑 → 来源可追溯。
