# Combat 模組契約

> **模組 ID：** `combat`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、Character／Team／Inventory／Progression／World 的公開 Query。
>
> **責任：** 管理雙方九宮格的 detailed Encounter、戰鬥暫態、倒扣式 CTB、技能、武器組切換、反擊架勢、敵人 AI、自動前排補位與戰鬥結果。Combat 只在遭遇內擁有戰鬥快照；角色永久狀態、隊伍持久配置、物品與地圖內容由其他模組擁有。不進九宮格的單場／多場掃蕩由 [Combat Sequence](21_combat_sequence_module.md) 負責。

---

## 1. 邊界與所有權

### 1.1 Combat 唯一可寫的 State

```ts
type CombatState = {
  encounters: Record<EncounterId, CombatEncounter>;
};
```

### 1.2 Combat 不擁有的事

| 事實 | 所有者 | Combat 的角色 |
|---|---|---|
| 角色永久生命、魔力與暫時狀態 | character | 遭遇中使用快照，結束時送出正式結果。 |
| 熟練度、主屬與已學技能 | progression | 以 Query 驗證與計算；只發出成長來源事實。 |
| 裝備實體與三組武器配置 | inventory | 以 Loadout Query 取得目前武器／效果。 |
| 隊伍歸屬、世界位置與持久戰鬥配置 | team | Encounter 開始時讀取一次全體正式成員與配置快照，結束後發出隊伍結果。隊伍沒有候補。 |
| 地圖怪群是否已清除 | map | 戰鬥勝利後要求 Map 處理來源內容。 |
| 戰鬥道具實體消耗 | inventory | 以 `CommitCombatItemUse` 原子提交。 |
| 敵人的文化來源 | world／map | 只接收已解析的 Encounter Definition。 |
| 簡易戰鬥串、戰力擲骰與掃蕩總經驗 | combat-sequence | Combat 不建立或修改 Combat Sequence；兩者只共用編譯後 Encounter／Skill View 與成長事件契約。 |

戰鬥本身不推進世界日或迷宮分鐘。

---

## 2. 靜態資料契約

### 2.1 CombatDefinitionReader

```ts
interface CombatDefinitionReader {
  getCombatRule(id: CombatRuleId): CombatRuleDefinition;
  getEncounterGroup(id: EncounterGroupDefinitionId): EncounterGroupDefinition;
  getMonster(id: MonsterDefinitionId): MonsterDefinition;
  getSkillView(id: SkillDefinitionId): CombatSkillDefinitionView;
  getOpeningCtbRule(id: OpeningCtbRuleId): OpeningCtbRuleDefinition;
  getActionDelayRule(id: ActionDelayRuleId): ActionDelayRuleDefinition;
  getCombatStatus(id: CombatStatusDefinitionId): CombatStatusDefinition;
  getCombatEffect(id: CombatEffectDefinitionId): CombatEffectDefinition;
  getDamageRule(id: CombatDamageRuleId): CombatDamageRuleDefinition;
  getHealRule(id: CombatHealRuleId): CombatHealRuleDefinition;
  getCtbAdjustmentRule(id: CombatCtbAdjustmentRuleId): CombatCtbAdjustmentRuleDefinition;
  getCombatInterruptionRule(id: CombatInterruptionRuleId): CombatInterruptionRuleDefinition;
  getEquipmentEffect(id: EquipmentEffectDefinitionId): EquipmentEffectDefinition;
  getAiPolicy(id: CombatAiPolicyId): CombatAiPolicyDefinition;
  getExperienceBudget(id: EncounterExperienceBudgetId): EncounterExperienceBudgetDefinition;
  getMonsterExperienceProfile(id: MonsterExperienceProfileId): MonsterExperienceProfileDefinition;
}
```

Progression 與 Combat 讀取的是同一份 Skill Definition 經 Data Runtime 編譯後的不同窄化 View，不維護兩份互相同步的 Skill 資料。

### 2.2 敵人定義

```ts
type MonsterDefinition = DefinitionHeader & {
  cultureId: CultureId;
  speciesKind: 'nonHuman' | 'human';
  threatRank: 'normal' | 'elite' | 'boss';
  bodySize: 'small' | 'medium' | 'large';
  attributes: {
    health: number;
    muscle: number;
    intelligence: number;
    reaction: number;
    coordination: number;
    charisma: number;
  };
  skillIds: SkillDefinitionId[];
  naturalAttackProfileId: MonsterNaturalAttackProfileId;
  controlResistanceProfileId: CombatControlResistanceProfileId;
  aiPolicyId: CombatAiPolicyId;
  experienceProfileId: MonsterExperienceProfileId;
};

type MonsterNaturalAttackProfileDefinition = DefinitionHeader & {
  physicalPowerResolverId: ResolverId;
  magicPowerResolverId: ResolverId;
  hitScoreResolverId: ResolverId;
};

type CombatControlResistanceProfileDefinition = DefinitionHeader & {
  ctbIncreaseMultiplier: number;                // 0..1；只作用於外來正值 adjustCtb
  maxExternalCtbIncreaseBeforeOwnAction?: number;
  interruptionImmunityUntilOwnActionAfterSuccess: boolean;
};
```

Rule Validation：

- 一般敵人恰好 1 招。
- 菁英與 Boss 為 2～4 招。
- 任何敵人不得超過 4 招。
- Boss 必為大型 3×3。
- 一般／菁英的威脅等級與體型沒有其他硬性綁定。
- 每個 Monster 都必須引用可計算的自然攻擊 Profile；不得假定非人類持有隱形武器，也不得只以顯示文字保存技能倍率。
- 控制抗性只改寫外來正值 CTB 增加與成功中斷頻率；自身 CTB 扣減、技能原始延遲與狀態持續不受影響。

### 2.3 遭遇編組

```ts
type EncounterGroupDefinition = DefinitionHeader & {
  memberDefinitionIds: MonsterDefinitionId[];
  initialPlacements: EnemyPlacementDefinition[];
  experienceBudgetId: EncounterExperienceBudgetId;
  rewardResolverId: ResolverId;
};

type EncounterExperienceBudgetDefinition = DefinitionHeader & {
  aggregation: 'sumMemberProfiles';
  groupModifier: number;
  minimumAwardRuleId?: ExperienceAwardRuleId;
};

type MonsterExperienceProfileDefinition = DefinitionHeader & {
  attackExperience: number;
  defenseExperience: number;
  attackAwardRuleId: ExperienceAwardRuleId;
  defenseAwardRuleId: ExperienceAwardRuleId;
};
```

每隻怪的攻擊／防禦經驗基礎由 `experienceProfileId` 定義；Encounter 建立時將實際成員的 Profile 加總一次，再套用資料化 Group Modifier，形成本次總預算。低階小型怪物可用 8～9 隻填滿九宮格，因此確實會納入 8～9 個小怪 Profile，但不得把「已加總的 Encounter 總預算」再對每隻怪重複發放。

### 2.4 技能戰鬥 View

```ts
type CombatSkillDefinitionView = {
  skillId: SkillDefinitionId;
  activationHand: 'mainHand' | 'offHand' | 'bothHands' | 'handless';
  weaponRequirementIds: WeaponRequirementId[];
  actionKind: 'attack' | 'guard' | 'cast' | 'perform' | 'support';
  masteryExperienceMode: 'damage' | 'fixedSupport';
  attackMasteryAwardRuleId?: AttackMasteryAwardRuleId;
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
  techniqueIds: TechniqueId[];
  targeting: TargetingDefinition;
  actionDelayRuleId: ActionDelayRuleId;
  effectIds: CombatEffectDefinitionId[];
  counterStance?: CounterStanceDefinition;
  resourceCosts: ResourceCostDefinition[];
};
```

技能分類是內部資料，不要求 UI 顯示所有 Tag。架構中不存在 Basic Attack Definition；攻擊、格擋、施法、演奏與支援全部由技能驅動。戰鬥也不存在主動移動、移動技能、推拉或擊退效果；`anchorCell` 只能由「前排全空」的系統補位規則改變。

### 2.5 戰鬥效果與狀態語彙

`CombatSkillDefinitionView.effectIds` 與裝備的技能效果都必須引用下列受限的資料語彙；不能以效果資料夾帶函式本文或自訂腳本。

```ts
type CombatEffectDefinition = DefinitionHeader & {
  operation:
    | {
        kind: 'dealDamage';
        damageRuleId: CombatDamageRuleId;
      }
    | {
        kind: 'heal';
        healRuleId: CombatHealRuleId;
      }
    | {
        kind: 'adjustCtb';
        adjustmentRuleId: CombatCtbAdjustmentRuleId;
      }
    | {
        kind: 'interruptCasting';
        interruptionRuleId: CombatInterruptionRuleId;
      }
    | {
        kind: 'applyStatus';
        statusId: CombatStatusDefinitionId;
        durationTargetActions: number;
        stackPolicy: 'replace' | 'refresh' | 'strongest';
      }
    | {
        kind: 'removeStatus';
        statusId: CombatStatusDefinitionId;
      };
};

type CombatDamageRuleDefinition = DefinitionHeader & {
  damageChannel: 'physical' | 'magic' | 'instrument';
  powerResolverId: ResolverId;
  canBeBlocked: boolean;
};

type CombatHealRuleDefinition = DefinitionHeader & {
  powerResolverId: ResolverId;
};

type CombatCtbAdjustmentRuleDefinition = DefinitionHeader & {
  amountResolverId: ResolverId; // 正數增加目標 currentCtb，負數扣減；結果最低夾在 0
};

type CombatInterruptionRuleDefinition = DefinitionHeader & {
  appliesToActionKinds: Array<'cast' | 'perform'>;
  interruptionDelayRuleId: ActionDelayRuleId;
};

type CombatStatusDefinition = DefinitionHeader & {
  polarity: 'positive' | 'negative';
  modifierResolverId: ResolverId;
  displayPriority: number;
};

type CombatStatusInstance = {
  statusInstanceId: string;
  statusId: CombatStatusDefinitionId;
  remainingTargetActions: number;
  appliedByCombatantId: CombatantId;
  revision: Revision;
};
```

- `dealDamage`、`heal`、`adjustCtb`、`interruptCasting`、`applyStatus`、`removeStatus` 是第一版戰鬥內容可使用的完整效果集合。若未來確實需要新 kind，必須先增補公開型別、Schema、Handler、Validator、Fixture 與存檔影響說明。
- Status 的持續時間只以**目標後續完成的行動次數**倒扣；不以世界日、地城分鐘或 UI 回合計數。`remainingTargetActions` 到 0 時由 Combat 移除狀態。
- `modifierResolverId` 只接收角色／敵人的 Encounter 能力快照與 Status 強度快照，回傳已註冊的副屬修正；它不得改格、建立新遭遇、寫入角色永久狀態或讀取完整世界。
- 守勢與反擊不是另一套隱藏普通攻擊：守勢以資料定義的正面 Status／格擋條件處理，反擊仍必須由 Skill 的 `counterStance` 主動建立並在符合條件時解析。

### 2.6 效果資料的硬限制

- `CombatDamageRuleDefinition.damageChannel` 只能走既有物理／魔法／樂器傷害與減傷規則；不能藉名稱繞過格擋或減傷。
- `adjustCtb` 的輸出是實際數值，結果只可使 `currentCtb` 最低為 0，沒有百分比 Bar、速度值或全局時間效果。
- 對 Monster 的外來正值 `adjustCtb` 必須先套用其 Control Resistance Profile，再套兩次自身行動間的累積上限；負值調整不吃此抗性。Boss 若已在本次自身行動前成功被中斷，後續 `interruptCasting` 只保留技能的其他合法效果，不再次中斷。
- `interruptCasting` 只可中斷正在進行的 `cast`／`perform` 讀條，並以資料指定的實際 CTB 延遲結束該次讀條；它不能取消守勢、改變格位或奪取下一次行動。
- `applyStatus` 的 target 必須落在 Skill 已驗證的合法目標內；Status 不能用來修改格位、隊伍成員、地圖內容、物品或熟練度。
- 相同 Status 的疊加完全依該 Effect 的 `stackPolicy` 決定；內容作者不可假定「同名狀態自然疊層」。

### 2.7 開場 CTB 與行動延遲

```ts
type CombatRuleDefinition = DefinitionHeader & {
  openingCtbRuleId: OpeningCtbRuleId;
  combatRestDelayRuleId: ActionDelayRuleId;
  defenseMasteryRoutingRuleId: DefenseMasteryRoutingRuleId;
};

type OpeningCtbRuleDefinition = DefinitionHeader & {
  baseCtb: number;                       // 同一場所有單位使用同一基礎值
  reductions: AttributeReductionRule[];
  minimumCtb: number;
};

type ActionDelayRuleDefinition = DefinitionHeader & {
  baseDelay: number;
  reductions: AttributeReductionRule[];
  minimumDelay: number;
};

type AttributeReductionRule = {
  primaryAttribute: PrimaryAttributeId;
  reductionPerPoint: number;
};
```

```text
開場目前 CTB =
  max(minimumCtb,
      baseCtb - Σ(primaryAttribute × reductionPerPoint))

實際增加延遲 =
  max(minimumDelay,
      baseDelay - Σ(primaryAttribute × reductionPerPoint))
```

開場的 `baseCtb` 對敵我完全相同，差異只來自資料指定的主屬扣減。數值是實際 CTB，不是百分比。UI 行動條只顯示 `min(currentCtb / 100, 1)`；Combat State 的 `currentCtb` 可超過 100。

---

## 3. Runtime State

### 3.1 CombatEncounter

```ts
type CombatEncounter = {
  encounterId: EncounterId;
  source: CombatEncounterSource;
  playerTeamId: TeamId;
  playerFormationRevision: Revision;
  combatants: Record<CombatantId, CombatantState>;
  playerGrid: CombatGridState;
  enemyGrid: CombatGridState;
  state: 'initializing' | 'active' | 'awaitingPlayerCommand' | 'resolved';
  currentActorId?: CombatantId;
  readyQueue: CombatantId[];
  supportMasteryUseCounts: Record<CharacterId, Record<SkillDefinitionId, number>>;
  rngStreamId: string;
  revision: Revision;
};

type CombatEncounterSource =
  | {
      kind: 'mapContent';
      mapId: MapInstanceId;
      contentId: ContentInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    }
  | {
      kind: 'playerTravelEvent';
      interactionId: InteractionId;
      eventInstanceId: PlayerTravelEventInstanceId;
      encounterGroupId: EncounterGroupDefinitionId;
    };

type DetailedCombatRequest = {
  teamId: TeamId;
  source: CombatEncounterSource;
  participantSnapshotRevision: Revision;
  rngStreamId: string;
};
```

### 3.2 CombatantState

```ts
type CombatantState = {
  combatantId: CombatantId;
  source:
    | { kind: 'character'; characterId: CharacterId }
    | { kind: 'monster'; monsterDefinitionId: MonsterDefinitionId; runtimeEnemyId: RuntimeEnemyId };
  side: 'player' | 'enemy';
  footprint: { width: 1 | 2 | 3; height: 1 | 2 | 3 };
  anchorCell: GridCell;

  health: number;
  mana: number;
  currentCtb: number;
  externalCtbIncreaseSinceOwnAction: number;
  interruptionImmuneUntilOwnAction: boolean;
  activeWeaponSetId?: WeaponSetId;
  activeStatuses: CombatStatusInstance[];
  counterStance?: CounterStanceInstance;
  casting?: CastingInstance;
  state: 'ready' | 'acting' | 'incapacitated' | 'dead';
  revision: Revision;
};
```

角色的遭遇中 HP／MP 是 Combat 快照；Character State 在 Encounter 結束前不逐招改寫。存檔中若有 active Encounter，UI 必須優先顯示 Combat 快照。`DetailedCombatRequest` 永遠建立可逐招操作的 `CombatEncounter`；任何不建立 Encounter 的掃蕩不得經過此入口。

`supportMasteryUseCounts` 只記本場 detailed 參戰者實際成功使用的無傷害支援技能次數；每位角色的同一技能至多累計 3。Encounter 結束時才將此快照轉成固定 Mastery MXP 事件，不能在每次施放時直接修改 Progression。攻擊型樂器與其他攻擊技能不寫入此計數，仍以有效傷害處理。

### 3.3 九宮格

```ts
type CombatGridState = {
  width: 3;
  height: 3;
  occupancy: Record<GridCell, CombatantId>;
};
```

- 雙方各自的局部座標都以第 1 排為前排、第 3 排為後排；補位不需要換算世界方向。
- 小型與人類敵人 1×1。
- 中型 2×2。
- 大型 3×3，獨占整個陣地。
- Placement 必須完整落在 3×3 且不可重疊。
- `ready`、`acting`、`incapacitated` 仍占格；`dead` 會從 occupancy 移除。暫時不能行動不等於出局。
- Combat 建立後沒有任何玩家、AI 或技能可自行更改格位；唯一的格位變化是 Combat 在前排全空時執行整側自動補位。

---

## 4. 公開 Query

```ts
interface CombatQuery {
  getEncounter(id: EncounterId): CombatEncounterView;
  getAvailableActions(encounterId: EncounterId, actorId: CombatantId): CombatActionOption[];
  getCtbOrder(encounterId: EncounterId): CombatantId[];
  getCombatant(id: CombatantId): CombatantView;
}

interface DetailedCombatResolver {
  begin(input: DetailedCombatRequest): EncounterId;
}
```

任務可行性、NPC 換裝與簡易戰鬥都直接使用 [Combat Power 純計算契約](22_combat_power_service.md)；Combat 不維護或轉送第二份 NPC 戰力 Estimator。

---

## 5. 輸入契約

### 5.1 Internal Command

| Internal Command | Combat 的反應 |
|---|---|
| `StartCombatEncounter` | 依 Team Formation、具型別的 Map Content／Player Travel Event Source 與 Encounter Definition 建立戰鬥快照，先做開場前排補位，再套用開場 CTB。 |

`StartCombatEncounter` 必須驗證玩家／NPC 隊伍正式成員數為 1～9，且 `TeamCombatFormation` 恰好配置每一名正式成員一次。漏配任何正式成員、出現第十名成員或額外候補都拒絕建立 Encounter；護衛與救援等任務暫時角色不在正式參戰名單。`source.kind=playerTravelEvent` 時，Interaction 必須仍為同一事件的 `awaitingChoice`，且 Event Instance 屬於玩家隊；NPC Team 一律拒絕這種 Source。

### 5.2 玩家 Game Command

| Command | 前置條件 | Combat 的責任 |
|---|---|---|
| `useCombatSkill` | Encounter 等待該角色、已學技能、武器組與目標合法。 | 切換武器組、付延遲／資源並解析技能。 |
| `useCombatItem` | Encounter 等待該角色、Item 可用。 | 啟動戰鬥道具 Workflow。 |
| `commandAlly` | 玩家可指揮該隊友。 | 寫入一次性 AI 指令；隊友仍由自己的行動時機執行。 |
| `combatRest` | Actor 可行動。 | 回復少量生命／魔力並增加資料指定延遲。 |

沒有 `normalAttack`、`moveCombatant` 或 `attemptEscape` Command。敵對遭遇只以一方遭擊殺／擊敗結束；戰鬥內不能主動換位。

### 5.3 訂閱 DomainEvent

| Event | Combat 的反應 |
|---|---|
| `CombatItemUseCommitted` | 讀取已提交的效果／延遲資料，完成該 Item Action。 |
| `EquipmentChanged`／`KnowledgeLearned` | 只影響尚未開始的 Encounter；active Encounter 依開始時快照，除非資料規則明確允許戰中換裝。 |
| `CharacterDied`／`CharacterAvailabilityChanged` | 若來源角色不再可用，拒絕建立新 Encounter。 |

---

## 6. 輸出 Internal Command

| Internal Command | 唯一處理者 | 用途 |
|---|---|---|
| `CommitCombatItemUse` | inventory | 驗證並提交 Item、延遲與效果資料。 |
| `ApplyCombatCondition` | character | Encounter 結束時寫回角色 HP／MP／狀態。 |
| `ResolvePlayerMapContent` | map | 只有 `source.kind=mapContent` 的勝利才正式處理來源怪群／Boss。 |

---

## 7. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `CombatEncounterStarted` | `encounterId`、`teamId`、`source` | dungeon、player-travel-event workflow、ui/app。 |
| `CombatActionResolved` | `encounterId`、`actorId`、`skillId?`、`results` | ui/app。 |
| `CombatEncounterResolved` | `encounterId`、`teamId`、`participantCharacterIds`、`source`、`outcome: victory \| defeat`、`contentResolution?` | dungeon、team、map、quest、player-travel-event workflow、ui/app。 |
| `CombatTeamOutcome` | `teamId`、`canContinue`、`reason` | team、dungeon。 |
| `CombatAttackMasteryEarned` | `source: { kind: encounter, encounterId }`、`characterAwards` | progression。 |
| `CombatDefenseMasteryEarned` | `source: { kind: encounter, encounterId }`、`characterAwards` | progression。 |
| `CombatSupportMasteryEarned` | `source: { kind: encounter, encounterId }`、`characterId`、`skillId`、`supportMasteryAwardRuleId`、`creditedUseCount` | progression。 |

Combat 不直接發 `MasteryExperienceGranted`、`InventoryTransferred` 或 `QuestStateChanged`。

Player Travel Event Workflow 只接受 Interaction 所保存的同一 `encounterId`、`eventInstanceId` 與 `teamId`。勝利或戰敗都會完成該旅行事件；若為戰敗，Quest 同時依既有 `CombatEncounterResolved` 規則使該隊所有 `incomplete` 護衛委託到期。Combat 不直接改 Team Pending 或 Quest State。

---

## 8. 核心規則

### 8.1 倒扣式 CTB

```text
建立 Encounter
  → 兩側各自執行一次前排補位
  → 所有單位以同一 opening baseCtb 計算自己的 currentCtb
  → 找出可排程單位中的最小 currentCtb
  → 所有人同時扣除該數值
  → currentCtb = 0 的單位進入 readyQueue
  → 敵我同值：玩家側排在敵方側前
  → 同側同值：使用 Encounter 的 deterministic RNG 隨機排序
  → 依序執行；每個動作完成後為行動者加上該動作的實際延遲
  → 所有 0 CTB 單位處理完後，才再次全體倒扣
```

- `currentCtb` 永遠是「距離下次可行動還剩多少實際數值」，不是累積進度。
- 一次全體倒扣必須使用該時點最小的非負 `currentCtb`；不可逐人扣除或讓世界時間前進。
- 若同一批同時到 0，固定先排玩家側，再排敵方側；同一側不以角色 ID、陣位或主屬作第二排序。
- Query 只能讀取既有排序，不得為了預覽消耗 RNG。`readyQueue` 必須可序列化，存讀檔後順序不變。
- 行動、硬直與反擊代價都直接增加實際 `currentCtb`；加速與恢復則直接扣除並最低夾在 0。UI 才把數值除以 100 顯示 Bar。

### 8.2 前排全空自動補位

補位對敵我兩側各自判定，且不是角色行動：

1. Encounter 建立完配置後，立即判定一次。
2. 一個完整 Action 與其立即反應鏈全部解析完後，再判定一次；多段技能中途不移動格位。
3. 只要第 1 排仍有任何占格單位，整側保持原位，第 2、3 排不個別向前。
4. `dead` 單位移出 occupancy 後，第 1 排若全空，找出目前最前方仍有占格單位的排數 `r`，將該側所有占格單位同步前移 `r - 1` 排；欄位與彼此排距不變。
5. 例：第 1、3 排有人時不移動；第 1 排清空後，第 3 排整排移至第 1 排。第 1、2、3 排有人且第 1 排清空時，第 2 排移至第 1 排、第 3 排移至第 2 排。

`TeamCombatFormation` 只決定開場位置；補位後的位置只存在 `CombatEncounter`，不寫回 Team。架構中不得提供一般位移 Resolver，也不得把補位偽裝成技能、事件或 AI 決策。

### 8.3 技能與武器組

- 每名角色有三組武器配置，每組為主手、副手與三個對應技能。
- 同組技能不切裝。
- 跨組技能先套用切換武器組延遲，再執行技能。
- 主手技能只觸發主手裝備效果；副手同理。
- 雙手同時技能分別判定兩手效果，相同控制效果不疊加，只取最強。
- 盾牌常駐防護在目前武器組持有時有效；盾擊／掩護只由盾牌技能觸發。

### 8.4 反擊

```text
角色主動使用反擊技能
  → 消耗該次行動並建立 CounterStance
  → 敵方技能命中該角色時檢查攻擊種類與格擋
  → 條件成功：立即解析反擊、套用反擊延遲、解除架勢
  → 條件未發生／格擋失敗／被硬直：不免費出手
```

反擊不是永久被動，也不是普通攻擊替代品。

### 8.5 裝備效果觸發順序

```text
常駐係數
→ 技能分類條件
→ 特定技能條件
→ 狀態／結果條件
→ 相同控制效果依 stack policy 合併
```

一般裝備優先使用技能分類觸發；具名技能觸發保留給資料指定的高品級裝備。

### 8.6 經驗來源

- 攻擊 MXP 依角色對各敵人造成的有效傷害比例分配。
- 法杖與攻擊魔法的 50／50 等分配由資料規則決定。
- 防禦 MXP 先依開戰時的初始隊伍站位分給所有參戰者：由前至後略過空排，第一個有人排每人權重 3、第二個有人排每人權重 2、第三個有人排每人權重 1；以所有參戰者權重和為分母分配 Encounter 防禦預算。是否取得份額不以持盾為條件，戰中補位也不改變本場快照；個人份額再依 `defenseMasteryRoutingRuleId` 對開始時防禦裝備的 Mastery 候選分配。
- 支援魔法／支援樂器的 Mastery MXP 是固定值，不看有效防護、增益、減益或疊加量；同一角色的同一技能在一場 Encounter 最多記 3 次成功使用，於 Encounter resolved 時一次發放。攻擊型樂器技能仍依傷害處理。

### 8.7 Detailed／Combat Sequence 成長邊界

Detailed Encounter 與 [Combat Sequence](21_combat_sequence_module.md) 產生相同類型的成長事件，Progression 不應知道隊伍是玩家或 NPC；它只依 `CombatMasterySource` 的判別欄位驗證冪等與來源規則。

| 成長來源 | detailed Encounter | Combat Sequence |
|---|---|---|
| 攻擊 MXP | 依實際有效傷害與該次技能的 Mastery Split。 | 整串正式成功的攻擊預算加總後，依開始快照的六分制攻擊技能權重一次分配。 |
| 防禦 MXP | 開戰初始站位的 3／2／1 有人排權重。 | 使用整串開始時的相同有人排權重，對總防禦預算分配一次。 |
| 無傷害增益／減益／治療技能 | 每次成功使用給固定 Mastery MXP，同角色同技能每場最多 3 次。 | 每個配置且合法的技能，每個正式成功戰鬥節點視為一次；整串場次可超過 3。 |
| 攻擊型樂器 | 依有效傷害。 | 列為攻擊技能，納入六分制攻擊權重。 |

- 8～9 隻小怪的 Profile 先彙總成單一 Encounter 預算，再按傷害／參戰規則分配一次。
- Detailed 只有正式 resolved Encounter 發出成長事件；Combat Sequence 則只有來源正式接受的成功 Result 才能納入整串結算。

---

## 9. Encounter 結束

```text
Combat 判定 victory／defeat
  → 對每名角色送 ApplyCombatCondition
  → source=mapContent 且 victory 時送 ResolvePlayerMapContent
  → 發出 Attack／Defense Mastery Earned
  → 發出 CombatEncounterResolved + CombatTeamOutcome
  → source=playerTravelEvent 時由 Workflow 以同源結果完成旅行互動
  → 全部成功才將 Encounter 標為 resolved 並提交
```

Character 寫回、Map 內容處理與 MXP 任一步驟違反不變量時，整筆結束交易回滾；不會出現怪已清除但角色狀態或獎勵未結算。

---

## 10. 不變量與測試

1. 每個 active Combatant 恰好占用合法 footprint。
2. Boss 必為大型 3×3；大型敵人不能與其他敵人同側共存。
3. 所有主動戰鬥行為必須是技能、道具、指揮或休息；不存在普通攻擊、逃跑與移動。
4. 未學技能、錯誤武器組、非法目標不得進入 Resolver。
5. `currentCtb` 可超過 100，Combat 不做 UI clamp；所有 CTB 扣減最低夾在 0。
6. 反擊只在先建立架勢且條件成功時解析一次。
7. 同一裝備效果在一次 Action 的合併順序 deterministic。
8. active Encounter 存讀檔後結果可重播。
9. Combat Sequence 與玩家 detailed Combat 不混用 Runtime State；Combat 不存在第二種簡化 Encounter。
10. Encounter 結束的 Character／Map／Progression 結果具原子性。
11. 戰鬥格位只能在 Encounter 建立時配置，或由前排全空規則整側同步改變；玩家 Command、AI、技能與效果均不可位移。
12. 同值 CTB 永遠玩家側優先；同側順序只由 Encounter RNG 決定，Query 不得改變結果。
13. 第 1 排仍有占格單位時不得補位；補位必須保留欄位與各占格單位的相對排距。
14. Encounter 的玩家側 `participantCharacterIds` 必須與開始快照的全部正式成員完全相同；不得漏配、候補或加入護衛／救援任務角色。
15. `CombatEncounterResolved(outcome=defeat)` 必須攜帶明確 `teamId`，讓 Quest 能在同一交易終止該隊全部進行中的護衛委託；Combat 不直接修改 Quest State。
16. Monster 的傷害與命中必須由 `naturalAttackProfileId` 和 Skill 的數值 Damage Rule 完整解析；顯示文字不參與運算。
17. Boss 的外來 CTB 增加與重複中斷必須受 `controlResistanceProfileId` 限制，讀檔後累積控制量與免疫狀態可重播。
18. Player Travel Event Encounter 必須以 Interaction／Event Instance 雙 ID 關聯，NPC 不可成為其 Team；結果只能恢復同一筆旅行 Pending 一次。

---

## 11. Combat 模組交接清單

- [ ] Combat Rule、Monster、Encounter、Skill View、Opening CTB、Delay、Status、AI、Experience Schema。
- [ ] CombatEncounter、Combatant、Grid、Counter、Casting Runtime State。
- [ ] Combat／Loadout／Progression／Character Query Port。
- [ ] 四種玩家 Command 與敵方／隊友 AI；不存在普通攻擊、逃跑與位移 Command。
- [ ] 倒扣式 CTB Scheduler、同值 readyQueue、開場配置與前排全空補位 Resolver。
- [ ] 技能、武器組、反擊、裝備效果與行動延遲 Resolver。
- [ ] Encounter 結束 Workflow、成長分配與原子交易測試。
