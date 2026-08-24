// app/workflows/content-event-resolution.ts
// 內容事件選項效果的派發（12_engine_runtime.md §「事件選項」把這件事劃給 Application Workflow）。
//
// 這支 Workflow 存在的理由，是 dungeon 那行寫死的成功：
//
//     resolution: { kind: 'contentResolver', resolverId, outcome: 'success' }
//
// 玩家選了哪個選項不影響任何事——規範 §5「寫死事件成功或失敗」、§16 排第 2 的清理項。根因有兩層：
//   1. `EffectDefinition` 曾是只有 ID 的空殼，契約裡沒有可執行的東西（已於前一輪按 §6.1 補齊）。
//   2. 選項效果會作用到 inventory／character／economy／progression／combat／world／city 七個模組。
//      dungeon 不得同步呼叫它們，也不該由它決定跨模組編排——那是 Workflow 的職責。
//
// Workflow 不擁有 Slice：它把選項的 Effect 翻譯成 Internal Command 草稿，交易由 Runner 統一提交
// 或整筆回滾。
//
// ── 為什麼有些 kind 目前一定拒絕 ──────────────────────────────────────────────
//
// 八種 Effect 裡只有三種現在翻得出完整命令。其餘五種缺的**不是這支檔案的邏輯**，而是接收端的
// 命令或查詢還不存在（例如把「消耗 N 個某定義的物品」變成命令，需要先由 Inventory Query 找出
// 玩家實際持有的 instance）。
//
// 那五種一律回傳 typed rejection，**不是靜默略過**。規範 §6 明文禁止「缺少 Internal Command
// Handler 時視為成功」，§10 也要求未閉合的能力不得偽裝成可用。結果是：用到那些 kind 的內容事件
// 會**明確失敗並指出缺什麼**，而不是像現在這樣假裝成功。這是退步嗎？不是——現在是玩家做了選擇
// 卻什麼都沒發生且系統回報成功，那比明確失敗糟得多。

import type {
  CharacterId,
  ContentEventInstanceId,
  EffectDefinition,
  EffectDefinitionId,
  EffectDefinitionKind,
  InternalCommandDraft,
  ModuleId,
  TeamId,
  TransactionMessageDraft,
  WorkflowId,
} from '../../contracts/core';
import type { EffectDefinitionReader } from '../content/effect-reader';

export const CONTENT_EVENT_RESOLUTION_WORKFLOW = 'workflow:content-event-resolution' as WorkflowId;

const CHARACTER_MODULE_ID = 'character' as ModuleId<'character'>;
const INVENTORY_MODULE_ID = 'inventory' as ModuleId<'inventory'>;
const WORLD_MODULE_ID = 'world' as ModuleId<'world'>;

// 派發一筆 Effect 需要的上下文。全部由呼叫端（Router）自現有 Context 提供，Workflow 維持純函式。
export type EffectDispatchContext = Readonly<{
  // 這次事件實例——applyStatus 與 setWorldFact 都要用它當來源身分。
  contentEventInstanceId: ContentEventInstanceId;
  // 行動者（`EffectTarget: 'actor'` 指的就是他）。
  actorCharacterId: CharacterId;
  playerTeamId: TeamId;
}>;

export type EffectDispatchRejection = Readonly<{
  code: string;
  details: Readonly<Record<string, string | number | boolean>>;
}>;

export type EffectDispatchResult =
  | Readonly<{ ok: true; messages: readonly TransactionMessageDraft[] }>
  | Readonly<{ ok: false; rejection: EffectDispatchRejection }>;

// 與各模組的 `internal()` 同一形狀（InternalCommandDraft）。刻意不用轉型：草稿的 command 欄位
// 本來就是 unknown（kernel 以 payload 自帶的 `type` 判別欄路由），所以不需要任何強制轉換。
function internal(targetModule: ModuleId, command: unknown): InternalCommandDraft<unknown> {
  return { targetModule, command };
}

function notWired(kind: EffectDefinitionKind, missing: string): EffectDispatchResult {
  return {
    ok: false,
    rejection: {
      code: 'workflow/content-event-effect-not-wired',
      details: { effectKind: kind, missing },
    },
  };
}

// kind → 翻譯器。**非 Partial 的 Record**（13_data_runtime.md §6.0 第 5 條）：契約新增一種 Effect
// kind 時，這裡少一個鍵就是編譯錯誤，不會靜默走進「未知 kind 不處理」的分支。
type EffectTranslator = (
  effect: EffectDefinition,
  ctx: EffectDispatchContext,
) => EffectDispatchResult;

const TRANSLATORS: Readonly<Record<EffectDefinitionKind, EffectTranslator>> = {
  // ── 三種現在翻得出完整命令 ────────────────────────────────────────────────
  grantItem: (effect, ctx) => {
    if (effect.kind !== 'grantItem') return notWired('grantItem', 'unreachable');
    if (effect.target !== 'actor') {
      // 給整隊：要先決定「一人一份還是隊伍共有」，那是設計問題不是實作細節。不自行選一種。
      return notWired('grantItem', "target='playerTeam' 的分配規則未定案");
    }
    return {
      ok: true,
      messages: [
        internal(INVENTORY_MODULE_ID, {
          type: 'CreateItemInstance',
          definitionId: effect.itemDefinitionId,
          quantity: effect.amount,
          location: { kind: 'characterBag', characterId: ctx.actorCharacterId },
          ownerCharacterId: ctx.actorCharacterId,
          reason: 'contentEvent.optionEffect',
        }),
      ],
    };
  },

  applyStatus: (effect, ctx) => {
    if (effect.kind !== 'applyStatus') return notWired('applyStatus', 'unreachable');
    if (effect.target !== 'actor') {
      return notWired('applyStatus', "target='playerTeam' 需要成員快照 Query");
    }
    return {
      ok: true,
      messages: [
        internal(CHARACTER_MODULE_ID, {
          type: 'ApplyContentEventStatus',
          contentEventInstanceId: ctx.contentEventInstanceId,
          effectId: effect.id,
          characterId: ctx.actorCharacterId,
          statusId: effect.statusId,
        }),
      ],
    };
  },

  setWorldFact: (effect, ctx) => {
    if (effect.kind !== 'setWorldFact') return notWired('setWorldFact', 'unreachable');
    return {
      ok: true,
      messages: [
        internal(WORLD_MODULE_ID, {
          type: 'SetWorldFact',
          factId: effect.factId,
          value: effect.value,
          // 來源就是這次的事件實例；sourceKind 是本 Workflow 的身分，World 以它比對
          // WorldFactDefinition.allowedSourceKinds。
          sourceId: ctx.contentEventInstanceId,
          sourceKind: CONTENT_EVENT_RESOLUTION_WORKFLOW,
        }),
      ],
    };
  },

  // ── 五種缺接收端的命令或查詢 ──────────────────────────────────────────────
  //
  // 每一筆的拒絕訊息都寫清楚**缺什麼**，缺口的位置在接收端而不是這裡。
  consumeActorItem: (effect) =>
    notWired(
      effect.kind,
      'RemoveItemInstance 需要 ItemInstanceId；把「消耗 N 個某定義」解析成實際 instance 需要 Inventory Query',
    ),

  removeActorCurrency: (effect) =>
    notWired(
      effect.kind,
      'RemoveCurrency 需要 fromAccountId 與 transferId；角色→帳戶的對照需要 Economy Query',
    ),

  grantMasteryExperience: (effect) =>
    notWired(
      effect.kind,
      'progression 沒有註冊任何「發放熟練經驗」的 Internal Command（它目前只由 Domain Event 驅動）',
    ),

  startDetailedCombat: (effect) =>
    notWired(
      effect.kind,
      'StartCombatEncounter 需要 EncounterGroup 與隊形快照；encounterPoolId → group 的抽取屬內容 Resolver',
    ),

  changeCityMetric: (effect) =>
    notWired(
      effect.kind,
      'ApplyCityMetricEffect 需要 cityMetricEffectResolverId（換算量屬城市資料），Effect 本身沒有帶',
    ),
};

// 把一個選項的全部 Effect 翻成 Internal Command 草稿。
//
// **任一筆翻不出來就整筆拒絕**，不做部分套用：選項的效果是一個整體，套一半會讓玩家得到獎勵卻
// 沒付代價（或反之），而交易一旦提交就沒有回頭路。
export function dispatchOptionEffects(
  effectIds: readonly EffectDefinitionId[],
  reader: EffectDefinitionReader,
  ctx: EffectDispatchContext,
): EffectDispatchResult {
  const messages: TransactionMessageDraft[] = [];
  for (const effectId of effectIds) {
    const effect = reader.getEffect(effectId);
    const translated = TRANSLATORS[effect.kind](effect, ctx);
    if (!translated.ok) return translated;
    messages.push(...translated.messages);
  }
  return { ok: true, messages };
}
