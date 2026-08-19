// modules/world/system.ts
// World 模組的純函式 Internal Command Handler 與 Job Handler（docs/00_core/architecture/07_world_module.md §5–7）。
//
// 設計原則：
//   * 全部為決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * **World 不擁有世界日。** `CoreState.worldDay` 由 Kernel 獨占寫入；需要當前世界日時只從注入的
//     ctx.worldDay 讀，本模組不提供任何推進世界日的命令或 handler。
//   * 戰爭的機率／權重／期間全部是資料：checkCadenceDays 來自 ConflictRuleDefinition，
//     開戰與否、對手、影響地區、結案日與結果都由 Definition 指定的 Resolver 產生（見
//     WorldConflictResolverPort）。本檔不含任何公式、門檻或期間數值。
//   * 路線通行狀態的轉移一律由命令 payload 帶入（其值來自 PassagePolicy／ConflictRule 資料），
//     Handler 只負責驗證與記錄，不自行判斷該開該關。
//   * Internal Command / Job root 一律回 ModuleOutcome<WorldState>；World 沒有 Domain Event
//     Subscriber，也沒有 Game Command（doc §5.2「第一版沒有玩家直接修改國界的 Game Command」）。

import type {
  AdventureSiteId,
  AnyScheduledJob,
  CommandRejection,
  DomainEventDraft,
  JsonScalar,
  MapInstanceId,
  ModuleId,
  ModuleOutcome,
  ModuleResult,
  NationId,
  RegionId,
  Revision,
  RngContext,
  RngCursor,
  ResolverId,
  ScheduledJobDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  ApplyEventWeightModifierCommand,
  ApplyMarketPressureCommand,
  ChangeRegionControlCommand,
  ConflictId,
  ConflictOutcome,
  ConflictRuleId,
  ConflictState,
  EventWeightModifierExpireJob,
  MarketPressureExpireJob,
  MarketPressureState,
  RegionControlState,
  RouteRuntimeState,
  SetRouteAccessCommand,
  SetWorldFactCommand,
  WorldConflictCheckJob,
  WorldConflictResolveJob,
  WorldDefinitionReader,
  WorldDomainEvent,
  WorldEventWeightModifierState,
  WorldFactDefinition,
  WorldState,
} from '../../contracts/world';

import {
  advanceRngCursor,
  bumpRevision,
  conflictRngStream,
  effectiveRouteAccess,
  removeEventWeightModifier,
  removeMarketPressure,
  sameEventWeightModifier,
  sameMarketPressure,
  tryGetConflict,
  tryGetEventWeightModifier,
  tryGetMarketPressure,
  tryGetRegionControl,
  upsertConflict,
  upsertEventWeightModifier,
  upsertFact,
  upsertMarketPressure,
  upsertRegionControl,
  upsertRouteState,
} from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數
// ──────────────────────────────────────────────────────────────────────────

export const WORLD_MODULE_ID = 'world' as ModuleId<'world'>;

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（12_engine_runtime.md §7.1 慣例：模組宣告自己要的窄形狀，Composition 注入實作）
// ──────────────────────────────────────────────────────────────────────────

// 交易私有的 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
// World 只鑄造自己 Slice 的實體 ID——Conflict。Region／City／Route／Site 都是 Definition ID
// （內容作者指定），MapInstanceId 屬 map 模組。
export interface WorldIdAllocator {
  nextConflictId(): ConflictId;
}

// map 模組擁有的既存 Map Instance 查詢：WorldQuery.listAdventureMapsForCities 需要
// 「這個冒險地目前的地圖實例是哪一個」。World 不得鑄造 MapInstanceId，只能取既存的。
export interface WorldAdventureMapPort {
  getAdventureMapId(siteId: AdventureSiteId): MapInstanceId | undefined;
}

// 一筆「開戰」的資料決定結果。哪些國家接壤、力量差多少、要不要打、打多久，全部由
// ConflictRuleDefinition.eligibilityResolverId 指定的 Resolver 依其 params 決定；World 只收結果。
export type ConflictStartDraft = Readonly<{
  attackerNationId: NationId;
  defenderNationId: NationId;
  affectedRegionIds: readonly RegionId[];
  // 結案日（worldConflictResolve 的 dueDay）。戰爭期間是資料，不是程式常數。
  resolveOnDay: WorldDay;
}>;

export type ConflictEligibilityResult = Readonly<{
  starts: readonly ConflictStartDraft[];
  nextRngCursor: RngCursor;
}>;

export type ConflictOutcomeResult = Readonly<{
  outcome: ConflictOutcome;
  nextRngCursor: RngCursor;
}>;

// 衝突判定 Resolver 的窄化呼叫面。RNG 紀律（§7.1）：RngContext 顯式傳入、nextRngCursor 顯式傳回，
// 由 World 把 cursor 寫回自己擁有的 ConflictState／下一筆 Job。
export interface WorldConflictResolverPort {
  resolveConflictEligibility(
    input: Readonly<{
      conflictRuleId: ConflictRuleId;
      eligibilityResolverId: ResolverId;
      worldDay: WorldDay;
      rng: RngContext;
    }>,
  ): ConflictEligibilityResult;

  resolveConflictOutcome(
    input: Readonly<{
      conflictId: ConflictId;
      conflictRuleId: ConflictRuleId;
      outcomeResolverId: ResolverId;
      attackerNationId: NationId;
      defenderNationId: NationId;
      affectedRegionIds: readonly RegionId[];
      worldDay: WorldDay;
      rng: RngContext;
    }>,
  ): ConflictOutcomeResult;
}

export type WorldHandlerContext = Readonly<{
  worldDay: WorldDay; // Kernel 提供的當前世界日（唯讀）
  definitions: WorldDefinitionReader;
  ids: WorldIdAllocator;
  conflicts: WorldConflictResolverPort;
}>;

// ──────────────────────────────────────────────────────────────────────────
// Handler 回傳型別
// ──────────────────────────────────────────────────────────────────────────

export type WorldHandlerResult = ModuleOutcome<WorldState>;

// ──────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────

type RejectionDetails = Readonly<Record<string, string | number | boolean>>;

function emit(event: WorldDomainEvent): DomainEventDraft<unknown> {
  return { event };
}

function makeResult(
  nextSlice: WorldState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): ModuleResult<WorldState> {
  return { nextSlice, outgoingMessages, scheduledJobs };
}

function accept(
  nextSlice: WorldState,
  outgoingMessages: readonly DomainEventDraft<unknown>[] = [],
  scheduledJobs: readonly ScheduledJobDraft<AnyScheduledJob>[] = [],
): WorldHandlerResult {
  return { ok: true, result: makeResult(nextSlice, outgoingMessages, scheduledJobs) };
}

function reject(code: string, details?: RejectionDetails): WorldHandlerResult {
  return { ok: false, rejection: { code, source: WORLD_MODULE_ID, details } };
}

function rejection(code: string, details?: RejectionDetails): CommandRejection {
  return { code, source: WORLD_MODULE_ID, details };
}

// ──────────────────────────────────────────────────────────────────────────
// 地區控制的共用套用（ChangeRegionControl 與 worldConflictResolve 共用同一份實作）
// ──────────────────────────────────────────────────────────────────────────

type RegionControlApplication =
  // 控制國已是目標國：冪等（doc §5.2 的「更新控制國」在已達成時不需要再做一次，也不該再發事件）。
  | Readonly<{ kind: 'unchanged' }>
  | Readonly<{ kind: 'changed'; state: WorldState; events: readonly WorldDomainEvent[] }>
  | Readonly<{ kind: 'rejected'; rejection: CommandRejection }>;

function applyRegionControl(
  state: WorldState,
  input: Readonly<{
    regionId: RegionId;
    newNationId: NationId;
    sourceConflictId?: ConflictId;
  }>,
  ctx: WorldHandlerContext,
): RegionControlApplication {
  // 未知 Region／Nation 由 Reader 明確拋錯（壞內容引用＝內容驗證問題，不是可接受的命令）。
  const region = ctx.definitions.getRegion(input.regionId);
  if (!region.enabled) {
    return {
      kind: 'rejected',
      rejection: rejection('world/region-disabled', { regionId: String(input.regionId) }),
    };
  }
  const newNation = ctx.definitions.getNation(input.newNationId);
  if (!newNation.enabled) {
    return {
      kind: 'rejected',
      rejection: rejection('world/nation-disabled', { nationId: String(input.newNationId) }),
    };
  }

  const current = tryGetRegionControl(state, input.regionId);
  if (current === undefined) {
    // doc §8 不變量 3：控制筆數由 Bootstrap 依 nativeNationId 建立。沒有＝狀態不完整，
    // 不是「這個地區還沒有人控制」——不能就地補一筆把缺口蓋掉。
    return {
      kind: 'rejected',
      rejection: rejection('world/region-control-missing', { regionId: String(input.regionId) }),
    };
  }
  if (current.controllerNationId === input.newNationId) return { kind: 'unchanged' };

  const oldNation = ctx.definitions.getNation(current.controllerNationId);
  const next: RegionControlState = {
    regionId: current.regionId,
    controllerNationId: input.newNationId,
    controlledSinceDay: ctx.worldDay,
    sourceConflictId: input.sourceConflictId,
    revision: bumpRevision(current.revision),
  };

  const events: WorldDomainEvent[] = [
    {
      type: 'RegionControlChanged',
      regionId: current.regionId,
      oldNationId: current.controllerNationId,
      newNationId: input.newNationId,
    },
  ];
  // doc §7.1／§8 不變量 5：占領只改**人類敵人**文化，原生物品與非人怪文化不動。
  // 兩國同文化時人類敵人文化其實沒變，就不發這個事件（發了是說了一件沒發生的事）。
  if (oldNation.cultureId !== newNation.cultureId) {
    events.push({
      type: 'HumanEnemyCultureChanged',
      regionId: current.regionId,
      cultureId: newNation.cultureId,
    });
  }

  return { kind: 'changed', state: upsertRegionControl(state, next), events };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command：ChangeRegionControl
// ──────────────────────────────────────────────────────────────────────────

export function handleChangeRegionControl(
  command: ChangeRegionControlCommand,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const applied = applyRegionControl(
    state,
    {
      regionId: command.regionId,
      newNationId: command.newNationId,
      sourceConflictId: command.sourceConflictId,
    },
    ctx,
  );
  if (applied.kind === 'rejected') return { ok: false, rejection: applied.rejection };
  if (applied.kind === 'unchanged') return accept(state);
  return accept(applied.state, applied.events.map(emit));
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command：SetRouteAccess
// ──────────────────────────────────────────────────────────────────────────

export function handleSetRouteAccess(
  command: SetRouteAccessCommand,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const route = ctx.definitions.getRoute(command.routeId);
  if (!route.enabled) {
    return reject('world/route-disabled', { routeId: String(command.routeId) });
  }

  const current = effectiveRouteAccess(state, route);
  // 冪等：狀態與理由都相同＝這件事已經做過了。
  if (current.accessState === command.accessState && current.reason === command.reason) {
    return accept(state);
  }

  const existing = state.routeStates[command.routeId];
  const next: RouteRuntimeState = {
    routeId: command.routeId,
    accessState: command.accessState,
    reason: command.reason,
    changedOnDay: ctx.worldDay,
    revision: existing === undefined ? (0 as Revision) : bumpRevision(existing.revision),
  };

  return accept(upsertRouteState(state, next), [
    emit({
      type: 'RouteAccessChanged',
      routeId: command.routeId,
      accessState: command.accessState,
      reason: command.reason,
    }),
  ]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command：ApplyMarketPressure（建立或結束）
// ──────────────────────────────────────────────────────────────────────────
//
// activeToDay 的語意：**失效日**（該日起不再生效）。所以到期 Job 的 dueDay 就是 activeToDay，
// 不需要任何 ±1 的程式假設；沒有 activeToDay 就是無限期，直到 active:false 明確結束。

function marketExpireJobDraft(
  pressure: MarketPressureState,
  dueDay: WorldDay,
): ScheduledJobDraft<MarketPressureExpireJob> {
  return {
    type: 'marketPressureExpire',
    dueDay,
    ownerModule: WORLD_MODULE_ID,
    targetId: pressure.pressureId,
    payload: {},
  };
}

export function handleApplyMarketPressure(
  command: ApplyMarketPressureCommand,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const existing = tryGetMarketPressure(state, command.pressureId);

  if (!command.active) {
    if (existing === undefined) {
      return reject('world/market-pressure-not-found', { pressureId: String(command.pressureId) });
    }
    return accept(removeMarketPressure(state, command.pressureId), [
      emit({
        type: 'MarketPressureChanged',
        scope: existing.scope,
        modifierRuleId: existing.modifierRuleId,
        active: false,
      }),
    ]);
  }

  if (command.activeToDay !== undefined && command.activeToDay <= command.activeFromDay) {
    return reject('world/market-pressure-invalid-window', {
      pressureId: String(command.pressureId),
      activeFromDay: command.activeFromDay,
      activeToDay: command.activeToDay,
    });
  }

  const next: MarketPressureState = {
    pressureId: command.pressureId,
    scope: command.scope,
    modifierRuleId: command.modifierRuleId,
    activeFromDay: command.activeFromDay,
    activeToDay: command.activeToDay,
    sourceConflictId: command.sourceConflictId,
  };
  // 冪等：同一筆壓力重送同樣內容＝已經套用過了。
  if (existing !== undefined && sameMarketPressure(existing, next)) return accept(state);

  const jobs =
    next.activeToDay === undefined ? [] : [marketExpireJobDraft(next, next.activeToDay)];

  return accept(
    upsertMarketPressure(state, next),
    [
      emit({
        type: 'MarketPressureChanged',
        scope: next.scope,
        modifierRuleId: next.modifierRuleId,
        active: true,
      }),
    ],
    jobs,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command：ApplyEventWeightModifier（建立或結束）
// ──────────────────────────────────────────────────────────────────────────

function weightExpireJobDraft(
  modifier: WorldEventWeightModifierState,
  dueDay: WorldDay,
): ScheduledJobDraft<EventWeightModifierExpireJob> {
  return {
    type: 'eventWeightModifierExpire',
    dueDay,
    ownerModule: WORLD_MODULE_ID,
    targetId: modifier.modifierId,
    payload: {},
  };
}

export function handleApplyEventWeightModifier(
  command: ApplyEventWeightModifierCommand,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const existing = tryGetEventWeightModifier(state, command.modifierId);

  if (!command.active) {
    if (existing === undefined) {
      return reject('world/event-weight-modifier-not-found', {
        modifierId: String(command.modifierId),
      });
    }
    return accept(removeEventWeightModifier(state, command.modifierId), [
      emit({
        type: 'EventWeightModifierChanged',
        scope: existing.scope,
        context: existing.context,
        modifierRuleId: existing.weightModifierRuleId,
        active: false,
      }),
    ]);
  }

  if (command.activeToDay !== undefined && command.activeToDay <= command.activeFromDay) {
    return reject('world/event-weight-modifier-invalid-window', {
      modifierId: String(command.modifierId),
      activeFromDay: command.activeFromDay,
      activeToDay: command.activeToDay,
    });
  }

  const next: WorldEventWeightModifierState = {
    modifierId: command.modifierId,
    scope: command.scope,
    context: command.context,
    weightModifierRuleId: command.weightModifierRuleId,
    activeFromDay: command.activeFromDay,
    activeToDay: command.activeToDay,
    sourceConflictId: command.sourceConflictId,
  };
  if (existing !== undefined && sameEventWeightModifier(existing, next)) return accept(state);

  const jobs =
    next.activeToDay === undefined ? [] : [weightExpireJobDraft(next, next.activeToDay)];

  return accept(
    upsertEventWeightModifier(state, next),
    [
      emit({
        type: 'EventWeightModifierChanged',
        scope: next.scope,
        context: next.context,
        modifierRuleId: next.weightModifierRuleId,
        active: true,
      }),
    ],
    jobs,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 Internal Command：SetWorldFact
// ──────────────────────────────────────────────────────────────────────────

function matchesValueKind(kind: WorldFactDefinition['valueKind'], value: JsonScalar): boolean {
  switch (kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
  }
}

export function handleSetWorldFact(
  command: SetWorldFactCommand,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  // World Fact 只保存「已在資料中註冊」的旗標（doc §2.5）；未註冊的 factId 由 Reader 拋錯。
  const definition = ctx.definitions.getWorldFact(command.factId);
  if (!definition.enabled) {
    return reject('world/fact-disabled', { factId: String(command.factId) });
  }
  if (!matchesValueKind(definition.valueKind, command.value)) {
    return reject('world/fact-value-kind-mismatch', {
      factId: String(command.factId),
      expected: definition.valueKind,
      actual: command.value === null ? 'null' : typeof command.value,
    });
  }
  if (!definition.allowedSourceKinds.includes(command.sourceKind)) {
    return reject('world/fact-source-kind-not-allowed', {
      factId: String(command.factId),
      sourceKind: String(command.sourceKind),
    });
  }

  const existing = state.facts[command.factId];
  const oldValue: JsonScalar = existing === undefined ? definition.defaultValue : existing.value;
  // 冪等：目前生效值已等於目標值＝這個旗標已經是這樣了。
  if (oldValue === command.value) return accept(state);

  return accept(
    upsertFact(state, {
      factId: command.factId,
      value: command.value,
      sourceId: command.sourceId,
      changedOnDay: ctx.worldDay,
      revision: existing === undefined ? (0 as Revision) : bumpRevision(existing.revision),
    }),
    [
      emit({
        type: 'WorldFactChanged',
        factId: command.factId,
        oldValue,
        newValue: command.value,
        sourceId: command.sourceId,
      }),
    ],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Job：worldConflictCheck
// ──────────────────────────────────────────────────────────────────────────

function conflictCheckJobDraft(
  conflictRuleId: ConflictRuleId,
  dueDay: WorldDay,
  rng: RngContext,
): ScheduledJobDraft<WorldConflictCheckJob> {
  return {
    type: 'worldConflictCheck',
    dueDay,
    ownerModule: WORLD_MODULE_ID,
    targetId: conflictRuleId,
    rngContext: rng,
    payload: {},
  };
}

function conflictResolveJobDraft(
  conflict: ConflictState,
  dueDay: WorldDay,
): ScheduledJobDraft<WorldConflictResolveJob> {
  return {
    type: 'worldConflictResolve',
    dueDay,
    ownerModule: WORLD_MODULE_ID,
    targetId: conflict.conflictId,
    expectedRevision: conflict.revision,
    payload: {},
  };
}

export function handleWorldConflictCheck(
  job: WorldConflictCheckJob,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const rule = ctx.definitions.getConflictRule(job.targetId);
  // doc §8 不變量 7：戰爭未啟用時不建立空白 Conflict Job。真的收到一筆＝排程與內容不一致。
  if (!rule.enabled) {
    return reject('world/conflict-rule-disabled', { conflictRuleId: String(job.targetId) });
  }
  if (!Number.isInteger(rule.checkCadenceDays) || rule.checkCadenceDays < 1) {
    return reject('world/conflict-cadence-invalid', {
      conflictRuleId: String(job.targetId),
      checkCadenceDays: rule.checkCadenceDays,
    });
  }
  // 這個 Job 會一直排下去，所以它的 RNG Stream 必須跨次延續（§7.1）：cursor 由上一次的
  // nextRngCursor 帶進來。沒有 rngContext 就無法保證「同 State 同 Seed 同結果」（不變量 8），
  // 不能改用一次性 context 代替。
  const rng = job.rngContext;
  if (rng === undefined) {
    return reject('world/conflict-check-rng-context-missing', {
      conflictRuleId: String(job.targetId),
      jobId: String(job.jobId),
    });
  }

  const eligibility = ctx.conflicts.resolveConflictEligibility({
    conflictRuleId: job.targetId,
    eligibilityResolverId: rule.eligibilityResolverId,
    worldDay: ctx.worldDay,
    rng,
  });

  let nextState = state;
  const events: DomainEventDraft<unknown>[] = [];
  const jobs: ScheduledJobDraft<AnyScheduledJob>[] = [];

  for (const start of eligibility.starts) {
    if (start.attackerNationId === start.defenderNationId) {
      return reject('world/conflict-invalid-parties', {
        conflictRuleId: String(job.targetId),
        nationId: String(start.attackerNationId),
      });
    }
    if (start.affectedRegionIds.length === 0) {
      return reject('world/conflict-no-affected-regions', {
        conflictRuleId: String(job.targetId),
      });
    }
    if (start.resolveOnDay < ctx.worldDay) {
      return reject('world/conflict-resolve-day-in-past', {
        conflictRuleId: String(job.targetId),
        resolveOnDay: start.resolveOnDay,
        worldDay: ctx.worldDay,
      });
    }
    for (const regionId of start.affectedRegionIds) {
      if (tryGetRegionControl(nextState, regionId) === undefined) {
        return reject('world/region-control-missing', { regionId: String(regionId) });
      }
    }
    // 參戰國必須是已註冊且啟用的 Nation（未知 ID 由 Reader 拋錯）。
    for (const nationId of [start.attackerNationId, start.defenderNationId]) {
      if (!ctx.definitions.getNation(nationId).enabled) {
        return reject('world/nation-disabled', { nationId: String(nationId) });
      }
    }

    const conflictId = ctx.ids.nextConflictId();
    const conflict: ConflictState = {
      conflictId,
      conflictRuleId: job.targetId,
      attackerNationId: start.attackerNationId,
      defenderNationId: start.defenderNationId,
      affectedRegionIds: [...start.affectedRegionIds],
      state: 'active',
      startedOnDay: ctx.worldDay,
      rngContext: conflictRngStream(rng.worldSeed, conflictId),
      revision: 0 as Revision,
    };
    nextState = upsertConflict(nextState, conflict);
    events.push(
      emit({
        type: 'ConflictStarted',
        conflictId,
        conflictRuleId: conflict.conflictRuleId,
        nationIds: [conflict.attackerNationId, conflict.defenderNationId],
        regionIds: [...conflict.affectedRegionIds],
      }),
    );
    jobs.push(conflictResolveJobDraft(conflict, start.resolveOnDay));
  }

  // 固定節奏續排（cadence 是資料）；cursor 前進，不重用同一個 cursor。
  jobs.push(
    conflictCheckJobDraft(
      job.targetId,
      (ctx.worldDay + rule.checkCadenceDays) as WorldDay,
      advanceRngCursor(rng, eligibility.nextRngCursor),
    ),
  );

  return accept(nextState, events, jobs);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Job：worldConflictResolve
// ──────────────────────────────────────────────────────────────────────────
//
// World 在這裡只做自己擁有的事：把 Conflict 結案、依結果資料改變地區控制、公告 ConflictResolved。
// ConflictRuleDefinition 的 marketPressureEffectIds / eventWeightEffectIds / passageEffectIds
// 是 Effect 語意（World 不擁有），要由一條編排 Workflow 展開成 ApplyMarketPressure /
// ApplyEventWeightModifier / SetRouteAccess 命令送回 World；事件帶著 conflictRuleId 就是為此。

export function handleWorldConflictResolve(
  job: WorldConflictResolveJob,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const conflict = tryGetConflict(state, job.targetId);
  if (conflict === undefined) {
    return reject('world/conflict-not-found', { conflictId: String(job.targetId) });
  }
  // 冪等：已結案的衝突再收到一次結案 Job（重複排程／舊排程）＝這件事已經發生過了。
  if (conflict.state === 'resolved') return accept(state);
  if (job.expectedRevision !== undefined && job.expectedRevision !== conflict.revision) {
    return reject('world/conflict-stale-revision', {
      conflictId: String(job.targetId),
      expected: job.expectedRevision,
      actual: conflict.revision,
    });
  }

  const rule = ctx.definitions.getConflictRule(conflict.conflictRuleId);
  if (!rule.enabled) {
    return reject('world/conflict-rule-disabled', {
      conflictRuleId: String(conflict.conflictRuleId),
    });
  }

  const resolved = ctx.conflicts.resolveConflictOutcome({
    conflictId: conflict.conflictId,
    conflictRuleId: conflict.conflictRuleId,
    outcomeResolverId: rule.outcomeResolverId,
    attackerNationId: conflict.attackerNationId,
    defenderNationId: conflict.defenderNationId,
    affectedRegionIds: conflict.affectedRegionIds,
    worldDay: ctx.worldDay,
    rng: conflict.rngContext,
  });

  let nextState = upsertConflict(state, {
    ...conflict,
    state: 'resolved',
    resolvedOnDay: ctx.worldDay,
    // 跨日解析的 cursor 存回自己的 Aggregate（§7.1）。
    rngContext: advanceRngCursor(conflict.rngContext, resolved.nextRngCursor),
    revision: bumpRevision(conflict.revision),
  });

  const events: DomainEventDraft<unknown>[] = [];

  // 占領：勝方接管結果指定的地區。沒有勝方（僵持）就不改控制——那是 Resolver 的決定，不是缺資料。
  const winner = resolved.outcome.winnerNationId;
  if (winner !== undefined) {
    const regionIds = [...resolved.outcome.affectedRegionIds].sort((a, b) =>
      String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
    );
    for (const regionId of regionIds) {
      const applied = applyRegionControl(
        nextState,
        { regionId, newNationId: winner, sourceConflictId: conflict.conflictId },
        ctx,
      );
      if (applied.kind === 'rejected') return { ok: false, rejection: applied.rejection };
      if (applied.kind === 'unchanged') continue;
      nextState = applied.state;
      for (const event of applied.events) events.push(emit(event));
    }
  }

  events.push(
    emit({
      type: 'ConflictResolved',
      conflictId: conflict.conflictId,
      conflictRuleId: conflict.conflictRuleId,
      outcome: resolved.outcome,
    }),
  );

  return accept(nextState, events);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 Job：marketPressureExpire / eventWeightModifierExpire
// ──────────────────────────────────────────────────────────────────────────

export function handleMarketPressureExpire(
  job: MarketPressureExpireJob,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const pressure = tryGetMarketPressure(state, job.targetId);
  // 冪等：壓力已被 ApplyMarketPressure(active:false) 移除，到期 Job 沒有事可做。
  if (pressure === undefined) return accept(state);
  // 冪等：這筆 Job 已被後來的 Apply 取代（延長或改成無限期）；失效日還沒到就不能移除。
  if (pressure.activeToDay === undefined || pressure.activeToDay > ctx.worldDay) {
    return accept(state);
  }

  return accept(removeMarketPressure(state, job.targetId), [
    emit({
      type: 'MarketPressureChanged',
      scope: pressure.scope,
      modifierRuleId: pressure.modifierRuleId,
      active: false,
    }),
  ]);
}

export function handleEventWeightModifierExpire(
  job: EventWeightModifierExpireJob,
  state: WorldState,
  ctx: WorldHandlerContext,
): WorldHandlerResult {
  const modifier = tryGetEventWeightModifier(state, job.targetId);
  if (modifier === undefined) return accept(state);
  if (modifier.activeToDay === undefined || modifier.activeToDay > ctx.worldDay) {
    return accept(state);
  }

  return accept(removeEventWeightModifier(state, job.targetId), [
    emit({
      type: 'EventWeightModifierChanged',
      scope: modifier.scope,
      context: modifier.context,
      modifierRuleId: modifier.weightModifierRuleId,
      active: false,
    }),
  ]);
}
