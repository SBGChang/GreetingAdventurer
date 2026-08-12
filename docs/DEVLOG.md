# 開發者日誌（Developer Log）

實作時序 + 決策脈絡的執行日誌。**最新在上**。與其他文件的分工：

- `HANDOFF.md`（repo 根）＝**現況快照**（此刻什麼做完了、什麼待做、怎麼驗證）。
- `docs/review/`＝**設計複審決策**（設計層裁決紀錄）。
- 本檔＝**做了什麼、為什麼這樣做、途中發現了什麼**的時間軸敘事。commit message 記「這個 commit 改了什麼」；本檔記「這一段路的判斷與轉折」。

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
