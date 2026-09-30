# Ngee Ann 2026 Apr–Jun 多批次 Excel 审计结论

## 结论

四份原始 Excel 可以作为四个不可变 Import Batch 进入同一 Ngee Ann Source Adapter，但不能先人工拼成一个新的“唯一事实文件”。批次间重叠必须在 Raw 与 Canonical 两层分别处理：Raw 保留所有输入与冲突标记；Canonical 只在新批次覆盖到更晚时间时选择 later-coverage winner，并公开 readiness warning。

本次数据支持三个可验收状态：

| 状态 | 参与批次 | 可确认 dataThrough | Report Edition 含义 |
| --- | --- | --- | --- |
| A | 21 Apr–20 May 的 Level 6/7 | 2026-05-19 | April partial + May MTD |
| B | C Snapshot 内的 May Report Edition | 2026-05-31 | May complete / immutable historical edition |
| C | 四份批次当前全部数据 | 2026-06-16 | June MTD + complete May comparison |

Excel 标题中的结束日不等于可确认的完整 dataThrough。累计电表读数需要下一时点形成区间；Level 6 还有一个设备缺少各批次末尾的最后一个 15-minute point。因此 A 不能写成 20 May complete，C 不能写成 17 Jun complete。

## Source manifest

| Level | Source window | SHA-256 | Data rows | Devices | Coverage note |
| --- | --- | --- | ---: | ---: | --- |
| 6 | 21 Apr–20 May | `e4d788af0135281c8ba519f04fa3c44751206ce0812e15e434da6cb8fda44f70` | 25,919 | 9 | one device ends 20 May 23:30; others 23:45 |
| 7 | 21 Apr–20 May | `0b1fb9613c596d3569f6be93046a43737366649b5f8a4d45fc8cdef073c30e5d` | 25,920 | 9 | all devices end 20 May 23:45 |
| 6 | 19 May–17 Jun | `64502f6369dad96f3dc6cbc650b28b3f108bb655e7a95ca078b9aa616966413f` | 25,919 | 9 | one device ends 17 Jun 23:30; others 23:45 |
| 7 | 19 May–17 Jun | `3f41f94e229933a97ce8d02a0382d3a8192e3c26065bf0f48a04168ec90dd674` | 25,920 | 9 | all devices end 17 Jun 23:45 |

四个文件的字段均为 `Device Name / Time / Active Energy`；各文件内部没有重复的 Device + Time，也没有设备时间序列内部缺口。Level 6 的两批设备集合相同；Level 7 同样相同。

## Overlap audit

| Level | Overlap rows | Same value | Conflicts | Conflict timestamp |
| --- | ---: | ---: | ---: | --- |
| 6 | 1,727 | 1,720 | 7 | 2026-05-20 23:45 |
| 7 | 1,728 | 1,719 | 9 | 2026-05-20 23:45 |
| Total | 3,455 | 3,439 | 16 | same terminal point |

这些冲突符合“旧批次末点被后续导出修订”的形态：全部出现在旧批次最后一个 15-minute point，第二批继续覆盖到 17 Jun。现有 later-coverage winner 适用于这组文件，但仍须保留 Raw conflict 和 readiness warning，不能把它描述为 exact duplicate。16 个冲突 pair 会形成 32 个 Raw conflict rows，Readiness 的 count 按 Raw rows 报告。

真实摄取只产生两个新数据状态：第一批的 Snapshot A 与四批全量的 Snapshot C。B 不是伪造的中间上传或裁剪文件，而是 Snapshot C 内 `1–31 May` 的 complete Report Edition。这样既保留了 Source truth，也能独立保存、展示和比较完整 May。

如果未来两个冲突批次具有相同 coverage end，`source_file/import_batch_id` 的字典序不能成为业务 winner。该情况必须 fail closed，要求管理员明确选择来源或上传修订批次。

## 尚未宣称完成

- 已通过生产 Import Batch public seam 物化 Snapshot A/C，并从 C 得到 sealed May Report Edition B；
- Level 6/7 发布 Mapping 已验证为 0 unmapped、18 canonical meter series；
- 已验证 16 个 conflict pairs 形成 32 个 Raw conflict rows；Metadata Readiness 的同 count warning 仍应在浏览器/Admin 做显示验收；
- 尚未在浏览器核对 May complete、June MTD、What Changed 与 AI Artifact identity；
- 本结论来自只读 workbook 审计，不等同于生产数据迁移或客户验收。
