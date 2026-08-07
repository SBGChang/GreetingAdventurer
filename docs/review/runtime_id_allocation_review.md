# 審查交接（第 3 條）：交易內 Runtime ID 配發機制未定義，與兩條明文規則衝突

> **對象：** 撰寫本專案設計/架構契約的原作者（AI）。
> **性質：** 與第 2 條不同——這**不是**「漏補型別」。`RuntimeIdGenerator` 這個 Port 已在第 2 條補上（`12_engine_runtime.md:138`）。本條要裁決的是**配發機制與 `core` slice 所有權**：目前設計有意圖暗示、但實際機制未落定，且與兩條明文規則衝突。
> **範圍：** `00_shared_contracts.md`、`12_engine_runtime.md`。所有 file:line 以套用第 2 條修改後的現行行號為準，可自行複驗（見末段）。

---

## 一、已驗證的三個事實

1. **計數器住在 `core`**：`CoreState.nextRuntimeSequence: number`（`00_shared_contracts.md:169`）；Runtime ID 由 `worldSeed + entityKind + nextRuntimeSequence` 產生（`12_engine_runtime.md:401-409`，§7.2）。
2. **沒有任何模組擁有 `core`**：`ModuleStateRegistry`（`00:173`）列了 16 個領域 slice，`core`（`CoreState`，`00:166`）不在其中。沒有模組的 `owns` 會是 `core`。
3. **模組只能改自己的 slice、且 handler 是純函式**：
   - `ModuleResult` 只回傳 `nextSlice`（自己的），且明文「**不包含其他模組 Slice 的 patch**」（`00:764`）。
   - 「**Handler 必須是 deterministic pure function**」（`00:765`）。

---

## 二、衝突

一個模組 handler（純函式、只能改自己 slice）要建立新實例、需要一個新 Runtime ID。但：

- 產生 ID 要**讀取並遞增** `nextRuntimeSequence` → 那在 `core`，handler **既不擁有、也不能 patch**（撞 `00:764`）。
- 即使改用注入的 `idGenerator`（`EngineContext`，`12:122-129`／`RuntimeIdGenerator` 於 `12:138`），呼叫一個會遞增序號的產生器**是有副作用的**，與「handler 是 pure function」（`00:765`）有張力。

**三條規則兩兩打架**：純函式 handler ✗ 不能改別的 slice ✗ 卻要拿到會遞增 `core` 計數器的 ID。

---

## 三、已存在的設計意圖（有暗示，但不成機制）

- `12:409`：「序號**只在交易提交時消耗**；拒絕交易不得永久吃掉 ID。」→ 暗示「暫定配發、提交才落定」。
- `00:125`（§2.1 ID 不變量）：「Runtime Instance ID 由**核心 ID 產生器**依世界 seed 與序號建立。」→ 暗示產生器與計數器屬 **kernel**，不屬任何領域模組。
- 第 2 條已補上的 Port（形狀已定，機制未定）：
  ```ts
  // 12_engine_runtime.md:138
  interface RuntimeIdGenerator {
    next<TId extends string>(namespace: string): TId;   // 交易內暫定配發，序號於提交時才落定（見 §7.2）
  }
  ```

**仍未落定的關鍵**（本條要裁決的）：
1. handler 是**直接呼叫 `idGenerator`**，還是**回傳「實例草稿」由 Runner 於提交時指派 ID**？
2. 「pure function handler」與「配發 ID」如何調和？
3. `core.nextRuntimeSequence` 提交時**由誰寫回**？（ownership 規則未指名 kernel 為 `core` 的 owner。）
4. 同一交易內若**兩個模組各建實例**（如先 `CreateItemInstance` 再 `TransferItem`），暫定 ID 如何在 working state 內**穩定且可互相引用**？

---

## 四、供裁決的兩個方案

### Option A — 草稿／提交指派（draft-and-assign）
- handler **不直接呼叫** `idGenerator`；回傳帶「暫定本地 ref」的實例草稿。
- **TransactionRunner（kernel）** 於提交時統一指派真 Runtime ID、並遞增 `core.nextRuntimeSequence`。
- 交易內跨 handler 引用剛建立的實例 → 用暫定本地 ref，提交時解析為真 ID。
- **優點**：handler 真的保持純函式；`core` 寫入集中在 kernel；`12:409`「提交才消耗序號」字面成立；配發順序依訊息佇列（本就 deterministic）→ 可重播。
- **代價**：handler 回傳型別要能表達「草稿 + 暫定 ref」；下游引用需能解析暫定 ref。

### Option B — 注入純 allocator + cursor 穿過 working state
- handler 呼叫注入的 `idGenerator.next()`；它是 `(worldSeed, namespace, cursor)` 的確定性函式；cursor 隨 working state 前進；Runner 於提交時把最終 cursor 寫回 `core`。
- **優點**：handler 直接拿到真 ID，寫起來直觀；無草稿／ref 解析。
- **代價**：可變 cursor 漏進 handler 領域，與「pure function」有張力（需正式定義為「以注入 cursor 為輸入的確定性呼叫」）；仍須明定 Runner 提交 cursor 回 `core`。

> 審查傾向 **Option A**：唯一能同時（a）保持 handler 純函式、（b）把 `core` 寫入集中於 kernel、（c）讓 `12:409` 字面成立的方案。但此為原作者的設計裁量，故列出兩案。

---

## 五、必要配套（不論選哪案）

**明文宣告 kernel 擁有 `core` slice 的寫入**，作為「模組只寫自己 slice」（`00:764`）的唯一例外。此點其實已被 `00:125`「Runtime Instance ID 由核心 ID 產生器建立」暗示，只是 ownership 規則沒正式寫。建議補在 §2.1 ID 不變量或 §9 模組註冊與回傳契約附近。

---

## 六、待原作者回覆

1. **Q1**：Option A（draft-and-assign）還是 Option B（注入 allocator + cursor）？
2. **Q2**：是否正式把「kernel 擁有 `core.nextRuntimeSequence` 的寫入」寫進 ownership 規則？（建議：是。）
3. **Q3**：交易內跨 handler 引用剛建立的實例——暫定本地 ref（A）或即時真 ID（B）？（實由 Q1 決定，確認一致即可。）

---

## 七、驗證方式（可自行複驗）

```bash
# 計數器在 core、且無模組擁有 core（CoreState 與 ModuleStateRegistry 相鄰但分開）
sed -n '164,193p' docs/00_core/architecture/00_shared_contracts.md

# 純函式 handler + 不得改他 slice
sed -n '760,768p' docs/00_core/architecture/00_shared_contracts.md

# Runtime ID 產生規則與「提交才消耗序號」
sed -n '401,410p' docs/00_core/architecture/12_engine_runtime.md

# ID 不變量：Runtime ID 由核心 ID 產生器建立
sed -n '122,126p' docs/00_core/architecture/00_shared_contracts.md
```
