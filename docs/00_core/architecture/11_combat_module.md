# Combat 模組契約

> **模組 ID：** `combat`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、Character／Team／Inventory／Progression／World 的公開 Query。
>
> **責任：** 管理雙方九宮格遭遇、戰鬥暫態、倒扣式 CTB、技能、武器組切換、反擊架勢、敵人 AI、自動前排補位與戰鬥結果。Combat 只在遭遇內擁有戰鬥快照；角色永久狀態、隊伍持久配置、物品與地圖內容由其他模組擁有。

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
| 隊伍歸屬、世界位置與持久戰鬥配置 | team | Encounter 開始時讀取一次參戰名單與配置快照，結束後發出隊伍結果。 |
| 地圖怪群是否已清除 | map | 戰鬥勝利後要求 Map 處理來源內容。 |
| 戰鬥道具實體消耗 | inventory | 以 `CommitCombatItemUse` 原子提交。 |
| 敵人的文化來源 | world／map | 只接收已解析的 Encounter Definition。 |

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
  aiPolicyId: CombatAiPolicyId;
  experienceProfileId: MonsterExperienceProfileId;
};
```

Rule Validation：

- 一般敵人恰好 1 招。
- 菁英與 Boss 為 2～4 招。
- 任何敵人不得超過 4 招。
- Boss 必為大型 3×3。
- 一般／菁英的威脅等級與體型沒有其他硬性綁定。

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

### 2.5 開場 CTB 與行動延遲

```ts
type CombatRuleDefinition = DefinitionHeader & {
  openingCtbRuleId: OpeningCtbRuleId;
  combatRestDelayRuleId: ActionDelayRuleId;
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
  source: {
    mapId?: MapInstanceId;
    contentId?: ContentInstanceId;
    encounterGroupId: EncounterGroupDefinitionId;
  };
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

type CombatResolutionMode = 'detailed' | 'abstract';

type CombatResolutionRequest = {
  mode: CombatResolutionMode;
  teamId: TeamId;
  encounterGroupId: EncounterGroupDefinitionId;
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
  activeWeaponSetId?: WeaponSetId;
  activeStatuses: CombatStatusInstance[];
  counterStance?: CounterStanceInstance;
  casting?: CastingInstance;
  state: 'ready' | 'acting' | 'incapacitated' | 'dead';
  revision: Revision;
};
```

角色的遭遇中 HP／MP 是 Combat 快照；Character State 在 Encounter 結束前不逐招改寫。存檔中若有 active Encounter，UI 必須優先顯示 Combat 快照。解析模式屬於 `CombatResolutionRequest`，不是隊伍身分：`detailed` 建立可逐招操作的 `CombatEncounter`；`abstract` 用於 NPC 地牢、未來玩家掃蕩與任何系統直接結算的戰鬥，直接產生結算結果而不建立 Encounter。

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

## 4. 公開 Query 與 Estimator

```ts
interface CombatQuery {
  getEncounter(id: EncounterId): CombatEncounterView;
  getAvailableActions(encounterId: EncounterId, actorId: CombatantId): CombatActionOption[];
  getCtbOrder(encounterId: EncounterId): CombatantId[];
  getCombatant(id: CombatantId): CombatantView;
}

interface AbstractCombatEstimator {
  resolve(input: CombatResolutionRequest): AbstractCombatResolution;
}

interface DetailedCombatResolver {
  begin(input: CombatResolutionRequest): EncounterId;
}

interface TeamPowerEstimator {
  assessQuestFeasibility(input: NpcQuestFeasibilityInput): NpcQuestFeasibility;
}

type NpcQuestFeasibilityInput = {
  teamId: TeamId;
  questId: QuestId;
  objective: QuestObjectiveView;
  assessedOnDay: WorldDay;
};

type NpcQuestFeasibility = {
  canAttempt: boolean;
  powerScore: number;
  expectedSuccess: number; // 0..1；僅供資料權重與 UI／debug，非保證結果
  riskBand: 'trivial' | 'favorable' | 'even' | 'dangerous' | 'impossible';
  reason?: 'insufficientPower' | 'noUsableMembers' | 'unsupportedObjective';
};
```

`TeamPowerEstimator` 與 `AbstractCombatEstimator` 必須使用同一份角色快照、裝備、技能、主屬與戰鬥公式來源：前者在 Team 選任務時估計「可否接與權重」，後者在地牢內對每個怪群實際骰定結果。兩者不可各自維護第二份 Team 戰力數值或互相保證結果。

任何抽象探索（NPC Team、未來玩家掃蕩）都只使用 `AbstractCombatEstimator`，不建立 `CombatEncounter`、不逐隻執行技能。

---

## 5. 輸入契約

### 5.1 Internal Command

| Internal Command | Combat 的反應 |
|---|---|
| `StartCombatEncounter` | 依 Team Formation、Map Content、Encounter Definition 建立戰鬥快照，先做開場前排補位，再套用開場 CTB。 |

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
| `ResolvePlayerMapContent` | map | 勝利後正式處理來源怪群／Boss。 |

---

## 7. 輸出事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `CombatEncounterStarted` | `encounterId`、`teamId`、`contentId?` | dungeon、ui/app。 |
| `CombatActionResolved` | `encounterId`、`actorId`、`skillId?`、`results` | ui/app。 |
| `CombatEncounterResolved` | `encounterId`、`participantCharacterIds`、`outcome`、`contentResolution?` | dungeon、team、map、ui/app。 |
| `CombatTeamOutcome` | `teamId`、`canContinue`、`reason` | team、dungeon。 |
| `CombatAttackMasteryEarned` | `encounterId`、`characterAwards` | progression。 |
| `CombatDefenseMasteryEarned` | `encounterId`、`characterAwards` | progression。 |
| `CombatSupportMasteryEarned` | `encounterId`、`characterId`、`skillId`、`supportMasteryAwardRuleId`、`useCount` | progression。 |

Combat 不直接發 `MasteryExperienceGranted`、`InventoryTransferred` 或 `QuestStateChanged`。

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
- 防禦 MXP 依開戰時的初始隊伍站位分給所有參戰者：由前至後略過空排，第一個有人排每人權重 3、第二個有人排每人權重 2、第三個有人排每人權重 1；以所有參戰者權重和為分母分配 Encounter 防禦預算。這是角色的防禦熟練度來源，與防具／盾牌穿戴與否無關，戰中補位也不改變本場快照。
- 支援魔法／支援樂器的 Mastery MXP 是固定值，不看有效防護、增益、減益或疊加量；同一角色的同一技能在一場 Encounter 最多記 3 次成功使用，於 Encounter resolved 時一次發放。攻擊型樂器技能仍依傷害處理。
- 抽象地牢戰鬥不逐招模擬：每一場戰鬥都視為每位裝備符合且已學會的支援技能角色使用該技能一次；Settlement 依實際戰鬥場次彙總後發放。此規則同時適用 NPC Team 與未來玩家掃蕩。

### 8.7 Detailed／Abstract 成長解析

兩種模式產生相同類型的成長事件，Progression 不應知道隊伍是玩家或 NPC。

| 成長來源 | `detailed` | `abstract` |
|---|---|---|
| 攻擊 MXP | 依實際有效傷害比例。 | 對每名角色計算 `攻擊技能數 / 技能組總數 × 6` 的整數權重；全隊權重和為分母分配 Encounter 攻擊預算。 |
| 防禦 MXP | 開戰初始站位的 3／2／1 有人排權重。 | 相同；不因模式或隊伍控制權改變。 |
| 無傷害增益／減益／治療技能 | 每次成功使用給固定 Mastery MXP，同角色同技能每場最多 3 次。 | 每位裝備符合且已學會該技能的角色，視為每場使用一次，各得一份固定 Mastery MXP。 |
| 攻擊型樂器 | 依有效傷害。 | 列為攻擊技能，納入攻擊技能占比權重。 |

例如 abstract Encounter 中三名角色的攻擊技能占比分別為 1、2/3、0，其權重為 6、4、0；第一、二名分別取得攻擊預算的 6/10 與 4/10，第三名不取得攻擊 MXP。無傷害技能的固定經驗與這個攻擊預算完全分開。
- 8～9 隻小怪的 Profile 先彙總成單一 Encounter 預算，再按傷害／參戰規則分配一次。
- 只有正式 resolved Encounter 發出成長事件；無效 Encounter 不得發放。

---

## 9. Encounter 結束

```text
Combat 判定 victory／defeat
  → 對每名角色送 ApplyCombatCondition
  → victory 時送 ResolvePlayerMapContent
  → 發出 Attack／Defense Mastery Earned
  → 發出 CombatEncounterResolved + CombatTeamOutcome
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
9. NPC Estimator 與玩家完整 Combat 不混用 Runtime State。
10. Encounter 結束的 Character／Map／Progression 結果具原子性。
11. 戰鬥格位只能在 Encounter 建立時配置，或由前排全空規則整側同步改變；玩家 Command、AI、技能與效果均不可位移。
12. 同值 CTB 永遠玩家側優先；同側順序只由 Encounter RNG 決定，Query 不得改變結果。
13. 第 1 排仍有占格單位時不得補位；補位必須保留欄位與各占格單位的相對排距。

---

## 11. Combat 模組交接清單

- [ ] Combat Rule、Monster、Encounter、Skill View、Opening CTB、Delay、Status、AI、Experience Schema。
- [ ] CombatEncounter、Combatant、Grid、Counter、Casting Runtime State。
- [ ] Combat／Loadout／Progression／Character Query Port。
- [ ] 四種玩家 Command 與敵方／隊友 AI；不存在普通攻擊、逃跑與位移 Command。
- [ ] 倒扣式 CTB Scheduler、同值 readyQueue、開場配置與前排全空補位 Resolver。
- [ ] 技能、武器組、反擊、裝備效果與行動延遲 Resolver。
- [ ] Encounter 結束 Workflow、成長分配與原子交易測試。
