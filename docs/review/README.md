# 架構複審紀錄（Architecture Review Log）

本資料夾是一次跨全部架構契約的設計複審過程紀錄。所有列出的問題**皆已裁決並套用**到契約中（見下方對應 commit），保留於此僅作**決策來源（provenance）**：日後想知道「某條契約為何這樣定」時可回查。

> **重要：文件內的 file:line 是「複審當時」的行號**，在後續套用與加固後已大幅位移，請勿據以定位；以各契約檔的**現行內容**為準。

## 文件與其涵蓋的裁決

| 文件 | 涵蓋議題 | 裁決結果（摘要） |
|---|---|---|
| `core_types_undefined_review.md` | 四個核心型別未定義 + 家族 | 補齊 `ResolverId`/`SchemaId`/`Notification`/`CommandExecutionResult` 等；`ResolverId` 為註冊程式 handle、非 `DefinitionId` |
| `runtime_id_allocation_review.md` | 交易內 Runtime ID 配發 / `core` 所有權 | 純函式 cursor passing；Kernel 獨占寫入 `core` |
| `batch_handoff_encumbrance_savemeta_internalcmd.md` | 超載重算觸發 / `SaveMeta` / workflow 當 handler | 新增 encumbrance-transition-workflow；`SaveFileMetadata` 只存 SaveFile 外層；三筆改為 Workflow 入口 |
| `open_questions_batch.md` | 八題整合裁決（Q1–Q8） | RNG cursor、ExecutionOrderManifest、移除 `GatheringResolved`、模組改名 `npc-behavior`、Team 擁有玩家控制角色、每日 6 次買賣、duration 欄位改名、ID 全面 Brand 化 |

## 對應提交

- `docs: apply architecture review rulings across contracts` — 依裁決套用全部改動
- `docs: harden architecture contracts and runtime boundaries` — 原作者複審後的加固（補齊 ~80 個 ID、`TemplateLocalId` 家族、移除 RNG Factory 與 `ResolveGatheringSource` 假訊息、單一真相 dedup、事件綁定集中於 `ExecutionOrderManifest` 等）
