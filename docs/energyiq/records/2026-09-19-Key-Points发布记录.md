# Key Points 发布记录（2026-09-19）

## 代码范围
- main 功能提交 e00dda53，基于公司当前生产 e6b5ea54；保留 OpenAI streaming tools 修复，不携带其他模型实验提交。
- 包含四指标、三重点发布、多电表行动、现场问答、设备名称展示及字体调整。
- 不包含本地数据库、QA 密钥、报告输出文件、临时 Next 配置。

## 已核验
- Integration 相关 10 文件 110 测试通过。
- 行动详情测试改为核验新的自然语言反馈区，而非已替换的旧表单。
- 补齐 Action 前端 meterIds 类型后，Integration 和 main 的 API / Web production build 均通过。
- main 工作区干净。
- 新公司服务器只读核验：current=e6b5ea5452267f06c6b5959e357c7bf1361a3470，API/Web active，磁盘剩余约21 GB。

## 发布边界
- 云效浏览器工具两次因 request-header policy 加载失败而无法连接，尚未同步 Codeup、触发流水线或切换生产。
- 需要 Codeup 镜像同步 GitHub main 后确认 SHA，再运行 Flow 1408538。线上必须保留当前 shared 数据、环境及调度。
- Key Points 本地报告/发布记录尚未迁移到公司服务器；不得把仅代码发布当作演示内容准备完成。优先在线生成新报告并验证自动登记；若增量迁移，复用已有审核与校验流程，只迁移授权管理员内容，不迁入 QA 现场备注或虚构执行。
- 完成发布后核验管理员登录、Key Points 四指标和三行动、Review action、现场回答、报告及设备名；确认每日02:00同步仍有效。
