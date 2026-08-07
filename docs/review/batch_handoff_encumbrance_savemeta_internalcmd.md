# 審查交接（批次）：三項未決架構問題

> **對象：** 撰寫本專案設計/架構契約的原作者（AI）。
> **內容：** 三項各自獨立、已驗證的問題，請分別裁決。file:line 以套用先前修改後的**現行行號**為準，可自行複驗（見各節末）。
> **註：** 「魅力漏聲望」一項已由專案負責人直接裁決（魅力不併入聲望、聲望改為獨立 RNG／條件因子），不在本文範圍。

---

## 問題 A：旅行抵達後的「延後超載重算」沒有觸發者（HIGH）

### 已驗證事實
1. **規則要求抵達後重算**：`05_inventory_module.md:250`——玩家隊 `travelling` 時只存 `deferredDuringTravel`；「**抵達下一個可控制位置後立即重算**，仍超載才轉為 `awaitingPlayer`」。不變量 `05:291` 同樣要求「非旅行中的超載必須是 `awaitingPlayer`」。
2. **重算指令存在**：`EvaluateTeamEncumbrance`（`05:368` handler 說明；`00_shared_contracts.md:538` 跨模組命令表）——「旅行中建立／保留 deferred；其餘玩家可控制位置建立 awaiting」。
3. **但它只由「改變重量／上限」的流程觸發**：`05:329`「所有可能改變攜帶重量或上限的 Workflow ... 呼叫 `EvaluateTeamEncumbrance`」；`00:538` 的發送者是 `inventory／statistics workflow`。
4. **抵達是「位置改變」而非「重量改變」**：Team 抵達時發 `TravelCompleted`（`02_team_module.md:477`，訂閱者＝progression、quest）與 `TeamLocationChanged`（`02:474`，訂閱者＝map、dungeon、quest）。**兩者都沒有 inventory 訂閱、也都不觸發 `EvaluateTeamEncumbrance`**。

### 問題
重算指令有、但**抵達這個時機沒有任何東西去呼叫它**。旅途中超載的玩家隊抵達後會**永遠停在非阻塞的 `deferredDuringTravel`**，架空強制超載畫面，也違反 `05:291` 不變量（抵達後應為 `awaitingPlayer`）。

> 精確定位：缺的不是「重算能力」（`EvaluateTeamEncumbrance` 已存在），而是**「抵達 → 呼叫重算」的接線**。

### 待裁決
1. 由哪個東西在抵達時觸發 `EvaluateTeamEncumbrance`？
   - (a) 新增一個 encumbrance workflow，訂閱 `TravelCompleted`／`TeamLocationChanged`（→可控制位置）後送 `EvaluateTeamEncumbrance`；或
   - (b) 讓 inventory 直接訂閱該事件並於 handler 內重算。
   （依「workflow 編排跨模組」的既有慣例，(a) 較一致。）
2. 「可控制位置」的判定以哪個事件為準——抵達城市（`TravelCompleted`）、進出地圖（`TeamLocationChanged`）、或兩者皆是？

### 複驗
```bash
sed -n '248,252p;289,292p;327,330p;366,369p' docs/00_core/architecture/05_inventory_module.md
sed -n '474p;477p' docs/00_core/architecture/02_team_module.md
sed -n '538p' docs/00_core/architecture/00_shared_contracts.md
```

---

## 問題 B：`SaveMeta` 有兩套不一致定義，且 `meta` 在存檔中重複（MED）

### 已驗證事實
- **4 欄版**（core）：`00_shared_contracts.md:162`——`saveSchemaVersion`、`moduleVersions`、`contentManifestVersion`、`contentManifestHash`。
- **6 欄版**（platform）：`14_save_platform.md:25`——同上 4 欄，另加**必填** `contentPacks: { packId; version; hash }[]` 與 `appBuildVersion`。
- **同名、不同形狀**，且 `meta` 在存檔中出現**兩次**：
  - `SaveFile.meta: SaveMeta`（`14:17`）→ 解析為 6 欄版。
  - `GameState.meta: SaveMeta`（`00:196`）→ 解析為 4 欄版（GameState 組裝於 core）。

### 問題
1. 同一型別名 `SaveMeta` 有兩種欄位集，實作者會分歧。
2. 存進 State 的 `GameState.meta`（4 欄）**缺 `contentPacks[]`**——而內容相容驗證（`14` §4.2「缺少必要 Pack／Definition／Resolver 即拒絕載入」）需要 per-pack hash。若相容驗證讀的是 state 內的 meta，就拿不到 pack 雜湊。
3. `meta` 同時存在 `SaveFile.meta` 與 `SaveFile.state.meta`，是**重複事實**，有失同步風險（違反專案自訂的「同一事實不在多處」原則）。

### 待裁決
1. `SaveMeta` 統一為哪一種形狀？（建議 6 欄版，因相容驗證需 `contentPacks[]`。）
2. `meta` 該住哪裡**一次**——放 `SaveFile` 外層、或放 `GameState`、或拆成「in-state 子集 + on-disk 全集」兩個具名型別？（避免重複。）

### 複驗
```bash
sed -n '162,168p;196p' docs/00_core/architecture/00_shared_contracts.md
sed -n '15,37p' docs/00_core/architecture/14_save_platform.md
```

---

## 問題 C：三筆 InternalCommand 把「workflow」列為唯一處理者（分類錯誤，MED）

### 已驗證事實
- 跨模組命令表（`00_shared_contracts.md:508` 表頭「Internal Command｜發送者｜**唯一處理者**｜目的」）中，**絕大多數列的唯一處理者是模組**（inventory、team、character、economy、city、combat…）。
- 但有**三列的唯一處理者填的是 workflow**：
  - `ResolveGatheringSource` → **gathering workflow**（`00:525`）
  - `ExecuteNpcMarketIntent` → **city workflow**（`00:559`）
  - `ResolveNpcMarriageProposal` → **marriage workflow**（`00:589`）
- 但訊息模型規定 workflow「只決定命令順序與失敗補償，**不擁有領域 State 或玩法公式**」（`00:777`）；InternalCommand 需要一個**可拒絕的唯一模組 handler**。

### 問題
workflow 是 process manager（**發出** InternalCommand、編排流程），不是 InternalCommand 的**終端 handler**。把 workflow 當唯一處理者與訊息模型／Registry 唯一性衝突，是分類錯誤。

### 待裁決（每筆二選一）
- (a) 這三筆其實是**「workflow 呼叫／編排」**，不是要被路由到單一 handler 的 InternalCommand → 應從 InternalCommand 表移出，改記為 workflow 步驟；或
- (b) 它們確實是 InternalCommand → 需指定**真正的模組 handler**（例如：gathering 目前是無 State 純服務而非模組，若要它當 handler，得先定義誰擁有該 handler）。

> 註：`ResolveGatheringSource` 牽涉 gathering——目前架構把 gathering 定位為**無 State 純計算服務**，本身沒有可路由的模組 handler，這也是為何它落到 workflow。裁決此筆時需一併確認 gathering 的 handler 歸屬。

### 複驗
```bash
sed -n '508p;525p;559p;589p;777p' docs/00_core/architecture/00_shared_contracts.md
```

---

## 待回覆彙整
- **A**：抵達觸發 `EvaluateTeamEncumbrance` 的機制（workflow 訂閱 vs inventory 直接訂閱）＋「可控制位置」以哪些事件為準。
- **B**：`SaveMeta` 統一形狀（建議 6 欄）＋ `meta` 單一歸屬（消除 SaveFile／GameState 重複）。
- **C**：三筆 workflow-as-handler 各自屬 (a) 改記為 workflow 步驟、或 (b) 指定真模組 handler；並確認 gathering 的 handler 歸屬。
