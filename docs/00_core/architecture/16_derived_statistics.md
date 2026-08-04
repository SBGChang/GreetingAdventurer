# Derived Statistics 純計算契約

> **技術元件：** `domain-services/statistics`
>
> **依賴：** Progression／Character／Inventory 的公開 Snapshot DTO，以及 Data Runtime 編譯出的 Statistics Definition Reader。
>
> **責任：** 以同一套資料化公式計算角色有效主屬、副屬、生命／魔力上限、裝備預覽與一次技能動作所需的能力快照。
>
> **非責任：** 不擁有 State、不讀完整 GameState、不改熟練度／裝備／生命、不決定技能是否命中或造成何種效果。

---

## 1. 為何是無 State 的 Domain Service

副屬同時需要多個真相來源：

| 輸入 | 唯一所有者 |
|---|---|
| 熟練度等級、五項主屬、已學技能 | progression |
| 年齡、聲望與暫時狀態 | character |
| 裝備實體、三組武器與裝備係數 | inventory |
| 係數合成、持握倍率、年齡修正與副屬公式 | statistics definition |

沒有任一來源模組可以宣稱自己擁有完整角色能力。Statistics Service 接收已組好的 immutable input，回傳可重建結果；因此不需要 `StatisticsState` 或 Save Migration。

---

## 2. Definition 契約

```ts
interface StatisticsDefinitionReader {
  getStatisticsRule(id: StatisticsRuleId): StatisticsRuleDefinition;
  getSecondaryAttributeRule(id: SecondaryAttributeId): SecondaryAttributeRuleDefinition;
  getGripRule(id: GripRuleId): GripRuleDefinition;
  getAgeModifierRule(id: AgeModifierRuleId): AgeModifierRuleDefinition;
}

type StatisticsRuleDefinition = DefinitionHeader & {
  primaryAttributeCap: 100;
  secondaryRuleIds: SecondaryAttributeId[];
  gripRuleId: GripRuleId;
  ageModifierRuleId: AgeModifierRuleId;
  reputationContributionRuleId: ResolverId;
};

type SecondaryAttributeRuleDefinition = DefinitionHeader & {
  output: SecondaryAttributeId;
  primaryCoefficients: Partial<Record<PrimaryAttributeId, number>>;
  equipmentCoefficientChannelIds: EquipmentCoefficientChannelId[];
  masteryCoefficientResolverId?: ResolverId;
  finalResolverId: ResolverId;
};
```

第一版至少能定義：

- 物理傷害、魔法傷害、樂器傷害。
- 命中、魔法命中、迴避、預判、格擋。
- 一般減傷、格擋減傷、魔法減傷、樂器減傷。
- 移動相關數值、最大生命與最大魔力。

數值名稱與公式來自 Definition；TypeScript 不為某把武器或某個文化寫特例。

---

## 3. 輸入與輸出 DTO

```ts
type CharacterStatisticsInput = {
  characterId: CharacterId;
  ageDays: number;
  reputation: number;
  primaryAttributesFromMastery: PrimaryAttributes;
  masterySnapshots: MasteryProgressView[];
  conditionModifierRefs: EffectDefinitionId[];
  equipmentLoadout: CharacterEquipmentLoadoutView;
  equipmentDefinitionViews: EquipmentDefinition[];
  statisticsRuleId: StatisticsRuleId;
};

type CharacterStatisticsSnapshot = {
  effectivePrimaryAttributes: PrimaryAttributes;
  secondaryAttributes: Record<SecondaryAttributeId, number>;
  maxHealth: number;
  maxMana: number;
  sourceRevisionKey: string;
};

interface CharacterStatisticsCalculator {
  calculate(input: Readonly<CharacterStatisticsInput>): CharacterStatisticsSnapshot;
  calculateAction(input: Readonly<ActionStatisticsInput>): ActionStatisticsSnapshot;
  previewEquipment(input: Readonly<EquipmentPreviewInput>): EquipmentPreviewResult;
}
```

`app/composition` 的 `CharacterStatisticsInputAssembler` 只負責向三個模組 Query 取 Snapshot 並組 DTO，不含公式。Calculator 才是公式唯一實作。

---

## 4. 既定合成順序

```text
熟練度提供的五項主屬
→ 各項 clamp 0..100
→ 年齡／聲望／狀態形成有效主屬或專用修正
→ 裝備五主屬係數矩陣
→ 持握係數
→ 對應熟練度係數
→ 副屬專用 Resolver 與最終上下限
```

既定持握資料必須能表達：

- 單手／雙手：1.0。
- 雙持左手：0.5。
- 雙持右手：0.35。
- 雙持總輸出為兩手結果相加。

這些值仍放在 `GripRuleDefinition`，測試 Fixture 固定第一版基準。樂器絕對命中、不吃一般減傷，以及樂器減傷讀取頭盔重量與年齡，也由專用 Secondary Rule 表達。

---

## 5. 與 Combat／Character／UI 的邊界

- Character 透過 `CharacterStatsQuery` Adapter 取得 `maxHealth`／`maxMana`，不自行重算。
- Combat 建立 Encounter 時取得 `CharacterStatisticsSnapshot`；Encounter 內使用快照，除非合法戰中行為明確要求重算。
- 裝備畫面使用 `previewEquipment`，但只顯示 Calculator 回傳的差異。
- UI 不可用表格係數自行重算傷害、命中或減傷。
- NPC Combat Estimator 與玩家 Combat 可共用 Calculator，但不得共用可變 Encounter State。

---

## 6. Cache 與可重播性

- `sourceRevisionKey` 由輸入 Entity Revision、Definition Manifest Hash 與 Statistics Rule ID 決定。
- Cache 位於 Application／Query Adapter，永遠可丟棄，不存檔。
- Calculator 不讀系統時間；需要 RNG 的最終戰鬥判定由 Combat 執行，基礎能力計算不得骰 RNG。
- 相同 input 與 Definition 必須得到逐位相同的 JSON 結果。

---

## 7. 不變量與測試

1. 五項主屬最終都介於 0～100。
2. 同一套輸入在 Combat、角色面板與裝備預覽得到相同基準副屬。
3. 雙手、單手與雙持左右手使用正確 Grip Rule。
4. 不同品級裝備的係數總預算只由資料決定。
6. 聲望對魅力的貢獻只套用一次。
7. 樂器傷害與減傷走專用 Rule，不被一般物理減傷誤算。
8. 年齡修正由同一 Age Rule 供角色面板與 Combat 使用。
9. Calculator 無 State、無 I/O、無未注入的全域資料。

---

## 8. 交接清單

- [ ] Statistics、Secondary Attribute、Grip、Age Modifier JSON Schema。
- [ ] `CharacterStatisticsInputAssembler` 的窄化 Query Port。
- [ ] Character／Action／Equipment Preview 三個 Calculator API。
- [ ] Formula Resolver 與資料驗證。
- [ ] Combat、CharacterStatsQuery、UI Preview 的契約測試。
