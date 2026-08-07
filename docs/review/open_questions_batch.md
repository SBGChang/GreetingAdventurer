# 待裁決問題清單（給原作者）

> 行號為現行版本（已套用 1~4 條與 A/B/C 修改後）。除非另註，皆可自行複驗。
> 分三組：**Ⅰ 架構**（同 A/B/C 風格，最需原作者裁決）、**Ⅱ 設計／契約對齊**、**Ⅲ 專案慣例**。文末另列「不需裁決、我可直接修」的純資料修正。

---

## Ⅰ. 架構

### Q1. `GatheringResolved` 事件的 `sourceModule` 是 workflow（C 的事件版遺留）
- `00_shared_contracts.md:689`：`GatheringResolved` 發送者＝「gathering workflow」。
- 這是 C 剛修好的「workflow 當處理者」分類錯誤的**事件版**：DomainEvent 信封的 `sourceModule` 不能是 workflow。
- 你在 C 的裁決已提到「**可以**移除這個複合事件，改用各擁有模組的完成事件與同一 `transactionId` 表達結果」。
- **待裁決**：(a) 移除 `GatheringResolved`，改用各擁有模組（Map／Inventory／Distribution／Progression）的既有完成事件 + 同 `transactionId`；或 (b) 保留事件但把 `sourceModule` 指到一個真模組。
- 影響面：ripple 約 7 檔（`19:168/170/187/202/223`、`06:178/334/413`、`05:435`、`03:400`、`01:425`、`00:689`）。因規模較大且你原本用「可以」，故未先動。

### Q2. `DeterministicRng` 有隱含可變狀態（你自己點出的）
- `00_shared_contracts.md:136`：`interface DeterministicRng { nextFloat(); nextInt(...) }`——每次呼叫推進內部 RNG 狀態，與剛修好的 `RuntimeIdGenerator`（已改純函式 cursor passing）是**同一個病**。
- **待裁決**：是否比照 Runtime ID，把 RNG 也改成 seed／cursor 顯式化的純函式介面？若是，請給目標介面（例如 `next(input:{stream, cursor}): {value, nextCursor}`）。

### Q3. 全域 `priority: number` 是無主的跨模組排序命名空間
- `ScheduledJob` 排序用 `priority`（`00:392`）、事件訂閱排序也用 `priority`（`12:319`）。
- 當兩個**不同模組**在同日同 phase 排程、或訂閱同一事件時，確定性結果取決於這個誰都不擁有的全域數字空間，與「模組獨立開發」有張力。
- **待裁決**：由誰治理 priority 數字空間？建議由 `app/composition` 用一張宣告式排序表集中管理，而非各模組自填魔數。

---

## Ⅱ. 設計／契約對齊

### Q4. 模組 18 `adventurer_lifecycle` 名實不符
- 該模組實際內容是 **NPC 決策 AI**（Intent→ActionChain→TeamPlan）；生理生命週期（年齡、生育、子女、人口補充）其實分散在 04／06／08／09。
- **待裁決**：是否改名（如 `npc-behavior`／`npc-agent`）以免實作者把生命週期邏輯放錯模組？

### Q5. 玩家角色「繼位續玩」的歸屬
- GDD §六/§七：「死亡或退休後可繼承隊友、子女或家人**繼續遊戲**」。
- 資產繼承有主（Economy + Character workflow）；`PlayerSuccessorSelected`（team→inheritance workflow）也存在。但「玩家 avatar 控制權轉移」這件事的**明確 owner** 仍不清楚。
- **待裁決**：確認 avatar 交接由哪個模組／workflow 擁有，或確認 `PlayerSuccessorSelected` 那條線就是完整答案。

### Q6. 「每日 6 次**買賣**」上限在契約憑空多出
- 契約：`23_social_module.md:83`「買賣的每日六次仍由 City 獨立計算」；`09_city_module.md:314` `PlayerDailyCommerceUsage`；`06:184`。
- GDD：只限 **6 次對話**，且明說城內買賣**不消耗時間**、無次數限制。
- **待裁決**：保留買賣每日 6 次上限（GDD 補寫），或移除此限制（契約改）？

### Q7. `durationDays` 一詞兩義（同一 crafting 模組）
- `20_crafting_and_cuisine_module.md:51` `CraftingRecipeDefinition.durationDays`＝**製作天數**（≥1 日）。
- `20:100` `CuisineRecipeDefinition.durationDays`＝**FoodStatus 效果維持天數**（料理本身零日）。
- **待裁決**：是否把其一改名（如料理側改 `foodEffectDurationDays`）以免實作者把料理誤算成 N 個製作日？

---

## Ⅲ. 專案慣例

### Q8. 是否把 75 個既有 ID 別名遷移到 `Brand<>`
- 你已兩次明用 `Brand<>`（`ResolverId`、`RuntimeIdCursor`），我已導入 `Brand<T,K>` 基底並讓新型別採用；但 `00` 既有約 75 個 ID 仍是 `type X = string`。
- **待裁決**：要不要做一次全清單遷移到 `Brand<>`（型別更安全、與你的偏好一致），還是維持「新型別 branded、舊型別 plain + 註記」？

---

## 附：不需裁決、我可直接修（純資料／文件一致性）
- 雲華 `data.mjs` 支援 MXP 平衡說明錯置（`48/72/120/200` 標成 L0/L3/高級/極品，實際 5 階）。
- 雲華兩隻獾怪掉落物 `.md` 與 `.mjs` 不一致（`.mjs` 正確）。
- 天衡宴列在 spec 但不在 `craftingCatalog.cuisine` 資料。
- 多份文件 invariant／測試編號重複或跳號（11、16、02、16_derived §7 跳 5）。
> 這些我可直接改，只是想告訴你有這批；若你希望原作者先確認再改，也可併入上面。
