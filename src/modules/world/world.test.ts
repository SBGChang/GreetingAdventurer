// modules/world/world.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋要求：每個登記進 ModuleContract 的 Handler 至少一個 accept；每一種 typed rejection 至少一個；
// 每一條宣稱的不變量至少一個；冪等 no-op 必須被釘住；RNG 路徑驗「同 cursor 同結果」與「cursor 前進」。

import type {
  JobId,
  MarketPressureId,
  RegionId,
  Revision,
  RouteId,
  TransactionMessageDraft,
  WorldDay,
  WorldEventWeightModifierId,
} from '../../contracts/core';
import type {
  ApplyEventWeightModifierCommand,
  ApplyMarketPressureCommand,
  ChangeRegionControlCommand,
  ConflictId,
  EventWeightModifierExpireJob,
  MarketPressureExpireJob,
  SetRouteAccessCommand,
  RouteAccessReason,
  SetWorldFactCommand,
  WorldConflictCheckJob,
  WorldConflictResolveJob,
  WorldDomainEvent,
  WorldState,
} from '../../contracts/world';

import type { WorldHandlerResult } from './system';
import {
  WORLD_MODULE_ID,
  handleApplyEventWeightModifier,
  handleApplyMarketPressure,
  handleChangeRegionControl,
  handleEventWeightModifierExpire,
  handleMarketPressureExpire,
  handleSetRouteAccess,
  handleSetWorldFact,
  handleWorldConflictCheck,
  handleWorldConflictResolve,
} from './system';
import { createWorldQuery } from './queries';
import { createWorldState } from './state';
import {
  CHECK_CADENCE_DAYS,
  CITY_A,
  CITY_B,
  CITY_C,
  CITY_D,
  CITY_ISLAND,
  CONFLICT_DURATION_DAYS,
  CONFLICT_RULE,
  CONFLICT_RULE_BAD_CADENCE,
  CONFLICT_RULE_OFF,
  CULTURE_ALPHA,
  CULTURE_BETA,
  FACT_BORDER_SEALED,
  FACT_OFF,
  FACT_SOURCE_CITY,
  FACT_SOURCE_QUEST,
  FACT_TAX_LEVEL,
  MAP_NORTH,
  MODIFIER_WAR,
  NATION_ALPHA,
  NATION_BETA,
  NATION_GAMMA,
  NATION_OFF,
  POLICY_BETA,
  PRESSURE_WAR,
  PRICE_RULE_WAR,
  QUEST_SOURCE,
  REGION_NORTH,
  REGION_OFF,
  REGION_SOUTH,
  ROUTE_AB_1,
  ROUTE_AB_2,
  ROUTE_AC,
  ROUTE_BD,
  ROUTE_CD,
  ROUTE_DE,
  ROUTE_OFF,
  SITE_NORTH,
  SITE_SOUTH,
  WEIGHT_RULE_WAR,
  WORLD_DAY,
  activeConflict,
  checkJobRngContext,
  fixtureWorldState,
  makeContext,
  stubAdventureMapPort,
  stubConflictResolver,
  stubDefinitionReader,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): WorldDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as WorldDomainEvent);
}

function findEvent<K extends WorldDomainEvent['type']>(
  events: readonly WorldDomainEvent[],
  type: K,
): Extract<WorldDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<WorldDomainEvent, { type: K }> | undefined;
}

function expectOk(r: WorldHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  // World 不擁有世界日：任何 Handler 都不得請求 Kernel 推進它（不變量 world.worldDayNotOwned）。
  assert(
    r.result.kernelRequests === undefined,
    `${label}: World handler 不得產生 kernelRequests（世界日由 Kernel 獨占）`,
  );
  return r.result;
}

function expectReject(r: WorldHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(
    r.rejection.code === code,
    `${label}: expected code '${code}', got '${r.rejection.code}'`,
  );
  assert(r.rejection.source === WORLD_MODULE_ID, `${label}: rejection.source 應為 world`);
}

// ── 命令／Job 建構子 ─────────────────────────────────────────────────────────

function changeControl(
  regionId: RegionId,
  newNationId: ChangeRegionControlCommand['newNationId'],
): ChangeRegionControlCommand {
  return { type: 'ChangeRegionControl', regionId, newNationId, sourceId: QUEST_SOURCE };
}

function setRouteAccess(
  routeId: RouteId,
  accessState: SetRouteAccessCommand['accessState'],
  reason?: RouteAccessReason,
): SetRouteAccessCommand {
  return { type: 'SetRouteAccess', routeId, accessState, reason };
}

function applyPressure(
  input: Partial<ApplyMarketPressureCommand> = {},
): ApplyMarketPressureCommand {
  return {
    type: 'ApplyMarketPressure',
    pressureId: PRESSURE_WAR,
    scope: { kind: 'region', id: REGION_SOUTH },
    modifierRuleId: PRICE_RULE_WAR,
    activeFromDay: WORLD_DAY,
    activeToDay: (WORLD_DAY + CONFLICT_DURATION_DAYS) as WorldDay,
    active: true,
    ...input,
  };
}

function applyModifier(
  input: Partial<ApplyEventWeightModifierCommand> = {},
): ApplyEventWeightModifierCommand {
  return {
    type: 'ApplyEventWeightModifier',
    modifierId: MODIFIER_WAR,
    scope: { kind: 'route', id: ROUTE_AC },
    context: 'playerTravel',
    weightModifierRuleId: WEIGHT_RULE_WAR,
    activeFromDay: WORLD_DAY,
    activeToDay: (WORLD_DAY + CONFLICT_DURATION_DAYS) as WorldDay,
    active: true,
    ...input,
  };
}

function setFact(input: Partial<SetWorldFactCommand> = {}): SetWorldFactCommand {
  return {
    type: 'SetWorldFact',
    factId: FACT_BORDER_SEALED,
    value: true,
    sourceId: QUEST_SOURCE,
    sourceKind: FACT_SOURCE_QUEST,
    ...input,
  };
}

const JOB_ID = 'job-1' as JobId;

function checkJob(input: Partial<WorldConflictCheckJob> = {}): WorldConflictCheckJob {
  return {
    jobId: JOB_ID,
    type: 'worldConflictCheck',
    dueDay: WORLD_DAY,
    ownerModule: WORLD_MODULE_ID,
    targetId: CONFLICT_RULE,
    rngContext: checkJobRngContext(0),
    payload: {},
    ...input,
  };
}

function resolveJob(input: Partial<WorldConflictResolveJob> = {}): WorldConflictResolveJob {
  return {
    jobId: JOB_ID,
    type: 'worldConflictResolve',
    dueDay: WORLD_DAY,
    ownerModule: WORLD_MODULE_ID,
    targetId: 'conflict-1' as ConflictId,
    expectedRevision: 0 as Revision,
    payload: {},
    ...input,
  };
}

function pressureExpireJob(
  targetId: MarketPressureId = PRESSURE_WAR,
): MarketPressureExpireJob {
  return {
    jobId: JOB_ID,
    type: 'marketPressureExpire',
    dueDay: WORLD_DAY,
    ownerModule: WORLD_MODULE_ID,
    targetId,
    payload: {},
  };
}

function modifierExpireJob(
  targetId: WorldEventWeightModifierId = MODIFIER_WAR,
): EventWeightModifierExpireJob {
  return {
    jobId: JOB_ID,
    type: 'eventWeightModifierExpire',
    dueDay: WORLD_DAY,
    ownerModule: WORLD_MODULE_ID,
    targetId,
    payload: {},
  };
}

function query(state: WorldState = fixtureWorldState()) {
  return createWorldQuery(state, stubDefinitionReader(), stubAdventureMapPort());
}

// ── 案例 ─────────────────────────────────────────────────────────────────────

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── ChangeRegionControl ───────────────────────────────────────────────────
  {
    name: 'ChangeRegionControl：換控制國 → 更新控制 + RegionControlChanged + HumanEnemyCultureChanged',
    run: () => {
      const state = fixtureWorldState();
      const res = expectOk(
        handleChangeRegionControl(changeControl(REGION_SOUTH, NATION_ALPHA), state, makeContext()),
        'changeControl',
      );
      const control = res.nextSlice.regionControl[REGION_SOUTH];
      assert(control !== undefined, '應有控制筆數');
      assert(control!.controllerNationId === NATION_ALPHA, `控制國應為 alpha（實得 ${String(control!.controllerNationId)}）`);
      assert(control!.controlledSinceDay === WORLD_DAY, 'controlledSinceDay 應為當前世界日');
      assert(control!.revision === 1, `revision 應 +1（實得 ${control!.revision}）`);

      const events = eventsOf(res.outgoingMessages);
      const changed = findEvent(events, 'RegionControlChanged');
      assert(changed !== undefined, '應 emit RegionControlChanged');
      assert(changed!.oldNationId === NATION_BETA && changed!.newNationId === NATION_ALPHA, 'payload 應帶新舊國');
      const culture = findEvent(events, 'HumanEnemyCultureChanged');
      assert(culture !== undefined && culture.cultureId === CULTURE_ALPHA, '應 emit HumanEnemyCultureChanged（alpha 文化）');
    },
  },
  {
    name: 'ChangeRegionControl：換成同文化的國家 → 只發 RegionControlChanged（人類敵人文化沒變）',
    run: () => {
      const res = expectOk(
        handleChangeRegionControl(changeControl(REGION_NORTH, NATION_GAMMA), fixtureWorldState(), makeContext()),
        'sameCulture',
      );
      const events = eventsOf(res.outgoingMessages);
      assert(findEvent(events, 'RegionControlChanged') !== undefined, '應 emit RegionControlChanged');
      assert(findEvent(events, 'HumanEnemyCultureChanged') === undefined, '同文化不應 emit HumanEnemyCultureChanged');
    },
  },
  {
    name: 'ChangeRegionControl：控制國已是目標國 → 冪等（state 原物件、無事件）',
    run: () => {
      const state = fixtureWorldState();
      const res = expectOk(
        handleChangeRegionControl(changeControl(REGION_NORTH, NATION_ALPHA), state, makeContext()),
        'idempotent',
      );
      assert(res.nextSlice === state, '冪等應回同一個 state 物件');
      assert(res.outgoingMessages.length === 0, '冪等不應發事件');
      // 資料齊全時仍然 no-op → 這是真的冪等，不是蓋住缺口。
      const again = expectOk(
        handleChangeRegionControl(changeControl(REGION_NORTH, NATION_ALPHA), res.nextSlice, makeContext()),
        'idempotent-again',
      );
      assert(again.nextSlice === state, '重複執行仍應為 no-op');
    },
  },
  {
    name: 'ChangeRegionControl 拒絕：region-control-missing / nation-disabled / region-disabled',
    run: () => {
      expectReject(
        handleChangeRegionControl(changeControl(REGION_SOUTH, NATION_ALPHA), createWorldState(), makeContext()),
        'world/region-control-missing',
        'missing',
      );
      expectReject(
        handleChangeRegionControl(changeControl(REGION_SOUTH, NATION_OFF), fixtureWorldState(), makeContext()),
        'world/nation-disabled',
        'nationOff',
      );
      expectReject(
        handleChangeRegionControl(changeControl(REGION_OFF, NATION_ALPHA), fixtureWorldState(), makeContext()),
        'world/region-disabled',
        'regionOff',
      );
    },
  },

  // ── SetRouteAccess ────────────────────────────────────────────────────────
  {
    name: 'SetRouteAccess：關閉路線 → RouteRuntimeState + RouteAccessChanged；再改一次 revision 前進',
    run: () => {
      const first = expectOk(
        handleSetRouteAccess(setRouteAccess(ROUTE_AB_1, 'closed', 'war' as RouteAccessReason), fixtureWorldState(), makeContext()),
        'close',
      );
      const runtime = first.nextSlice.routeStates[ROUTE_AB_1];
      assert(runtime !== undefined && runtime.accessState === 'closed', '應記錄 closed');
      assert(runtime!.reason === 'war', 'reason 應原樣保存');
      assert(runtime!.changedOnDay === WORLD_DAY, 'changedOnDay 應為當前世界日');
      assert(runtime!.revision === 0, '首筆 revision 應為 0');
      const event = findEvent(eventsOf(first.outgoingMessages), 'RouteAccessChanged');
      assert(event !== undefined && event.accessState === 'closed', '應 emit RouteAccessChanged');

      const second = expectOk(
        handleSetRouteAccess(setRouteAccess(ROUTE_AB_1, 'restricted', 'treaty' as RouteAccessReason), first.nextSlice, makeContext()),
        'restrict',
      );
      assert(second.nextSlice.routeStates[ROUTE_AB_1]!.revision === 1, 'revision 應 +1');
      assert(second.nextSlice.routeStates[ROUTE_AB_1]!.accessState === 'restricted', '應可轉為 restricted');
    },
  },
  {
    name: 'SetRouteAccess：設成 Definition 既有的預設狀態 → 冪等（無 Runtime 筆數、無事件）',
    run: () => {
      const state = fixtureWorldState();
      const res = expectOk(
        handleSetRouteAccess(setRouteAccess(ROUTE_AB_1, 'open'), state, makeContext()),
        'idempotentOpen',
      );
      assert(res.nextSlice === state, '與預設狀態相同應為 no-op');
      assert(res.outgoingMessages.length === 0, '不應發事件');
      // ROUTE_DE 的 enabledByDefault=false → 預設 closed，同理冪等。
      const closed = expectOk(
        handleSetRouteAccess(setRouteAccess(ROUTE_DE, 'closed'), state, makeContext()),
        'idempotentClosed',
      );
      assert(closed.nextSlice === state, 'enabledByDefault=false 的預設是 closed');
    },
  },
  {
    name: 'SetRouteAccess 拒絕：route-disabled',
    run: () => {
      expectReject(
        handleSetRouteAccess(setRouteAccess(ROUTE_OFF, 'closed'), fixtureWorldState(), makeContext()),
        'world/route-disabled',
        'routeOff',
      );
    },
  },

  // ── ApplyMarketPressure ───────────────────────────────────────────────────
  {
    name: 'ApplyMarketPressure：建立 → state + MarketPressureChanged(active) + 到期 Job（dueDay=activeToDay）',
    run: () => {
      const res = expectOk(
        handleApplyMarketPressure(applyPressure(), fixtureWorldState(), makeContext()),
        'createPressure',
      );
      const entry = res.nextSlice.marketPressures[PRESSURE_WAR];
      assert(entry !== undefined && entry.modifierRuleId === PRICE_RULE_WAR, '應建立壓力');
      const event = findEvent(eventsOf(res.outgoingMessages), 'MarketPressureChanged');
      assert(event !== undefined && event.active, '應 emit active:true');
      assert(res.scheduledJobs.length === 1, '應排一筆到期 Job');
      const job = res.scheduledJobs[0]!;
      assert(job.type === 'marketPressureExpire', 'Job 型別應為 marketPressureExpire');
      assert(job.dueDay === WORLD_DAY + CONFLICT_DURATION_DAYS, '到期日應等於 activeToDay');
    },
  },
  {
    name: 'ApplyMarketPressure：重送同一筆 → 冪等（無事件、無 Job）',
    run: () => {
      const created = expectOk(
        handleApplyMarketPressure(applyPressure(), fixtureWorldState(), makeContext()),
        'create',
      );
      const again = expectOk(
        handleApplyMarketPressure(applyPressure(), created.nextSlice, makeContext()),
        'again',
      );
      assert(again.nextSlice === created.nextSlice, '相同內容應為 no-op');
      assert(again.outgoingMessages.length === 0 && again.scheduledJobs.length === 0, '不應再發事件或排程');
    },
  },
  {
    name: 'ApplyMarketPressure：無限期（無 activeToDay）→ 不排到期 Job；active:false 明確結束',
    run: () => {
      const created = expectOk(
        handleApplyMarketPressure(applyPressure({ activeToDay: undefined }), fixtureWorldState(), makeContext()),
        'indefinite',
      );
      assert(created.scheduledJobs.length === 0, '無 activeToDay 不應排到期 Job');

      const ended = expectOk(
        handleApplyMarketPressure(applyPressure({ active: false }), created.nextSlice, makeContext()),
        'end',
      );
      assert(ended.nextSlice.marketPressures[PRESSURE_WAR] === undefined, '應移除壓力');
      const event = findEvent(eventsOf(ended.outgoingMessages), 'MarketPressureChanged');
      assert(event !== undefined && !event.active, '應 emit active:false');
    },
  },
  {
    name: 'ApplyMarketPressure 拒絕：invalid-window / not-found',
    run: () => {
      expectReject(
        handleApplyMarketPressure(applyPressure({ activeToDay: WORLD_DAY }), fixtureWorldState(), makeContext()),
        'world/market-pressure-invalid-window',
        'window',
      );
      expectReject(
        handleApplyMarketPressure(applyPressure({ active: false }), fixtureWorldState(), makeContext()),
        'world/market-pressure-not-found',
        'notFound',
      );
    },
  },

  // ── ApplyEventWeightModifier ──────────────────────────────────────────────
  {
    name: 'ApplyEventWeightModifier：建立／冪等／結束／拒絕',
    run: () => {
      const created = expectOk(
        handleApplyEventWeightModifier(applyModifier(), fixtureWorldState(), makeContext()),
        'createModifier',
      );
      assert(created.nextSlice.eventWeightModifiers[MODIFIER_WAR] !== undefined, '應建立修正');
      const event = findEvent(eventsOf(created.outgoingMessages), 'EventWeightModifierChanged');
      assert(event !== undefined && event.active && event.context === 'playerTravel', '應 emit active:true');
      assert(created.scheduledJobs.length === 1 && created.scheduledJobs[0]!.type === 'eventWeightModifierExpire', '應排到期 Job');

      const again = expectOk(
        handleApplyEventWeightModifier(applyModifier(), created.nextSlice, makeContext()),
        'againModifier',
      );
      assert(again.nextSlice === created.nextSlice, '相同內容應為 no-op');

      const ended = expectOk(
        handleApplyEventWeightModifier(applyModifier({ active: false }), created.nextSlice, makeContext()),
        'endModifier',
      );
      assert(ended.nextSlice.eventWeightModifiers[MODIFIER_WAR] === undefined, '應移除修正');

      expectReject(
        handleApplyEventWeightModifier(applyModifier({ activeToDay: WORLD_DAY }), fixtureWorldState(), makeContext()),
        'world/event-weight-modifier-invalid-window',
        'windowModifier',
      );
      expectReject(
        handleApplyEventWeightModifier(applyModifier({ active: false }), fixtureWorldState(), makeContext()),
        'world/event-weight-modifier-not-found',
        'notFoundModifier',
      );
    },
  },

  // ── SetWorldFact ──────────────────────────────────────────────────────────
  {
    name: 'SetWorldFact：設定 boolean → WorldFactChanged（oldValue 取自 Definition defaultValue）',
    run: () => {
      const res = expectOk(handleSetWorldFact(setFact(), fixtureWorldState(), makeContext()), 'setFact');
      const entry = res.nextSlice.facts[FACT_BORDER_SEALED];
      assert(entry !== undefined && entry.value === true, '應寫入 true');
      assert(entry!.changedOnDay === WORLD_DAY, 'changedOnDay 應為當前世界日');
      const event = findEvent(eventsOf(res.outgoingMessages), 'WorldFactChanged');
      assert(event !== undefined, '應 emit WorldFactChanged');
      assert(event!.oldValue === false, 'oldValue 應為 Definition 的 defaultValue');
      assert(event!.newValue === true, 'newValue 應為命令值');
    },
  },
  {
    name: 'SetWorldFact：值已等於目前生效值 → 冪等（含「等於 defaultValue」的情形）',
    run: () => {
      const state = fixtureWorldState();
      const same = expectOk(
        handleSetWorldFact(setFact({ value: false }), state, makeContext()),
        'sameAsDefault',
      );
      assert(same.nextSlice === state, '與 defaultValue 相同應為 no-op');

      const set = expectOk(handleSetWorldFact(setFact(), state, makeContext()), 'set');
      const again = expectOk(handleSetWorldFact(setFact(), set.nextSlice, makeContext()), 'setAgain');
      assert(again.nextSlice === set.nextSlice, '重送同值應為 no-op');
      assert(again.outgoingMessages.length === 0, '不應再發事件');
    },
  },
  {
    name: 'SetWorldFact 拒絕：value-kind-mismatch / source-kind-not-allowed / fact-disabled',
    run: () => {
      expectReject(
        handleSetWorldFact(setFact({ factId: FACT_TAX_LEVEL, value: true, sourceKind: FACT_SOURCE_CITY }), fixtureWorldState(), makeContext()),
        'world/fact-value-kind-mismatch',
        'kind',
      );
      expectReject(
        handleSetWorldFact(setFact({ sourceKind: FACT_SOURCE_CITY }), fixtureWorldState(), makeContext()),
        'world/fact-source-kind-not-allowed',
        'source',
      );
      expectReject(
        handleSetWorldFact(setFact({ factId: FACT_OFF }), fixtureWorldState(), makeContext()),
        'world/fact-disabled',
        'disabled',
      );
      // null 不符任何 valueKind。
      expectReject(
        handleSetWorldFact(setFact({ value: null }), fixtureWorldState(), makeContext()),
        'world/fact-value-kind-mismatch',
        'null',
      );
    },
  },

  // ── worldConflictCheck ────────────────────────────────────────────────────
  {
    name: 'worldConflictCheck：開戰 → ConflictState + ConflictStarted + 結案 Job + 續排檢查（cadence 來自資料）',
    run: () => {
      const res = expectOk(
        handleWorldConflictCheck(checkJob(), fixtureWorldState(), makeContext()),
        'check',
      );
      const conflicts = Object.values(res.nextSlice.conflicts);
      assert(conflicts.length === 1, `應開一場戰爭（實得 ${conflicts.length}）`);
      const conflict = conflicts[0]!;
      assert(conflict.state === 'active', '應為 active');
      assert(conflict.conflictRuleId === CONFLICT_RULE, '應記錄規則來源');
      assert(conflict.startedOnDay === WORLD_DAY, 'startedOnDay 應為當前世界日');
      assert(conflict.rngContext.cursor === 0, '衝突自己的長期 Stream 由 cursor 0 起算');
      assert(
        String(conflict.rngContext.streamId).includes(String(conflict.conflictId)),
        'Stream 應由該 Conflict 自己的 ID 派生',
      );

      const started = findEvent(eventsOf(res.outgoingMessages), 'ConflictStarted');
      assert(started !== undefined, '應 emit ConflictStarted');
      assert(started!.nationIds.length === 2, 'payload 應帶兩個參戰國');
      assert(started!.conflictRuleId === CONFLICT_RULE, 'payload 應帶規則來源（後果 Workflow 需要）');

      const resolveDraft = res.scheduledJobs.find((j) => j.type === 'worldConflictResolve');
      assert(resolveDraft !== undefined, '應排結案 Job');
      assert(resolveDraft!.dueDay === WORLD_DAY + CONFLICT_DURATION_DAYS, '結案日應由 Resolver 資料決定');
      assert(resolveDraft!.expectedRevision === 0, '結案 Job 應帶 expectedRevision');

      const nextCheck = res.scheduledJobs.find((j) => j.type === 'worldConflictCheck');
      assert(nextCheck !== undefined, '應續排下一次檢查');
      assert(nextCheck!.dueDay === WORLD_DAY + CHECK_CADENCE_DAYS, 'cadence 應取自 ConflictRuleDefinition');
      const nextRng = nextCheck!.rngContext;
      assert(nextRng !== undefined && nextRng.cursor === 1, 'cursor 應前進（不重用 cursor 0）');
    },
  },
  {
    name: 'worldConflictCheck：決定性——同 cursor 同結果；不同 cursor 由資料決定不開戰但仍續排',
    run: () => {
      const a = expectOk(handleWorldConflictCheck(checkJob(), fixtureWorldState(), makeContext()), 'runA');
      const b = expectOk(handleWorldConflictCheck(checkJob(), fixtureWorldState(), makeContext()), 'runB');
      assert(
        JSON.stringify(Object.keys(a.nextSlice.conflicts)) === JSON.stringify(Object.keys(b.nextSlice.conflicts)),
        '同 cursor 應產生完全相同的衝突集合',
      );
      assert(
        JSON.stringify(a.scheduledJobs) === JSON.stringify(b.scheduledJobs),
        '同 cursor 應產生完全相同的排程',
      );

      const odd = expectOk(
        handleWorldConflictCheck(
          checkJob({ rngContext: checkJobRngContext(1) }),
          fixtureWorldState(),
          makeContext(),
        ),
        'oddCursor',
      );
      assert(Object.keys(odd.nextSlice.conflicts).length === 0, 'cursor=1 依 stub 資料不開戰');
      assert(odd.scheduledJobs.length === 1 && odd.scheduledJobs[0]!.type === 'worldConflictCheck', '不開戰仍要續排檢查');
      assert(odd.scheduledJobs[0]!.rngContext!.cursor === 2, 'cursor 應繼續前進');
    },
  },
  {
    name: 'worldConflictCheck 拒絕：rule-disabled / cadence-invalid / rng-context-missing',
    run: () => {
      expectReject(
        handleWorldConflictCheck(checkJob({ targetId: CONFLICT_RULE_OFF }), fixtureWorldState(), makeContext()),
        'world/conflict-rule-disabled',
        'ruleOff',
      );
      expectReject(
        handleWorldConflictCheck(checkJob({ targetId: CONFLICT_RULE_BAD_CADENCE }), fixtureWorldState(), makeContext()),
        'world/conflict-cadence-invalid',
        'cadence',
      );
      expectReject(
        handleWorldConflictCheck(checkJob({ rngContext: undefined }), fixtureWorldState(), makeContext()),
        'world/conflict-check-rng-context-missing',
        'rng',
      );
    },
  },
  {
    name: 'worldConflictCheck 拒絕：Resolver 給出的開戰資料不合法（同國／無地區／結案日在過去／無控制筆數）',
    run: () => {
      const base = {
        attackerNationId: NATION_ALPHA,
        defenderNationId: NATION_BETA,
        affectedRegionIds: [REGION_SOUTH],
        resolveOnDay: (WORLD_DAY + CONFLICT_DURATION_DAYS) as WorldDay,
      };
      expectReject(
        handleWorldConflictCheck(
          checkJob(),
          fixtureWorldState(),
          makeContext({ conflicts: stubConflictResolver({ starts: [{ ...base, defenderNationId: NATION_ALPHA }] }) }),
        ),
        'world/conflict-invalid-parties',
        'sameNation',
      );
      expectReject(
        handleWorldConflictCheck(
          checkJob(),
          fixtureWorldState(),
          makeContext({ conflicts: stubConflictResolver({ starts: [{ ...base, affectedRegionIds: [] }] }) }),
        ),
        'world/conflict-no-affected-regions',
        'noRegions',
      );
      expectReject(
        handleWorldConflictCheck(
          checkJob(),
          fixtureWorldState(),
          makeContext({ conflicts: stubConflictResolver({ starts: [{ ...base, resolveOnDay: (WORLD_DAY - 1) as WorldDay }] }) }),
        ),
        'world/conflict-resolve-day-in-past',
        'pastDay',
      );
      expectReject(
        handleWorldConflictCheck(checkJob(), createWorldState(), makeContext()),
        'world/region-control-missing',
        'noControl',
      );
      expectReject(
        handleWorldConflictCheck(
          checkJob(),
          fixtureWorldState(),
          makeContext({ conflicts: stubConflictResolver({ starts: [{ ...base, attackerNationId: NATION_OFF }] }) }),
        ),
        'world/nation-disabled',
        'nationOffStart',
      );
    },
  },

  // ── worldConflictResolve ──────────────────────────────────────────────────
  {
    name: 'worldConflictResolve：結案 → 控制國變更 + ConflictResolved + cursor 存回自己的 Aggregate',
    run: () => {
      const state = fixtureWorldState({
        conflicts: { ['conflict-1' as ConflictId]: activeConflict() },
      });
      const res = expectOk(handleWorldConflictResolve(resolveJob(), state, makeContext()), 'resolve');
      const conflict = res.nextSlice.conflicts['conflict-1' as ConflictId]!;
      assert(conflict.state === 'resolved', '應標記 resolved');
      assert(conflict.resolvedOnDay === WORLD_DAY, 'resolvedOnDay 應為當前世界日');
      assert(conflict.rngContext.cursor === 1, '解析後應保存 nextCursor');
      assert(conflict.revision === 1, 'revision 應 +1');

      const control = res.nextSlice.regionControl[REGION_SOUTH]!;
      assert(control.controllerNationId === NATION_ALPHA, '勝方（attacker）應接管地區');
      assert(control.sourceConflictId === ('conflict-1' as ConflictId), '應記錄來源衝突');

      const events = eventsOf(res.outgoingMessages);
      assert(findEvent(events, 'RegionControlChanged') !== undefined, '應 emit RegionControlChanged');
      assert(findEvent(events, 'HumanEnemyCultureChanged') !== undefined, '應 emit HumanEnemyCultureChanged');
      const resolved = findEvent(events, 'ConflictResolved');
      assert(resolved !== undefined && resolved.conflictRuleId === CONFLICT_RULE, '應 emit 帶規則來源的 ConflictResolved');
    },
  },
  {
    name: 'worldConflictResolve：僵持（無勝方）→ 只結案，不改控制',
    run: () => {
      const state = fixtureWorldState({
        conflicts: { ['conflict-1' as ConflictId]: activeConflict() },
      });
      const ctx = makeContext({
        conflicts: stubConflictResolver({ outcome: { affectedRegionIds: [REGION_SOUTH] } }),
      });
      const res = expectOk(handleWorldConflictResolve(resolveJob(), state, ctx), 'stalemate');
      assert(res.nextSlice.regionControl[REGION_SOUTH]!.controllerNationId === NATION_BETA, '無勝方不應改控制國');
      const events = eventsOf(res.outgoingMessages);
      assert(findEvent(events, 'RegionControlChanged') === undefined, '不應 emit RegionControlChanged');
      assert(findEvent(events, 'ConflictResolved') !== undefined, '仍應結案');
    },
  },
  {
    name: 'worldConflictResolve：已結案 → 冪等；未知／過期 revision → 拒絕',
    run: () => {
      const resolvedState = fixtureWorldState({
        conflicts: { ['conflict-1' as ConflictId]: activeConflict({ state: 'resolved' }) },
      });
      const res = expectOk(handleWorldConflictResolve(resolveJob(), resolvedState, makeContext()), 'alreadyResolved');
      assert(res.nextSlice === resolvedState, '已結案應為 no-op');
      assert(res.outgoingMessages.length === 0, '不應重複發事件');

      expectReject(
        handleWorldConflictResolve(resolveJob(), fixtureWorldState(), makeContext()),
        'world/conflict-not-found',
        'notFound',
      );
      const state = fixtureWorldState({
        conflicts: { ['conflict-1' as ConflictId]: activeConflict({ revision: 3 as Revision }) },
      });
      expectReject(
        handleWorldConflictResolve(resolveJob(), state, makeContext()),
        'world/conflict-stale-revision',
        'stale',
      );
    },
  },

  // ── 到期 Job ──────────────────────────────────────────────────────────────
  {
    name: 'marketPressureExpire：到期移除 + active:false；已移除／已延長 → 冪等',
    run: () => {
      const created = expectOk(
        handleApplyMarketPressure(applyPressure({ activeToDay: WORLD_DAY + 1 }), fixtureWorldState(), makeContext()),
        'create',
      );
      const expireDay = (WORLD_DAY + 1) as WorldDay;
      const expired = expectOk(
        handleMarketPressureExpire(pressureExpireJob(), created.nextSlice, makeContext({ worldDay: expireDay })),
        'expire',
      );
      assert(expired.nextSlice.marketPressures[PRESSURE_WAR] === undefined, '到期應移除');
      const event = findEvent(eventsOf(expired.outgoingMessages), 'MarketPressureChanged');
      assert(event !== undefined && !event.active, '應 emit active:false');

      // 已被移除：冪等。
      const again = expectOk(
        handleMarketPressureExpire(pressureExpireJob(), expired.nextSlice, makeContext({ worldDay: expireDay })),
        'expireAgain',
      );
      assert(again.nextSlice === expired.nextSlice, '已移除應為 no-op');
      assert(again.outgoingMessages.length === 0, '不應再發事件');

      // 失效日還沒到（被延長）：這筆 Job 已被取代，冪等。
      const superseded = expectOk(
        handleMarketPressureExpire(pressureExpireJob(), created.nextSlice, makeContext()),
        'superseded',
      );
      assert(superseded.nextSlice === created.nextSlice, '尚未到失效日不應移除');
    },
  },
  {
    name: 'eventWeightModifierExpire：到期移除 + active:false；已移除／已延長 → 冪等',
    run: () => {
      const created = expectOk(
        handleApplyEventWeightModifier(applyModifier({ activeToDay: WORLD_DAY + 1 }), fixtureWorldState(), makeContext()),
        'create',
      );
      const expireDay = (WORLD_DAY + 1) as WorldDay;
      const expired = expectOk(
        handleEventWeightModifierExpire(modifierExpireJob(), created.nextSlice, makeContext({ worldDay: expireDay })),
        'expire',
      );
      assert(expired.nextSlice.eventWeightModifiers[MODIFIER_WAR] === undefined, '到期應移除');
      const event = findEvent(eventsOf(expired.outgoingMessages), 'EventWeightModifierChanged');
      assert(event !== undefined && !event.active, '應 emit active:false');

      const again = expectOk(
        handleEventWeightModifierExpire(modifierExpireJob(), expired.nextSlice, makeContext({ worldDay: expireDay })),
        'expireAgain',
      );
      assert(again.nextSlice === expired.nextSlice, '已移除應為 no-op');

      const superseded = expectOk(
        handleEventWeightModifierExpire(modifierExpireJob(), created.nextSlice, makeContext()),
        'superseded',
      );
      assert(superseded.nextSlice === created.nextSlice, '尚未到失效日不應移除');
    },
  },

  // ── WorldQuery：城市網路 ──────────────────────────────────────────────────
  {
    name: 'WorldQuery 距離：最短路線數、平手依 RouteId 固定排序、可重播、走不到回 undefined',
    run: () => {
      const q = query();
      assert(q.getCityGapCount(CITY_A, CITY_A) === 0, '同城距離為 0');
      assert(q.getCityGapCount(CITY_A, CITY_B) === 1, 'a→b 距離 1');
      assert(q.getCityGapCount(CITY_A, CITY_D) === 2, 'a→d 距離 2');

      const oneHop = q.getShortestRoute(CITY_A, CITY_B);
      assert(oneHop !== undefined && oneHop.length === 1, 'a→b 應為單段');
      assert(oneHop![0] === ROUTE_AB_1, `平行路線應取 RouteId 較小者（實得 ${String(oneHop![0])}）`);

      const twoHop = q.getShortestRoute(CITY_A, CITY_D);
      assert(twoHop !== undefined && twoHop.length === 2, 'a→d 應為兩段');
      assert(
        twoHop![0] === ROUTE_AB_1 && twoHop![1] === ROUTE_BD,
        `同距離多路徑應依 RouteId 序列取最小（實得 ${twoHop!.map(String).join(',')}）`,
      );
      assert(
        JSON.stringify(q.getShortestRoute(CITY_A, CITY_D)) === JSON.stringify(twoHop),
        '重複查詢結果必須一致（可重播）',
      );
      // ROUTE_OFF 的 Definition enabled=false → 不在城市網路內。
      assert(q.getCityGapCount(CITY_A, CITY_ISLAND) === undefined, '停用路線不構成連通');
      assert(q.getShortestRoute(CITY_A, CITY_ISLAND) === undefined, '走不到應回 undefined');
    },
  },
  {
    name: 'WorldQuery listCitiesWithinHops：含起點、依 CityId 排序、負值為空',
    run: () => {
      const q = query();
      const within1 = q.listCitiesWithinHops(CITY_A, 1);
      assert(
        JSON.stringify(within1.map(String)) === JSON.stringify([CITY_A, CITY_B, CITY_C].map(String)),
        `1 跳內應為 a,b,c（實得 ${within1.map(String).join(',')}）`,
      );
      assert(q.listCitiesWithinHops(CITY_A, 0).length === 1, '0 跳只有起點自己');
      assert(q.listCitiesWithinHops(CITY_A, -1).length === 0, '負值為空');
      assert(q.listCitiesWithinHops(CITY_A, 2).length === 4, '2 跳內應為 a,b,c,d');
    },
  },
  {
    name: 'WorldQuery listAdventureMapsForCities：只回既存 Map Instance，缺的跳過（不自造 ID）',
    run: () => {
      const q = query();
      const maps = q.listAdventureMapsForCities([CITY_A, CITY_C]);
      assert(maps.length === 1 && maps[0] === MAP_NORTH, `只應回既存實例（實得 ${maps.map(String).join(',')}）`);
      assert(q.listAdventureMapsForCities([CITY_B]).length === 0, '無冒險地的城市回空');
    },
  },
  {
    name: 'WorldQuery 歸屬與文化：占領只改人類敵人文化，原生文化不動（doc §8 不變量 5）',
    run: () => {
      const before = query();
      assert(before.getRegionForCity(CITY_C) === REGION_SOUTH, 'city→region');
      assert(before.getRegionForSite(SITE_SOUTH) === REGION_SOUTH, 'site→region');
      assert(before.getAccessCityForSite(SITE_NORTH) === CITY_A, 'site→access city');
      assert(before.getNativeCulture(REGION_SOUTH) === CULTURE_BETA, '原生文化為 beta');
      assert(before.getControllerNation(REGION_SOUTH) === NATION_BETA, '開局控制國為原生國');
      assert(before.getHumanEnemyCulture(REGION_SOUTH) === CULTURE_BETA, '人類敵人文化＝控制國文化');

      const occupied = expectOk(
        handleChangeRegionControl(changeControl(REGION_SOUTH, NATION_ALPHA), fixtureWorldState(), makeContext()),
        'occupy',
      ).nextSlice;
      const after = query(occupied);
      assert(after.getNativeCulture(REGION_SOUTH) === CULTURE_BETA, '占領不得改原生文化');
      assert(after.getHumanEnemyCulture(REGION_SOUTH) === CULTURE_ALPHA, '人類敵人文化應變成占領國文化');
      assert(after.getControllerNation(REGION_SOUTH) === NATION_ALPHA, '控制國應為 alpha');
      assert(
        Object.keys(occupied.regionControl).length === Object.keys(fixtureWorldState().regionControl).length,
        '每個 Region 仍恰好一筆控制（不得新增第二筆）',
      );
    },
  },
  {
    name: 'WorldQuery getControllerNation：控制筆數缺失時明確拋錯（不回原生國蓋掉缺口）',
    run: () => {
      let threw = false;
      try {
        query(createWorldState()).getControllerNation(REGION_SOUTH);
      } catch {
        threw = true;
      }
      assert(threw, '缺控制筆數應拋錯');
    },
  },
  {
    name: 'WorldQuery getRouteAccess：預設取自 Definition，Runtime 覆寫後取 Runtime，並帶 passagePolicyId',
    run: () => {
      const q = query();
      assert(q.getRouteAccess(ROUTE_AB_1).accessState === 'open', 'enabledByDefault=true → open');
      assert(q.getRouteAccess(ROUTE_DE).accessState === 'closed', 'enabledByDefault=false → closed');
      assert(q.getRouteAccess(ROUTE_AC).passagePolicyId === POLICY_BETA, '應帶 Route 的通行政策');
      assert(q.getRouteAccess(ROUTE_AB_1).passagePolicyId === undefined, '沒有政策就是沒有');

      const closed = expectOk(
        handleSetRouteAccess(setRouteAccess(ROUTE_CD, 'restricted', 'border' as RouteAccessReason), fixtureWorldState(), makeContext()),
        'restrict',
      ).nextSlice;
      const view = query(closed).getRouteAccess(ROUTE_CD);
      assert(view.accessState === 'restricted' && view.reason === 'border', 'Runtime 應覆寫預設');
    },
  },
  {
    name: 'WorldQuery 世界級修正：依 scope／context 過濾',
    run: () => {
      const withPressure = expectOk(
        handleApplyMarketPressure(applyPressure(), fixtureWorldState(), makeContext()),
        'pressure',
      ).nextSlice;
      const withBoth = expectOk(
        handleApplyEventWeightModifier(applyModifier(), withPressure, makeContext()),
        'modifier',
      ).nextSlice;
      const q = query(withBoth);

      assert(q.listMarketPressures({ kind: 'region', id: REGION_SOUTH }).length === 1, '應查到 region scope 的壓力');
      assert(q.listMarketPressures({ kind: 'region', id: REGION_NORTH }).length === 0, '不同 scope 不應查到');
      assert(q.listMarketPressures({ kind: 'nation', id: NATION_BETA }).length === 0, 'scope kind 不同不應查到');

      assert(q.listEventWeightModifiers({ kind: 'route', id: ROUTE_AC }, 'playerTravel').length === 1, '應查到 route scope 的修正');
      assert(q.listEventWeightModifiers({ kind: 'route', id: ROUTE_AC }, 'dungeon').length === 0, 'context 不同不應查到');
      assert(q.listEventWeightModifiers({ kind: 'route', id: ROUTE_AB_2 }, 'playerTravel').length === 0, '不同 route 不應查到');
    },
  },
  {
    name: 'WorldQuery getWorldFact：無 Runtime 筆數回 Definition defaultValue；有則回 Runtime 值',
    run: () => {
      assert(query().getWorldFact(FACT_BORDER_SEALED) === false, '應回 Definition 的 defaultValue');
      assert(query().getWorldFact(FACT_TAX_LEVEL) === 1, 'number 型 default');
      const set = expectOk(handleSetWorldFact(setFact(), fixtureWorldState(), makeContext()), 'set').nextSlice;
      assert(query(set).getWorldFact(FACT_BORDER_SEALED) === true, '應回 Runtime 值');
    },
  },
];

export type WorldTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly WorldTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`world module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
