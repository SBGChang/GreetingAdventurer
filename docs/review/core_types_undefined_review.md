# 審查交接：四個跨模組核心型別未定義（附既存相關說明對照）

> **對象：** 撰寫本專案設計/架構契約的原作者（AI）。
> **狀態：** 已完成第二輪深掘 + 一次完整性掃描。原始 4 個型別**皆已有相關說明**，沒有一個是「請你設計新型別」——問題是「漏補別名 / 接既有零件 / 解命名分歧」。完整性掃描另找出同家族 ~9 個被引用卻未定義的型別（見 §五）。
>
> **重要：本文列出的未定義型別是「已知樣本」，不是完整清單。** 這類「引用了卻沒定義」的漏本質上是編譯器一遍就抓完的事；最終應以 `tsc` + `public.ts` export snapshot（本專案 CI 已規定，`technical_architecture.md:139`）產出完整清單。以下請原作者就 §五末的裁決點確認即可。
> **範圍：** `docs/00_core/` 架構契約。所有 file:line 皆可自行複驗（見末段）。

---

## 〇、一句話

四個型別被大量引用卻在全庫 **0 筆 `type` 定義**；但深掘後發現**它們的概念/行為/姊妹型別多半已存在**，屬文件工程層面的漏接，不是設計缺口。

| 型別 | 引用處 | 既存相關說明 | 真正缺什麼 | 性質 |
|---|---|---|---|---|
| `ResolverId` | 15+ 檔、30+ 處 | `13_data_runtime.md §7`（完整定義概念）、`14:142`（載入期驗證） | 只缺 `contracts/core` 的型別別名 | **純漏寫，已決定** |
| `CommandExecutionResult` | `12:96`（主入口回傳） | `GameCommandResult`(`00:274`)、`CommandRejection`(`00:268`)、姊妹 `WorldAdvanceResult`(`12:104`)、§3 生命週期(`12:155-160`) | 與既有 `GameCommandResult` 是否同一 | **命名對齊** |
| `Notification` | `00:732`、`12:440` | §9 行為(`15:327-344`)、`LocalizedTextRef`(`15:353`)；但 UI 端用 `UiNotice`(`15:331`) | 與 `UiNotice` 的關係 | **命名漂移** |
| `MigrationContext` | `14:128` | 載入順序(`14:109-119`)、§4.1 約束(`14:132-136`) | 依既有約束推導形狀 | **可直接推導** |

---

## 一、`ResolverId`（純漏寫，設計已決定）

### 既存說明
- `13_data_runtime.md §7`（`:428-450`）完整定義 Resolver：資料只引用穩定 ID，實體是**登記在 Resolver Registry 的純函式**（deterministic、無 I/O、scoped RNG、不改 GameState）。
- `14_save_platform.md:142` 在內容相容驗證中把 Resolver 與 Pack/Definition 並列為載入期必須存在的引用。
- 對比：ID 清單（`00:33-107`）中規則類一律 `= DefinitionId`（資料），resolver 一律 `: ResolverId`（未 alias）——**因為它指向的是程式 registry，不是內容 registry**。

### 結論（無需裁決）
`ResolverId` 自成一類，**不**等於 `DefinitionId`。僅需在 `contracts/core` 補：
```ts
type ResolverId = string; // branded；解析進 Resolver Registry（註冊程式），非內容定義
```

### 連帶：同家族兩個也未定義（請一併補）
- `SchemaId`：`13:436-437`（`inputSchemaId`/`resultSchemaId`）等引用，全庫無定義。
- `ResolverContext`：`13:438`（`resolve(input, context)`）引用，全庫無定義。
> 這兩者屬 data-runtime 局部、風險較低，但補 `ResolverId` 時應同批處理，避免再牽出新的未定義型別。

---

## 二、`CommandExecutionResult`（命名對齊，1 個裁決）

### 既存說明
- `00:274` 已定義通用結果聯集：
  ```ts
  type GameCommandResult<TResult> =
    | { accepted: true; result: TResult }
    | { accepted: false; rejection: CommandRejection };
  ```
- `00:268` 已定義 `CommandRejection`。
- `12:104` 已定義姊妹型別 `WorldAdvanceResult`（帶 `state`/`reachedDay`/`status`/`committedOutbox`）。
- `12:155-160` §3 生命週期圖已描述成功（committed state + outbox）與拒絕（rejected + 原 state）兩種結局。

### 裁決點 Q1
`executePlayerCommand` 的回傳 `CommandExecutionResult`（`12:96`）應該是：
- **(a)** 直接就是 `GameCommandResult<…>`（則 `12` 改為引用 `00` 的既有型別，不另立名）；或
- **(b)** 一個引擎層專屬結果，與 `WorldAdvanceResult` 對齊（含 `committedOutbox`），成功時攜 outbox、失敗時攜 `CommandRejection`。

> 兩者皆以既有零件組成，非新設計。請原作者指定 (a) 或 (b)。

---

## 三、`Notification`（命名漂移，1 個裁決）

### 既存說明
- 引擎端：`ModuleResult.notifications?: Notification[]`(`00:732`)、`CommittedOutbox.notifications: Notification[]`(`12:440`)。
- UI 端：`NotificationProjector.project(event): UiNotice[]`(`15:331`)——回傳 **`UiNotice`**，且 `UiNotice` 全庫**亦無定義**。
- 行為約束 §9(`15:327-344`)：不改 State、不觸發 Command、可略過、用 Localization Key；文字用 `LocalizedTextRef`(`15:353`)。

### 裁決點 Q2
`Notification`（引擎端）與 `UiNotice`（UI 投影端）是：
- **(a)** 同一概念、兩個名字 → 統一為一個（建議定於 `contracts/core` 或 UI 邊界，並刪除另一名）；或
- **(b)** 兩層不同物：`Notification` = 引擎直接發出的原始通知（`LocalizedTextRef` 基底），`UiNotice` = UI 投影/在地化後的顯示物 → 兩者都要定義，並在文件寫明轉換關係。

> 需先定 (a)/(b)，否則補定義會與另一個名字撞義。

---

## 四、`MigrationContext`（可直接推導，1 個確認）

### 既存說明
- 載入順序（`14:109-119`）：`各 Module Slice Migration` 明確排在 `載入目前 Content Manifest` 與 `Definition ID/Pack 相容驗證` **之前**。
- §4.1 約束（`14:132-136`）：migration 必須 deterministic、**不得用 RNG/系統時間/平台網路**、只改自己 Slice。

### 推導結果 + 確認點 Q3
依上述順序，`MigrationContext` **不能**攜帶 Definition Registry（此時 definitions 尚未載入）。形狀應為最小確定性上下文（版本資訊已在 `ModuleMigration`；context 可含診斷輸出／schema 參照，但**不含 definitions/RNG/time**）。

**請確認**：是否存在任何實際 migration 需要讀 Definition？
- 若否（依現行設計意圖，應為否）→ 按上述最小形狀定義即可。
- 若是 → 載入順序需調整，這才是真設計議題，需另立討論。

---

## 五、完整性掃描：其餘被引用卻未定義的型別（已知樣本，非完整清單）

除原始四個外，對核心底層（信封／結果／outbox／平台候選）掃描，另發現以下型別被引用但全庫無 `type`/`interface` 定義。分三級：

### Tier A — 跨引擎→平台／UI 的「資料」型別（與 `Notification` 同級，必須定義）
| 型別 | 引用處 | 備註 |
|---|---|---|
| `PlatformEffectCandidate` | `12:441` | **就在 `CommittedOutbox` 內部**，即直接交付平台的 outbox 欄位。優先度最高。 |
| `AudioCandidate` | `15:335` | `AudioCandidateProjector.project()` 回傳。 |
| `AchievementCandidate` | `14:206`、`14:219`、`technical_architecture.md:650` | Application 由 committed Event 投影產生。 |
| `AchievementDeliveryResult` | `14:206` | `AchievementGateway.unlock()` 回傳。 |
| `UiNotice` | `15:331` | 見 §三，與 `Notification` 的命名關係需一併裁決。 |

### Tier B — `EngineContext` 注入的基礎設施 Port／Factory（行為多有描述，型別形狀待定）
`DeterministicRngFactory`、`RuntimeIdGenerator`、`GameDefinitionReaders`、`ModuleRegistry`、`EngineSafetyLimits`（皆 `12:117-123` 的 `EngineContext` 成員，`type`/`interface` 查無）。
> 這些可能是**刻意留待實作定介面**，故不與 Tier A 同級。是否要在契約先 stub 出 Port，請原作者定。

### Tier C — data-runtime 局部（低風險）
`SchemaId`（`13:436-437`）、`ResolverContext`（`13:438`）。補 `ResolverId` 時同批處理。

### 排除（已確認有定義，非問題）
`CorrelationId`(`00:108`)、`CommittedOutbox`(`12:437`)、`GameCommandResult`(`00:274`)、`CommandRejection`(`00:268`)、`WorldAdvanceResult`(`12:104`)、`LocalizedTextRef`(`15:353`)。

---

## 六、待原作者回覆

1. **Q1**：`CommandExecutionResult` 用既有 `GameCommandResult`(a) 還是引擎專屬對齊 `WorldAdvanceResult`(b)？
2. **Q2**：`Notification` 與 `UiNotice` 是同一(a) 還是兩層(b)？
3. **Q3**：有無 migration 需讀 Definition？（決定 `MigrationContext` 形狀與載入順序是否要動。）
4. **Q4**：Tier B 的 `EngineContext` 基礎設施 Port 要不要在契約先 stub，還是留待實作？
5. **建議**：把「未定義型別完整清單」交給 `tsc`／export snapshot 產出，本文 §五為人工樣本，可能仍有遺漏（尤其 24 份領域模組契約內的同類漏尚未系統性掃描）。

`ResolverId`（+ Tier C 的 `SchemaId`/`ResolverContext`）已無待裁決，確認後直接補。Tier A 各型別皆為明確資料形狀，可依引用處上下文擬定後複核。

---

## 七、驗證方式（可自行複驗）

```bash
# 全部樣本型別是否在全庫有定義（預期：多數無）
grep -rnE '(type|interface) (ResolverId|CommandExecutionResult|MigrationContext|Notification|UiNotice|SchemaId|ResolverContext|PlatformEffectCandidate|AudioCandidate|AchievementCandidate|AchievementDeliveryResult|DeterministicRngFactory|RuntimeIdGenerator|GameDefinitionReaders|ModuleRegistry|EngineSafetyLimits)\b' docs/

# 既存可接的零件（預期：有）
grep -rnE 'type (GameCommandResult|CommandRejection|WorldAdvanceResult|LocalizedTextRef)\b' docs/

# 核心 ID 清單（確認 ResolverId 不在其中）
sed -n '33,107p' docs/00_core/architecture/00_shared_contracts.md

# 載入順序（確認 migration 在 definition 之前）
sed -n '107,136p' docs/00_core/architecture/14_save_platform.md
```
