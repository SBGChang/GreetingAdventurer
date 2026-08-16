# 正式 Runtime 資料驅動與零暫代規範

> 本檔為**權威原文**，逐字保存。操作層摘要與判斷流程見 `../SKILL.md`；
> 目前待清理項目見 `cleanup-backlog.md`（會隨進度變動，原文 §16 亦保留於此）。

## 一、目的

本規範確保遊戲的正式 Runtime 永遠維持：

- 資料與邏輯分離。
- 模組所有權清楚。
- 所有玩法內容可由 Content Pack 驅動。
- 資料不足時明確失敗。
- 不以硬編碼、假資料或暫代流程換取開發方便。

核心原則是：

程式碼負責規則、流程、驗證與演算法；內容資料負責實際內容、可調參數與資料對照。

任何已被架構指定由 Definition、Resolver、Content Pack 或其他模組擁有的事實，Handler 都不得自行決定。
資料結構不足時必須擴充正式 Schema；模組契約不足時必須修改正式契約；流程尚未完成時不得開放該功能。

## 二、適用範圍

本規範適用於所有正式執行路徑，包括：

- Kernel
- GameEngine
- GameSession
- Transaction Runner
- Composition Root
- Module Handler
- Workflow
- Resolver
- Query Adapter
- Definition Reader
- Bootstrap
- Save／Load Migration
- Content Compiler
- Production UI 可呼叫的功能入口

測試 Fixture 與 Bring-up 工具不屬於正式 Runtime，但必須與正式執行路徑完全隔離。
只要正式程式可以引用、載入或呼叫某份 Fixture／Bring-up 資料，就視為違反本規範。

## 三、程式碼與資料的責任邊界

### 程式碼負責

程式碼只能負責：

- 演算法。
- 狀態轉移流程。
- 交易與回滾。
- 命令與事件路由。
- 模組所有權驗證。
- 資料結構驗證。
- 固定的系統不變量。
- Resolver 的通用計算程序。
- Content Pack 的載入、編譯與驗證。
- 錯誤處理與 typed rejection。

### 內容資料負責

下列內容必須由 Definition、Resolver、Rule 或 Content Pack 提供：

- 武器、防具、道具、素材、料理、書籍與配方。
- 技能、魔法、被動、狀態與效果。
- 怪物、怪物技能、敵人組成、掉落與生成權重。
- 城市、設施、文化、地圖與冒險地。
- 傷害、治療、回復、倍率、機率與權重。
- CTB 基礎值、最低值、屬性減免與控制抗性。
- 使用延遲、持續時間、製作時間與活動時間。
- 經驗值、價格、重量、數量與產量。
- 角色生成池、性別分布、職業分布與文化分布。
- 事件條件、事件選項與選項效果。
- Effect → Status 等跨資料對照。
- Skill → Weapon Requirement 等裝備需求。
- Definition ID、Resolver ID、Rule ID。
- 所有可透過平衡調整改變的數值。

只要修改某個值可能改變內容、平衡或文化差異，該值就屬於資料，不得寫在 Handler 中。

## 四、系統不變量

真正不可調整的結構規則可以存在於程式中，例如：

- 戰鬥場地為雙方 3×3。
- 正式隊員上限為 9 人。
- Mastery 等級範圍為 Lv.0～10。
- 主屬性上限為 100。
- 支援技能每戰、每招最多計算 3 次。
- 訊息種類。
- Module ID。
- Schema kind。
- 錯誤碼。
- Kernel 安全上限。
- Hash 演算法常數。

這些值必須已由正式規格定義為結構性不變量。

不得僅因「目前不打算調整」就把數值視為系統不變量。只要架構已將該值歸屬於 Definition、Rule 或 Resolver，就必須由資料提供。

若無法判斷某個值是系統不變量還是可調資料，預設視為可調資料。

## 五、禁止硬編碼內容

正式 Runtime 禁止：

- 在 Handler 內寫死 Definition ID。
- 在 Handler 內寫死 Resolver ID。
- 在 Handler 內寫死 Rule ID。
- 寫死怪物、物品、技能、地圖或城市 ID。
- 寫死傷害、回復、機率、時間或倍率。
- 寫死角色性別、職業或文化。
- 寫死事件成功或失敗。
- 寫死掉落與產出。
- 寫死技能與裝備的對照。
- 寫死 Effect 與 Status 的對照。
- 以固定值代替尚未接入的資料規則。
- 由不擁有該資料的模組臨時產生 Runtime ID。

例如以下行為一律禁止：

- Combat 固定使用 `combat-rule-standard`。
- 缺少回復規則時固定恢復 5 HP／MP。
- 缺少年齡規則時使用倍率 1。
- 缺少控制抗性時使用倍率 1。
- 缺少角色生成規則時固定為 female。
- 缺少事件效果時直接判定成功。
- 缺少 Map Instance 時由 Team 自行鑄造 Map ID。

## 六、禁止方便性 Fallback

正式 Runtime 不允許任何方便性 fallback。

禁止：

- Reader 找不到資料時回傳假的預設 Definition。
- Resolver 不存在時改用固定結果。
- 缺少欄位時使用 `?? 1`、`?? 0` 或其他預設玩法值。
- 捕捉 Definition Reader 例外後繼續成功。
- 缺少模組時跳過該步驟。
- 缺少事件訂閱者時忽略事件。
- 缺少 Internal Command Handler 時視為成功。
- 以 accepted no-op 代表尚未實作。
- 以固定成功維持流程可運作。
- 使用測試 Fixture 填補正式內容。
- 自動退回 Bring-up Bootstrap。
- 用註解或 TODO 合理化未完成行為。

資料不足時只能採取：

- Bootstrap 失敗。
- Content Pack 驗證失敗。
- 該 Capability 不啟用。
- Command 回傳明確 typed rejection。
- 存檔拒絕載入或先完成正式 Migration。

不得偷偷選擇替代資料繼續執行。

契約明確定義的冪等 no-op 不屬於方便性 fallback。例如已處理過的事件、過期 Job 或已完成的解除操作，可以依正式冪等規則接受且不重複套用；但必須有明確契約與測試。

## 七、Schema 不足時的唯一處理方式

當目前 Schema 無法表達需求時，必須依序：

1. 確認資料語意與擁有模組。
2. 擴充正式 Definition／State／Command／Event Schema。
3. 提升對應 `schemaVersion`。
4. 定義舊資料與舊存檔 Migration。
5. 更新 Content Compiler。
6. 更新 Definition Reader。
7. 更新 Resolver 或 Query Port。
8. 更新正式 Content Pack。
9. 更新驗證器。
10. 更新模組與整合測試。

全部完成後才啟用功能。

禁止：

- 用字串欄位暫時承載未定義資料。
- 用 `Record<string, unknown>` 繞過 Schema。
- 用兩種不同 ID 強制轉型。
- 把 Effect ID 當 Status ID。
- 把 Item ID 當 Definition ID。
- 用 `as unknown as` 掩蓋跨語意契約缺失。
- 先寫固定行為，日後才補 Schema。

## 八、正式 Content Pack

正式 Runtime 只能讀取正式 Content Pack。

每個 Content Pack 至少必須包含：

- `packId`
- `version`
- `schemaVersion`
- Pack Hash
- Definition 檔案清單
- Definition kind 清單
- Pack 相依關係
- 必要 Resolver 清單
- 文化與功能範圍
- 相容的 Runtime 版本

正式 Runtime 不得直接讀取：

- `docs/03_content/**/*.data.mjs`
- Markdown 文件
- HTML 閱讀頁
- 測試 Fixture
- Bring-up 專用資料
- 人工整理但未經 Schema 驗證的物件

文件資料可以作為內容設計來源，但必須經由 Content Compiler 產生正式 Runtime Definition。

## 九、零例外原則

正式 Runtime 對本規範採零例外政策。

不存在：

- 暫時 allowlist。
- 特例名單。
- 先合併再處理。
- 第一版先寫死。
- 測試有過就先接受。
- 只要有 TODO 就可以保留。
- 因趕進度而允許的 fallback。
- 因資料尚未完成而允許的固定結果。

如果資料不足，就擴充資料。
如果 Schema 不足，就擴充 Schema。
如果 Reader 不足，就擴充 Reader。
如果 Resolver 不足，就新增或擴充 Resolver。
如果模組邊界錯誤，就先修正所有權與介面。
如果 Workflow 尚未完成，就不註冊該入口。
如果整條流程尚未閉合，就不啟用該 Capability。

未完成不是錯誤；把未完成的能力偽裝成可用功能才是錯誤。

## 十、Capability 啟用規則

每項正式功能必須宣告完整依賴。

例如「玩家進入地牢」至少需要：

- Dungeon Definition Reader。
- Map Query。
- Team Query。
- Distribution 模組。
- Combat 模組。
- 對應 Rule／Resolver。
- 必要的 Internal Command Handler。
- 必要的 Domain Event Subscriber。
- Pending Interaction Query。
- 完整的離場與返城收斂流程。

只有依賴全部存在且通過驗證，Capability 才能啟用。

未完成的 Capability：

- 不得出現在正式 Capability Manifest。
- 不得由 UI 顯示。
- 不得註冊正式 Game Command 入口。
- 不得由其他 Workflow 呼叫。
- 不得在玩家操作後才拋出「尚未實作」。

## 十一、Bootstrap Gate

正式新遊戲初始化必須依序：

1. 載入 Content Manifest。
2. 驗證 Pack ID、版本、Schema 與 Hash。
3. 建立 Definition Registry。
4. 註冊 Resolver。
5. 驗證所有 Definition reference。
6. 驗證所有 Resolver reference。
7. 驗證正式 Capability 的完整依賴。
8. 建立所有 Module Slice。
9. 建立世界、國家、城市、地圖與路線。
10. 建立玩家角色與其他初始角色。
11. 建立 Inventory、Loadout、Economy account。
12. 建立 Team、Formation 與初始位置。
13. 建立初始 Scheduler Job。
14. 驗證跨模組不變量。
15. 全部成功後一次提交 GameState。

提交後才能進入第一個正式頁面。

任一步失敗：

- 不得保留部分 GameState。
- 不得寫入正式存檔。
- 不得發布 committed event。
- 不得顯示正式遊戲畫面。
- 不得改用 Bring-up fixture。
- 不得停用驗證後強制進入。

## 十二、模組所有權

每個模組必須：

- 只寫自己的 State Slice。
- 只建立自己擁有的 Runtime Entity。
- 只鑄造自己擁有的 Runtime ID。
- 透過窄化 Reader 取得 Definition。
- 透過 Query Port 讀取其他模組事實。
- 透過 Internal Command 要求其他模組改變 State。
- 透過 Domain Event 公告已發生事實。
- 透過 Workflow 編排跨模組流程。

禁止：

- 直接修改其他模組 State。
- 直接讀取完整 GameState。
- 直接 import 其他模組內部實作。
- 自行複製其他模組資料。
- 在本模組建立其他模組擁有的對照。
- 用強制型別轉換跨越所有權。
- 為了避免新增 Workflow 而直接呼叫其他模組 Handler。

## 十三、Bring-up 與測試隔離

測試 Fixture 與 Bring-up 工具必須：

- 使用獨立目錄。
- 使用獨立入口。
- 使用獨立 export。
- 不得由 Production Composition import。
- 不得被正式 Bootstrap 使用。
- 不得被正式 Content Manifest 引用。
- 不得包含於正式發行 Bundle。
- 不得作為正式 Reader 的 fallback。
- 不得在 Save／Load 流程中出現。

Production Build 必須驗證正式依賴圖中不存在：

- `fixtures.ts`
- `*.test.ts`
- `session-fixture.ts`
- Bring-up Bootstrap
- `docs/03_content`
- 測試 Content Pack

測試資料不構成本規範的例外，因為它們必須完全位於正式 Runtime 範圍之外。

## 十四、自動門禁

CI 與正式 Build 必須執行：

- TypeScript 型別檢查。
- Module Registry 完整性驗證。
- Workflow 入口完整性驗證。
- Game Command／Internal Command／Job Handler 完整性驗證。
- Domain Event 訂閱完整性驗證。
- Content Manifest 驗證。
- Definition reference 驗證。
- Resolver reference 驗證。
- Runtime Schema 驗證。
- Production dependency graph 驗證。
- Fixture／Bring-up import 禁止檢查。
- 硬編碼 Definition／Resolver／Rule ID 掃描。
- 跨語意 ID 強制轉型掃描。
- 正式 Handler 的資料 fallback 掃描。
- Content Pack Bootstrap smoke test。
- 缺少資料時必須失敗的負向測試。
- 替換 Content Pack 後行為確實改變的測試。
- Runtime Pack 與閱讀用 HTML 產物同步驗證。

任何一項失敗都不得產生正式 Build。

## 十五、Code Review 必查項目

每次修改正式 Runtime，審查者必須確認：

1. 這個數字是系統不變量還是可調資料？
2. 這個 ID 從哪個 Definition／Command／Query 取得？
3. 這項資料的擁有者是哪個模組？
4. 資料不存在時是否明確失敗？
5. 是否出現固定成功或 accepted no-op？
6. 是否用型別轉換掩蓋契約缺失？
7. 是否從 Fixture 或文件內容取得資料？
8. 是否新增尚未閉合的公開 Capability？
9. 是否需要 Schema Migration？
10. 更換 Content Pack 後行為是否會改變？

只要其中任何問題無法明確回答，修改不得合併。

## 十六、目前優先清理項目

依風險排序：

1. Effect ID 被直接當成 Status ID。
2. Dungeon 事件選項固定成功。
3. Dungeon 固定陷阱尚未解析。
4. NPC Dungeon 怪物內容固定視為成功。
5. `combat-rule-standard` 寫死於 Combat。
6. 控制抗性 Definition 尚未被 Runtime 使用。
7. 戰鬥休息固定恢復 5 HP／MP。
8. 臨時角色性別固定為 female。
9. 年齡經驗倍率固定為 1。
10. Team 休息時間寫在 Handler。
11. Skill 的 `weaponRequirementIds` 缺少裝備端正式資料契約。
12. Combat 沒有消費 `targetResolverId`。
13. Team 自行鑄造 Map Instance ID。
14. Bring-up Bootstrap 使用固定 archetype、HP／MP、性別與站位。
15. 正式 Content Pack、Composition Root 與 NewGameBootstrapper 尚未建立。

上述項目不能以保留 TODO 的方式結案。必須擴充正式資料契約並移除暫代行為；在完成以前，對應 Capability 不得視為可用。

## 十七、完成標準

本規範只有在以下條件全部成立後才算落地：

- 正式 Runtime 不直接依賴文件資料。
- 正式 Runtime 不依賴任何 Fixture 或 Bring-up 程式。
- 正式 Bootstrap 只能從已驗證 Content Pack 建立世界。
- 正式 Handler 沒有硬編碼內容 ID。
- 正式 Handler 沒有可調數值 fallback。
- 缺少資料時一定明確失敗。
- 不存在固定成功的未完成流程。
- 不存在用 accepted no-op 偽裝的未完成功能。
- 不存在跨語意 ID 強制轉型。
- 所有 Runtime Entity 都由擁有模組建立。
- 所有公開 Capability 的跨模組流程完整閉合。
- 所有可調內容都能只修改 Content Pack，不修改 Runtime 程式。
- 同一套 Runtime 可以載入不同文化或平衡 Pack，並產生不同結果。
- CI 能阻止任何新的硬編碼、fallback、Fixture 引用或不完整 Capability 進入正式 Build。
