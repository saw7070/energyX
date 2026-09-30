# Tuya Office Overview 原子投影发布实施记录

## 范围与身份

- Issue：#224。
- 固定基线：`origin/main@3a7f66a1049ea5e216821a1dc3cfb922cb802fc9`。
- 本次只处理 Tuya 数据 Snapshot / facts 与 Managed Overview current pointer 的原子发布和失败恢复。
- 不包含 #100 最终 Overview 模板，不调用真实 Tuya Provider，不启动浏览器，不部署或改写生产数据。

## 用户可见合同

一次合法 Tuya 更新只有两种对普通读取可见的状态：

1. 上一个完整的 Snapshot、facts、Project Release 与 Overview Projection；
2. 新的完整 Snapshot、facts、Project Release 与 Overview Projection。

同步过程中、投影校验失败或进程在 pointer 切换附近崩溃时，不发布 Snapshot / Overview identity 分裂的中间状态。普通 GET 进入同一 Project 读锁，只读已发布投影；发现未恢复 journal 时 fail closed，不调用 Provider，也不执行恢复写入。

## 实现

- Metadata 新增每 Project 唯一的 durable publication journal，持久化 previous/candidate Snapshot 与 previous/candidate Overview pointer identity。
- Tuya sync runner 在 Provider 返回后进入 Project publication lock，并在锁内重新读取 prior identity；Connector hierarchy 已轮换时拒绝旧 pin。
- facts / Snapshot 候选完成后，Overview cache 在 current pointer 写入前先持久化 pointer rollback receipt；只有投影返回非空 `projectionRef` 且 receipt 完整时才清除 journal。
- candidate pointer 已写后崩溃，下一 writer 先以 exact CAS 恢复 previous pointer，再以 previous Snapshot 对应的历史 mapping fingerprint、timezone 与 hierarchy revision 重建 previous facts。
- first publication 失败时删除 candidate facts，并保持 Snapshot 与 Overview pointer 均为 unavailable。
- Setup publish、普通 materialize 与 Tuya atomic publish 进入同一 Project writer lock；普通 GET 使用 read lock，stale journal 不在 GET 内修复。
- Admin import materialization 也使用 Snapshot + Overview 同一 atomic publication seam；投影失败时 previous Snapshot / facts / pointer 保持不变，重试不再次调用 Provider。
- Imports current Snapshot、data coverage 与 Tuya status 三条普通 GET 统一进入 journal-aware read gate；发布进行中等待，遗留 journal 明确返回冲突而不是泄漏 candidate facts。
- 手工 Overview repair 与 Workspace prewarm 在写 pointer 前先恢复遗留 journal；不会先发布 candidate pointer、再被迟到 recovery 回滚成 split identity。
- 若 Snapshot + Overview 已完整发布、但进程在 source-run success 落账前中断，重试可识别 exact duplicate + already-current Projection，清理空 journal 后补齐 run/watermark，不要求虚构第二张 pointer receipt。
- AI analysis prewarm 移到 publication 成功之后；prewarm 失败不会回滚已完成的 Snapshot / Overview 发布。

## 回归边界

测试覆盖：

- first publication 无投影 receipt；
- previous complete 存在时投影校验失败；
- candidate Overview pointer 已真实落盘后模拟 crash，并恢复 exact previous Snapshot、facts、Release pointer；
- journal 已写但 first candidate pointer 尚未落盘；
- stale journal 在 setup/materialize/publish writer 前恢复，普通 GET fail closed 且零 mutation；
- Provider 等待期间 hierarchy revision 轮换；
- rollback 后下一次合法日更成功；
- 已完整发布但 source-run 尚未落账的 exact duplicate 恢复；
- Admin materialize 投影失败后保持 previous complete，并在后续重试成功；
- imports / data coverage / Tuya status 的 stale-journal fail-closed 与 publication-lock 等待；
- Admin repair / Workspace prewarm 在 pointer 写入前执行 recovery；
- post-publication AI prewarm 失败不回滚。

所有新增回归均使用仓库默认 test timeout；没有提高 timeout、跳过测试或引入新依赖。Node 22.23.2 下本轮 publication focused gate 为 7 files / 95 tests PASS；真实 crash recovery 3.58s、跨批次同步 3.74s、首次无 receipt 回滚 3.51s。DuckDB 一次性初始化放入 suite fixture，产品断言仍覆盖真实 materialization / pointer / rollback 链。

## 尚未宣称

- 未执行真实 Tuya Provider 调用、生产 rematerialization、服务启动、浏览器验收、部署或生产写入。
- 未证明多进程同时写入；本实现保护当前单服务进程的 Project writer chain，并以 durable journal 覆盖进程重启恢复。
- 未实现或复刻 #100 的最终 Tuya Office Overview 视觉模板。
