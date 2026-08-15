# 開發者日誌（Developer Log）

實作時序 + 決策脈絡的執行日誌。**最新在上**。與其他文件的分工：

- `HANDOFF.md`（repo 根）＝**現況快照**（此刻什麼做完了、什麼待做、怎麼驗證）。
- `docs/review/`＝**設計複審決策**（設計層裁決紀錄）。
- 本檔＝**做了什麼、為什麼這樣做、途中發現了什麼**的時間軸敘事。commit message 記「這個 commit 改了什麼」；本檔記「這一段路的判斷與轉折」。

---

## 2026-08-15 — 複審回合 12：4 個 P1 + 1 個 P2（引擎收尾 + 內容軌地圖格式）

兩條引擎問題都是**上一輪修一半**：R11 修的地方對，但同一條規則的另一半沒補。另外三條在剛併入的三國內容
軌，是資料格式本身表達不出既定地圖規則。

**#1 跨武器組移裝時舊組沒有事件** —— R11 #1 讓 `configureWeaponSet` 對「本組」兩手發 `EquipmentChanged`，
但把 WS0 的武器改裝到 WS1 時，State 正確清空了 WS0，事件卻只宣告 WS1。依 `weaponSetId` 分別快取的 UI／
戰力會留著 WS0 的舊資料。改：被清空的**其他**武器組也各自發事件。

**#2 現有刷新鎖仍可被 set 覆蓋** —— R11 #4 擋住了「別張委託 release 別人的鎖」，卻沒擋 set。別張委託直接
覆蓋一樣奪走所有權，而且**比原本的洞更糟**：覆蓋後 `sourceQuestId` 換成了劫奪者，原委託連自己下的鎖都
解不掉。改：現存鎖屬於別張委託時 set 一律拒絕；同一張委託重設（延長、改 reason）仍允許。

**#3 字元格表達不出正式房間拓樸** —— 三國地圖存成一格一符號的字元格。那表達不出 01_map_module.md §94–96
要求的多格 L／T／凹形房間、通道與紅門；渲染又對**每一格**描邊，等於在正式閱讀版上宣告所有房間都是 1×1，
而且完全畫不出紅門。改：改用雲華早就在用的房間模型——一層＝房間（一組格＝一個移動節點＝一個內容槽）＋
連線（通道／紅門）；牆只畫在不同房間之間，多格房間因此自然合併。渲染抽到
`shared/map_render.mjs`，四國共用一份，不再讓字元格那份繼續分岔。

**#4 國家迷宮樓梯鏈不連續** —— 維爾冬 B2／B3／B4 的樓梯座標跳動，最深層甚至沒有樓梯；奧瑞恩與薩菲爾套用
同一份錯誤版型。§98 規定樓梯是 1×1 單一功能房，所以中間層需要**兩座**（一上一下）。改：以兩個座標交替
——F1 ↓(2,5)；F2 ↑(2,5) ↓(5,2)；…；F6 ↑(2,5)——每一對相鄰樓層座標相同（§97），最上層無 ↑、最底層無 ↓。

**#5（P2）驗證器只檢查列數與欄數** —— 這正是上面三條能通過「驗證成功」的原因。改：`shared/map_model.mjs`
依 §94–101 全面驗證——格在界內且不重疊、功能房 1×1 且互斥且不帶內容、大型敵人房至少 2×2、事件房至少 2 格、
採集房不得再有其他內容、每扇紅門至少一側有守護偏好、每層連通、每張圖恰一入口一出口、樓梯鏈配對。上述每一
類缺陷都實測確認會被抓到。

### 這輪的教訓

1. **「修了 A 路徑」不等於「修了這條規則」。** #1 #2 都是 R11 只補了規則的一半。R10／R11 記的是「同一件事
   有兩條入口會分岔」，這輪是同一個病的變體：**同一條規則有多個觸發點**（configureWeaponSet 的本組 vs 其他
   組；lock 的 set vs release）。修規則時要列出它所有的觸發點，不是只修被回報的那個。
2. **不完整的防線可能比沒有更糟。** #2 覆蓋鎖之後，原委託連自己的鎖都解不掉——R11 #4 只擋 release 反而讓
   劫奪變成不可逆。
3. **資料格式決定了規則能不能被遵守。** #3 不是「畫錯了」，是字元格**根本表達不出**多格房間與紅門。遇到
   「輸出不符規則」時，先問格式表達得出來嗎。
4. **驗證器要驗規則，不是驗形狀。** #5 只比對列數欄數，於是三類實質錯誤全部合格通過。

`tsc` 乾淨、verify 全過、四國 HTML 產生器全部通過。引擎兩條各自 mutation check；地圖驗證器以六類人造缺陷
（樓梯跳動、缺最底層樓梯、大型房 1 格、功能房非 1×1、房間不連通、紅門無守護）實測確認會紅。

**待內容**：三國目前仍共用同一份拓樸（併入前就是如此）。要讓各國迷宮在地形上真正不同，是內容設計工作，
不是格式問題——已記入 HANDOFF。

---

## 2026-08-15 — 複審回合 11：2 個 P1 + 3 個 P2（事件通知、Job 生命期、擁有權）

R10 的六項修正本身都站得住，這輪抓到的是它們**周邊**沒補齊的部分。其中 #2 是我在 R10 基於**錯誤的執行模型**
寫下的——值得單獨記。

**#1 武器組配置不通知 Character 重算上限** —— `configureWeaponSet` 只發 `WeaponSetConfigured`，從不發
`EquipmentChanged`。character 能力上限、Combat Power、UI、快取都靠後者重算；換武器組配置後上限不會更新
（若該裝給生命上限，角色可能停在高於新上限的 HP）。**這與 R7 #3「自動卸裝沒發 EquipmentChanged」是同一個
形狀，只是換了一條入口**——又一次印證 R10 的教訓 2「同一件事有兩條入口就必然分岔」。改：每隻**佔用者有變**
的手各發一筆，slot 由該手解析（清空時退回舊占用者的同手 slot）。

**#2 早到的成年 Job 會永久消失** —— R10 #4 我把早到分支寫成靜默 no-op，理由寫在註解裡：「同一筆 Job 之後
仍需生效」。**那個前提是錯的**：`session.ts` 明寫 Job 於交易**成功提交時就被 Scheduler dequeue**，而 no-op
也算成功提交。於是早到的成年 Job 被消耗掉、再也不存在，角色永遠長不大。改：早到時**重排**到
`birthDay + adulthoodAgeDays`，token 照常消耗，新 Job 帶前進後的值。R10 那條測試也一併翻正——它把同一個
Job 物件餵給後續 state 再跑一次，而那在真實 Scheduler 下不可能發生。

**#3（P2）卸下雙手武器會重複更新同一實體** —— 雙手武器 main===off，`displaced` 沒去重就會對同一實體跑兩次
卸下迴圈，revision 為了一次變更白跳兩格。`equipItem` 早就有 `!displaced.includes(...)` 防護，
`configureWeaponSet` 沒有——同樣是「兩條入口只修了一條」。

**#4（P2）任意 Quest 都能解除別人的刷新鎖** —— release 分支沒有比對 `sourceQuestId`，一張無關委託就能解掉
鎮壓／討伐目標地圖的鎖，讓它提前恢復刷新、洗掉委託生成時固定的目標狀態。無鎖可解也靜默成功。改：解鎖須
有鎖且 `sourceQuestId` 相符。

**#5（P2）Pending 流程圖仍是舊規則** —— R10 #6 改了 §5.1 的 Job 表並加了裁決註記，但 §7.2 的流程圖沒跟著
改。同一份文件裡兩處講不一樣的事，比只有一處講錯更糟。已補上鎖定分支與 `pendingCheckScheduledFor` 的存活
判定。

### 這輪的教訓

1. **修一條規則時，把同類入口一起 grep 過。** #1 與 #3 都是「另一條入口沒跟上」。R10 已經記過這條，這輪
   仍各中一次——說明光「知道」不夠，要在動手時真的去查。
2. **對 runtime 的假設要去讀，不要用推的。** #2 我在註解裡寫下一個沒驗證過的執行模型，測試又照那個模型寫，
   於是測試「通過」但保護的是錯的東西。**mutation check 擋不住這種錯**——它只證明測試咬得住實作，不證明
   實作對。要驗前提，得去讀 `session.ts`。
3. **改文件時，同一份文件裡的重複描述要一起改。** #5：型別、表格、流程圖講的是同一件事。

`tsc` 乾淨、verify 全過（新增：兩手變更各發 EquipmentChanged、清空手發 undefined、卸雙手武器 revision 只跳
一格、早到重排且到期真成年、非下鎖者不得解鎖、無鎖解鎖被拒 等測）。四條程式修正各自 mutation check 過。

---

## 2026-08-15 — 複審回合 10：4 個 P1 + 2 個 P2（新能力的邊界、跨入口一致性、文件衝突）

比 R9 好得多：**沒有一條是把既有行為改壞的回歸**。這輪的形狀改成三類——① 新開放的能力沒把邊界一起補上、
② 同一件事有兩條入口而只修了一條、③ 兩份正式文件互相矛盾。

**#1 同一把單手武器可佔滿兩手** —— R9 #1 讓單手武器可以放副手（雙持），但沒補反向邊界：
`configureWeaponSet` 只擋「雙手武器 main !== off」，單手武器 main === off 直接通過；`equipItem` 把已在主手的
劍改裝到副手時也不清主手引用。兩種情況都讓 Loadout 兩手指向同一實體，而 `ItemLocation` 只能指向其中一手。
**雙持是兩把武器，不是一把佔兩次**。改：`configureWeaponSet` 拒絕非雙手武器的 main === off；`equipItem`
換手時清掉原手引用。

**#2 裝備流程混淆 Owner 與位置** —— 兩條裝備入口各驗各的：`configureWeaponSet` 只驗 Owner，於是
`homeStorage` 裡的裝備可以直接穿上（繞過住宅取物與攜帶重量），被 Quest 保留的物品也照收。**Owner 是「誰的
東西」，location 才是「東西在哪」，兩者不能互相代替。** 改：抽出 `equipLegalityRejection`，兩條入口共用——
只接受該角色背包內或身上既有裝備，且任何 active reservation 一律拒絕。

**#3 多格裝備的 Query 回傳錯誤** —— `getEquippedItem` 掃 `ItemLocation.slotId`，但一件裝備只保存**一個**位置
錨點，卻可以占多個 slot。雙手劍的副手查詢、長袍的頭部查詢都回 `undefined`，即使 Loadout 明確顯示它們占著。
改：權威改為 **Loadout 的 slot 對應**——武器組以「該裝備現在在哪隻手」解析（單手武器的 `occupiedSlots` 只有
`[mainHandSlot]`，放副手時對不上），鎧甲直接查 `armorSlots`（多格鎧甲每格都指向同一件）。

**#4 生命週期 token 沒有在結算／重排時前進** —— R9 #3 把 token 拆成逐種類，卻**只做了一半**：從沒在 Job 真
的被處理時前進它。兩筆同 token 的成年 Job 會各發一次 `CharacterBecameAdult`；退休／自然死亡選 reschedule
時 token 不動、新 Job 還帶舊值，於是重複 Job 每輪各排一筆而**逐輪增殖**。改：驗證通過即消耗該 lane 的
token，runner 一律拿已消耗的 character（reschedule 排出的新 Job 因此自動帶前進後的 token）；兩條 reschedule
路徑原本回傳未變的 state，等於把消耗丟掉，一併修正。**邊界**：成年 Job 早到時什麼都沒發生，就**不**消耗——
否則那條 lane 的 token 白白前進，真正到期的同一筆 Job 反而過期，角色永遠長不大。這條是第一版 mutation
check 唯一沒抓到的，補測後才釘住。

**#5（P2）製作素材沒有位置防線** —— 已裝備的劍可以直接當素材；等 Transform 實作後會消耗掉它卻在 Loadout
留下引用。同 #2，`05_inventory_module.md §367` **本來就要求驗「位置」**。改：素材只能來自 Owner 的背包或
住宅存放。

**#6（P2）刷新鎖與 Pending 的文件互相矛盾** —— GDD §183 明定鎮壓／討伐鎖期間「跳過刷新日**且不建立
Pending**」、解除後等下一個固定刷新日、不補算不累積；`01_map_module.md §5.1` 卻寫成「保留 Pending 並重排」。
實作兩邊都不是：留下一個永遠不會被重排的 marker。**以 GDD 為準**——設鎖時清除既有 Pending，並更正架構書
（含 Job 表的真實存活條件與鎖定情形）。

### 觀察

R9 那輪的教訓（「拒絕掉它不是修正」「共用 revision 當存活判定必然誤殺」）都沒有再犯。這輪浮現的是**下一層**
的三種形狀，值得記住：

1. **開放一個新能力時，把它的反向邊界一起補。** #1：允許單手武器放副手，就必須同時回答「那同一把可以兩手
   都放嗎」。新自由度一定帶來新的非法狀態。
2. **同一件事有兩條入口，就必然會分岔。** #2 的 `equipItem` 與 `configureWeaponSet`、#5 的素材位置，都是同一
   條規則只寫在一邊。抽成共用函式，不要靠兩邊記得同步。
3. **Query 與 State 的權威要講清楚。** #3 的錯不在查詢寫錯，而在拿「一個錨點」去回答「占用了哪些格」。
4. **兩份文件衝突時，先裁決再實作。** #6 的實作兩邊都不是——那是文件沒裁決的直接後果。

`tsc` 乾淨、verify 全過（新增：單手不得兩手同一件、換手清原手引用、homeStorage/任務保留物兩條入口都擋、
雙手劍副手查得到、長袍頭部查得到、雙持兩把各自查得到、已裝備物不得當素材、成年結算消耗 token、早到不消耗、
reschedule 消耗且新 Job 帶新 token、設鎖清 Pending 等測）。全部經 mutation check，共 9 條各自驗過會紅。

---

## 2026-08-14 — 複審回合 9：4 個 P1 + 2 個 P2（**R8 修正自己造成的回歸**）

這回合難堪但重要：**六條裡有三條是 R8 的修正親手造成的**，其中兩條是「修 A 洞挖出 B 洞」，一條是把
早就修過的東西改回去。R8 那輪每一項都有 mutation-check 過的迴歸測試，測試也確實咬得住它們各自宣稱的
那件事——但沒有一個測試涵蓋「這個修正**同時**破壞了什麼」。教訓寫在最後。

**#1 雙持被再次禁掉（回歸）** —— R8 #1 為了修「單手武器放副手時 `slotId` 寫成主手」，直接拒絕單手武器
放副手。那違反 GDD §511（同組內可混搭兩種武器）與 §250 的雙持傷害倍率，也牴觸雲華／維爾冬內容裡的
單手武器定位。更難堪的是 **R5 #5 已經修過同一條**（見本檔 R5 段落：「雙持被誤禁——R4 手部驗證讓副手只
收盾」），R8 又把它改了回去。禁用從來不是對的解，只是資料模型表達不出那個配置而已。改：契約新增
`EquipmentDefinition.handSlots`（可放置手別 → 該手的 slot）。`occupiedSlots` 只能說「占幾個 slot」，說不出
「這把單手武器現在在副手」——那是**配置**決定的，不是定義決定的。`configureWeaponSet` 依 handSlots 判定
合法性、依**實際配置的那隻手**寫 `ItemLocation.slotId`；`equipItem` 改由玩家指名的 slotId 解析目標手，
不再從 `equipmentKind` 猜。

**#2 探索操作會讓 Pending 刷新永久失效（回歸）** —— R8 #2 拿 `MapInstance.revision` 當 Job 存活判定，但開門、
陷阱、採集、內容結算全都會 bump 它。排好次日檢查後只要有人開一扇門，那筆 Job 就變成 no-op，而 no-op 路徑
**不會再排下一次**，地圖從此不再刷新。這正是 R8 #6 我自己在 character 指出的同一個陷阱——當時沒把同一個
透鏡套到 map 上。改：改驗刷新自己的 token `refresh.pendingCheckScheduledFor`（Job 的 dueDay 須與它相符），
它只由 Pending 登記與刷新本身改動。同時仍擋得住 R8 #2 的原始情境。`pendingCheckJobDraft` 也不再掛
`expectedRevision`——設了卻沒人讀的欄位，只會讓下一個人以為那裡有防線。

**#3 退休後不會自然死亡（回歸）** —— R8 #6 用**單一** `lifecycleRevision`，退休會跳它，連帶讓角色出生時就
排好的自然死亡 Job 一起失效；但 Handler 明明允許 retired 執行，於是退休角色永遠不會老死。一個 token 表達
不了三種失效條件不同的 Job。改：拆成 `lifecycleRevisions`（逐種類一個）——`adulthood` 只在死亡失效、
`retirementCheck` 在死亡或已退休失效、`naturalDeathCheck` **只**在死亡失效。`lifecycleJobDraft` 改成收
`character` 並自己依 payload 種類取 token，不讓呼叫端傳——傳錯種類正是這條的成因。

**#4 戰敗返城早於戰利品分配（回歸）** —— R8 #5 在同一筆交易關 Session、Finalize、開始返城。那違反
03_dungeon_module.md §443（競拍期間仍算位於冒險地，不可開始返城），而且 `closed` 的 Session 不再匹配
`AssetDistributionCompleted` 的玩家分支，競拍結束後那個事件會落空。改：新增 `defeated` 狀態——探索結束、
收集結束，但 Session 留著、不返城；等 `AssetDistributionCompleted` 才關閉並返城。分配屏障對 leaving 與
defeated 一致，差別只在**完成經驗只給 leaving**。

**#5（P2）製作保留無法表達數量與素材需求** —— `ReserveCraftingInputs` 只有 `itemIds`：說不出這次用掉幾個
（3 瓶藥水只用 1 瓶也整疊鎖住）、說不出對應配方哪一格，重複 ID 還照單全收（同一實體 bump 兩次 revision、
發兩次事件，第二筆覆蓋第一筆）。值得注意的是 **05_inventory_module.md §367 本來就寫了要驗「數量」**——
這條與其說是設計缺口，不如說是實作沒跟上文件。改：`inputs: { itemId, quantity, slotId }[]` + 命令帶
`recipeId`，保留記下 `recipeId` + `slotId`；拒絕重複 ID、非正整數數量、超過持有量；保留量即請求量。配方本身
的合法性仍由 `startCrafting` Workflow 驗（doc 20 §191）——Inventory 的 Reader 讀不到配方定義，這裡只忠實
記錄已驗證的身分。**已知限制**：部分保留仍會鎖住整個實體（`isReservedActive` 是「有保留就算」），要等
堆疊拆分才能真正只鎖 2 瓶。

**#6（P2）正式架構文件沒跟上契約** —— R8／R9 動過的 Source Contract 都回寫了：`Character.lifecycleRevisions`
（04）、`ItemReservation` 判別聯集 + `EquipmentDefinition.handSlots` + `ReserveCraftingInputs` 新輸入（05）、
`PlayerExplorationSession.status` 加 `defeated` + `AssetDistributionCompleted` 的兩種來源 +
`listContentEventOptionIds`（03）、pending 刷新的存活判定（01）。不回寫的話，下一位依正式文件實作的人會做出
不相容的模型。

### 這輪真正的教訓

R8 的每一項都有 mutation-check 過的迴歸測試，而且都咬得住——問題不在測試不夠嚴，在**測試只涵蓋了修正
宣稱要修的那件事**。三條回歸的共同形狀是：

1. **「拒絕掉它」不是修正，是把缺陷換個位置。** #1 用禁用雙持來修 slotId 撞位。要問的是「這個配置合法嗎」——
   合法就代表資料模型缺了東西，該補契約而不是擋使用者。
2. **拿共用 revision 當存活判定，一定會誤殺。** #2 #3 是同一個錯誤的兩個實例。任何 `expectedRevision` 都要
   先問「還有誰會 bump 這個計數器」。答案通常是「一堆不相干的動作」。
3. **修「東西沒被收掉」時，要連順序一起想。** #4 為了不留下孤兒 Distribution 而提早關 Session，反而跳過了
   分配屏障。
4. **改動前先查這條有沒有修過。** #1 早在 R5 就修過一次。動一條看起來像「缺防護」的邏輯前，先 grep DEVLOG。

`tsc` 乾淨、verify 全過（新增：雙持兩把武器落在不同 slot、盾不得放主手、equipItem 尊重指名副手、開門不得
作廢 Pending 刷新、退休角色仍會自然老死、過期退休檢查丟棄、戰敗等分配完成才返城且不發完成經驗、正常離場
仍發完成經驗、重複素材 ID 拒絕、數量邊界 等測）。全部經 mutation check：**每一條回歸都用「把 R8 的實作原樣
放回去」驗過會紅**。

---

## 2026-08-14 — 複審回合 8：5 個 P1 + 2 個 P2（狀態邊界 + 未驗證的 Job/輸入）

這回合的共同主題是**「宣稱有驗、其實沒驗」**：契約與註解都寫了防線（`expectedRevision`、選項合法性、
`contentRevision`、`craftingAttemptId`），實作卻沒讀。全套 `tsc` 與 `verify-modules` 在修之前就是全綠的
——因為這些全是現有測試沒覆蓋的狀態邊界。所以這輪每一項都補了會**咬**的迴歸測試：新測寫完後逐一把修正
反轉（mutation check），確認測試真的紅，才算收。

**#1 單手武器放副手時位置寫成主手** —— `EquipmentDefinition` 只宣告 `occupiedSlots`，單手武器的是
`[mainHandSlot]`，模組根本沒有副手 slot 可記；`configureWeaponSet` 於是把 `ItemLocation.slotId` 寫成
**主手**，和主手裝備衝突，也和 `equipItem`（單手一律進主手）互相矛盾。改：副手只收盾（其
`occupiedSlots = [offHandSlot]`，slotId 才正確）或共用的雙手武器，單手武器放副手直接拒絕，兩條裝備路徑
判定一致。**待做**：真雙持（一組兩把武器）需要資料模型補 slot→hand 的訊號。

**#2 過期的地圖刷新 Job 仍會刷新** —— `handleMapRefreshCheck` 只確認實例存在，完全沒讀
`job.expectedRevision`。同日產生的兩筆 Pending Job 都會跑，地圖版本從 1 連刷成 2、3。Job 本來就帶著
`expectedRevision`，改為不符即 no-op：第一次刷新跳 revision，比它舊的 Job 全部自然出局。

**#3 NPC 舊結果可清除已保護的內容** —— `handleApplyNpcDungeonSettlement` 只驗 mapVersion／內容狀態，
忽略目標的 `contentRevision`、內容自己的 `mapId` 與 `npcResolverId`。委託保護內容（會跳 content revision）
之後，保護前產生的 NPC 結果仍能把它結算掉。改為三者皆須相符，不符則轉入 `skippedResults`。

**#4 任意偽造的事件選項都被當成成功** —— `resolveDungeonInteraction` 完全不驗 `optionId`：清掉 Pending
並固定回報成功，UI 送什麼都算數。契約補 `DungeonDefinitionReader.listContentEventOptionIds`，非法選項一律
拒絕且**不動 Session**（玩家可以重送合法選項）。兩個 Reader 都實作：真實 Reader 以
`getGatheringInteractionView` 的同一個窄化投影模式從 `content-event` 定義取選項表，fixture 供其單一選項。
資料化的分支結果（效果／戰鬥／物品）仍待內容軌，TODO 保留。

**#5 戰敗留下永遠 collecting 的戰利品分配** —— 戰敗只關 Session 並開始返城，探索起始時建立的
Distribution 沒有任何人收：Session 一旦 `closed` 就不再匹配 `AssetDistributionCompleted` 分支，那筆分配
**再也碰不到**。改為與 `StartReturnFromDungeon` 一併送 `FinalizeAssetDistributionCollection`。Session 仍是
直接 `closed` 而非 `leaving`——全隊戰敗不算完成探索，不得走 `MapExplorationCompleted`（會發完成經驗）那條。

**#6（P2）生命週期 Job 的 revision 防線只存在於註解** —— `characterLifecycleDue` 帶著
`expectedRevision`，Handler 的註解也寫了「Job 帶 expectedRevision」，但從沒讀過它。這條的陷阱是**不能拿
`character.revision` 驗**：它每次受傷、狀態變更、可用性調整都會跳，拿它當防線會讓成年／自然死亡 Job 在
到期前就全部「過期」而永不觸發。改為新增獨立的 `lifecycleRevision`，只在 lifeState 轉換（`toDead`、退休）
時跳，五個 Job draft 改帶它、Handler 比對它。這兩種失敗模式各自有測試把關：拿掉防線、以及改用
`revision` 驗，分別會紅在不同案例上。

**#7（P2）製作保留遺失 Attempt 身分** —— `ReserveCraftingInputs` 帶著 `craftingAttemptId`，但
`ItemReservation` 是扁平結構、無處可放，於是被丟掉；事後無從確認素材保留給哪一次製作。改成**判別聯集**，
`craftingInput` 分支必填 `craftingAttemptId`，由編譯器在未來每個建構點強制，而不是一個會靜靜沒被設定的
選填欄位。消耗端 `TransformCraftingItems` 在 `inventory/public.ts` 有宣告但**尚未實作**，所以今天還沒有
對象可驗；這一步先把未來要比對的身分記下來。

`tsc` 乾淨、verify 全過（新增：非法選項拒絕且保留 Pending、合法選項照常結算、戰敗結束 Distribution、
生命週期 token 過期丟棄、受傷不誤殺 Job、製作保留記錄 Attempt 等測）。

---

## 2026-08-13 — 複審回合 7：6 個 P1（跨模組執行 + 狀態一致性）

跨模組執行檢查抓到 6 個 P1。逐一修根、加測試、各自 commit。

**#1 Subscriber 的後續訊息被 Router 靜默丟棄** —— 這是最有影響的一條。`SubscriberDispatch` 只回 `mutation`，模組 Subscriber 的 `outgoingMessages` 沒交給 Transaction Runner。實測戰鬥勝利後 dungeon 送的 `ResolvePlayerMapContent` 從未執行、地圖內容永遠停在 available；也波及 NPC 地牢結算與 progression 次級事件。kernel 的 EventSubscriber **本就支援 outgoing**（會 enqueue），只有 Router 沒供給。改 `SubscriberDispatch` 回 `{ mutation, outgoing? }`、`subscriberResult()` 帶上 outgoingMessages，全表改用它。

**#2 支援熟練度冪等鍵範圍過大** —— R6 的 key 只有 `combat:support + encounterId`，但 Combat 每名角色每技能各發一筆 → 同場第一筆入帳後其餘全被當重放（第二名支援者拿不到）。key 加 `characterId:skillId` discriminant；attack/defense 聚合全隊於單一事件，維持 encounter 級 key。

**#3 自動卸裝沒發 EquipmentChanged** —— R6 移任務貨物時清了 Loadout，但只發 `InventoryTransferred`。character 能力上限/Combat Power/UI/快取不知裝備已卸（若該裝給生命上限，角色可能暫留高於新上限的 HP）。卸裝時補發 `EquipmentChanged(itemId: undefined)`。

**#4 Resolver 可寫入非法戰鬥配置** —— 玩家設站位走 `validatePlacements`，但招募/離隊的 `recomputeFormation` 直接信任 Resolver。實測 Resolver 把三人全塞 (0,0)，招募仍成功、非法重疊寫進 State。改：`recomputeFormation` 驗證 Resolver 輸出，非法則退回模組自算的 row-major 合法配置（Team 自己守不變量，Resolver 無權破壞）。

**#5 removeTeam 留下 Active Plan/FreeAction** —— R6 清了 Formation/Retention，但 plans/freeActions 沒清。招募一個正跑 City Free Plan 的單人 NPC → Team 消失但 Plan 仍在、引用死掉的 Team。改：`removeTeam` 成為「結束 aggregate」——一併清所有 `teamId===id` 的 plans/freeActions。孤兒的 teamPlanDue Job 因對應 Plan 已移除,`handleTeamPlanDueJob` 的 `tryGetPlan===undefined → no-op` 安全跳過,不進 requireTeam。

**#6 地牢戰敗後仍恢復探索** —— `handleCombatEncounterResolved` 勝敗一律回 exploring，全隊戰敗仍能走地牢。改：非勝利 → Session 收為 `closed`（不回 exploring）+ 送 `StartReturnFromDungeon` 讓 team 結束地牢 Plan + 返城。**架構待做**：完整版應由 `CombatTeamOutcome(canContinue=false)` 統一驅動 Team+Dungeon 退出（該事件與其訂閱尚未接入 Manifest）；目前 dungeon 直接驅動退出。

`tsc` 乾淨、verify 全過（新增：subscriber outgoing 保留、支援多人入帳、卸裝發事件、非法配置退回、aggregate 清除、戰敗結束探索 等測）。

---

## 2026-08-13 — 複審回合 6：5 個 P1（狀態不變量；現有測試沒覆蓋到）

全是「tsc + verify 全綠但狀態不變量被破壞」的洞——現有測試沒測到。逐一修根、加不變量測試、各自 commit。

**#1 戰鬥熟練度事件非冪等** —— `handleCombatAttack/Defense/SupportMasteryEarned` 用固定 awardKind、**完全沒用 `payload.source`**，同一 `CombatAttackMasteryEarned` 重放 → 經驗 50→100、又發 5 個事件。doc §7.5 要求以 `CombatMasterySource` 冪等。加 `masteryLedger`(key = awardKind + encounter/sequence);`applyMasteryOnce` 已記帳的來源重放 → no-op。attack/defense/support 各自 key,同 encounter 三種不互擋。

**#2 裝備中物品可直接變任務貨物** —— `moveItemToTeamQuestCargo` 把物品移到 `teamQuestCargo` 卻沒動 Loadout,武器仍掛主手 → 破壞 single-location。(`reserveQuestItem` 刻意允許保留 equipped 物品,故此流程本就接受 equipped;修法是**同步卸下**而非拒絕。)加 `clearLoadoutRefIfEquipped`:物品離開 equipped 時,同一交易清掉所有武器組/裝甲格引用。transferItem/removeItem 本就對 equipped 物品拒絕,不受影響。

**#3 離隊/刪隊沒同步戰鬥配置** —— 違反「成員變動須於同一交易產生合法配置」。離隊後:玩家隊配置仍含離隊者、新生成單人 NPC Team 無配置;招募刪除來源 Team 後舊配置殘留。修:`settleRetentionAndDepartures` 離隊後重建玩家隊配置 + 為每個新生成 NPC Team 建配置;`removeTeam` 一併清 `combatFormations`/`memberRetention`(招募走 removeTeam,故來源配置不再殘留)。

**#4 溢出傷害算進熟練度** —— 對剩 5 HP 敵人面板 30 傷,帳本記 30(非真正扣的 5),高傷武器靠尾刀刷攻擊熟練度。改 `recordAttackDamage` 用 `min(面板, 目標當前 HP)`;面板值仍用於顯示與致死判定。

**#5 配置未驗 `floor`** —— 格位只驗 row/col 範圍,重疊 key 卻含 floor → 同 row/col 但 floor 0 vs 99 可規避重疊檢查。戰鬥配置單一 3×3,floor 必為 0;非 0 現以 cell-out-of-range 拒絕。

`tsc` 乾淨、verify 全過(新增:熟練度冪等、任務貨物卸裝、離隊/刪隊重建配置、溢出傷害、floor 等測)。

---

## 2026-08-13 — 複審回合 5：7 P1 + 1 P2（上輪修得太窄的補課 + 文件漂移）

複審重現 7 P1 + 1 P2，多條直接證明 R4 修得太窄（只覆蓋窄測案例）。逐一修根、各自 commit。

**#1 Query 仍偽造 WeaponSetId（split-brain）** —— R4 只改 Handler 配核心 ID，Query 的 `emptyLoadoutView` 仍回 `${char}:ws0`。UI 拿 Query 的 ID 去 equip → `unknown-weapon-set`。根治:Loadout 收斂為**單一** `createInitialLoadout`(角色誕生時鑄);Handler 改 `requireLoadout`(未建 → `loadout-not-initialized`,不再自行配 ID);Query 未建角色回明顯哨兵 ID(不偽造)。測:Query 給的 ID 能被 Handler 認得(round-trip)。**待接**:createInitialLoadout 進 bootstrap/角色生命週期。

**#2 `runDueJob` 執行未到期 Job** —— 只驗在不在 Scheduler,沒驗 `dueDay <= worldDay`。補到期檢查(未到期 → `job-not-due`、不開交易)。**副作用**:bootstrap 與 travel-integration 測試原本就靠「提前執行未來 Job」跑,現改為先把世界時鐘推進到 `dueDay`(真實快轉語意)。

**#3 cast/perform 仍可偽造目標側別** —— R4 側別只擋 `actionKind==='attack'`。把傷害技能標成 `cast` 就繞過、打隊友。根治:側別**由效果推定**(有 dealDamage→敵方、有 heal→己方),不看 actionKind;`applyEffect` 再逐效果守門(傷害永不作用己方、治療永不作用敵方)。

**#4 `equipItem` 仍破壞 single-location** —— R4 只修了 `configureWeaponSet` 的跨組清除,漏了另一入口 `equipItem`。補上同樣的跨組清除。

**#5 雙持被誤禁** —— R4 手部驗證讓副手只收盾,違反 GDD「同組可混搭兩把武器」。改:副手也收單手武器(仍擋單獨雙手武器/鎧甲/飾品)。R4 那條「單手劍不得放副手」測試翻正。

**#6 `configureWeaponSet` 繞過技能驗證 Workflow** —— 直接路由到 Inventory,可寫入不存在的技能 ID;Combat 又在 `knows()` 前先 `getSkillView()`,遇偽造技能直接拋錯。安全面修:Combat 把 `knows()` 移到 `getSkillView()` **之前**,偽造/未學技能於 knows() no-op(不崩潰、不施放)。**待做**:configure 時的技能驗證 Workflow(屬未建的 application-workflow 層)。

**#7 招募邊界仍缺(部分修)** —— 補**同城硬條件**(旅行中/跨城 → `not-in-same-city`)。仍缺 retryEligibilityResolverId(需重試計數 state + resolver)、酒館可見性(需內容)、社交 `inviteSuccessBonus`(需社交 Query)、`RecruitmentResolved` 結果事件(需契約)——皆記於 HANDOFF,未藏。

**#8 WorkflowDefinition 仍縮水** —— 缺 `steps`、`startsFrom` 只支援事件、驗證器允許額外訂閱。補齊 `steps`(對齊 12_engine_runtime.md 的 `WorkflowStepDefinition`)、broaden `startsFrom`、`validateManifest` 加「Workflow 只能訂閱其 startsFrom」檢查。註:runtime 仍直接執行單步,完整 step-machine 未接。

**文件漂移**(複審點名):HANDOFF 的 Workflow 表列與 RNG 段更新為現況(共用單一訂閱表、招募擲敗已改接受);`session.ts` dequeue 註解由「交易前」改回「成功提交時」。

`tsc` 乾淨、verify 全過(新增:job 未到期、Query/Handler ID 一致、cast 側別、equipItem 跨組、雙持、knows() 前置、同城、extra-subscription 等測)。

---

## 2026-08-13 — 複審回合 4：4 個 P1 + 2 個 P2（玩法邊界與 ID 出處）

「全綠不代表玩法邊界安全」。這輪 6 則全真、逐一修+測，各自 commit。

**#1（P1）已消耗/取消的 Job 可重放** —— `runDueJob` 直接跑呼叫者傳入的 Job 快照，沒對照目前 `scheduler.jobsById`。同日快照裡，前一筆交易若取消/消耗後一筆，照舊快照重跑會**重複結算**（NPC 地牢、刷新）。改：依 `jobId` 從目前 Scheduler 取**權威** Job 來跑；不在佇列 → 不開交易、不推進 cursor、回 `engine/job-not-scheduled`。測：跑完 teamPlanDue 後拿同一快照重放 → 拒絕、序號不變、原封回傳。

**#2（P1）招募擲敗永遠無法靠重試改變** —— 擲敗以 `reject` 表達，回滾 §7.2 cursor，下一次招募得**相同 CommandId → 相同 RNG stream/cursor → 相同骰值**（實測兩次 stream 完全相同）。機率「沒中」是正常玩法結果:改**接受並提交、不轉移角色**;提交推進序號，下次得新 stream。資格不符（隊滿等）才拒絕。（上一輪我把這列為「留待」，這輪照要求修掉。）

**#3（P1）戰鬥目標可偽造與重複** —— `handleUseCombatSkill` 直接信任 UI 的 `targetCombatantIds`：攻擊技能可打我方隊友（80→50）、同一目標傳兩次傷兩次（100→40，應 70）。改：`legalTargetsFor` 先**去重 + 存活 + 依 actionKind 篩側別**（attack 只打敵、support 只作用己方），效果與反擊只套合法集合；attack/support 指定目標卻全數不合法則整個行動 no-op。**誠實未竟**：資料化 `targetResolverId`（範圍/形狀/人數）、`activationHand`/`weaponRequirementIds` 仍未驗（後者需 fixture 於武器組實裝武器 + 武器→需求資料）。

**#4（P1）configureWeaponSet 產生非法/自相矛盾裝態** —— 只驗存在/擁有/kind，沒驗手部位置、不同步 `ItemInstance.location`、一件武器可同時被多組引用。改：主手須武器、副手須盾（或與主手同件的雙手武器）；原子同步 location（裝上→equipped、頂掉→回背包）；裝上時清掉其他武器組對同一件的引用（single-location）。

**#5（P2）Workflow Manifest 與架構契約相反** —— 開了第二張 `workflowEventSubscriptionsByType`（模組 vs Workflow 對同一事件的順序失去單一真相）、本地重宣告不相容的 `WorkflowId`、無 `WorkflowDefinition`、Registry 只查 ID 在 Set、邏輯寫在 router。改：模組與 Workflow **共用**唯一有序 `EVENT_SUBSCRIPTIONS_BY_TYPE`（`subscriber: ModuleId | WorkflowId`，順序單一由陣列位置決定）；用 core 的 `WorkflowId`（`workflow:travel-event`）；`WorkflowDefinition` 帶 `startsFrom` 且 `validateManifest` 驗證其有對應訂閱；router 以 dispatch 表歸屬區分模組/Workflow（Workflow 無 mutation）；反應邏輯移到 `app/workflows/player-travel-event.ts`；registry 模組交叉驗證跳過 Workflow 訂閱者。travel-integration（引擎自驅端到端）仍過。

**#6（P2）武器組 Runtime ID 繞過核心產生器** —— `getOrCreateLoadout` 以 `${characterId}:ws${i}` 偽造 ID，不經核心產生器、不推進 `nextRuntimeSequence`。改：`InventoryDeps.nextWeaponSetId()`（id-port 接 `next<WeaponSetId>('weapon-set')`）配發；fixture 預建 Loadout 以固定 ID 讓測試沿用 `${char}:ws{i}` 引用（fixture 可釘 ID，生產不可）。**誠實未竟**：仍是**惰性**建立；正式應在**角色誕生**時就鑄好 Loadout（讓 UI/命令能先查 ID 再引用），該 eager 流程與未建的角色生命週期/bootstrap 綁在一起。

`tsc` 乾淨、verify 全過（+ 新增 job 重放、招募接受、攻擊側別/去重、手部/location/跨組、startsFrom、weapon-set ID 出處 等測）。

---

## 2026-08-13 — #6 模組正確性收尾（c2 戰鬥技能合法性）+ b RNG 串接

延續 backlog #6 與複審 #4。**c1/c3**（地牢互動查房、裝備副手/多格防具）上一輪已 commit;本輪做 **c2 + b**。

**c2 — 戰鬥技能合法性（`handleUseCombatSkill`）**。原本任何技能照施:資源成本以 `Math.max(0, …)` 夾零,法力/生命不足也**全效**施放(下溢);且不查玩家角色是否**學會**、是否**配置在生效武器組**。改:玩家角色 → `progression.knows()` 且技能 ∈ 生效武器組 `selectedSkillIds`,否則 no-op;再算總成本、不足即 no-op,足夠才**精確扣**(不夾零)。怪物用自身招式,不受武器組限制。維持 combat 現行 `ModuleResult`「拒絕即 no-op」風格(不改 outcome 契約)。**目標側別合法性**(打友方/治敵方)需資料化 targeting resolver,留 TODO。測:法力不足→mana 不動+無 `CombatActionResolved`;未配置 `SKILL_BITE`→無傷、無事件。

**b — RNG 串接(threading，§7.1 的 threading 缺陷)**。`TeamResolverPort` 的擲骰型方法只回 `boolean`,丟掉 `nextCursor`;離隊結算迴圈對每名成員重用同一 `ctx.rngContext`（cursor 恆 0）→ 同機率下**全體同結果**（要嘛全走、要嘛全留）。改:兩個擲骰方法回 `RngStep<boolean>`(對齊 `gathering` 既有樣板與 Session `session.ts:246` 的「多次抽取須顯式串接 nextRngCursor」註記);離隊迴圈**逐名串接** cursor(被 `continue` 略過者不抽、不進),招募單次抽取讀 `.value`。stub/測試共用 `rngStepBool()`（nextCursor = cursor+1，把品牌型別轉換集中一處）。測:兩名合格成員實見游標 `[0,1]`（非 `[0,0]`）—— 直接證串接、有牙(移除串接則 `seen[1]` 仍為 0 而失敗)。

**未竟(誠實記帳)**:§7.1 仍缺 ① 同交易跨 tag 的 cursor 串接/sub-stream;② Event Subscriber 子 stream;③ 招募擲敗現以 `reject` 表達,應改「接受＋結果欄位」(合法指令、這次沒中 ≠ 非法)——屬 outcome 建模重構,牽動契約與 `transaction.test`,不在本輪 threading 範圍。

`tsc` 乾淨、verify 全過（kernel + 7 模組 + composition + engine session + travel workflow）。

---

## 2026-08-12 — 複審回合 3 + 旅行「做到底」：Workflow 訂閱機制,旅行端到端接通

複審回合 3 抓到我上一輪引入/未竟的 3 個 P1:①`runDueJob` 在交易**前** dequeue,拒絕的 Job 仍被消耗(破壞回滾)——改成**只在提交時消耗**,失效 Job 由 Handler 接受並 no-op(dungeon `npcDungeonDay` 從拒絕改 no-op);③戰鬥授權只驗 Encounter 屬玩家隊,沒驗 `actorId`/`allyId` 是玩家方——補 `side==='player'`;②旅行改「停下等 Workflow」方向對,但 composition **沒有** Workflow 驅動者,真實 Session 停在段落邊界,而單元測試手動扮演 Workflow **把斷線藏起來**。

②我先誠實攤開(manifest/HANDOFF 註),然後**做到底**:建 composition 的 **Workflow 訂閱機制**——
- kernel:`EventSubscriber.mutation` 改選填(Workflow 只送命令、不擁有 Slice);
- manifest:`WORKFLOW_EVENT_SUBSCRIPTIONS_BY_TYPE` + `REGISTERED_WORKFLOW_IDS`,與模組訂閱分開驗;
- router:`WORKFLOW_SUBSCRIBERS` 分派;
- 旅行事件 Workflow:`TravelSegmentReached` → 讀隊伍 active plan → 送 `CompletePlayerTravelSegmentWithoutEvent`(第一版恆「無事件」;內容 event weights 後命中事件改送 `OpenPlayerTravelInteraction`)。

`travel-integration.test` **以引擎自驅**證端到端:一支旅行中的隊伍只靠反覆 `runDueJob` —— dueCityTravel 發段落事件 → Workflow 送 CompleteSegment → team 推進 —— 恰 3 個 due-job 交易後抵達 CITY_B,**零手動 CompleteSegment**。這是旅行從「停住」到「真的通」。

**教訓再一次**:綠燈的單元測試可能**在扮演本該由系統做的角色**——把整合斷線藏起來。端到端要讓**引擎自己驅動**,測試只擺輸入、驗輸出,不代跑中間步驟。

---

## 2026-08-12 — 複審回合 2：開機切片的 5 個 P1（含「可玩」是過度宣稱的更正）

上一則把 bring-up 切片說成「基本可以玩的架構」是**過度宣稱**——它是引擎迴圈的煙霧測試,不是可玩性。複審點出 6 個問題,前 5 個 P1 全修（commits `4746412`、`50f6668`、`e2617af`）:

1. **到期 Job 沒被消耗**（我引入）——`runDueJob` 執行後 Job 仍留在 `jobsById`（applyScheduling 只刪 cancelled），快轉會不斷取得同一到期工作。修:Scheduler 在 Job 交易**之前** dequeue 它（一次性;接受或拒絕都已消耗）。測試改成**真的執行** Job 並驗證它消失 + Plan 完成。
2. **bootstrap 過度宣稱**（我命名膨脹）——只建 character/team/formation 卻自稱「合法初始 GameState / NewGameBootstrapper」。改名 `createNewGame` → `createBringUpFixture`,補隊長成長檔 + 輸入驗證,並在檔首誠實列出正式 §1.1 Gate 還缺什麼（多卡在內容）。
3. **RNG 每交易從 cursor 0**（我引入）——`rngContextFor()` 恆回 cursor 0、stream 不含調用身分,同一判定跨交易恆得相同結果。修:stream 由「訊息 ID（commandId/jobId）+ tag」派生（§7.1）。
4. **玩家命令沒查 actorTeamId 權限**（一直缺）——router dispatch 忽略 actorTeamId,玩家可在 payload 填別隊角色/Encounter 操作不屬於自己的資料。修:dispatch 前授權(全域 actorTeamId===playerTeamId;teamId/characterId/encounterId 目標須屬 actorTeam)。此檢查還抓出 transaction.test 一個潛在的 session-team 不匹配。
5. **玩家旅行跳過旅行事件 Workflow**（Wave B team bug）——`dueCityTravel` 在發 TravelSegmentReached 的同交易就推進下一段、第三段直接抵達,旅行事件/護衛刺殺/Pending 選擇全攔不住。修:拆成「dueCityTravel 只抵達本段並停下」+ 新 `handleCompletePlayerTravelSegmentWithoutEvent`（原 PENDING,現接上 router）推進;team.test 的旅行模擬扮演「無事件」Workflow 逐段送命令,仍得 3 段 + 1 完成。

**仍在 backlog（#6，非本輪）**:裝備副手寫進主手/多格防具殘 slot、戰鬥可用未學技能+資源下溢+目標未驗、地牢互動未查內容是否在目前房間、11 Game/16 Internal/2 Job 未實作、契約重複 9 筆。

**教訓**:綠燈 ≠ 正確。golden replay 抓非決定性,但抓不到「授權」「Workflow 攔截」這種**缺席的規則**——那要靠複審逐條讀。命名也要誠實:`createBringUpFixture` 不叫 `createNewGame`。

---

## 2026-08-12 — 開機骨架：NewGameBootstrapper + 第一個可跑切片（golden 重播）

驗收目標「基本可以玩的架構」的**最小端到端證明**。commit `f9c433d`。

`bootstrap.ts` 的 `createNewGame(input)` 組出合法初始 GameState:玩家隊（control=player、在起始城、站位涵蓋隊長）+ 隊長 Character,用**交易外的 bootstrap cursor**（§7.2）鑄隊伍/隊長 ID,終值寫入 `core.nextRuntimeSequence`。內容輕:隊長的內容相依欄位（archetype/sex/birthDay）以 bring-up 參數帶入,不讀 content。起始日給正值（8000）讓隊長（birthDay 0）開局成年、且世界日曆非負。

`bootstrap.test.ts` 把切片整條跑過真引擎 Session:一筆玩家 `rest`（cityFacilityAction）—— **刻意挑它**,因為它只用 `worldDay + team id allocator`、鑄一個 TeamPlanId、排一個 teamPlanDue Job、**零跨模組外送**,故能完整走過 bootstrap→命令→§7.2 ID 配發→排程→提交,又不依賴任何未實作模組或內容。驗:合法 bootstrap（隊在城、隊長就位、序號=2）、bootstrap 決定性、rest 的 plan+job 效果、**golden 重播**（同 seed+命令 → 逐位元相同提交 State）。

**意義**:引擎迴圈第一次「開機就跑」。在此之前所有測試都從 fixture/手建 state 起手;現在有了從**零**組出合法 state、驅動命令、決定性重播的完整鏈。往後換上真內容/真模組時,這條鏈是回歸基準（golden replay 抓非決定性）。

---

## 2026-08-12 — 契約接線硬化（複審回合）：combat-sequence 交易模型 + 10 個 discriminant 碰撞

一輪複審點出三個「只有在組裝尚未實作的模組時才會爆」的接線缺陷。全部修正,`tsc` 乾淨、verify 全過。commit `7581c11`。

1. **Combat Sequence 同步 Host Port 違反交易模型** —— `dungeon` 的 `CombatSequenceHostPort.resolveNext()` **同步回傳** `CombatSequenceChallengeResult`,繞過 Transaction Runner／Slice 所有權／回滾。它只宣告、從未被呼叫（system.ts 只有 TODO）。combat-sequence 契約**本就有**非同步流程,故移除介面,改由 dungeon 發 6 個 Internal Command（加進 `DungeonOutboundInternalCommand`）+ 訂閱 `CombatSequenceChallengeResolved`／`CombatSequenceSettled`。從 dungeon `reads` 拿掉 `combat-sequence-host-port`（它本來就不是「讀」）。

2. **10 個跨契約 `type:` discriminant 碰撞**（同 discriminant、不同 payload → 組聯集時錯誤縮窄）。逐一收斂到單一擁有者（import 擁有者型別,不各自宣告）:
   - distribution→economy（CreateEconomyAccount/Grant/Transfer Currency）、distribution→inventory（TransferItem/RemoveItemInstance）：distribution 的 §5.3 outbound 本來就標注「placeholder」,改引用接收者真實型別。
   - `ReleaseExpiredQuestCargo`：三份架構文件都載明 **inventory** 是 handler → 移除 distribution 誤宣告的 inbound 版本。
   - combat↔combat-sequence 的三個 `*MasteryEarnedPayload`：兩者都發此事件,combat-sequence 擁有 → combat 與 progression 都改從擁有者 import。
   - `PlayerInteractionOpened`（team/distribution/dungeon 三發）：收成 team 的單一 `kind` 聯集（travelEvent|succession|lootAuction|dungeonEvent）;dungeon 的 `interactionKind` 改 `kind`。
   - 名字重複基準線 16 → 9。

3. **ratchet 補強**：原 `check-contract-duplicates.ts` 只抓**型別名稱**重複,抓不到「不同名、同 discriminant」。新增 discriminant 宣告碰撞檢查——關鍵是**只算宣告**（`type: 'X';`）、**不算 union 引用**（`({ type: 'X' } & Foo)`,那是 B.5「引用擁有者」的正確樣式）。基準線空（10 個全收斂）。

**教訓延續**（[[fanout-execution-lessons]]）：per-module 綠燈證明不了跨模組線。這 10 個碰撞全是「各自宣告、tsc 因 unknown 傳遞看不到」的影子契約,跟 B.5 同一類病根;ratchet 現在連 discriminant 層都守住。**架構文件是實作依據**,故 §2.3 一併改寫（同步 Port → 命令出/事件回的表格）。

---

## 2026-08-11 — Wave C：root 路由 → 引擎 Session → 內容 adapter 兩半

一輪 12 個 commit（`ff22578`→`c9da57e`）。目標：把 Wave C composition 從「骨架」推到「引擎迴圈真的會跑，且內容有落地點」。全程 `tsc` 乾淨、`verify-modules` 全過（測試組從 11 → 15）。

### 做了什麼

1. **Root 路由**（`c2c24e6`）——`router.ts` 原本只接 Internal Command 與 Event。補上兩個交易 root：
   - `routeGameCommand(envelope)`：依 `GAME_COMMAND_ENTRY` 分派。**關鍵**：dungeon 玩家 handler 需要 teamId,但 Game Command payload 不帶——teamId 取自 `GameCommandEnvelope.actorTeamId`（§5.1）。Workflow 入口（gatherDungeonNode）與 Wave B 未實作者一律明確報錯,缺口清單化（`PENDING_GAME_COMMANDS`）。
   - `routeJob(job)`：依 `job.type` 分派;`npcDungeonDay` 的 runId 取自 `job.targetId`。`PENDING_JOBS` 列 Manifest 註冊但未實作者（team `freeActionDue`/`nonPlayerMemberCityFreeDayTick`）。
   - 三種形狀差異（參數順序、`ModuleResult` vs `ModuleOutcome`、slice 歸屬）收斂方式與既有 Internal Command 表一致。

2. **Context 工廠 refactor**（`b5707d3`）——**發現**：每個 `createXxxQuery` 都吃 **state 快照**(非 live accessor;inventory 甚至預先 `const items = state.items`)。若 context 固定,後段 handler 會讀到交易開始時的過期 slice,違反 §3.1 rule 3。故 `createTransactionConfig`/`routeGameCommand`/`routeJob` 改吃 `ModuleContextFactory = (state)=>ModuleContexts`,每次 dispatch 以當前 workingState 重建。需跨呼叫延續的 cursor/RNG 由工廠閉包（Session 提供）保存,不放進被重建的 context。

3. **引擎 Session**（`5380116`）——**發現**：kernel `runTransaction` 只做路由/因果/原子性,**不管 §7.2 runtime-id cursor**,也不寫回 `core.nextRuntimeSequence`（transaction.test 的 applyScheduling 用本地計數器 stub）。`session.ts` 補這層：seed cursor 自 `core.nextRuntimeSequence` → 鑄 envelope（command→transaction→correlation）+ handler entity ID + 排程 job ID（全走同一 cursor）→ 接受則寫回、拒絕則丟棄。內容相依部分由注入的 `ContextAssembler` 供給,故 Session **與內容無關**。
   - **跨模組級聯冒煙測試**：玩家 `openDungeonDoor` → dungeon handler 送 `OpenMapDoor` → **真 map handler 開真 map slice**,一筆原子交易。挑這條是因 `handleOpenMapDoor` 對 ctx 是 `void ctx`,不依賴未實作模組。驗了門開、cursor 落點 3、逐位元決定性重播、拒絕全回滾。這是各模組自己的綠燈證明不了的「跨模組線」。

4. **內容 Reader adapter**（`27908ec` dungeon 樣板 + 端到端;`9af7f66` 其餘 6 模組）——`data-runtime` 的 `createDefinitionReader` **在此之前零消費者**。補 registry→窄化 reader→領域 reader 的 adapter：`reader-adapter.ts`（通用 `domainDefinitionView`：registry header 權威、領域欄位取自 `data`）+ 每模組一個 `createXxxDefinitionReader`。特殊 getter：map `getGatheringMapView`（投影）、progression `listSocialMasteryBenefits`（`.list()`）、combat `getSkillView`（客製 mapView,`skillId`←`def.id`、無 header）。各模組 `XXX_DEFINITION_KINDS` 是內容作者標 `kind` 的唯一參照。

5. **內容 Resolver adapter**（`9e13bdf`）——resolver **不像 reader 機械統一**（每個 `resolve(input,ctx)` 領域化,有的 resolverId 在 input 內、有的要綁定）,故建**可重用核心 + 樣板**：`resolver-adapter.ts`（`runResolver` + `resolverContext`）+ `resolvers.ts` 兩個資料調校樣板（`logisticRollResolver`→boolean 含 RNG、`weightedProductResolver`→number）。**巧接**：resolver 的 params 從定義讀,直接重用 reader adapter（params 定義的 `data` 就是 `LogisticCurveParams`）。證明時以 `bias=±1000` 讓機率 float 下溢夾成 1/0,得保證的決定性布林。

### 本輪最重要的判斷

**「注入真實 ports」如字面所述是卡住的,而且不是我製造的缺口。** 兩支測繪代理證實：無任何 content-pack JSON、無任何 `ResolverRegistration`、各 `XxxDefinitionReader` 是手寫介面待接 adapter,且 world / derived-statistics 模組未實作（`WorldQuery`/`TeamWorldReader`/carry-capacity 無來源）。

因此把工作**正交拆兩軌**：
- **引擎軌（內容無關,本輪做完）**：路由 + §7.2 id/cursor + rng + 跨模組級聯。全真、有測試。
- **內容軌（本輪鋪好插座）**：reader/resolver adapter 是「插座」,內容 JSON 是「插頭」。插座能獨立先做、獨立用小的記憶體 pack 單元測（dungeon 還端到端證）；插頭是發包軌。

Session 的 `ContextAssembler` 是兩軌的接縫：換上真 Yunhua content pack 時只換 Assembler,不動 Session。

### 仍待做（交棒點）

- **內容 JSON**：依各模組 `XXX_DEFINITION_KINDS` 與 params kind,把 `docs/03_content/yunhua/` 轉成引擎 content pack JSON。**發包軌,依 domain 切。**
- **具體 resolver + 各模組 `ResolverPort` bridge**：逐 resolver 的公式/領域工作（非機械填）。combat `resolvePower` 因 resolverId 在 input 內,是最乾淨的 bridge 樣板。
- **真實跨模組 query port**：Session `ContextAssembler` 裡仍用 fixture 的 `DungeonMapPort`/combat formation 快照等;要換成讀真 slice（部分需 map 曝更多、或 world/derived-stats 模組）。
- **NewGameBootstrapper + 全 vertical slice + golden 重播**：骨幹已就緒,卡在上面三項。
- **引擎 Session 刻意未涵蓋**（已記於 `session.ts`）：Draft→信封 ID 物化（Outbox/存檔用,與 State 正確性無關）；§7.1 `invocationRngContext` 完整推導（現為簡化版）。
