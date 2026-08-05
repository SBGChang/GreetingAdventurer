# Combat Sequence 模組契約

> **模組 ID：** `combat-sequence`
>
> **依賴：** [共用核心契約](00_shared_contracts.md)、自己的窄化 Definition Reader、Inventory 的補品 Query／Command Port，以及共用的 [Combat Power Query](22_combat_power_service.md)。Team／Inventory／Progression／Combat View 的跨模組組合只存在 `app/composition` 的 Snapshot Assembler，不成為本模組對其他 Runtime 模組的直接依賴。
>
> **責任：** 管理不進入九宮格的簡易戰鬥串。每個節點只以固定隊伍戰力對敵方戰力擲骰，可在規則允許時消耗補品重骰；整串只累積正式成功的戰鬥數與攻擊／防禦經驗預算，結束時一次產生成長來源。
>
> **使用者：** 單場戰鬥掃蕩使用一節點戰鬥串；地牢掃蕩與 NPC 地牢使用多節點戰鬥串。角色是不是玩家不決定模式，呼叫的 Workflow 才決定走 detailed Encounter 或 Combat Sequence。

---

## 1. 邊界與所有權

```ts
type CombatSequenceId = Brand<string, 'CombatSequenceId'>;
type CombatSequenceChallengeId = Brand<string, 'CombatSequenceChallengeId'>;
type CombatSequenceChallengeResultId = Brand<string, 'CombatSequenceChallengeResultId'>;
type CombatSequenceSourceId = Brand<string, 'CombatSequenceSourceId'>;
type CombatSequenceSourceCommitId = Brand<string, 'CombatSequenceSourceCommitId'>;
type CombatSequenceRuleId = Brand<DefinitionId, 'CombatSequenceRuleId'>;
type RetrySupplyPolicyId = Brand<DefinitionId, 'RetrySupplyPolicyId'>;
```

### 1.1 唯一可寫 State

```ts
type CombatSequenceState = {
  sequences: Record<CombatSequenceId, CombatSequence>;
};
```

Combat Sequence 是可跨日保存的 Runtime Aggregate。它不建立 `CombatEncounter`，也不寫入 Combat、Dungeon、Map、Inventory、Progression 或 Team State。

### 1.2 不擁有的事

| 事實 | 所有者 | Combat Sequence 的角色 |
|---|---|---|
| 九宮格、CTB、HP／MP、逐招技能與真實傷害 | combat | 完全不讀取或模擬。 |
| 隊伍成員、陣形與裝備 | team／inventory | 開始時取得不可變分配快照。 |
| 隊伍與敵方戰力公式 | combat-power domain service | 只保存已解析的數值與 revision key。 |
| 地牢內容順序、每日十點、寶箱、事件與採集 | dungeon／map | Dungeon 走到怪物內容時才要求解析對應戰鬥節點。 |
| 怪物內容是否真正被清除 | map 或其他來源模組 | 成功擲骰只是候選結果；來源正式提交後才可發經驗。 |
| 補品 Item、數量與消耗 | inventory | 透過 Internal Command 原子消耗後才允許重骰。 |
| 熟練度與主屬 | progression | 只發出已分配好的成長來源事件。 |
| 世界日與排程 | core／host workflow | 本模組沒有每日 Job；由 Dungeon 或單場掃蕩 Workflow 驅動。 |

### 1.3 兩種模式不是兩套規則

```ts
type CombatSequenceSource =
  | {
      kind: 'singleBattleSweep';
      sourceId: CombatSequenceSourceId;
    }
  | {
      kind: 'dungeonSweep';
      sourceId: CombatSequenceSourceId;
      mapId: MapInstanceId;
      mapVersion: number;
    };
```

- `singleBattleSweep` 恰有一個 Challenge，解析後立刻等待來源提交。
- `dungeonSweep` 可有多個 Challenge；Dungeon 仍依 NPC 內容順序與每日點數決定何時解析下一個。
- 兩者使用完全相同的成功率、補品重骰與最終熟練度公式。

---

## 2. 靜態資料契約

### 2.1 Definition Reader

```ts
interface CombatSequenceDefinitionReader {
  getRule(id: CombatSequenceRuleId): CombatSequenceRuleDefinition;
  getRetrySupplyPolicy(id: RetrySupplyPolicyId): RetrySupplyPolicyDefinition;
  getEncounterView(id: EncounterGroupDefinitionId): SimplifiedCombatChallengeDefinitionView;
  getSkillView(id: SkillDefinitionId): SimplifiedCombatSkillDefinitionView;
}
```

原始 Monster／Encounter／Skill 資料仍分別只有一份；Data Runtime 將它們編譯成 Combat Sequence 所需的窄化 View。

### 2.2 戰鬥串規則

```ts
type CombatSequenceRuleDefinition = DefinitionHeader & {
  combatPowerRuleId: CombatPowerRuleId;
  successChanceResolverId: ResolverId;
  retryRelativePowerGapMaximum: number; // 第一版內容值 0.15
  maxRetryCountPerChallenge: number;    // 第一版內容值 1
  retrySupplyPolicyId: RetrySupplyPolicyId;
  defenseMasteryRoutingRuleId: DefenseMasteryRoutingRuleId;
  attackWeightScale: 6;
  attackSkillAggregation: 'equalConfiguredAttackSkills';
  distributionRounding: 'largestRemainderStableId';
};

type RetrySupplyPolicyDefinition = DefinitionHeader & {
  eligibleItemTagIds: ItemTagId[];
  selection: 'lowestValueThenStableId';
  quantityPerRetry: 1;
};
```

`successChanceResolverId` 的固定輸入／輸出契約為：

```ts
type CombatSequenceSuccessChanceInput = {
  teamPower: number;
  enemyPower: number;
};

type CombatSequenceSuccessChanceResult = {
  probability: number; // 0..1
};
```

資料驗證必須拒絕非有限值、負戰力、超出 0～1 的機率、負重骰次數，以及不等於 6 的第一版權重刻度。第一版基礎資料固定每個 Challenge 最多重骰一次；15% 與一次重骰仍存在資料檔，不散落在 Handler 常數中。

### 2.3 Encounter 與 Skill 窄化 View

```ts
type SimplifiedCombatChallengeDefinitionView = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
  combatPower: number;
  sourceRevisionKey: string;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

type SimplifiedCombatSkillDefinitionView = {
  skillId: SkillDefinitionId;
  masteryExperienceMode: 'damage' | 'fixedSupport';
  attackMasterySplits?: MasteryRatio[];
  supportMasteryAwardRuleId?: SupportMasteryAwardRuleId;
};

type MasteryRatio = {
  masteryId: MasteryId;
  ratio: number;
};
```

- Encounter 戰力與經驗預算使用與 detailed Combat 相同的 Definition 來源，不得建立第二份怪物經驗表。
- `damage` 技能必須有總和恰為 1 的 `attackMasterySplits`，且不可帶支援獎勵。
- `fixedSupport` 技能必須引用一筆 Support Mastery Award Rule，且不納入攻擊技能數。
- 攻擊型樂器使用 `damage`；無傷害增益、減益、治療與支援樂器使用 `fixedSupport`。

---

## 3. 開始時的不可變快照

### 3.1 隊伍戰力

Combat Sequence 只需要 [Combat Power 純計算契約](22_combat_power_service.md)公開的 `CombatPowerQuery.getTeamPower` 與 `TeamCombatPowerSnapshot`，不自行定義第二份介面。Snapshot Assembler 同時使用 `getEncounterPower` 編譯各 Challenge，但 Sequence Entity 只保存開始時已解析的數值與 revision key。

Combat Power 是 Derived Statistics、裝備實例、技能配置與角色狀態組成的可重建結果；若 Team State 保存數值，只能作為帶 `sourceRevisionKey` 的 cache，不能成為第二份權威公式。開始 Sequence 時，Team、每個 Challenge 與 Sequence Rule 的 `combatPowerRuleId` 必須完全相同，禁止比較由不同公式產生的兩個分數。

### 3.2 熟練度分配快照

```ts
type CombatSequenceAllocationSnapshot = {
  capturedOnDay: WorldDay;
  teamFormationRevision: Revision;
  teamPowerRevisionKey: string;
  members: CombatSequenceMemberSnapshot[];
};

type CombatSequenceMemberSnapshot = {
  characterId: CharacterId;
  formationCell: GridCell;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[]; // 只含該組已學會、裝備符合且合法的 1～3 招
  attackSkillCount: number;
  attackWeightUnits: number;              // 0..6 的整數衍生值
  attackMasterySplits: MasteryRatio[];    // 已彙總並正規化
  supportSkills: Array<{
    skillId: SkillDefinitionId;
    awardRuleId: SupportMasteryAwardRuleId;
  }>;
  defenseMasterySplits: MasteryRatio[];   // 由 detailed／簡易共用的防禦 Award Rule 解析
};
```

快照由 `app/composition` 的 `CombatSequenceSnapshotAssembler` 組合 Team、Inventory、Progression、Combat Definition View 與 Combat Power Query。Combat Sequence 不自行挑裝備或技能。`members` 必須與開始時 Team 的全部正式成員完全相同且為 1～9 人；沒有候補、漏配或額外任務角色。

第一版自動控制隊伍使用「合法武器組中戰力最高者」作為 `selectedWeaponSetId`；玩家啟動單場掃蕩時可明確指定合法武器組，未指定時使用相同政策。選定後整串不可變更。

攻擊權重固定為：

```text
configuredSkillCount = configuredSkillIds.length

configuredSkillCount = 0 時：attackWeightUnits = 0
否則：
  attackWeightUnits = attackSkillCount / configuredSkillCount × 6
```

每組最多三招，因此 0、1/3、1/2、2/3、1 都能以 0、2、3、4、6 表示。若未來允許其他技能槽數，必須先調整資料的權重刻度，不可產生非整數後偷偷四捨五入。

同一角色有多個攻擊技能時，先將角色取得的攻擊份額平均分給各攻擊技能，再依各技能的 `attackMasterySplits` 分配；Assembler 將結果彙總成 `CombatSequenceMemberSnapshot.attackMasterySplits`，Sequence 結算時不再讀活資料。

---

## 4. Runtime State

```ts
type CombatSequence = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  ruleId: CombatSequenceRuleId;

  allocationSnapshot: CombatSequenceAllocationSnapshot;
  teamPower: number;
  challengeOrder: CombatSequenceChallengeId[];
  challenges: Record<CombatSequenceChallengeId, CombatSequenceChallengeSnapshot>;
  cursor: number;
  results: Record<CombatSequenceChallengeId, CombatSequenceChallengeResult>;

  status: 'active' | 'awaitingSourceCommit' | 'settled' | 'invalid';
  terminationReason?: 'allResolved' | 'challengeFailed' | 'hostStopped' | 'sourceInvalidated';
  settlement?: CombatSequenceSettlementRecord;
  startedOnDay: WorldDay;
  endedOnDay?: WorldDay;
  rngContext: RngContext;
  rngDrawIndex: number;
  revision: Revision;
};

type CombatSequenceChallengeSnapshot = {
  challengeId: CombatSequenceChallengeId;
  order: number;
  encounterGroupId: EncounterGroupDefinitionId;
  sourceRef:
    | { kind: 'singleBattle'; sourceId: CombatSequenceSourceId }
    | {
        kind: 'mapContent';
        mapId: MapInstanceId;
        mapVersion: number;
        contentId: ContentInstanceId;
        contentRevision: Revision;
      };
  enemyPower: number;
  enemyPowerRevisionKey: string;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

type CombatSequenceChallengeResult = {
  resultId: CombatSequenceChallengeResultId;
  challengeId: CombatSequenceChallengeId;
  attemptedOnDay?: WorldDay;
  outcome: 'success' | 'failure' | 'skippedBeforeAttempt';
  attempts: CombatSequenceRollResult[];
  consumedSupplyItemIds: ItemInstanceId[];
};

type CombatSequenceRollResult = {
  attemptIndex: number;
  rngDrawIndex: number;
  successProbability: number;
  roll: number; // [0, 1)
  success: boolean;
};

type CombatSequenceSettlementRecord = {
  sourceCommitId: CombatSequenceSourceCommitId;
  acceptedSuccessfulResultIds: CombatSequenceChallengeResultId[];
  acceptedSuccessfulCount: number;
  totalAttackExperienceBudget: number;
  totalDefenseExperienceBudget: number;
  settledOnDay: WorldDay;
};
```

Challenge 保存開始時已解析的敵方戰力與經驗預算，避免跨日因內容資料重新載入而改變同一串結果。它是本 Aggregate 的運算快照，不宣稱擁有 Map Content 或 Encounter Definition。

### 4.1 不變量

1. 一支 Team 同一時間最多有一筆 `active` 或 `awaitingSourceCommit` Sequence。
2. `challengeOrder` 不可為空、不可重複，`order` 必須從 0 連續遞增；單場掃蕩恰有一筆。沒有怪物內容的 Dungeon 不建立空 Sequence。
3. `cursor` 只可向前；同一 Challenge 最多解析或 skip 一次。
4. Sequence 期間不重算隊伍戰力、不移除成員、不改陣形、不換武器組。
5. 每個 Challenge 的第一次擲骰恰好一次；每次重骰前必須成功消耗一份合法補品。
6. 相對戰力差超過資料門檻時不得使用補品重骰。
7. Challenge 失敗後 Sequence 立即進入 `awaitingSourceCommit`，不得解析後續 Challenge。
8. 只有來源正式接受的成功 Result 才能進入熟練度總和；failure、skip 與競爭失效結果均為 0。
9. `settled` 或 `invalid` Sequence 不得再次發出成長來源。
10. `rngDrawIndex` 只在一個 roll 隨交易提交時增加 1；拒絕交易與 Query 不消耗 RNG。
11. `settled` 必須有且只能有一筆 `settlement`；相同 `sourceCommitId` 重送回傳既有結果，不再次發事件，不同 ID 重送則拒絕。
12. Team Power 的參與者集合必須與 Allocation Snapshot 完全相同；每位成員的武器組也必須與計算該 Power 時相同。

---

## 5. 公開 Query 與純 Resolver

```ts
interface CombatSequenceQuery {
  getSequence(id: CombatSequenceId): CombatSequenceView | undefined;
  getActiveSequenceForTeam(teamId: TeamId): CombatSequenceView | undefined;
  getProgress(id: CombatSequenceId): CombatSequenceProgressView;
}

type CombatSequenceProgressView = {
  sequenceId: CombatSequenceId;
  status: CombatSequence['status'];
  resolvedCount: number;
  challengeCount: number;
  settledSuccessfulCount?: number;
};
```

公開 Query 不回傳未揭露內容、RNG roll、機率或未提交經驗；debug adapter 可在開發模式使用獨立權限讀取診斷 View。

```ts
interface CombatSequenceChallengeResolver {
  resolveInitial(input: CombatSequenceChallengeResolutionInput): CombatSequenceRollResult;
  resolveRetry(input: CombatSequenceChallengeRetryInput): CombatSequenceRollResult;
}

interface CombatSequenceMasteryAllocator {
  allocate(input: CombatSequenceMasteryAllocationInput): CombatSequenceMasteryAllocation;
}

type CombatSequenceChallengeResolutionInput = {
  rule: CombatSequenceRuleDefinition;
  teamPower: number;
  enemyPower: number;
  attemptIndex: 0;
  rngContext: RngContext;
  rngDrawIndex: number;
};

type CombatSequenceChallengeRetryInput = Omit<
  CombatSequenceChallengeResolutionInput,
  'attemptIndex'
> & {
  attemptIndex: number;
  consumedSupplyItemId: ItemInstanceId;
};

type AcceptedCombatSequenceChallengeExperience = {
  resultId: CombatSequenceChallengeResultId;
  attackExperienceBudget: number;
  defenseExperienceBudget: number;
};

type CombatSequenceMasteryAllocationInput = {
  sequenceId: CombatSequenceId;
  rule: CombatSequenceRuleDefinition;
  allocationSnapshot: CombatSequenceAllocationSnapshot;
  acceptedChallenges: AcceptedCombatSequenceChallengeExperience[];
};

type MasteryExperienceAmount = {
  characterId: CharacterId;
  masteryId: MasteryId;
  amount: number;
};

type CombatSequenceSupportAward = {
  characterId: CharacterId;
  skillId: SkillDefinitionId;
  supportMasteryAwardRuleId: SupportMasteryAwardRuleId;
  creditedUseCount: number;
};

type CombatSequenceMasteryAllocation = {
  attackAwards: MasteryExperienceAmount[];
  defenseAwards: MasteryExperienceAmount[];
  supportAwards: CombatSequenceSupportAward[];
};
```

兩者都是無 State、無 I/O 的純函式。Resolver 只吃明確 RNG Cursor；Allocator 只吃已接受的成功結果和開始快照。所有需要整數化的預算先依精確比例計算，再採最大餘數法；餘數同值時以 `characterId`、`masteryId` 的穩定順序分配，確保總發放量等於原預算。

---

## 6. 輸入契約

### 6.1 Internal Command

| Internal Command | 呼叫者 | Combat Sequence 的責任 |
|---|---|---|
| `StartCombatSequence` | dungeon／single-battle-sweep workflow | 驗證快照與 Challenge 順序，建立 active Sequence。 |
| `ResolveNextCombatSequenceChallenge` | dungeon／single-battle-sweep workflow | 只解析 cursor 指向的 Challenge；必要時經補品 Workflow 重骰。 |
| `SkipNextCombatSequenceChallenge` | dungeon | 來源在嘗試前已不可用時不耗 RNG、不給經驗並前進。 |
| `StopCombatSequence` | host workflow | 不再解析後續節點，轉為等待來源提交。 |
| `CommitCombatSequenceSourceResults` | dungeon settlement／single-battle source workflow | 接收來源正式接受的成功 Result ID，計算一次成長並結束。 |
| `InvalidateCombatSequence` | dungeon／team／save migration | 標為 invalid；不得發經驗。 |
| `ReleaseCombatSequence` | host workflow | Host 已保存所需結果且不再引用時，移除 settled／invalid Aggregate。 |

```ts
type StartCombatSequence = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  ruleId: CombatSequenceRuleId;
  allocationSnapshot: CombatSequenceAllocationSnapshot;
  teamPowerSnapshot: TeamCombatPowerSnapshot;
  challenges: CombatSequenceChallengeSnapshot[];
  rngContext: RngContext;
};

type ResolveNextCombatSequenceChallenge = {
  sequenceId: CombatSequenceId;
  expectedChallengeId: CombatSequenceChallengeId;
  attemptedOnDay: WorldDay;
};

type SkipNextCombatSequenceChallenge = {
  sequenceId: CombatSequenceId;
  expectedChallengeId: CombatSequenceChallengeId;
  reason: 'sourceUnavailableBeforeAttempt';
};

type CombatSequenceStopReason = 'allResolved' | 'challengeFailed' | 'hostStopped';

type StopCombatSequence = {
  sequenceId: CombatSequenceId;
  reason: CombatSequenceStopReason;
};

type CombatSequenceInvalidReason =
  | 'sourceInvalidated'
  | 'teamUnavailable'
  | 'snapshotRevisionConflict'
  | 'saveMigrationInvalidated';

type InvalidateCombatSequence = {
  sequenceId: CombatSequenceId;
  reason: CombatSequenceInvalidReason;
};

type ReleaseCombatSequence = {
  sequenceId: CombatSequenceId;
  expectedRevision: Revision;
};
```

`ReleaseCombatSequence` 只接受 `settled` 或 `invalid`；active／awaiting Sequence 不得清除。長期歷史由 committed event log／debug export 負責，Save State 不永久累積已結束戰鬥串。

### 6.2 補品重骰 Workflow

```text
第一次擲骰失敗
  → abs(teamPower - enemyPower) / max(enemyPower, 1) <= retryRelativePowerGapMaximum
  → retryCount < maxRetryCountPerChallenge
  → Inventory Query 找到合法且未保留的補品
  → Combat Sequence 送出 ConsumeCombatSequenceRetrySupply
  → Inventory 成功消耗一份
  → 使用同一 Sequence RNG Stream 的下一個值重骰
  → 成功即停止；再次失敗則依資料上限判定是否還能重骰
```

補品選擇按 `RetrySupplyPolicyDefinition` 決定並以穩定 ID 破同值，不讀 UI 排序。若 Inventory 拒絕消耗，該次重骰不發生、RNG 不前進，Challenge 保持失敗。

```ts
interface CombatSequenceSupplyQuery {
  listEligibleRetrySupplies(input: {
    teamId: TeamId;
    participantCharacterIds: CharacterId[];
    policyId: RetrySupplyPolicyId;
  }): RetrySupplyCandidate[];
}

type RetrySupplyCandidate = {
  itemId: ItemInstanceId;
  ownerCharacterId: CharacterId;
  availableQuantity: number;
  unitValue: number;
};
```

隊伍沒有共用背包；候選補品來自開始快照中的正式參與者個人背包。自動選擇最低價合法品，同價以 `itemId` 穩定排序，因此被消耗的是明確角色的真實物品。

### 6.3 對 Inventory 的輸出命令

```ts
type ConsumeCombatSequenceRetrySupply = {
  sequenceId: CombatSequenceId;
  challengeId: CombatSequenceChallengeId;
  teamId: TeamId;
  itemId: ItemInstanceId;
  quantity: 1;
};
```

Inventory 成功後發出 `CombatSequenceRetrySupplyConsumed`；此事件與下一次重骰必須位於同一 Engine Transaction。Sequence 不可先記錄重骰成功再事後扣道具。

### 6.4 單一 Challenge 狀態轉移

```text
ResolveNextCombatSequenceChallenge
  → 驗證 active、cursor、來源與快照 revision
  → 取一個 RNG 值做第一次戰力骰
  → 成功：記 success，cursor + 1
  → 失敗且符合重骰：先消耗補品，再取下一個 RNG 值
  → 最終成功：記 success，cursor + 1
  → 最終失敗：記 failure，status = awaitingSourceCommit
  → cursor 已到尾端：status = awaitingSourceCommit
  → emit CombatSequenceChallengeResolved
  → 若轉為 awaiting，再 emit CombatSequenceReadyForSourceCommit
```

`SkipNextCombatSequenceChallenge` 記錄 `skippedBeforeAttempt` 並前進 cursor，但不消耗 RNG、補品或經驗；skip 後到達尾端時同樣進入 `awaitingSourceCommit`。

---

## 7. 來源提交與整串熟練度結算

### 7.1 為何成功擲骰不能立刻發經驗

NPC Dungeon 的內容在整趟結束時才由 Map 正式套用；在此之前，玩家或更早結算的隊伍可能已拿走同一怪物內容。因此 Sequence 先保存每筆成功 Result，來源提交時再傳入實際接受的 Result ID。

```ts
type CommitCombatSequenceSourceResults = {
  sequenceId: CombatSequenceId;
  acceptedSuccessfulResultIds: CombatSequenceChallengeResultId[];
  sourceCommitId: CombatSequenceSourceCommitId;
  committedOnDay: WorldDay;
};
```

`acceptedSuccessfulResultIds` 必須是本 Sequence 中 outcome 為 `success` 的子集合，不得含失敗、skip 或其他 Sequence 的 Result。

### 7.2 攻擊經驗

```text
總攻擊預算 = Σ(所有 accepted success Challenge.attackExperienceBudget)

角色攻擊份額 =
  總攻擊預算 × 角色 attackWeightUnits / 全隊 attackWeightUnits 總和

各 Mastery 份額 =
  角色攻擊份額 × allocationSnapshot.attackMasterySplits[masteryId]
```

全隊攻擊權重為 0 時，不發攻擊 MXP，不得除以 0，也不得把預算改分給無攻擊技能角色。

### 7.3 防禦經驗

```text
總防禦預算 = Σ(所有 accepted success Challenge.defenseExperienceBudget)
```

以 Sequence 開始時的 `formationCell` 排序，略過完全無人的排：

- 第一個有人排：該排每人權重 3。
- 第二個有人排：該排每人權重 2。
- 第三個有人排：該排每人權重 1。

```text
角色防禦份額 =
  總防禦預算 × 角色列權重 / 全體角色列權重總和
```

再依該角色快照中的 `defenseMasterySplits` 送入既定 Mastery；Sequence 不以穿戴裝備臨時猜測去向。

### 7.4 無傷害技能額外經驗

```text
正式成功場次 = acceptedSuccessfulResultIds.length
```

每位成員快照中的每個 `supportSkills` 都視為每個正式成功 Challenge 使用一次：

```text
該技能 creditedUseCount = 正式成功場次
固定額外 MXP = fixedExperiencePerUse × creditedUseCount
```

這裡沒有「整串最多 3 次」；三次上限只屬 detailed Encounter 中同一技能的真實使用。簡易戰鬥串是每場最多一次，五場正式勝利即可得到五次。

### 7.5 輸出成長事件

| Event | 最少 payload | 訂閱者 |
|---|---|---|
| `CombatSequenceChallengeResolved` | `sequenceId`、`teamId`、`challengeId`、`resultId`、`sourceRef`、`outcome` | dungeon／single-battle-sweep workflow、quest、debug。 |
| `CombatSequenceReadyForSourceCommit` | `sequenceId`、`teamId`、`terminationReason` | dungeon／single-battle-sweep workflow。 |
| `CombatSequenceSettled` | `sequenceId`、`teamId`、`source`、`terminationReason`、`acceptedSuccessfulCount`、總經驗預算 | dungeon、team、ui/app。 |
| `CombatAttackMasteryEarned` | `source: { kind: combatSequence, sequenceId }`、`characterAwards` | progression。 |
| `CombatDefenseMasteryEarned` | `source: { kind: combatSequence, sequenceId }`、`characterAwards` | progression。 |
| `CombatSupportMasteryEarned` | `source: { kind: combatSequence, sequenceId }`、`characterId`、`skillId`、`supportMasteryAwardRuleId`、`creditedUseCount` | progression。 |
| `CombatSequenceInvalidated` | `sequenceId`、`teamId`、`reason` | host workflow、ui/app。 |

詳細 Combat 與 Combat Sequence 共用三種 `*MasteryEarned` Event 名稱，但 `source` 是 discriminated union：

```ts
type CombatMasterySource =
  | { kind: 'encounter'; encounterId: EncounterId }
  | { kind: 'combatSequence'; sequenceId: CombatSequenceId };

type CombatSequenceChallengeResolvedPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  challengeId: CombatSequenceChallengeId;
  resultId: CombatSequenceChallengeResultId;
  sourceRef: CombatSequenceChallengeSnapshot['sourceRef'];
  outcome: CombatSequenceChallengeResult['outcome'];
};

type CombatSequenceReadyForSourceCommitPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  terminationReason: Exclude<CombatSequence['terminationReason'], 'sourceInvalidated' | undefined>;
};

type CombatSequenceSettledPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  source: CombatSequenceSource;
  terminationReason: Exclude<CombatSequence['terminationReason'], 'sourceInvalidated' | undefined>;
  acceptedSuccessfulCount: number;
  totalAttackExperienceBudget: number;
  totalDefenseExperienceBudget: number;
};

type CombatAttackMasteryEarnedPayload = {
  source: CombatMasterySource;
  characterAwards: MasteryExperienceAmount[];
};

type CombatDefenseMasteryEarnedPayload = {
  source: CombatMasterySource;
  characterAwards: MasteryExperienceAmount[];
};

type CombatSupportMasteryEarnedPayload = CombatSequenceSupportAward & {
  source: CombatMasterySource;
};

type CombatSequenceInvalidatedPayload = {
  sequenceId: CombatSequenceId;
  teamId: TeamId;
  reason: CombatSequenceInvalidReason;
};
```

Progression 不需要知道來源是玩家或 NPC，只依已驗證的 Character Award 套用 MXP。

---

## 8. Dungeon 整合

```text
StartNpcDungeonRun
  → Dungeon 依 Map npcOrder 取得所有怪物 Content
  → 建立一筆 dungeonSweep Combat Sequence
  → NpcDungeonRun 只保存 combatSequenceId

npcDungeonDay 走到怪物 Content
  → Dungeon 驗證點數並扣除該內容 pointCost
  → ResolveNextCombatSequenceChallenge
  → 成功：Dungeon 暫存 Content 結果並繼續
  → 失敗：Dungeon 停止 Run，進入 settling

Run 全清／首次失敗／目標完成
  → ApplyNpcDungeonSettlement
  → Map 回傳 appliedResults／skippedResults
  → Dungeon 將 applied 的成功戰鬥 Result ID
    送入 CommitCombatSequenceSourceResults
  → Combat Sequence 一次發出整串 Mastery 成長來源
```

Dungeon 的每日十點仍可能跨多日呼叫 Sequence，但每個怪群只執行純戰力擲骰；沒有 HP、技能、個體怪物或逐角色迴圈。寶箱、事件與採集不進 Combat Sequence。

若 Dungeon 在嘗試某怪物前發現內容已正式被處理，必須同步 `SkipNextCombatSequenceChallenge`，保持兩個游標一致。Map Settlement 再競爭失效的成功結果則由 accepted Result ID 過濾。

`NpcDungeonRun` 關閉前必須同時滿足：

1. Map Settlement 已完成。
2. Combat Sequence 已 settled 或 invalid。
3. Asset Distribution 已完成。

Run 關閉並不再需要查詢戰鬥進度後，Dungeon Workflow 送出 `ReleaseCombatSequence`；不得由 Combat Sequence 猜測 Host 是否已完成而自行刪除。

---

## 9. 單場掃蕩整合

```ts
type StartSingleBattleSweep = GameCommandEnvelope & {
  type: 'startSingleBattleSweep';
  teamId: TeamId;
  sourceId: CombatSequenceSourceId;
  encounterGroupId: EncounterGroupDefinitionId;
  selectedWeaponSetIds?: Record<CharacterId, WeaponSetId>;
  expectedSourceRevision: Revision;
};
```

Command 由 `app/workflows/single-battle-sweep` 處理，不由 detailed Combat Handler 接收。來源必須明確允許掃蕩、隊伍不在 detailed Encounter／其他 Sequence、參戰者與武器組合法；省略的角色武器組使用最高 Combat Power 合法組。第一版補品重骰依自動 Policy，不開玩家確認 Pending Interaction。

```text
玩家選擇掃蕩一場可掃蕩戰鬥
  → single-battle-sweep workflow 驗證來源與隊伍
  → 建立恰有一個 Challenge 的 Combat Sequence
  → 立即 ResolveNextCombatSequenceChallenge
  → 來源模組正式提交成功／失敗結果
  → CommitCombatSequenceSourceResults
  → Sequence 當次交易完成或等待必要互動後結束
```

單場掃蕩不建立 Dungeon Run、不取得每日十點，也不產生迷宮時間。若未來改為讓玩家確認是否使用補品，Workflow 可以開 Pending Interaction；核心 Sequence 的重骰資格、消耗與 RNG 規則不變。

---

## 10. 驗收測試與交接清單

最低必須提供：

1. 一節點單場掃蕩成功／失敗並只結算一次的測試。
2. 多節點串成功兩場、第三場失敗，後續節點不解析的測試。
3. 相對戰力差恰為 15% 可重骰、超過 15% 不可重骰的邊界測試。
4. 每次重骰先成功消耗一份補品；消耗拒絕時不前進 RNG 的交易測試。
5. 同 seed、快轉、存讀檔後得到相同 roll 與結果的測試。
6. 1、2、3 招技能組得到正確 6、3／6、2／4／6 權重的測試。
7. 全隊權重 6／4／0 時只由前兩人取得 6/10、4/10 攻擊預算的測試。
8. 防禦 3／2／1 有人排權重與空排略過的測試。
9. 五場 accepted success 令每個合法支援技能取得五次固定經驗，而不是被 detailed 的三次上限截斷。
10. Map 只接受部分成功 Result 時，攻擊／防禦預算與場次只計 accepted 子集的測試。
11. 同一 `sourceCommitId` 重送不重複發 MXP的冪等測試。
12. Sequence 期間 Team／Loadout Revision 改變時拒絕外部修改或使 Sequence 明確 invalid，不可靜默重建快照。
13. Dungeon 多日呼叫與一日連續呼叫產生相同最終 Settlement 的測試。
14. `settled`／`invalid` 後不能再解析、重骰或提交的測試。
15. Host 尚未關閉時保留 settled Sequence；Host 明確 release 後移除，active／awaiting 不可移除的測試。
16. 任一 `CombatSequenceChallengeResolved(outcome=failure)` 由 Quest 在同一交易終止該 `teamId` 全部進行中的護衛委託；後續 settled／重送事件不得重複終止的測試。

交接物：

- [ ] Combat Sequence Rule、Retry Supply Policy 與窄化 Encounter／Skill JSON Schema。
- [ ] `CombatSequenceState`、Aggregate、Challenge、Result、Allocation Snapshot Save Schema 與 migration。
- [ ] `CombatSequenceQuery`、`CombatPowerQuery` 與 Snapshot Assembler。
- [ ] Challenge Resolver、Mastery Allocator 與 deterministic RNG fixture。
- [ ] Start／Resolve／Skip／Stop／Commit／Invalidate／Release Internal Command Handler。
- [ ] 補品消耗 Workflow、Dungeon Workflow 與單場掃蕩 Workflow 契約測試。
