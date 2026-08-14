# 開發者日誌（Developer Log）

實作時序 + 決策脈絡的執行日誌。**最新在上**。與其他文件的分工：

- `HANDOFF.md`（repo 根）＝**現況快照**（此刻什麼做完了、什麼待做、怎麼驗證）。
- `docs/review/`＝**設計複審決策**（設計層裁決紀錄）。
- 本檔＝**做了什麼、為什麼這樣做、途中發現了什麼**的時間軸敘事。commit message 記「這個 commit 改了什麼」；本檔記「這一段路的判斷與轉折」。

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
