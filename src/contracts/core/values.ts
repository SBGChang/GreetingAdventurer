// contracts/core/values.ts
// 在地化文字與通知。對應 00_shared_contracts.md §2.2。

import type { JsonScalar, LocalizationKey } from './primitives';
import type {
  CharacterStatusDefinitionId,
  CityId,
  ConditionDefinitionId,
  ContentEventDefinitionId,
  ContentEventInstanceId,
  ContentEventOptionId,
  EffectDefinitionId,
  EncounterPoolId,
  EventId,
  ExperienceAwardRuleId,
  ItemDefinitionId,
  NotificationId,
  PlayerTravelEventBindingRuleId,
  ResolverId,
  RngStreamId,
  WorldFactId,
} from './ids';
import type { DefinitionHeader } from './module';

// core 型別：Definition、Event、Rejection、Notification 與 ViewModel 皆引用它；UI 邊界才依語系解析。
export type LocalizedTextRef = Readonly<{
  key: LocalizationKey;
  params?: Readonly<Record<string, JsonScalar>>;
}>;

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

// Core／Engine 產出的語意通知。UI 顯示模型 UiNotice 由 Application 投影，定義於 UI 契約。
export type Notification = Readonly<{
  id: NotificationId;
  sourceEventId?: EventId;
  message: LocalizedTextRef;
  tone: NotificationTone;
  dedupeKey?: string;
}>;

// ModuleResult 只回傳 Draft；Runner 配發 NotificationId 後才成為正式 Notification。
export type NotificationDraft = Readonly<Omit<Notification, 'id'>>;

// ── 內容事件實例 ────────────────────────────────────────────────────────────
//
// 內容事件（地牢事件房、旅行事件…）在世界裡被實體化後的最小身分。
//
// 這個型別原本在 **contracts/dungeon 與 contracts/team 各有一份**：dungeon 那份自己標著
// `[EXTERNAL PLACEHOLDER] 由內容/事件模組擁有`，team 那份標著「擁有者待定」。兩份形狀還不一樣
// （team 那份少了 definitionId）——正是 check-contract-duplicates 在防的影子型別：同一個概念
// 兩個宣告，跨模組傳遞時編譯器看不出不匹配。
//
// 放在 core 而不是挑一個模組當擁有者，是因為**沒有**模組擁有它：dungeon 用它表示事件房的 Pending
// 互動、team 用它表示旅行事件，兩邊都只是消費者。它的 ID 家族（ContentEventInstanceId /
// ContentEventDefinitionId）本來就住在 core，實例的形狀跟著回來是一致的。
export type ContentEventInstance = Readonly<{
  instanceId: ContentEventInstanceId;
  definitionId: ContentEventDefinitionId;
  // 該實例專屬的 RNG stream：同一個事件定義在不同實例上必須能得到不同結果，且可重播。
  rngStreamId: RngStreamId;
}>;

// ── Effect：封閉 tagged variant（13_data_runtime.md §6）──────────────────────
//
// 這**不是** expression DSL（那是明文禁止的）。資料只能從有限的 `kind` 裡選一個並填它的欄位，
// 要有新行為就必須改程式。§6.0 的治理原則在此逐條生效：
//   * 一個 kind 一張表：每個 kind 只帶自己的欄位，欄位全部必填（`multiplier?` 是唯一例外，
//     語意是「不指定就用規則自己的倍率」，不是「缺資料」）。
//   * 不得合併成寬表：沒有任何 `value`／`amount` 之類跨 kind 共用的模糊欄位，也沒有
//     `params: Record<string, unknown>`——§6.0 明說那是 Schema 未補齊的末期症狀。
//
// 這個型別原本在 `contracts/character` 是 `Readonly<{ id: EffectDefinitionId }>`——一個只有 ID 的
// 空殼。空殼的後果不是型別鬆而是**功能缺失**：拿到一筆 Effect 也不知道要做什麼，所以事件選項只能
// 一律回報成功（規範 §5「寫死事件成功或失敗」）。

// Effect 的作用範圍。文件未直接定義，但它自己的 condition context 只暴露兩個可指涉範圍
//（`actorCharacterId` 與 `playerTeamId`），所以可作用對象就是這兩個。
export type EffectTarget = 'actor' | 'playerTeam';

export type EffectDefinition = DefinitionHeader<EffectDefinitionId> &
  (
    | Readonly<{ kind: 'grantItem'; target: EffectTarget; itemDefinitionId: ItemDefinitionId; amount: number }>
    | Readonly<{ kind: 'consumeActorItem'; itemDefinitionId: ItemDefinitionId; amount: number }>
    | Readonly<{ kind: 'removeActorCurrency'; amount: number }>
    | Readonly<{
        kind: 'applyStatus';
        target: EffectTarget;
        statusId: CharacterStatusDefinitionId;
        duration: number;
      }>
    | Readonly<{
        kind: 'grantMasteryExperience';
        target: EffectTarget;
        experienceAwardRuleId: ExperienceAwardRuleId;
        multiplier?: number;
      }>
    | Readonly<{ kind: 'startDetailedCombat'; encounterPoolId: EncounterPoolId }>
    | Readonly<{ kind: 'setWorldFact'; factId: WorldFactId; value: JsonScalar }>
    | Readonly<{
        kind: 'changeCityMetric';
        cityId: CityId;
        metric: 'prosperity' | 'safety';
        amount: number;
      }>
  );

export type EffectDefinitionKind = EffectDefinition['kind'];

// ── 內容事件定義（13_data_runtime.md §6.1）──────────────────────────────────

// 選項。`optionId` 只需在所屬 ContentEventDefinition 內唯一，所以任何 Resolver／UI／Handler 都
// 必須連同 definitionId（或 event instanceId）定位，不得把它當全域 Definition ID 用。
export type ContentEventOptionDefinition = Readonly<{
  optionId: ContentEventOptionId;
  visibilityConditionIds: readonly ConditionDefinitionId[];
  eligibilityConditionIds: readonly ConditionDefinitionId[];
  // 選了這個選項會發生什麼。**這是「事件選項固定成功」的解藥**：結果由這裡的 Effect 決定，
  // 不由 Handler 寫死。空陣列是合法的（有些選項就是「什麼都不做地離開」），但那必須是內容
  // 明確寫下的空，不是讀不到資料時的預設。
  effectIds: readonly EffectDefinitionId[];
}>;

export type ContentEventDefinition = DefinitionHeader<ContentEventDefinitionId> &
  (
    | Readonly<{
        context: 'playerTravel';
        triggerConditionIds: readonly ConditionDefinitionId[];
        bindingRuleId?: PlayerTravelEventBindingRuleId;
        options: readonly ContentEventOptionDefinition[];
      }>
    | Readonly<{
        context: 'dungeon' | 'city';
        triggerConditionIds: readonly ConditionDefinitionId[];
        options: readonly ContentEventOptionDefinition[];
        autoResolutionRuleId?: ResolverId;
      }>
  );
