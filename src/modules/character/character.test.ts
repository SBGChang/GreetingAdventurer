// modules/character/character.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。

import type {
  CharacterId,
  FamilyLinkId,
  QuestId,
  WorldDay,
  Revision,
  TransactionMessageDraft,
} from '../../contracts/core';
import type {
  Character,
  CharacterState,
  FamilyLink,
  ApplyCombatCondition,
  CreatePartnerFamilyLink,
  OpenCharacterRelationshipFact,
  ResolveCharacterRelationshipFact,
  ApplyCharacterReputationEffect,
  CharacterLifecycleJob,
} from '../../contracts/character';
import type { CharacterDomainEvent } from './system';
import {
  handleApplyCombatCondition,
  handleCreatePartnerFamilyLink,
  handleOpenCharacterRelationshipFact,
  handleResolveCharacterRelationshipFact,
  handleApplyCharacterReputationEffect,
  handleCharacterLifecycleJob,
  onFacilityRestCompleted,
  onHomeYearRestCompleted,
  onQuestStateChanged,
  onStatsCapacityChanged,
} from './system';
import { createCharacterQuery } from './queries';
import { createCharacterState } from './state';
import {
  fixtureCharacterState,
  makeCharacter,
  makeEscort,
  makeContext,
  stubResolverPort,
  stubStatsQuery,
  PLAYER_ID,
  NPC_ID,
  POISON_STATUS_ID,
  WELLFED_STATUS_ID,
  PLAYER_ARCHETYPE_ID,
  NPC_ARCHETYPE_ID,
} from './fixtures';
import type { EffectDefinitionId, CharacterStatusInstanceId } from '../../contracts/core';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): CharacterDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as CharacterDomainEvent);
}

function hasEvent(events: readonly CharacterDomainEvent[], type: CharacterDomainEvent['type']): boolean {
  return events.some((e) => e.type === type);
}

function findEvent<T extends CharacterDomainEvent['type']>(
  events: readonly CharacterDomainEvent[],
  type: T,
): Extract<CharacterDomainEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as
    | Extract<CharacterDomainEvent, { type: T }>
    | undefined;
}

function reqChar(state: CharacterState, id: CharacterId) {
  const c = state.characters[id];
  if (c === undefined) throw new Error(`missing character ${String(id)}`);
  return c;
}

// ── 測試案例 ─────────────────────────────────────────────────────────────────
type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: 'ApplyCombatCondition: 致命傷害 → 死亡 + 不可用 + 事件',
    run: () => {
      const state = fixtureCharacterState();
      const ctx = makeContext();
      const cmd: ApplyCombatCondition = { type: 'ApplyCombatCondition', characterId: PLAYER_ID, healthDelta: -9999 };
      const res = handleApplyCombatCondition(cmd, state, ctx);
      const next = reqChar(res.nextSlice, PLAYER_ID);
      assert(next.condition.health === 0, 'HP 應被夾到 0');
      assert(next.lifeState === 'dead', 'lifeState 應為 dead');
      assert(next.availability === 'unavailable', 'availability 應為 unavailable');
      const events = eventsOf(res.outgoingMessages);
      assert(hasEvent(events, 'CharacterDied'), '應 emit CharacterDied');
      assert(hasEvent(events, 'CharacterConditionChanged'), '應 emit CharacterConditionChanged');
      assert(hasEvent(events, 'CharacterAvailabilityChanged'), '應 emit CharacterAvailabilityChanged');
    },
  },
  {
    name: 'ApplyCombatCondition: 非致命傷害 + 上限夾住',
    run: () => {
      const state = fixtureCharacterState();
      const ctx = makeContext({ stats: stubStatsQuery(100, 50) });
      // 先過量治療應被夾到 max=100
      const heal = handleApplyCombatCondition(
        { type: 'ApplyCombatCondition', characterId: PLAYER_ID, healthDelta: 9999 },
        state,
        ctx,
      );
      assert(reqChar(heal.nextSlice, PLAYER_ID).condition.health === 100, '治療應夾到 maxHealth');
      // 扣血 30 → 70
      const dmg = handleApplyCombatCondition(
        { type: 'ApplyCombatCondition', characterId: PLAYER_ID, healthDelta: -30 },
        state,
        ctx,
      );
      const next = reqChar(dmg.nextSlice, PLAYER_ID);
      assert(next.condition.health === 70, `HP 應為 70，實際 ${next.condition.health}`);
      assert(next.lifeState === 'alive', '未致命應仍存活');
    },
  },
  {
    name: 'FacilityRestCompleted: 回滿 HP/MP、清除 clearByRest 狀態、保留其他',
    run: () => {
      const ctx = makeContext({ stats: stubStatsQuery(120, 60) });
      const hurt = makeCharacter({
        characterId: PLAYER_ID,
        condition: {
          health: 10,
          mana: 5,
          statuses: [
            {
              statusInstanceId: 's-poison' as CharacterStatusInstanceId,
              statusId: POISON_STATUS_ID,
              appliedOnDay: 0 as WorldDay,
              stacks: 2,
            },
            {
              statusInstanceId: 's-food' as CharacterStatusInstanceId,
              statusId: WELLFED_STATUS_ID,
              appliedOnDay: 0 as WorldDay,
              stacks: 1,
            },
          ],
        },
      });
      const state = createCharacterState({ characters: [hurt] });
      const res = onFacilityRestCompleted(
        { type: 'FacilityRestCompleted', cityId: 'city-1' as never, characterIds: [PLAYER_ID], ruleId: 'rule-1' as never },
        state,
        ctx,
      );
      const next = reqChar(res.nextSlice, PLAYER_ID);
      assert(next.condition.health === 120 && next.condition.mana === 60, 'HP/MP 應回滿');
      const ids = next.condition.statuses.map((s) => s.statusId);
      assert(ids.includes(POISON_STATUS_ID), 'poison（clearByRest=false）應保留');
      assert(!ids.includes(WELLFED_STATUS_ID), 'wellfed（clearByRest=true）應清除');
      // 確認沒有疲勞欄位（不變量 7）：condition 只含 health/mana/statuses
      assert(Object.keys(next.condition).sort().join(',') === 'health,mana,statuses', 'condition 不得有疲勞欄位');
    },
  },
  {
    name: 'CreatePartnerFamilyLink: 合法伴侶恰建立一條雙人 active link',
    run: () => {
      const state = fixtureCharacterState(); // player=female, npc=male, 皆成年存活
      const ctx = makeContext();
      const cmd: CreatePartnerFamilyLink = { type: 'CreatePartnerFamilyLink',
        characterIds: [PLAYER_ID, NPC_ID],
        sourceId: PLAYER_ID,
      };
      const res = handleCreatePartnerFamilyLink(cmd, state, ctx);
      const links = Object.values(res.nextSlice.familyLinks);
      assert(links.length === 1, '應恰建立一條 link');
      const link = links[0]!;
      assert(link.kind === 'partner' && link.activeToDay === undefined, '應為 active partner');
      assert(link.characterIds.length === 2, 'partner 必為兩人');
      assert(hasEvent(eventsOf(res.outgoingMessages), 'FamilyLinkChanged'), '應 emit FamilyLinkChanged');
    },
  },
  {
    name: 'CreatePartnerFamilyLink: 同性 / 自我求婚 / 已婚 皆被拒',
    run: () => {
      const ctx = makeContext();
      const a = makeCharacter({ characterId: 'a' as CharacterId, sex: 'female', birthDay: 0 as WorldDay });
      const b = makeCharacter({ characterId: 'b' as CharacterId, sex: 'female', birthDay: 0 as WorldDay });
      const state = createCharacterState({ characters: [a, b] });
      // 同性 → 拒
      const sameSex = handleCreatePartnerFamilyLink(
        { type: 'CreatePartnerFamilyLink', characterIds: ['a' as CharacterId, 'b' as CharacterId], sourceId: 'a' as CharacterId },
        state,
        ctx,
      );
      assert(Object.keys(sameSex.nextSlice.familyLinks).length === 0, '同性應被拒');
      // 自我求婚 → 拒
      const selfM = handleCreatePartnerFamilyLink(
        { type: 'CreatePartnerFamilyLink', characterIds: ['a' as CharacterId, 'a' as CharacterId], sourceId: 'a' as CharacterId },
        state,
        ctx,
      );
      assert(Object.keys(selfM.nextSlice.familyLinks).length === 0, '自我求婚應被拒');
    },
  },
  {
    name: 'RelationshipFact: 開啟冪等、只回未了結、解決冪等',
    run: () => {
      const ctx = makeContext();
      const state = fixtureCharacterState();
      const openCmd: OpenCharacterRelationshipFact = { type: 'OpenCharacterRelationshipFact',
        subjectCharacterId: PLAYER_ID,
        counterpart: { kind: 'character', characterId: NPC_ID },
        kind: 'debt',
        sourceId: PLAYER_ID,
      };
      const first = handleOpenCharacterRelationshipFact(openCmd, state, ctx);
      assert(Object.keys(first.nextSlice.relationshipFacts).length === 1, '第一次應建立');
      // 重送同來源 → 冪等（不新增）
      const again = handleOpenCharacterRelationshipFact(openCmd, first.nextSlice, ctx);
      assert(Object.keys(again.nextSlice.relationshipFacts).length === 1, '重送應冪等');
      // Query 只回未了結
      const q = createCharacterQuery(again.nextSlice);
      assert(q.listUnresolvedRelationships(PLAYER_ID).length === 1, 'Query 應回一筆未了結');
      // 解決後 Query 回 0，且再次解決冪等
      const factId = Object.keys(again.nextSlice.relationshipFacts)[0]! as never;
      const resolveCmd: ResolveCharacterRelationshipFact = { type: 'ResolveCharacterRelationshipFact',
        relationshipFactId: factId,
        sourceId: PLAYER_ID,
      };
      const resolved = handleResolveCharacterRelationshipFact(resolveCmd, again.nextSlice, ctx);
      assert(
        createCharacterQuery(resolved.nextSlice).listUnresolvedRelationships(PLAYER_ID).length === 0,
        '解決後應無未了結',
      );
      const resolvedAgain = handleResolveCharacterRelationshipFact(resolveCmd, resolved.nextSlice, ctx);
      assert(
        eventsOf(resolvedAgain.outgoingMessages).length === 0,
        '重複解決應冪等（不再發事件）',
      );
    },
  },
  {
    name: 'naturalDeathCheck Job: resolver 觸發 → 死亡；否則排下一次（不每日掃描）',
    run: () => {
      const state = fixtureCharacterState();
      const job: CharacterLifecycleJob = {
        jobId: 'job-1' as never,
        type: 'characterLifecycleDue',
        dueDay: 20000 as WorldDay,
        ownerModule: 'character' as never,
        targetId: PLAYER_ID,
        payload: { kind: 'naturalDeathCheck' },
      };
      // reschedule 情境：不死，排下一個明確 Job
      const alive = handleCharacterLifecycleJob(
        job,
        state,
        makeContext({ resolvers: stubResolverPort({ resolveNaturalDeath: () => ({ outcome: 'reschedule', nextCheckInDays: 365 }) }) }),
      );
      assert(reqChar(alive.nextSlice, PLAYER_ID).lifeState === 'alive', 'reschedule 應存活');
      assert(alive.scheduledJobs.length === 1, '應排一個下一次檢查 Job（非每日）');
      // trigger 情境：死亡
      const dead = handleCharacterLifecycleJob(
        job,
        state,
        makeContext({ resolvers: stubResolverPort({ resolveNaturalDeath: () => ({ outcome: 'trigger' }) }) }),
      );
      assert(reqChar(dead.nextSlice, PLAYER_ID).lifeState === 'dead', 'trigger 應死亡');
      assert(hasEvent(eventsOf(dead.outgoingMessages), 'CharacterDied'), '應 emit CharacterDied');
    },
  },
  {
    name: 'adulthood Job: 到齡 → available + CharacterBecameAdult',
    run: () => {
      const worldDay = 6000 as WorldDay; // > 成年門檻 5475
      const child = makeCharacter({
        characterId: 'kid' as CharacterId,
        birthDay: 0 as WorldDay,
        availability: 'unavailable',
      });
      const state = createCharacterState({ characters: [child] });
      const job: CharacterLifecycleJob = {
        jobId: 'job-a' as never,
        type: 'characterLifecycleDue',
        dueDay: worldDay,
        ownerModule: 'character' as never,
        targetId: 'kid' as CharacterId,
        payload: { kind: 'adulthood' },
      };
      const res = handleCharacterLifecycleJob(job, state, makeContext({ worldDay }));
      assert(reqChar(res.nextSlice, 'kid' as CharacterId).availability === 'available', '成年應轉 available');
      assert(hasEvent(eventsOf(res.outgoingMessages), 'CharacterBecameAdult'), '應 emit CharacterBecameAdult');
    },
  },
  {
    // R8 P2：expectedRevision 原本只寫在註解裡，從未比對。
    name: '生命週期 Job：expectedRevision 與 lifecycleRevision 不符 → 過期丟棄',
    run: () => {
      const worldDay = 6000 as WorldDay;
      // 角色的生命週期已推進過一次（例如已退休），舊 Job 帶的是 0。
      const child = makeCharacter({
        characterId: 'kid' as CharacterId,
        birthDay: 0 as WorldDay,
        availability: 'unavailable',
        lifecycleRevisions: { adulthood: 1 as Revision, retirementCheck: 0 as Revision, naturalDeathCheck: 0 as Revision },
      });
      const state = createCharacterState({ characters: [child] });
      const job: CharacterLifecycleJob = {
        jobId: 'job-stale' as never,
        type: 'characterLifecycleDue',
        dueDay: worldDay,
        ownerModule: 'character' as never,
        targetId: 'kid' as CharacterId,
        expectedRevision: 0 as Revision,
        payload: { kind: 'adulthood' },
      };
      const res = handleCharacterLifecycleJob(job, state, makeContext({ worldDay }));
      assert(
        reqChar(res.nextSlice, 'kid' as CharacterId).availability === 'unavailable',
        '過期 Job 不得改狀態',
      );
      assert(eventsOf(res.outgoingMessages).length === 0, '過期 Job 不得發事件');
    },
  },
  {
    // R8 P2 的另一半，也是不能直接拿 character.revision 驗的原因：受傷會跳 revision，
    // 若拿它當 expectedRevision，成年／自然死亡 Job 會全部被誤判成過期而永遠不觸發。
    name: '生命週期 Job：受傷跳 revision 但不跳 lifecycleRevision → 成年 Job 仍成立',
    run: () => {
      const worldDay = 6000 as WorldDay;
      const injured = makeCharacter({
        characterId: 'kid' as CharacterId,
        birthDay: 0 as WorldDay,
        availability: 'unavailable',
      });
      // 模擬排程後受過幾次傷：revision 已前進，lifecycleRevision 未動。
      const wounded: Character = { ...injured, revision: 7 as Revision };
      const state = createCharacterState({ characters: [wounded] });
      const job: CharacterLifecycleJob = {
        jobId: 'job-adult' as never,
        type: 'characterLifecycleDue',
        dueDay: worldDay,
        ownerModule: 'character' as never,
        targetId: 'kid' as CharacterId,
        expectedRevision: wounded.lifecycleRevisions.adulthood,
        payload: { kind: 'adulthood' },
      };
      const res = handleCharacterLifecycleJob(job, state, makeContext({ worldDay }));
      assert(
        reqChar(res.nextSlice, 'kid' as CharacterId).availability === 'available',
        '受傷不得讓成年 Job 過期',
      );
      assert(hasEvent(eventsOf(res.outgoingMessages), 'CharacterBecameAdult'), '應 emit CharacterBecameAdult');
    },
  },
  {
    // R9 #3：R8 #6 用單一 lifecycleRevision，退休會跳它 → 出生時就排好的自然死亡 Job 一起作廢，
    // 退休角色從此不會自然老死（但 Handler 明明允許 retired 執行）。token 必須逐種類分開。
    name: '生命週期 Job：退休不得作廢自然死亡 Job（退休角色仍會自然老死）',
    run: () => {
      const worldDay = 30000 as WorldDay; // > 自然壽命終點 29200
      const born = makeCharacter({ characterId: 'elder' as CharacterId, birthDay: 0 as WorldDay });
      // 出生時排好的自然死亡 Job，帶的是當時的 naturalDeathCheck token。
      const deathJob: CharacterLifecycleJob = {
        jobId: 'job-death' as never,
        type: 'characterLifecycleDue',
        dueDay: worldDay,
        ownerModule: 'character' as never,
        targetId: 'elder' as CharacterId,
        expectedRevision: born.lifecycleRevisions.naturalDeathCheck,
        payload: { kind: 'naturalDeathCheck' },
      };

      // 中途退休：跑一次 retirementCheck 並讓 resolver 判定觸發。
      const retireJob: CharacterLifecycleJob = {
        jobId: 'job-retire' as never,
        type: 'characterLifecycleDue',
        dueDay: 20075 as WorldDay,
        ownerModule: 'character' as never,
        targetId: 'elder' as CharacterId,
        expectedRevision: born.lifecycleRevisions.retirementCheck,
        payload: { kind: 'retirementCheck' },
      };
      const retired = handleCharacterLifecycleJob(
        retireJob,
        createCharacterState({ characters: [born] }),
        makeContext({
          worldDay: 20075 as WorldDay,
          resolvers: stubResolverPort({ resolveRetirement: () => ({ outcome: 'trigger' }) }),
        }),
      );
      assert(reqChar(retired.nextSlice, 'elder' as CharacterId).lifeState === 'retired', '前提：角色應已退休');

      // 自然死亡 Job 到期：退休不得讓它過期。
      const died = handleCharacterLifecycleJob(
        deathJob,
        retired.nextSlice,
        makeContext({
          worldDay,
          resolvers: stubResolverPort({ resolveNaturalDeath: () => ({ outcome: 'trigger' }) }),
        }),
      );
      assert(
        reqChar(died.nextSlice, 'elder' as CharacterId).lifeState === 'dead',
        '退休角色仍應自然老死（退休不得作廢自然死亡 Job）',
      );
      assert(hasEvent(eventsOf(died.outgoingMessages), 'CharacterDied'), '應 emit CharacterDied');
    },
  },
  {
    name: '生命週期 Job：退休後的舊退休檢查 Job 過期丟棄（該種類的 token 已跳）',
    run: () => {
      const born = makeCharacter({ characterId: 'elder2' as CharacterId, birthDay: 0 as WorldDay });
      const retireJob: CharacterLifecycleJob = {
        jobId: 'job-retire' as never,
        type: 'characterLifecycleDue',
        dueDay: 20075 as WorldDay,
        ownerModule: 'character' as never,
        targetId: 'elder2' as CharacterId,
        expectedRevision: born.lifecycleRevisions.retirementCheck,
        payload: { kind: 'retirementCheck' },
      };
      const ctx = makeContext({
        worldDay: 20075 as WorldDay,
        resolvers: stubResolverPort({ resolveRetirement: () => ({ outcome: 'trigger' }) }),
      });
      const retired = handleCharacterLifecycleJob(retireJob, createCharacterState({ characters: [born] }), ctx);
      // 同一筆（或重複的）退休檢查再跑一次：token 已跳 → no-op，不得重複發 CharacterRetired。
      const again = handleCharacterLifecycleJob(retireJob, retired.nextSlice, ctx);
      assert(eventsOf(again.outgoingMessages).length === 0, '過期的退休檢查不得再發事件');
    },
  },
  {
    name: 'HomeYearRestCompleted: 生育成功 → 子女 + 雙向親子 + 事件',
    run: () => {
      const a = makeCharacter({ characterId: 'pa' as CharacterId, sex: 'male', birthDay: 0 as WorldDay });
      const b = makeCharacter({ characterId: 'ma' as CharacterId, sex: 'female', birthDay: 0 as WorldDay });
      const partnerLink: FamilyLink = {
        familyLinkId: 'link-partner' as FamilyLinkId,
        kind: 'partner',
        characterIds: ['pa' as CharacterId, 'ma' as CharacterId],
        activeFromDay: 0 as WorldDay,
        revision: 0 as Revision,
      };
      const state = createCharacterState({ characters: [a, b], familyLinks: [partnerLink] });
      const ctx = makeContext({
        resolvers: stubResolverPort({
          resolveBirth: () => ({ born: true, archetypeId: PLAYER_ARCHETYPE_ID, sex: 'female', innateTraitIds: [] }),
        }),
      });
      const res = onHomeYearRestCompleted(
        { type: 'HomeYearRestCompleted', teamId: 'team-1' as never, memberIds: ['pa' as CharacterId, 'ma' as CharacterId], elapsedDays: 365 },
        state,
        ctx,
      );
      const born = findEvent(eventsOf(res.outgoingMessages), 'CharacterBorn');
      assert(born !== undefined, '應 emit CharacterBorn');
      const childId = born!.characterId;
      const child = reqChar(res.nextSlice, childId);
      assert(child.parentIds.length === 2, '子女應有兩名父母');
      assert(child.availability === 'unavailable', '新生兒未成年不可入隊');
      // 雙向對稱
      assert(reqChar(res.nextSlice, 'pa' as CharacterId).childIds.includes(childId), '父應含 childId');
      assert(reqChar(res.nextSlice, 'ma' as CharacterId).childIds.includes(childId), '母應含 childId');
      // 排了新生兒的生命週期 Job（含成年）
      assert(res.scheduledJobs.some((j) => (j.payload as { kind: string }).kind === 'adulthood'), '應排成年 Job');
    },
  },
  {
    name: 'QuestStateChanged: 任務到期回收護衛暫時角色',
    run: () => {
      const questId = 'quest-1' as QuestId;
      const escort = makeEscort('esc-1' as CharacterId, questId);
      const state = createCharacterState({ characters: [escort] });
      const res = onQuestStateChanged(
        { type: 'QuestStateChanged', questId, oldStatus: 'incomplete', newStatus: 'expired', reason: 'actualEndDeadline' },
        state,
        makeContext(),
      );
      const next = reqChar(res.nextSlice, 'esc-1' as CharacterId);
      assert(next.availability === 'unavailable', '回收後應 unavailable');
      assert(hasEvent(eventsOf(res.outgoingMessages), 'TemporaryCharacterRecovered'), '應 emit TemporaryCharacterRecovered');
    },
  },
  {
    name: 'ApplyCharacterReputationEffect: 依 Effect 調整聲望 + 事件',
    run: () => {
      const state = fixtureCharacterState();
      const ctx = makeContext({ resolvers: stubResolverPort({ resolveReputationDelta: () => 5 }) });
      const cmd: ApplyCharacterReputationEffect = { type: 'ApplyCharacterReputationEffect',
        characterId: PLAYER_ID,
        effectId: 'eff-rep' as EffectDefinitionId,
        sourceId: PLAYER_ID,
      };
      const res = handleApplyCharacterReputationEffect(cmd, state, ctx);
      assert(reqChar(res.nextSlice, PLAYER_ID).reputation === 5, '聲望應 +5');
      const ev = findEvent(eventsOf(res.outgoingMessages), 'CharacterReputationChanged');
      assert(ev !== undefined && ev.oldValue === 0 && ev.newValue === 5, '事件值應正確');
    },
  },
  {
    name: 'ProgressionCapacityChanged: 上限下降 → 當前 HP 被夾住',
    run: () => {
      const hurt = makeCharacter({
        characterId: PLAYER_ID,
        condition: { health: 100, mana: 50, statuses: [] },
      });
      const state = createCharacterState({ characters: [hurt] });
      // 新上限 60 → HP 應被夾到 60
      const ctx = makeContext({ stats: stubStatsQuery(60, 30) });
      const res = onStatsCapacityChanged(
        { type: 'EquipmentChanged', characterId: PLAYER_ID, slotId: 'mainHand' as never },
        state,
        ctx,
      );
      const next = reqChar(res.nextSlice, PLAYER_ID);
      assert(next.condition.health === 60 && next.condition.mana === 30, '當前資源應被新上限夾住');
      assert(hasEvent(eventsOf(res.outgoingMessages), 'CharacterConditionChanged'), '應 emit CharacterConditionChanged');
    },
  },
];

export type CharacterTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

// 執行全部案例並回傳結果（供 harness 收集）。
export function runTestsVerbose(): readonly CharacterTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return { name: c.name, passed: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// 任一失敗即 throw（含所有失敗案例名稱）。
export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(`character module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
