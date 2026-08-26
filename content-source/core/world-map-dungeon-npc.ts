// content-source/core/world-map-dungeon-npc.ts
// 世界／地圖／地城／NPC 行為的**文化無關規則**。四國共用同一份；任何一國專屬的節點、地圖、
// 怪物、事件與名字都不在這裡（那些屬 `pack:<culture>`）。
//
// ── 這一檔為什麼只有 8 個 kind，而不是被指派的 13 個 ─────────────────────────
//
// 被指派但**刻意未撰寫**的五個 kind，理由逐一寫在檔尾的「未撰寫的 kind」區塊，並列進交接回報。
// 摘要：`gathering-rule` 的擁有者是 gathering 服務（別人寫）；`conflict-rule`／`world-fact`／
// `map-spawn-rule`／`map-gathering-rule` 各自有具體的契約缺口或文化歸屬，寫下去只會產生
// 「載入成功但永遠讀不到」或「戰爭發生卻沒有任何後果」這類偽裝成完成的內容。
//
// ── 來源標記慣例 ────────────────────────────────────────────────────────────
//
// 每個數值後面標明出處。設計文件沒有明文的一律標成【第一版方案（待討論）】並附設計理由——
// 那不是「隨便填」，而是「這個值現在由內容決定、可以被討論與調整，而且不在程式裡」。

import type {
  ConditionDefinitionId,
  ActionChainTemplateId,
  AdventurerDecisionPolicyId,
  InteractionRuleId,
  NpcDungeonTargetResolverId,
  NpcExplorationRuleId,
  NpcMarketPolicyId,
  NpcSequenceRuleId,
  NpcTravelRuleId,
  ResolverId,
} from '../../src/contracts/core';
import type { PassagePolicyDefinition, PassagePolicyId } from '../../src/contracts/world';
import type { NpcSequenceGroupKey, NpcSequenceRuleDefinition } from '../../src/contracts/map';
import type {
  DungeonInteractionRuleDefinition,
  NpcDungeonTargetKind,
  NpcDungeonTargetResolverDefinition,
  NpcExplorationRuleDefinition,
  NpcStopPolicyId,
  OutcomeRuleId,
} from '../../src/contracts/dungeon';
import type {
  ActionChainTemplateDefinition,
  AdventurerDecisionPolicyDefinition,
  NpcIntentCandidateRule,
  NpcMarketPolicyDefinition,
  NpcMemberFreeActionCandidateRule,
  NpcMemberFreeActionKind,
  NpcPurchaseNeedRule,
} from '../../src/contracts/npc-behavior';
import type { FreeActionRuleId } from '../../src/contracts/team';
import { cultureIds, type Authored, type AuthoredDomain } from '../authoring';

const core = cultureIds('core');

// ── Resolver ID ─────────────────────────────────────────────────────────────
//
// `ResolverId` 是 `Brand<string, 'resolver'>`——**不是** `DefinitionId`，所以它不走
// `cultureIds().id()` 的三段內容 ID 規約（那是給 Definition 用的）。Resolver 是**程式身分**：
// 一份 pack 引用的 Resolver 必須已經註冊，否則 Bootstrap 就該失敗（§11）。因此格式沿用 repo 既有
// 的 `resolver:<module>.<local>`，並集中在這一個工具產生，避免逐處手打字串打錯一個字。
//
// 這裡出現的每一個 ID 都必須列進 `packs.ts` 的 `requiredResolverIds`，並在回報的「需要註冊的
// resolverId」逐筆列出——漏了會讓「引用未註冊 Resolver」的 pack 一路載入成功，直到玩家觸發它。
function resolverId(local: string): ResolverId {
  return `resolver:${local}` as ResolverId;
}

// ════════════════════════════════════════════════════════════════════════════
// world：通行政策
// ════════════════════════════════════════════════════════════════════════════
//
// 來源：`docs/00_core/game_design_document.md`「國度設定」——「國度間有通行證制度」；
// `07_world_module.md` §7.2 的通行流程「WorldQuery 取得 Route 與 Passage Policy →
// InventoryQuery 提供通行證實體 → Passage Resolver 判定」。
//
// 為什麼政策放 core 而不是文化 pack：`PassagePolicyDefinition` 的唯一欄位是
// `requirementResolverId`——它表達的是「這條邊界**用哪一種判定形狀**」，而形狀只有兩種：
// 不需要條件（國內路線）與需要有效通行證（國境）。四國共用這兩種說法；各國的 Nation／Route 只是
// 指向其中一個。哪一國對誰封鎖、需要哪一張通行證，都不在這張表上（見下方契約缺口）。
const passagePolicies: readonly Authored<PassagePolicyDefinition>[] = [
  {
    kind: 'passage-policy',
    id: core.id<PassagePolicyId>('passage-policy', 'domestic-open'),
    // 【第一版方案（待討論）】**這一筆沒有文件出處**，是設計判斷。設計文件只寫了通行證制度
    // （＝下面那一筆），從沒說過要有一條「明確不需要條件」的政策。
    //
    // 提出它的理由：`RouteDefinition.passagePolicyId` 是**選填**的
    // （`contracts/world/index.ts:121`），而現存測試明訂「沒有政策就是沒有」
    // （`modules/world/world.test.ts:909`）——也就是留空目前是合法狀態，判定端要自己決定
    // 「沒有政策等於可以走」。有了這一筆，國內 Route 可以指向它，把那個決定寫回內容。
    //
    // 待裁決：若整合者認為「留空＝可通行」就是既定語意，那這一筆是多餘的，應刪除；
    // 兩種說法同時存在會讓「國內路線」有兩種合法表達方式。
    requirementResolverId: resolverId('world.passage.no-requirement'),
  },
  {
    kind: 'passage-policy',
    id: core.id<PassagePolicyId>('passage-policy', 'national-border'),
    // 國境：需要一張對目的國有效的通行證。GDD「戰爭機制」明列「通行證可能失效（突然無法進入
    // 某個國度）」，所以判定必須是每次重算的 Resolver，不是一次寫死的布林。
    requirementResolverId: resolverId('world.passage.passport-required'),
  },
];

// ════════════════════════════════════════════════════════════════════════════
// map：NPC 探索序列規則
// ════════════════════════════════════════════════════════════════════════════
//
// 來源：`01_map_module.md` §2.2「NPC 序列規則必須由資料指定，不能由地圖檔案名稱或程式特例推論」
// ＋ §3.3 不變量 4「可 NPC 處理的動態內容與採集點共用一條序列」。
//
// 為什麼放 core：`groupPriority` 說的是「NPC 先處理哪一類目標」。那是 NPC 行為的結構性偏好，
// 四國的 NPC 用同一套；每張圖不同的是**有哪些內容、幾個**（`map-spawn-rule.spawnBudgets`，
// 屬文化 pack），不是「先開寶箱還是先打 Boss」。
//
// 【第一版方案（待討論）】權重值本身文件沒有明文。設計理由：`03_dungeon_module.md` §2.2 明訂
// 「**任一內容嘗試失敗就結束本次地牢探索**」，所以 NPC 每天能處理幾個目標，取決於它把失敗風險
// 最低的目標排在前面。因此本表依「失敗風險遞增」排序：
//   風險 0（拿了就走，不擲成敗）：寶箱、採集點
//   風險中（事件結果由 Effect 決定，可能失敗）：地圖事件
//   風險高（要打）：一般怪群 → 綁架／控制的守衛 → Boss
// 權重以 10 為間距，留出插入空間；同權重的先後由建構順序決定（doc §2.2 明訂穩定排序）。
//
// `Record<NpcSequenceGroupKey, number>` 是**非 Partial**：新增一種 `MapContentKind` 而這裡沒給
// 權重，本檔會直接編譯失敗（13_data_runtime.md §6.0 規矩五）。不要改成 Partial 或補預設值。
const NPC_SEQUENCE_GROUP_PRIORITY: Readonly<Record<NpcSequenceGroupKey, number>> = {
  chest: 10,
  gatheringNode: 20,
  mapEvent: 30,
  monsterGroup: 40,
  kidnap: 50,
  control: 60,
  boss: 70,
};

export const NPC_SEQUENCE_RULE_ID = core.id<NpcSequenceRuleId>('npc-sequence-rule', 'shared');

const npcSequenceRule: Authored<NpcSequenceRuleDefinition> = {
  kind: 'npc-sequence-rule',
  id: NPC_SEQUENCE_RULE_ID,
  groupPriority: NPC_SEQUENCE_GROUP_PRIORITY,
};

// ════════════════════════════════════════════════════════════════════════════
// dungeon：互動時間規則
// ════════════════════════════════════════════════════════════════════════════
//
// 三個時間量全部有明文來源，一筆都不是我編的：
//   * `traversalMinutesPerCell` = 30
//       GDD「一天的結構」：「地城以迷宮分鐘處理：每經過 1 個實際小格消耗 30 分鐘」
//       ＋ `docs/02_systems/time_and_mastery_progression.md`「迷宮分鐘」同句。
//   * `redDoorOpenMinutes` = 30
//       `time_and_mastery_progression.md`「紅門」：「玩家可花 30 分鐘開啟紅門」。
//   * `minutesPerDungeonDay` = 1440
//       `time_and_mastery_progression.md`「迷宮分鐘」：「生命週期試算暫以 1,440 分鐘等於 1 日」。
//       注意文件用字是「暫以」——它是**日曆換算**而非玩法平衡量，但既然契約已把它放進 Definition，
//       就由資料提供，不回頭寫成程式常數。
//
// 為什麼放 core：迷宮時間是遊戲的時間制度，四國共用。換文化不會讓一格變成 20 分鐘。
const dungeonInteractionRule: Authored<DungeonInteractionRuleDefinition> = {
  kind: 'dungeon-interaction-rule',
  // ID 前綴刻意用 kind 字串 `dungeon-interaction-rule`，不是 brand tag `interaction-rule`
  // （`InteractionRuleId = DefinitionId<'interaction-rule'>`）。兩者不一致是既有的契約瑕疵，
  // 已列進回報；ID 字面值跟著 kind 走，讀 JSON 的人才找得到它屬於哪個家族。
  id: core.id<InteractionRuleId>('dungeon-interaction-rule', 'standard'),
  traversalMinutesPerCell: 30,
  redDoorOpenMinutes: 30,
  minutesPerDungeonDay: 1440,
  // 固定陷阱的處理結果（觸發／解除）由這個 Resolver 決定，Handler 不含機率
  // （`modules/dungeon/system.ts` 的 `DungeonResolverPort.resolveTrap`）。**尚未註冊**。
  trapResolverId: resolverId('dungeon.trap.standard'),
};

// ── dungeon：NPC 探索規則 ───────────────────────────────────────────────────
//
// `dailyPointBudget` = 10：`03_dungeon_module.md` §2.2 明文「第一版基礎資料為 10」，
// 該節還附了一段 JSON 範例 `{"id": "base.npc-dungeon-exploration", "dailyPointBudget": 10}`。
//
// `stopPolicyId` 指向的 `npc-stop-policy` 家族**目前沒有 Definition 型別、也沒有登記擁有模組**
// （見檔尾契約缺口 2）。欄位是必填的，所以這裡填了一個依規約成形的 ID：ID 對得上、內容還不存在。
// 這是刻意讓缺口在載入時大聲失敗（Content Pack 驗證失敗＝合法出口 2），而不是省略欄位或
// 讓整條 NPC 地牢探索規則消失。
const npcExplorationRule: Authored<NpcExplorationRuleDefinition> = {
  kind: 'npc-exploration-rule',
  id: core.id<NpcExplorationRuleId>('npc-exploration-rule', 'standard'),
  dailyPointBudget: 10,
  // 「首次失敗即結束本次地牢探索」是 doc §2.2 的硬規則（「不得由資料改成失敗後繼續」），
  // 所以停止政策的 local 名就叫 first-failure。
  stopPolicyId: core.id<NpcStopPolicyId>('npc-stop-policy', 'first-failure'),
};

export const NPC_STOP_POLICY_ID = npcExplorationRule.stopPolicyId;

// ── dungeon：NPC 目標 Resolver ──────────────────────────────────────────────
//
// 來源：`03_dungeon_module.md` §2.2 的 `NpcDungeonTargetResolverDefinition`
// ＋ `01_map_module.md` §7.3 步驟 2「目標類型是否仍可被該 Resolver 處理」。
//
// 一筆定義 = 一個「NPC 面對這一類目標時怎麼結算」的策略。切分依據是**結算通道**，不是
// contentKind 的個數：
//   * 怪群與 Boss 走 Combat Sequence（`modules/dungeon/system.ts`：「非怪物內容：成敗由資料規則
//     決定（outcomeRuleId）」，反面就是怪物內容不走 outcomeRuleId）。兩者同一通道 → 一筆。
//   * 綁架與控制在守衛清空後才是可處理目標，結算方式相同 → 一筆。
//   * 寶箱、地圖事件、採集點各自一筆。
// 這個切分是文化無關的：換一份文化 pack 換的是「這張圖有哪些內容」，不是「寶箱怎麼結算」。
//
// `successBehavior` 全部是 `'continue'`：doc §2.2 只把**失敗**定為終止條件；成功後繼續往下一個
// `npcOrder` 是同節「依有序內容序列骰完所有可處理內容」的前提
// （`18_npc_behavior_module.md` §2.2 也是同一句）。`'leave'` 留給未來「打完就撤」的內容設計。
//
// `outcomeRuleId` 指向的 `outcome-rule` 家族**目前沒有 Definition 型別、也沒有登記擁有模組**
// （見檔尾契約缺口 3）。與 stopPolicyId 同樣處理：填成形的 ID，讓缺口在載入時失敗。
//
// 【第一版方案（待討論）】**「切成五筆」本身沒有文件出處**：設計文件只給了
// `NpcDungeonTargetResolverDefinition` 的形狀，沒有規定要有幾條、怎麼分。下面的切分依據是
// 程式裡的結算通道（`modules/dungeon/system.ts:1407` 註解「非怪物內容：成敗由資料規則決定
// （outcomeRuleId）」＝怪物內容不走 outcomeRuleId），不是文件明文。若整合者要合併或再細分，
// 只要文化 pack 的 `map-content.npcPolicy.resolverId` 跟著改，就是純內容變更。

// 目標 Resolver 的 local 名。用聯集而不是 `string`，是為了讓下面的 ID 匯出表在**兩個方向**
// 都被編譯器檢查：新增一個 local 卻沒進匯出表 → 匯出表少 key，編譯失敗；文化 pack 拼錯
// key → 取值處編譯失敗（若鍵型別是 `string`，拼錯只會安靜地得到 undefined）。
type TargetResolverLocal =
  | 'combat-target'
  | 'chest'
  | 'map-event'
  | 'guarded-objective'
  | 'gathering-node';

type TargetResolverRow = Readonly<{
  local: TargetResolverLocal;
  // 為什麼 outcome rule 的 local 名與 resolver 分開列：兩者可以多對一（例如寶箱與採集點若日後
  // 想共用同一條產出規則），現在一對一只是第一版的選擇。
  outcomeLocal: string;
  targetKinds: readonly NpcDungeonTargetKind[];
}>;

const TARGET_RESOLVER_ROWS: readonly TargetResolverRow[] = [
  {
    local: 'combat-target',
    outcomeLocal: 'combat-target',
    targetKinds: [
      { kind: 'mapContent', contentKind: 'monsterGroup' },
      { kind: 'mapContent', contentKind: 'boss' },
    ],
  },
  {
    local: 'chest',
    outcomeLocal: 'chest',
    targetKinds: [{ kind: 'mapContent', contentKind: 'chest' }],
  },
  {
    local: 'map-event',
    outcomeLocal: 'map-event',
    targetKinds: [{ kind: 'mapContent', contentKind: 'mapEvent' }],
  },
  {
    local: 'guarded-objective',
    outcomeLocal: 'guarded-objective',
    targetKinds: [
      { kind: 'mapContent', contentKind: 'kidnap' },
      { kind: 'mapContent', contentKind: 'control' },
    ],
  },
  {
    local: 'gathering-node',
    outcomeLocal: 'gathering-node',
    targetKinds: [{ kind: 'gatheringNode' }],
  },
];

function targetResolverDefinitionId(local: TargetResolverLocal): NpcDungeonTargetResolverId {
  return core.id<NpcDungeonTargetResolverId>('npc-dungeon-target-resolver', local);
}

function targetResolver(row: TargetResolverRow): Authored<NpcDungeonTargetResolverDefinition> {
  return {
    kind: 'npc-dungeon-target-resolver',
    id: targetResolverDefinitionId(row.local),
    // `targetKinds` 是 readonly，契約欄位也是 readonly，直接引用不需要複製。
    supportedTargetKinds: row.targetKinds,
    outcomeRuleId: core.id<OutcomeRuleId>('outcome-rule', row.outcomeLocal),
    successBehavior: 'continue',
  };
}

// 供文化 pack 的 `map-content` 與 `gathering-rule` 填 `npcPolicy.resolverId` 時引用，
// 不必自己拼字串。
//
// 鍵型別是 `TargetResolverLocal` 而**不是** `string`：這張表存在的唯一理由就是「不要讓引用端
// 手打字串」，若鍵是 `string`，引用端打錯字仍然編譯通過、只是取到 undefined——那就等於這張表
// 不存在。非 Partial 的 Record 同時保證新增一個 local 一定得在這裡補一筆。
export const NPC_DUNGEON_TARGET_RESOLVER_IDS: Readonly<
  Record<TargetResolverLocal, NpcDungeonTargetResolverId>
> = {
  'combat-target': targetResolverDefinitionId('combat-target'),
  chest: targetResolverDefinitionId('chest'),
  'map-event': targetResolverDefinitionId('map-event'),
  'guarded-objective': targetResolverDefinitionId('guarded-objective'),
  'gathering-node': targetResolverDefinitionId('gathering-node'),
};

// ════════════════════════════════════════════════════════════════════════════
// npc-behavior：動作串模板
// ════════════════════════════════════════════════════════════════════════════
//
// 來源：`18_npc_behavior_module.md` §2.1 的 `ActionChainNodeTemplate` 聯集
// ＋ 同節「`travelToCity`、`executeNearbyAdventure` 與尚未接取成功的 `acceptNearbyQuest`
// 都各自是一節完成的 Chain」。所以三個模板各只有一個工作節點 + `complete`。
//
// 為什麼放 core：節點序列是 NPC 的行為骨架，四國共用（doc §6 不變量 5：「獨立冒險者與多人隊伍
// 使用同一份 Decision Policy」）。文化 pack 想改 NPC 偏好，改的是 Decision Policy 的候選與權重，
// 或提供自己的模板指向不同的 Resolver——這正是「換一份 pack 換一套 NPC 行為」的接縫。
//
// 刻意**沒有** `purpose: 'free'` 的模板：`cityFree` 的強制自由期由模組在非自由 Chain 完成時
// 直接建立（`modules/npc-behavior/system.ts` 的 `completeChain` 送 `StartNpcTeamPlan(cityFree)`），
// 不經由模板；而 doc §2 明訂 `fallbackChainTemplateId` 不得指向 `cityFree`，`purpose: 'free'`
// 也不對應任何 `NpcIntentKind`。因此一筆 free 模板會是**沒有任何讀取路徑的內容**。
export const TRAVEL_CHAIN_TEMPLATE_ID = core.id<ActionChainTemplateId>(
  'action-chain-template',
  'travel-to-selected-city',
);
export const LOCAL_ADVENTURE_CHAIN_TEMPLATE_ID = core.id<ActionChainTemplateId>(
  'action-chain-template',
  'enter-nearby-adventure-map',
);
export const ACCEPT_QUEST_CHAIN_TEMPLATE_ID = core.id<ActionChainTemplateId>(
  'action-chain-template',
  'accept-nearby-quest',
);

const chainTemplates: readonly Authored<ActionChainTemplateDefinition>[] = [
  {
    kind: 'action-chain-template',
    id: TRAVEL_CHAIN_TEMPLATE_ID,
    purpose: 'travel',
    nodes: [
      // 目的城市由 Resolver 決定（doc §2.1「NPC 節點只解析目的地與路線」）。候選集合由模組依
      // `WorldQuery.listCitiesWithinHops` 提供，挑哪一個是資料的事。**尚未註冊**。
      { kind: 'travelToCity', destinationResolverId: resolverId('npc-behavior.destination.nearby-city') },
      { kind: 'complete' },
    ],
  },
  {
    kind: 'action-chain-template',
    id: LOCAL_ADVENTURE_CHAIN_TEMPLATE_ID,
    purpose: 'localAdventure',
    nodes: [
      {
        kind: 'executeNearbyAdventure',
        // 依戰力可行性與資料權重從本城＋相鄰一格城市的冒險地中選一張圖（doc §2.2 末段）。
        mapResolverId: resolverId('npc-behavior.map.nearby-adventure-site'),
        stopPolicyId: NPC_STOP_POLICY_ID,
      },
      { kind: 'complete' },
    ],
  },
  {
    kind: 'action-chain-template',
    id: ACCEPT_QUEST_CHAIN_TEMPLATE_ID,
    purpose: 'quest',
    nodes: [
      {
        kind: 'acceptNearbyQuest',
        // doc §2.2 的四條候選條件（未接取、未被別隊標記、路線可達、
        // `CombatPowerQuery.assessQuestFeasibility` 可嘗試）由這個 Resolver 執行。**尚未註冊**。
        questSelectorId: resolverId('npc-behavior.quest.feasible-nearby-posting'),
      },
      { kind: 'complete' },
    ],
  },
];

// ── npc-behavior：市場政策 ──────────────────────────────────────────────────
//
// 來源：`18_npc_behavior_module.md` §2.3。三種採購目標（`equipment` / `combatConsumable` /
// `nonCombatConsumable`）是契約的封閉聯集，一筆都不能少——少一種就等於「NPC 永遠不買那類東西」，
// 而那是內容決定，不該由漏填表達。
//
// 為什麼放 core：買賣**規則的形狀**（先保留底金、再依需求挑報價、賣出多餘品）四國共用；
// 各國商店裡有什麼是 city／inventory 的文化內容。
const PURCHASE_NEED_ROWS: readonly NpcPurchaseNeedRule['target'][] = [
  'equipment',
  'combatConsumable',
  'nonCombatConsumable',
];

export const NPC_MARKET_POLICY_ID = core.id<NpcMarketPolicyId>('npc-market-policy', 'baseline');

const npcMarketPolicy: Authored<NpcMarketPolicyDefinition> = {
  kind: 'npc-market-policy',
  id: NPC_MARKET_POLICY_ID,
  // doc §2.3：「`budgetReserveRuleId` 必須在報價後保留最低現金」。**尚未註冊**。
  budgetReserveRuleId: resolverId('npc-behavior.market.budget-reserve'),
  purchaseNeedRules: PURCHASE_NEED_ROWS.map((target) => ({
    target,
    // 需求判定與報價挑選分成兩個 Resolver 是契約的形狀（不是我拆的）：前者答「要不要買」，
    // 後者答「買哪一筆 Offer」。逐目標各一組，才能讓裝備與補品用不同的判準。**尚未註冊**。
    needResolverId: resolverId(`npc-behavior.market.need.${target}`),
    offerSelectorId: resolverId(`npc-behavior.market.offer.${target}`),
  })),
  sellRules: [
    {
      // 只賣「自己背包裡多餘的」：doc §5.3 明訂不得賣隊友物、任務貨物、已保留物或不在自己
      // 背包中的物品——那些是硬條件，由模組與 Workflow 擋；這裡的 Resolver 只挑候選。
      itemSelectorId: resolverId('npc-behavior.market.sell.surplus-item'),
      sellWhenResolverId: resolverId('npc-behavior.market.sell.when-surplus'),
    },
  ],
  // doc §2.3：「可在資料規則滿足時購入房屋」。選填欄位，這裡明確給——不給等於「本版 NPC 不買房」，
  // 那也是合法的內容決定，但與文件描述不符。
  homePurchaseRuleId: resolverId('npc-behavior.market.home-purchase'),
  // 【第一版方案（待討論）】文件只說「一次自由活動循環至多執行 `maxTransactionsPerFreeCycle` 筆」，
  // 沒給數字，並明確排除玩家主角的每日 6 次計數（doc §2.3）。設計理由：一次自由循環讓 NPC 能
  // 完成「賣掉一件多餘品 + 買一件需要的」這個最小有意義組合，所以取 2。取 1 會讓 NPC 永遠只能
  // 二選一；取大值會讓城市商店庫存在單一自由期被一支隊伍掃空（doc 同節警告的「同一天無限買賣」）。
  maxTransactionsPerFreeCycle: 2,
};

// ── npc-behavior：冒險者決策政策 ────────────────────────────────────────────
//
// 這是本 domain 的驗收核心：**換一份 pack 必須產生不同的 NPC 行為**。可換的接縫全部在資料上——
//   * 有哪些候選意圖（`candidates` 的筆數與 `intentKind`）
//   * 每個意圖用哪一條動作串（`chainTemplateId` → 不同模板 → 不同 Resolver → 不同目的地／地圖）
//   * 每個意圖的門檻（`conditionId`）與權重公式（`weightResolverId`）
//   * 複審週期、強制自由期長度、旅行規則、市場政策
// 本模組的 Handler 沒有任何 intentKind 的 if-else（見 `modules/npc-behavior/system.ts` 檔頭）。
//
// 逐欄位來源：
//   * `candidates` 的三種 `intentKind` —— doc §2 的封閉聯集，且「候選池只包含三種非自由工作」。
//     三種全列：少列一種等於「這份 pack 的 NPC 永遠不做那件事」，那必須是明講的內容決定。
//   * `memberFreeActionCandidates` 的五種 —— doc §2.3「自由活動可抽取的個人行為為製作、鍛鍊、
//     買賣、向同隊成員求婚、休息」。`NpcMemberFreeActionKind` 聯集恰為這五種。
//   * `forcedFreeDurationDays: { min: 2, max: 7 }` —— doc §2「強制自由活動 2～7 日」、
//     §5.1 與不變量 10 同數。**不是**我設計的。
//   * `reviewIntervalDays` —— 見下方註解。
const INTENT_CANDIDATE_ROWS: readonly Readonly<{
  intentKind: NpcIntentCandidateRule['intentKind'];
  chainTemplateId: ActionChainTemplateId;
  // 條件與權重的 local 名分開列：條件答「現在做得到嗎」，權重答「多想做」。兩者對同一意圖
  // 不是同一件事，共用一個 ID 會讓「做不到」與「不想做」分不開。
  conditionLocal: string;
  weightLocal: string;
}>[] = [
  {
    intentKind: 'travelToCity',
    chainTemplateId: TRAVEL_CHAIN_TEMPLATE_ID,
    conditionLocal: 'npc-can-reach-another-city',
    weightLocal: 'travel',
  },
  {
    intentKind: 'enterNearbyAdventureMap',
    chainTemplateId: LOCAL_ADVENTURE_CHAIN_TEMPLATE_ID,
    conditionLocal: 'npc-has-eligible-nearby-adventure-site',
    weightLocal: 'local-adventure',
  },
  {
    intentKind: 'acceptNearbyQuest',
    chainTemplateId: ACCEPT_QUEST_CHAIN_TEMPLATE_ID,
    conditionLocal: 'npc-has-claimable-nearby-posting',
    weightLocal: 'accept-quest',
  },
];

// 五種個人自由行動。`freeActionRuleId` 的家族（`free-action-rule`）由 **team** 擁有，
// 這是**跨 domain 引用**：本輪 team 那一軌已寫出 `free-action-rule.core.<local>` 七筆
// （craft / train / teach / trade / tavern-visit / propose-to-teammate / rest）。
//
// 這張映射表存在的唯一理由是大小寫規約不同：契約的 `NpcMemberFreeActionKind` 是 camelCase
// （`proposeToTeammate`），而內容 ID 的 local 段是 kebab-case（`propose-to-teammate`）。
// 直接把 union 值當 local 名會產生 `free-action-rule.core.proposeToTeammate`——一個
// **不存在的 ID**，而且載入會成功、只是永遠讀不到。所以逐筆明寫，並用非 Partial 的 Record
// 讓「新增一種自由行動卻沒指定它的 Rule」變成本檔的編譯錯誤。
const FREE_ACTION_RULE_LOCAL: Readonly<Record<NpcMemberFreeActionKind, string>> = {
  craft: 'craft',
  train: 'train',
  trade: 'trade',
  proposeToTeammate: 'propose-to-teammate',
  rest: 'rest',
};

// 抽選順序（同權重時的穩定順序來源）。五種全列——少一種等於「這份 pack 的 NPC 永遠不做那件事」。
const FREE_ACTION_ROWS: readonly NpcMemberFreeActionKind[] = [
  'craft',
  'train',
  'trade',
  'proposeToTeammate',
  'rest',
];

export const ADVENTURER_DECISION_POLICY_ID = core.id<AdventurerDecisionPolicyId>(
  'adventurer-decision-policy',
  'baseline',
);

const adventurerDecisionPolicy: Authored<AdventurerDecisionPolicyDefinition> = {
  kind: 'adventurer-decision-policy',
  id: ADVENTURER_DECISION_POLICY_ID,
  // 【第一版方案（待討論）】doc §4.1 明訂「`NpcActionChain` 節點完成時只登記
  // `dueDay = currentDay + 1` 的下一步，保持每日結算與『新行為最早次日開始』原則」。
  //
  // 這個欄位的實際作用範圍（`modules/npc-behavior/system.ts` 的 `decisionJobDraft`，
  // 約 224–239 行）：`npcDecisionDue` 的**每一條**返回路徑都用它重排下一次抽選 Job，
  // 且只在 `controller.nextDecisionOnDay <= worldDay` 時生效——也就是它是「還沒有下一個
  // 明確可抽日時的複審節奏」，包含「隊伍還在跑 Chain、今天不必抽」這種常見路徑。
  // （**注意**：它不是「抽不到候選時的重試間隔」——抽不到候選走的是
  // `drawIntent` 的 `fallbackChainTemplateId`，見 system.ts:346，那條路徑當天就會開工。）
  //
  // 取 1 = 每日複審，與上面那條「新行為最早次日開始」同節奏；取大值會讓一支已完成 Chain
  // 的隊伍在明確可抽日之後仍憑空停擺數日。
  reviewIntervalDays: 1,
  candidates: INTENT_CANDIDATE_ROWS.map((row) => ({
    intentKind: row.intentKind,
    chainTemplateId: row.chainTemplateId,
    conditionId: core.id<ConditionDefinitionId>('condition', row.conditionLocal),
    weightResolverId: resolverId(`npc-behavior.intent-weight.${row.weightLocal}`),
  })),
  memberFreeActionCandidates: FREE_ACTION_ROWS.map((actionKind) => {
    const local = FREE_ACTION_RULE_LOCAL[actionKind];
    return {
      actionKind,
      freeActionRuleId: core.id<FreeActionRuleId>('free-action-rule', local),
      conditionId: core.id<ConditionDefinitionId>('condition', `npc-member-can-${local}`),
      weightResolverId: resolverId(`npc-behavior.free-action-weight.${local}`),
    };
  }),
  // 抽不到候選時的強制非自由工作。**有明文的只有約束**：doc §2「資料驗證禁止它指向 `cityFree`」
  // （Runtime 也真的擋，見 system.ts:346–355），所以只能是三個非自由模板之一。
  // 【第一版方案（待討論）】**挑哪一個是設計判斷，文件沒指定**。選旅行的理由：它的前置條件
  // 最弱（有一條開放路線就能走），最不容易連 fallback 也失敗。
  fallbackChainTemplateId: TRAVEL_CHAIN_TEMPLATE_ID,
  forcedFreeDurationDays: { min: 2, max: 7 },
  // 跨 domain 引用：`npc-travel-rule` 家族由 **team** 擁有（固定 6 日直達、無事件）。
  // local 名 `standard` 取自本輪 team 那一軌實際寫出的 `npc-travel-rule.core.standard`——
  // 這不是我挑的名字，是對齊既存內容，否則就是一個永遠讀不到的引用。
  npcTravelRuleId: core.id<NpcTravelRuleId>('npc-travel-rule', 'standard'),
  marketPolicyId: NPC_MARKET_POLICY_ID,
};

// ════════════════════════════════════════════════════════════════════════════
// 未撰寫的 kind——每一筆都有具體缺口，不是漏掉
// ════════════════════════════════════════════════════════════════════════════
//
// 1. `gathering-rule`
//    擁有者是 Gathering 服務（`19_gathering_service.md`），由 services 那一軌撰寫。這裡不重複寫。
//
// 2. `conflict-rule`（world）
//    `ConflictRuleDefinition` 的三組後果欄位是 `EffectDefinitionId[]`
//    （`marketPressureEffectIds` / `eventWeightEffectIds` / `passageEffectIds`），但
//    `EffectDefinition`（`contracts/core/values.ts`）的 `effectKind` 聯集只有 grantItem /
//    consumeActorItem / removeActorCurrency / applyStatus / grantMasteryExperience /
//    startDetailedCombat / setWorldFact / changeCityMetric——**沒有任何一種能表達市場壓力、
//    事件權重修正或路線通行變更**。也就是說 GDD「戰爭機制」列的三個後果（物價指數變動、事件
//    發生權重改變、通行證可能失效）目前在資料裡無法表達。
//    填空陣列會讓戰爭「發生但沒有任何後果」——那正是規範點名的「把未完成偽裝成可用」。
//    `07_world_module.md` §2.4 明文允許這個狀態：「戰爭觸發條件、力量差、占領結果與市場修正
//    尚未定數值時，**可以沒有啟用中的 Conflict Rule**；架構不得自行補公式」，§8 不變量 7
//    也要求「戰爭未啟用時，不建立空白 Conflict Job」。因此本版不撰寫。
//
// 3. `world-fact`（world）
//    這個 kind 是「已註冊世界旗標」的登記表（doc §2.5：「不能當任意 key/value 垃圾桶」）。
//    問題是它的生產端與消費端都不在 core：生產端是內容事件的 `setWorldFact` Effect（文化內容），
//    消費端是 `ConditionDefinition`——而 `condition` 這個 kind **沒有登記擁有模組**（缺口 4），
//    所以現在沒有任何規則讀得到任何 Fact。設計文件也沒有指名任何一個具體 Fact。
//    在這種狀態下憑空造幾個旗標，只會產生零引用內容。判定：具體 Fact 屬文化 pack；core 本版不寫。
//
// 4. `map-spawn-rule`（map）
//    `MapSpawnRuleDefinition` 的四個引用欄位全部指向文化內容：`localCultureContentRuleId` /
//    `humanCultureContentRuleId`（`culture-content-rule`）、`chestPoolId`（`chest-pool`）、
//    `mapEventPoolId`（`map-event-pool`）——而**這三個 kind 都沒有登記擁有模組**，任何人現在都
//    寫不出它們（缺口 5）。`spawnBudgets` 更是逐圖的數量區間，而指向它的
//    `MapTemplateDefinition.spawnRuleId` 本身就是文化內容（九座迷宮）。
//    依 `packs.ts` 的分包原則（判不出來一律放文化 pack），一張 spawn rule 屬一張圖，屬文化 pack。
//    可以放 core 的只有它引用的 `npcSequenceRuleId`——那一筆已在本檔提供。
//    （另註：任務指定的「map 刷新鎖／固定刷新日」無法由 `map-spawn-rule` 表達，見缺口 6。）
//
// 5. `map-gathering-rule`（map）
//    `map-reader.ts` 以 kind `'map-gathering-rule'` 讀取，而 `getGatheringMapView(id)` 的
//    參數是 `GatheringRuleId`——也就是它期待**同一個 ID** 上同時存在 `'gathering-rule'`
//    （dungeon 與 gathering 讀它）與 `'map-gathering-rule'` 兩個 kind。一筆定義只有一個 kind，
//    而 Content Compiler 又強制同一 pack 內 ID 唯一，所以這兩筆**在結構上不可能同時存在**。
//    `npcPolicy` 已經住在 `GatheringRuleDefinition` 上（gathering 擁有），在這裡再寫一份就是
//    同一個事實兩個擁有者。判定：這是要收斂的契約缺口（缺口 1），不是待寫的內容。

export const worldMapDungeonNpcDomain: AuthoredDomain = {
  domain: 'world-map-dungeon-npc',
  definitions: [
    ...passagePolicies,
    npcSequenceRule,
    dungeonInteractionRule,
    npcExplorationRule,
    ...TARGET_RESOLVER_ROWS.map(targetResolver),
    ...chainTemplates,
    npcMarketPolicy,
    adventurerDecisionPolicy,
  ],
};

// 本 domain 引用到的 Resolver。整合者把它併進 `packs.ts` 的 `requiredResolverIds`——
// Bootstrap 以此確認「pack 用到的 Resolver 全部已註冊」才啟動（authoring.ts §11）。
// 手寫一份總表會與內容漂移，所以從實際資料收集。
export const WORLD_MAP_DUNGEON_NPC_REQUIRED_RESOLVER_IDS: readonly ResolverId[] = [
  ...passagePolicies.map((policy) => policy.requirementResolverId),
  dungeonInteractionRule.trapResolverId,
  ...chainTemplates.flatMap((template) =>
    template.nodes.flatMap((node) => {
      if (node.kind === 'travelToCity') return [node.destinationResolverId];
      if (node.kind === 'executeNearbyAdventure') return [node.mapResolverId];
      if (node.kind === 'acceptNearbyQuest') return [node.questSelectorId];
      return [];
    }),
  ),
  npcMarketPolicy.budgetReserveRuleId,
  ...npcMarketPolicy.purchaseNeedRules.flatMap((rule) => [rule.needResolverId, rule.offerSelectorId]),
  ...npcMarketPolicy.sellRules.flatMap((rule) => [rule.itemSelectorId, rule.sellWhenResolverId]),
  ...(npcMarketPolicy.homePurchaseRuleId === undefined ? [] : [npcMarketPolicy.homePurchaseRuleId]),
  ...adventurerDecisionPolicy.candidates.map((candidate) => candidate.weightResolverId),
  ...adventurerDecisionPolicy.memberFreeActionCandidates.map((candidate) => candidate.weightResolverId),
];

// 本 domain 產生的 kind。整合者把它併進 core pack 的 `declaredKinds`（那一欄刻意手寫，
// 見 authoring.ts 的說明——推導出來的宣告等於沒有檢查）。此處只是給整合者對照用的清單。
export const WORLD_MAP_DUNGEON_NPC_DECLARED_KINDS: readonly string[] = [
  'passage-policy',
  'npc-sequence-rule',
  'dungeon-interaction-rule',
  'npc-exploration-rule',
  'npc-dungeon-target-resolver',
  'action-chain-template',
  'npc-market-policy',
  'adventurer-decision-policy',
];
