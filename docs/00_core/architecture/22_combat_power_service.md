# Combat Power 純計算契約

> **技術元件：** `domain-services/combat-power`
>
> **依賴：** Statistics、Progression、Inventory、Team 與 Combat 的公開 Snapshot DTO，以及 Data Runtime 編譯出的 Combat Power Definition Reader。
>
> **責任：** 依同一份資料規則，把角色能力、合法武器組、技能配置、裝備效果與陣形編譯成可比較的角色／隊伍／敵方戰力；提供任務評估、NPC 換裝與 Combat Sequence 使用的唯讀結果。
>
> **非責任：** 不擁有 State、不選擇 NPC 行動、不擲戰鬥成功骰、不消耗補品、不發熟練度、不模擬 HP／技能施放，也不以品級、詞條數或物品價格直接判斷強弱。

---

## 1. 邊界與唯一真相

Combat Power 是可丟棄的衍生值，不是 Team、Character 或 Inventory 的權威欄位。所有呼叫者必須使用本服務；禁止另寫「任務戰力」、「NPC 換裝分數」或「掃蕩戰力」公式。

```ts
type CombatPowerRuleId = Brand<DefinitionId, 'CombatPowerRuleId'>;
type CombatPowerFeatureRuleId = Brand<DefinitionId, 'CombatPowerFeatureRuleId'>;
type CombatPowerFeatureId = Brand<DefinitionId, 'CombatPowerFeatureId'>;
type CombatCapabilityId = Brand<DefinitionId, 'CombatCapabilityId'>;
type EquipmentLoadoutCandidateId = Brand<string, 'EquipmentLoadoutCandidateId'>;
```

```text
Progression／Character／Inventory／Team Snapshot
  → app/composition 組成 Combat Power Input
  → CombatPowerCalculator（純函式）
  → CombatPowerQuery（唯讀 Facade，可快取）
  → 任務可行性／NPC 換裝／Combat Sequence
```

Detailed Combat 仍依真實能力與技能逐步解析，不以戰力值代替戰鬥；但它與本服務必須讀同一份 Statistics、Equipment、Skill 與 Monster Definition 來源。

---

## 2. 靜態資料契約

### 2.1 Definition Reader

```ts
interface CombatPowerDefinitionReader {
  getRule(id: CombatPowerRuleId): CombatPowerRuleDefinition;
  getFeatureRule(id: CombatPowerFeatureRuleId): CombatPowerFeatureRuleDefinition;
  getSkillView(id: SkillDefinitionId): CombatPowerSkillDefinitionView;
  getEquipmentEffectView(id: EquipmentEffectDefinitionId): CombatPowerEquipmentEffectView;
}
```

Skill 與 Equipment Effect 仍各只有一份作者資料；Data Runtime 只把原始 Definition 編譯成 Combat Power 所需的窄化 View。

### 2.2 戰力規則

```ts
type CombatPowerRuleDefinition = DefinitionHeader & {
  statisticsRuleId: StatisticsRuleId;
  featureRuleIds: CombatPowerFeatureRuleId[];
  unitAggregationResolverId: ResolverId;
  teamFormationResolverId: ResolverId;
  teamAggregation: 'sumMembersThenFormation';
  encounterAggregation: 'sumMembersThenFormation';
  minimumPower: number;
  rounding: 'roundHalfUpAtFinalOutput';
};

type CombatPowerFeatureRuleDefinition = DefinitionHeader & {
  featureId: CombatPowerFeatureId;
  source: CombatPowerFeatureSource;
  coefficient: number;
  transformResolverId?: ResolverId;
};

type CombatPowerFeatureSource =
  | { kind: 'primaryAttribute'; attributeId: PrimaryAttributeId }
  | { kind: 'secondaryAttribute'; attributeId: SecondaryAttributeId }
  | { kind: 'maximumResource'; resource: 'health' | 'mana' }
  | { kind: 'skillCapability'; capabilityId: CombatCapabilityId }
  | { kind: 'equipmentEffectCapability'; capabilityId: CombatCapabilityId };
```

`coefficient`、Feature 組合與 Resolver 都在 `content/*/rules/`；Handler 不可出現散落的戰力倍率。`transformResolverId` 只可引用 Data Runtime 已註冊、輸入輸出 Schema 固定且無 I/O／RNG 的純 Resolver。

### 2.3 Skill／Equipment Effect 窄化 View

```ts
type CombatPowerCapabilityContribution = {
  capabilityId: CombatCapabilityId;
  baseValue: number;
  scalingResolverId?: ResolverId;
};

type CombatPowerSkillDefinitionView = {
  skillId: SkillDefinitionId;
  weaponRequirementIds: WeaponRequirementId[];
  capabilityContributions: CombatPowerCapabilityContribution[];
  sourceRevisionKey: string;
};

type CombatPowerEquipmentEffectView = {
  equipmentEffectId: EquipmentEffectDefinitionId;
  triggerEligibility: 'alwaysWhileEquipped' | 'configuredSkillCompatible';
  requiredSkillTagIds: SkillTagId[];
  capabilityContributions: CombatPowerCapabilityContribution[];
  sourceRevisionKey: string;
};
```

- 武器與防具的主／副屬係數已反映在 Statistics Snapshot，不可再次加入。
- 只有無法由 Statistics 表達的技能覆蓋、支援、控制與裝備條件效果，才進 Capability Contribution。
- 裝備效果必須先通過武器組與技能 Tag 條件，不能因為 Item Instance 存在就計分。
- 物品品級、品質前綴、素材詞條數與售價都不是直接 Feature；它們只能透過最終能力或合法效果間接改變戰力。

---

## 3. 純計算輸入與輸出

### 3.1 單位輸入

```ts
type CombatPowerUnitInput = {
  unitRef:
    | { kind: 'character'; characterId: CharacterId }
    | { kind: 'monster'; monsterDefinitionId: MonsterDefinitionId; memberIndex: number };
  statistics: CombatUnitStatisticsSnapshot;
  selectedWeaponSetId?: WeaponSetId;
  configuredSkills: CombatPowerSkillDefinitionView[];
  activeEquipmentEffects: CombatPowerEquipmentEffectView[];
  sourceRevisionKey: string;
};

type CombatUnitStatisticsSnapshot = Pick<
  CharacterStatisticsSnapshot,
  | 'effectivePrimaryAttributes'
  | 'secondaryAttributes'
  | 'maxHealth'
  | 'maxMana'
  | 'sourceRevisionKey'
>;

type CombatPowerUnitSnapshot = {
  unitRef: CombatPowerUnitInput['unitRef'];
  combatPowerRuleId: CombatPowerRuleId;
  totalPower: number;
  featureBreakdown: CombatPowerFeatureAmount[];
  sourceRevisionKey: string;
};

type CombatPowerFeatureAmount = {
  featureId: CombatPowerFeatureId;
  amountBeforeCoefficient: number;
  coefficient: number;
  weightedAmount: number;
};
```

Monster 由 Combat Definition Compiler 產生與角色相同形狀的 Statistics Snapshot；不得因為是 Monster 就走另一套無法比較的分數。`memberIndex` 讓同一 Definition 在 Encounter 中重複出現時仍有穩定識別。

### 3.2 隊伍與敵方編組

```ts
type CombatPowerFormationMember = {
  unit: CombatPowerUnitInput;
  anchorCell: GridCell;
  occupiedCells: GridCell[];
};

type TeamCombatPowerCalculationInput = {
  teamId: TeamId;
  ruleId: CombatPowerRuleId;
  members: CombatPowerFormationMember[];
  formationRevision: Revision;
  sourceRevisionKey: string;
};

type EncounterCombatPowerCalculationInput = {
  encounterGroupId: EncounterGroupDefinitionId;
  ruleId: CombatPowerRuleId;
  members: CombatPowerFormationMember[];
  encounterDefinitionRevisionKey: string;
};

type TeamCombatPowerSnapshot = {
  teamId: TeamId;
  participantCharacterIds: CharacterId[];
  combatPowerRuleId: CombatPowerRuleId;
  memberPowers: CombatPowerUnitSnapshot[];
  formationModifier: number;
  totalPower: number;
  sourceRevisionKey: string;
};

type EncounterCombatPowerSnapshot = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
  memberPowers: CombatPowerUnitSnapshot[];
  formationModifier: number;
  totalPower: number;
  sourceRevisionKey: string;
};
```

`TeamCombatPowerCalculationInput.members` 必須由 Team Query 的正式成員與持久配置組合而成，且恰好包含該 Team 當下全部 1～9 名正式成員各一次。呼叫者不能自行挑選參與者；不存在候補、留城或只取部分隊員計算戰力的路徑。護衛角色與救援等任務暫時角色不屬於正式成員，因此不進入隊伍戰力。

第一版隊伍與 Encounter 都先加總成員，再套用同一 Formation Resolver。大型／中型單位的占格已在 `occupiedCells` 表達，不得因為 3×3 占九格就把同一 Boss 加總九次。

### 3.3 Calculator

```ts
interface CombatPowerCalculator {
  calculateUnit(
    input: Readonly<CombatPowerUnitInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): CombatPowerUnitSnapshot;

  calculateTeam(
    input: Readonly<TeamCombatPowerCalculationInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): TeamCombatPowerSnapshot;

  calculateEncounter(
    input: Readonly<EncounterCombatPowerCalculationInput>,
    rule: Readonly<CombatPowerRuleDefinition>,
  ): EncounterCombatPowerSnapshot;
}
```

Calculator 無 State、無 I/O、無 RNG。所有中間值保留完整精度，只在最終 `totalPower` 套用資料指定的 rounding；Breakdown 供測試、平衡工具與 Debug 使用，不存入 Save。

---

## 4. Application Query Facade

```ts
interface CombatPowerQuery {
  getCharacterPower(input: CharacterCombatPowerQueryInput): CombatPowerUnitSnapshot;
  getTeamPower(input: TeamCombatPowerInput): TeamCombatPowerSnapshot;
  getEncounterPower(input: EncounterCombatPowerQueryInput): EncounterCombatPowerSnapshot;
  assessQuestFeasibility(input: NpcQuestFeasibilityInput): NpcQuestFeasibility;
  compareLoadouts(input: EquipmentLoadoutPowerComparisonInput): EquipmentLoadoutPowerComparisonResult;
}

type NpcQuestFeasibilityInput = {
  teamId: TeamId;
  questId: QuestId;
  objective: QuestObjectiveView;
  assessedOnDay: WorldDay;
  combatPowerRuleId: CombatPowerRuleId;
};

type NpcQuestFeasibility = {
  canAttempt: boolean;
  powerScore: number;
  expectedSuccess: number; // 0..1；只供資料權重與 UI／debug，不保證實際結果
  riskBand: 'trivial' | 'favorable' | 'even' | 'dangerous' | 'impossible';
  reason?: 'insufficientPower' | 'noUsableMembers' | 'unsupportedObjective';
};

type CharacterCombatPowerQueryInput = {
  characterId: CharacterId;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[];
  combatPowerRuleId: CombatPowerRuleId;
};

type TeamCombatPowerInput = {
  teamId: TeamId;
  formationRevision: Revision;
  selectedWeaponSetIds: Record<CharacterId, WeaponSetId>;
  combatPowerRuleId: CombatPowerRuleId;
};

type EncounterCombatPowerQueryInput = {
  encounterGroupId: EncounterGroupDefinitionId;
  combatPowerRuleId: CombatPowerRuleId;
};

type EquipmentLoadoutPowerComparisonInput = {
  characterId: CharacterId;
  candidates: EquipmentLoadoutPowerCandidate[];
  combatPowerRuleId: CombatPowerRuleId;
};

type EquipmentLoadoutPowerCandidate = {
  candidateId: EquipmentLoadoutCandidateId;
  equipmentLoadout: CharacterEquipmentLoadoutView;
  selectedWeaponSetId: WeaponSetId;
  configuredSkillIds: SkillDefinitionId[];
};

type EquipmentLoadoutPowerComparisonResult = {
  candidates: Array<{
    candidateId: EquipmentLoadoutCandidateId;
    power: number;
    sourceRevisionKey: string;
  }>;
  highestPowerCandidateId?: EquipmentLoadoutCandidateId;
};
```

`CombatPowerQuery` 位於 `app/composition`，負責使用窄化 Query 取得 Snapshot、組成 Calculator Input 與管理可丟棄 Cache；它不是新的 Domain State。`getTeamPower` 依 `teamId` 從 Team Query 取得全部正式成員與配置，呼叫端不能傳入參與者子集；`selectedWeaponSetIds` 也必須恰好涵蓋該批正式成員。`assessQuestFeasibility` 只把同一隊伍／目標戰力快照轉成任務候選權重，不保證實際通關。`compareLoadouts` 使用同一 Calculator 重算候選完整裝備／武器組／技能配置，並以「戰力高、再以 Candidate ID 穩定排序」選出第一名。NPC 可比較目前配置與換上一件新物品後的候選；Combat Sequence 則可用只改變 Weapon Set 的候選取得預設組合。

Query Facade 必須拒絕：

- 非隊員、死亡或當下不可參戰的 Character。
- 不存在、未持有或裝備位置不合法的武器組。
- 未學會、武器需求不符或超過配置上限的技能。
- Team／Encounter 與 Rule 使用不同 Statistics Rule 或 Combat Power Rule。
- Team 的正式成員、配置與所選武器組 Character ID 集合不完全相等，或混入護衛／救援等任務暫時角色。

---

## 5. Revision、Cache 與 Sequence 快照

`sourceRevisionKey` 至少包含：

- Content Manifest Identity。
- Combat Power Rule 與所有 Feature／Resolver 的 Revision。
- Statistics Rule Revision。
- Character／Mastery／Condition Revision。
- Equipment Item Instance、Affix、武器組與技能配置 Revision。
- Team Formation Revision；Encounter 則包含 Encounter、Monster 與 Placement Revision。

Application Cache Key 必須包含完整 Query Input 與上述 Revision；任何一項改變即可丟棄舊值。Cache 不進 Save。

Combat Sequence 開始時保存 `TeamCombatPowerSnapshot.totalPower`、`sourceRevisionKey` 與 Encounter Power Snapshot 的對應值；整串期間不重算。若開始交易未能同時鎖定配置快照與 Sequence，必須拒絕開始，不得先建 Sequence 再補資料。

---

## 6. 與其他模組的介面

| 呼叫者 | 使用方式 | 禁止行為 |
|---|---|---|
| combat-sequence | 開始時取得一次 Team 與每個 Challenge 戰力快照。 | 串中重算、直接讀 Team／Inventory State。 |
| combat | Detailed Encounter 只讀同源能力與 Definition，不擁有任務可行性 Port。 | 建立第二套 NPC 戰力公式。 |
| npc-behavior | 直接呼叫 `assessQuestFeasibility`，並只讀候選 Loadout 比較結果。 | 自己加品級、價格或職業偏好分數當戰力。 |
| inventory／crafting | NPC 比較換裝時由 Workflow 呼叫 `compareLoadouts`。 | Inventory 在 Entity 內保存權威戰力。 |
| ui/app | 顯示總值與 Breakdown，或做裝備預覽。 | 在 View 重算公式。 |

---

## 7. Data Runtime 驗證

1. 每個 Combat Power Rule 的 Statistics Rule、Feature Rule 與 Resolver 引用都必須存在。
2. Feature ID 在同一 Rule 中不得重複；係數、最小戰力與 Capability Base Value 必須是有限非負數。
3. Transform、Unit Aggregation 與 Formation Resolver 必須符合各自固定的 Input／Output Schema，且不得註冊 RNG、Clock、I/O 或 State 存取。
4. 每個可配置戰鬥 Skill 都必須能編譯出 Combat Power Skill View；沒有額外 Capability 時使用空陣列，不可用缺值代表錯誤。
5. Equipment Effect 的觸發條件必須能由已選武器組與已配置技能完全判定。
6. Team 與 Encounter 的 `totalPower` 必須為有限且不低於 `minimumPower` 的數值。
7. 同一 Rule 的角色與 Monster 必須共享 Feature Rule；禁止建立不可比較的陣營專用倍率。
8. Team Input 的正式成員、Formation Member 與所選武器組 Character ID 集合必須完全相等，且人數為 1～9；不得缺員、加入候補或任務暫時角色。

---

## 8. 測試與交接清單

1. 相同 Input、Rule 與 Revision 必須得到逐位相同的 Snapshot 與 Breakdown。
2. 裝備係數只透過 Statistics 計入一次；Equipment Effect Capability 另行計入一次。
3. 未滿足武器／Tag 條件的技能與裝備效果不得提供戰力。
4. 同一 Boss 無論占 3×3 或以一個 anchor 表示，都只計一個 Unit。
5. 候選 Loadout 同分時必須以穩定 ID 得到相同結果。
6. NPC 換裝、任務評估、單場掃蕩與地牢掃蕩必須取得相同 Rule 下的一致戰力。
7. 任一相關 Revision 改變後 Cache 必須失效；Sequence 已保存的快照不得改變。
8. `getTeamPower` 無法由呼叫端指定部分成員；少一名正式成員、多一名護衛角色或武器組清單不完整時均拒絕組合 Input 的測試。

實作交接：

- [ ] Combat Power Rule／Feature Rule JSON Schema 與 Resolver Schema。
- [ ] Skill／Equipment Effect 的 Combat Power Compiler View。
- [ ] Unit／Team／Encounter Calculator 與 deterministic fixtures。
- [ ] `CombatPowerQuery` Facade、Input Assembler 與 revision-aware cache。
- [ ] Loadout 比較與穩定同分規則。
- [ ] Combat Sequence、任務評估、NPC 換裝與 UI Preview 契約測試。
