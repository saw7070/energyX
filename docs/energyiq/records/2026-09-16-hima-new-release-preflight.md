# Hima 新版发布预检（2026-09-16）

## 范围

- 生产迁移记录基线 / 本次 fetch 得到的 GitHub origin/main：`dde001e4`。
- 已验收候选：`07494566`，Integration 分支 `codex/244-report-integration`，领先 16 个提交，无反向分叉。
- 改动为 44 个文件：Insight/Action 管理、来源关联、优先级、可逆分组、聊天工具、隔离 Demo 反馈及页面交互和验收文档。
- 不包含本地数据库、QA 用户、模拟执行数据、API 密钥、临时文件，未提交的 web 配置保留在原工作区。

## 已执行

- 重新 fetch origin 并核对 main / HEAD / merge base。
- 后端相关回归：7 文件、75 测试通过。
- 前端相关回归：6 文件、56 测试通过。
- Integration TypeScript build 通过。
- 干净的 `D:/Projects/energyiq-main` 已 fast-forward 到 `07494566`；尚未 push。
- main TypeScript build、Next.js 生产 Web build（含类型检查和静态页面生成）均通过，进程退出码 0。
- 新数据库结构为新增 `CREATE TABLE IF NOT EXISTS` 表，包括行动来源、优先级、Insights、关联、分组和 Demo 记录。没有破坏性删除或改列迁移，不应覆盖现有业务库。

## 当前阻塞

实际新开云效流水线页面后，SSO 返回：**当前 RAM 用户不在管理员选择的用户范围之内，请联系管理员**。当前 Chrome 登录主体无 Hima 组织访问权限；已请用户切回此前有权限的公司账号。

尚未核对当前 Codeup main、当前流水线 YAML、当天备份和部署中的任务。因此未 push GitHub / Codeup、未触发流水线、未修改服务器或切换服务。不能宣称发布完成。

## 恢复访问后

1. 读回 Codeup main 和 Flow 1408538 配置，确认是否有镜像/自动触发；不假定 GitHub push 就会发布。
2. 核对在线版本、队列空闲和现有一致性备份流程，保留 API env、SECRET_MASTER_KEY、storage 与报告 worker 隔离设置。
3. 同步已验收 main 到 Codeup，触发现有流水线，记录实际 commit、备份及部署批次；不要覆盖迁移时在云效修复的部署脚本。
4. 在线检查登录、Explorer、新 Action 页面、模型对话/报告、Skill 版本、自动化与 Demo 隔离，并确认每日 02:00 Tuya 同步仍启用。
5. 如回退，只在确认写入边界后切回版本；不能重启旧服务器覆盖新机新增数据。

本地回归日志：Integration 的 `outputs/action-integration-20260914/release-*-tests.log`、`release-build.log`、`release-main-web-build.log`。
