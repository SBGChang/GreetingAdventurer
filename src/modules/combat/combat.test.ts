// modules/combat/combat.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。

import type { CombatantId, EncounterId } from '../../contracts/core';
import type { TransactionMessageDraft, ModuleOutcome, ModuleResult } from '../../contracts/core';
import type {
  CombatDomainEvent,
  CombatActionResult,
  ActionDelayRuleDefinition,
} from '../../contracts/combat';

import type { CombatState, CombatEncounter, CombatantState } from './state';
import { createInitialCombatState, upsertEncounter } from './state';
import {
  handleStartCombatEncounter,
  handleUseCombatSkill,
  handleEnemyTurn,
  handleCombatRest,
  handleCommandAlly,
  advanceToNextActor,
} from './system';
import {
  makeCombatContext,
  makeEncounter,
  stubProgressionQuery,
  fixtureStartCommand,
  SKILL_STRIKE,
  SKILL_COUNTER,
  SKILL_HEAL,
  SKILL_BITE,
  SKILL_CAST_DAMAGE,
  SKILL_CTB_DELAY,
  SKILL_INTERRUPT,
  CTRL_ELITE,
  CTRL_BOSS,
  stubDefinitionReader,
  stubLoadoutQuery,
  DELAY_STANDARD,
  EFF_COUNTER_DAMAGE,
  HERO_ID,
  MAGE_ID,
  WEAPON_SET_A,
  WEAPON_SET_B,
  WEAPON_SET_C,
  DELAY_WEAPON_SWITCH,
  WEAPON_SWITCH_DELAY,
  stubResolverPort,
} from './fixtures';
import { makeCombatQuery } from './queries';
import { localCell } from './state';
import type { Revision, SkillDefinitionId } from '../../contracts/core';
import type { ApplyCombatCondition } from '../../contracts/character';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// P1-6：可拒絕的 Handler 改回 ModuleOutcome 之後，測試必須明講它預期接受還是拒絕。
// 這正是改動的重點——原本兩者都長成「回傳未變 slice」，測試寫不出區別，所以也就測不到。
function ok(outcome: ModuleOutcome<CombatState>): ModuleResult<CombatState> {
  if (!outcome.ok) throw new Error(`預期接受，實際拒絕：${outcome.rejection.code}`);
  return outcome.result;
}
function rejectedWith(outcome: ModuleOutcome<CombatState>, code: string): void {
  if (outcome.ok) throw new Error(`預期拒絕 "${code}"，實際接受`);
  assert(
    outcome.rejection.code === code,
    `預期拒絕碼 "${code}"，實際 "${outcome.rejection.code}"`,
  );
}
function eventsOf(messages: readonly TransactionMessageDraft[]): CombatDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as CombatDomainEvent);
}
function countEvent(events: readonly CombatDomainEvent[], type: CombatDomainEvent['type']): number {
  return events.filter((e) => e.type === type).length;
}
// CombatActionResolved.results 現在是**判別聯集**（一個 kind 一張表），不再是
// Record<string, JsonValue> 袋子——測試因此可以直接讀具名欄位，而不是先自己轉型。
function actionResultsOf(messages: readonly TransactionMessageDraft[]): readonly CombatActionResult[] {
  const event = eventsOf(messages).find((e) => e.type === 'CombatActionResolved');
  if (event === undefined || event.type !== 'CombatActionResolved') {
    throw new Error('預期有一筆 CombatActionResolved');
  }
  return event.results;
}
function commandsOf(messages: readonly TransactionMessageDraft[]): unknown[] {
  return messages.filter((m) => 'command' in m).map((m) => (m as { command: unknown }).command);
}
function aliveEnemies(encounter: CombatEncounter): CombatantState[] {
  return (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.side === 'enemy' && c.state !== 'dead');
}

// ── 測試案例 ─────────────────────────────────────────────────────────────
type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    // R14 #1：武器組可能存著失效的技能引用（舊存檔、被移除的內容、未載入的內容包）。
    // getAvailableActions 直接 getSkillView 會讓**整個戰鬥選單 Query 拋錯**。
    name: 'getAvailableActions: 武器組含失效技能引用時，選單仍可建立（跳過該技能而非拋錯）',
    run: () => {
      const GHOST = 'definition:skill:removed-by-content-update' as never;
      const ctx = makeCombatContext();
      const encounter = makeEncounter([
        { combatantId: HERO_ID as unknown as CombatantId, side: 'player', currentCtb: 0, col: 1, characterId: HERO_ID },
      ]);
      const withActor: CombatEncounter = { ...encounter, currentActorId: HERO_ID as unknown as CombatantId };
      const state = upsertEncounter(createInitialCombatState(), withActor);

      // 武器組第一格是失效引用，第二格是正常技能。
      const loadout = {
        getEquipmentLoadout: () => ({
          characterId: HERO_ID,
          armorSlots: {},
          weaponSets: [
            { weaponSetId: WEAPON_SET_A, selectedSkillIds: [GHOST, SKILL_STRIKE, undefined] },
            { weaponSetId: WEAPON_SET_B, selectedSkillIds: [undefined, undefined, undefined] },
            { weaponSetId: WEAPON_SET_C, selectedSkillIds: [undefined, undefined, undefined] },
          ],
          revision: 0,
        }),
      } as unknown as typeof ctx.loadout;

      const query = makeCombatQuery(state, { definitions: ctx.definitions, loadout, progression: ctx.progression });
      let options;
      try {
        options = query.getAvailableActions(withActor.encounterId, HERO_ID as unknown as CombatantId);
      } catch (error) {
        throw new Error(`失效技能引用不得讓戰鬥選單拋錯：${error instanceof Error ? error.message : String(error)}`);
      }
      assert(
        options.every((o) => String(o.skillId) !== String(GHOST)),
        '失效技能不應出現在選單中',
      );
      assert(
        options.some((o) => o.skillId === SKILL_STRIKE),
        '同組的正常技能仍應列出（不得因一筆失效引用整組消失）',
      );
    },
  },
  {
    name: 'CTB 倒扣式：最小 currentCtb 先行動；同值跨側玩家優先',
    run: () => {
      const ctx = makeCombatContext();

      // (a) A(player,10) / E(enemy,10) / B(player,5) → 倒扣 5 → 只有 B 抵 0 → B 先。
      const encA = makeEncounter([
        { combatantId: 'pa', side: 'player', currentCtb: 10, col: 1 },
        { combatantId: 'ee', side: 'enemy', currentCtb: 10, col: 1 },
        { combatantId: 'pb', side: 'player', currentCtb: 5, col: 2 },
      ]);
      const advA = advanceToNextActor(encA, ctx);
      assert(advA.currentActorId === ('pb' as CombatantId), `最小 CTB 應先行動，實際 ${String(advA.currentActorId)}`);

      // (b) A(player,5) / E(enemy,5) 同值跨側 → 玩家 A 先，readyQueue=[A,E]（不變量 12）。
      const encB = makeEncounter([
        { combatantId: 'pa', side: 'player', currentCtb: 5, col: 1 },
        { combatantId: 'ee', side: 'enemy', currentCtb: 5, col: 1 },
      ]);
      const advB = advanceToNextActor(encB, ctx);
      assert(advB.currentActorId === ('pa' as CombatantId), '同值跨側應玩家優先');
      assert(
        advB.readyQueue.length === 2 && advB.readyQueue[0] === ('pa' as CombatantId) && advB.readyQueue[1] === ('ee' as CombatantId),
        'readyQueue 應為 [玩家, 敵方]',
      );
      // Query 不消費 RNG / 不改動排序：兩者皆抵 0 後 cursor 不因單元素側而前進。
      assert(advB.currentActorId !== undefined, '應有行動者');
    },
  },
  {
    name: '傷害技能擊殺一名敵人',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;
      assert(encounter.combatants[actorId]!.side === 'player', '開場行動者應為玩家（反應較高先手）');

      const enemyId = aliveEnemies(encounter)[0]!.combatantId;
      const res = ok(
        handleUseCombatSkill(
          started.nextSlice,
          {
            type: 'useCombatSkill',
            encounterId,
            actorId,
            skillId: SKILL_STRIKE,
            targetCombatantIds: [enemyId],
          },
          ctx,
        ),
      );
      const after = res.nextSlice.encounters[encounterId]!;
      const enemy = after.combatants[enemyId]!;
      assert(enemy.state === 'dead', `敵人應死亡（HP20 受 30 傷），實際 state=${enemy.state}`);
      assert(enemy.health === 0, 'HP 應夾到 0');
      assert(countEvent(eventsOf(res.outgoingMessages), 'CombatActionResolved') === 1, '應 emit 一次 CombatActionResolved');
    },
  },
  {
    name: '資源不足 → 拒絕（不施放、不扣、不夾零）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;
      // 把行動者法力壓到 SKILL_HEAL 成本（5）以下。
      const drained: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...encounter,
            combatants: {
              ...encounter.combatants,
              [actorId]: { ...encounter.combatants[actorId]!, mana: 3 },
            },
          },
        },
      };
      const res = handleUseCombatSkill(
        drained,
        { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_HEAL, targetCombatantIds: [actorId] },
        ctx,
      );
      // P1-6 前是「回傳未變 slice」，與「成功但這回合沒事發生」無從區分——Runner 會照常提交。
      rejectedWith(res, 'combat/insufficient-resources');
    },
  },
  {
    name: '技能未配置於目前武器組 → 拒絕（不施放）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;
      const enemyId = aliveEnemies(encounter)[0]!.combatantId;
      // SKILL_BITE 是敵方招式，不在玩家武器組 selectedSkillIds 內。
      const res = handleUseCombatSkill(
        started.nextSlice,
        { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_BITE, targetCombatantIds: [enemyId] },
        ctx,
      );
      rejectedWith(res, 'combat/skill-not-in-active-weapon-set');
    },
  },
  {
    name: '攻擊技能不得作用我方隊友（側別過濾 → 全數不合法 → 拒絕）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      // 找一個「非行動者」的玩家方 combatant 當隊友。
      const ally = Object.values(enc.combatants).find(
        (c) => c.side === 'player' && c.combatantId !== actorId,
      );
      assert(ally !== undefined, 'fixture 應有另一名玩家方 combatant 作為隊友');
      const allyId = ally!.combatantId;
      const res = handleUseCombatSkill(
        started.nextSlice,
        { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [allyId] },
        ctx,
      );
      rejectedWith(res, 'combat/no-legal-target');
    },
  },
  {
    name: '重複目標 ID 只命中一次（去重；單次與重複造成相同傷害）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc0 = started.nextSlice.encounters[encounterId]!;
      const actorId = enc0.currentActorId!;
      const enemyId = aliveEnemies(enc0)[0]!.combatantId;
      // 把敵人 HP 拉高，讓單次傷害殺不死，才能區分「一次」與「兩次」命中。
      const boosted: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...enc0,
            combatants: {
              ...enc0.combatants,
              [enemyId]: { ...enc0.combatants[enemyId]!, health: 500, maxHealth: 500 },
            },
          },
        },
      };
      const cmd = (targets: readonly CombatantId[]) => ({
        type: 'useCombatSkill' as const,
        encounterId,
        actorId,
        skillId: SKILL_STRIKE,
        targetCombatantIds: targets,
      });
      const once = ok(handleUseCombatSkill(boosted, cmd([enemyId]), ctx)).nextSlice.encounters[encounterId]!.combatants[enemyId]!;
      const twice = ok(handleUseCombatSkill(boosted, cmd([enemyId, enemyId]), ctx)).nextSlice.encounters[encounterId]!.combatants[enemyId]!;
      assert(once.health < 500, '單次攻擊應造成傷害');
      assert(once.health > 0, '單次攻擊不應直接擊殺（否則無法區分重複命中）');
      assert(twice.health === once.health, `重複目標不得雙重命中：單次剩 ${once.health}、重複剩 ${twice.health}`);
    },
  },
  {
    name: '側別由效果推定而非 actionKind：cast 傷害技能不得作用同側（把傷害標成 cast 也擋得住）',
    // P1-6：同側目標現在是拒絕而非 no-op；對照組（打敵方）仍應成功，證明擋的是側別不是技能壞了。
    run: () => {
      const ctx = makeCombatContext();
      const enc = {
        ...makeEncounter([
          { combatantId: 'p1', side: 'player', health: 100 },
          { combatantId: 'm1', side: 'enemy', health: 100 },
          { combatantId: 'm2', side: 'enemy', health: 80 },
        ]),
        currentActorId: 'm1' as CombatantId,
      };
      const state = upsertEncounter(createInitialCombatState(), enc);
      const cast = (targetId: string) => ({
        type: 'useCombatSkill' as const,
        encounterId: enc.encounterId,
        actorId: 'm1' as CombatantId,
        skillId: SKILL_CAST_DAMAGE,
        targetCombatantIds: [targetId as CombatantId],
      });
      // m1（enemy）以 cast 傷害點自己人 m2（同 enemy 側）→ 依效果篩側別 → 拒絕、m2 不受傷。
      rejectedWith(handleUseCombatSkill(state, cast('m2'), ctx), 'combat/no-legal-target');
      // 對照：點敵方 p1 應正常造成傷害（證明擋下的是側別、不是技能壞了）。
      const oppSide = ok(handleUseCombatSkill(state, cast('p1'), ctx)).nextSlice.encounters[enc.encounterId]!.combatants['p1' as CombatantId]!;
      assert(oppSide.health < 100, `cast 傷害對敵方應生效（實得 ${oppSide.health}）`);
    },
  },
  {
    name: '#4：溢出傷害不計入攻擊熟練度（尾刀只算真正扣除的 HP）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc0 = started.nextSlice.encounters[encounterId]!;
      const actorId = enc0.currentActorId!;
      const actor = enc0.combatants[actorId]!;
      assert(actor.source.kind === 'character', '行動者應為玩家角色');
      const characterId = actor.source.kind === 'character' ? actor.source.characterId : undefined;
      const enemyId = aliveEnemies(enc0)[0]!.combatantId;
      // 敵人壓到 5 HP：面板傷害（30）溢出 25，只有 5 是有效傷害。
      const state: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...enc0,
            combatants: { ...enc0.combatants, [enemyId]: { ...enc0.combatants[enemyId]!, health: 5 } },
          },
        },
      };
      const res = ok(
        handleUseCombatSkill(
          state,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [enemyId] },
          ctx,
        ),
      );
      const ledger = res.nextSlice.encounters[encounterId]?.attackDamageByCharacter[characterId!] ?? {};
      const total = Object.values(ledger).reduce((a, b) => a + b, 0);
      assert(total === 5, `攻擊熟練度應記有效傷害 5（非面板 30），實得 ${total}`);
    },
  },
  {
    name: '#6：未學/偽造技能於 knows() 即擋下，不得先呼叫 getSkillView（不崩潰）',
    run: () => {
      const BOGUS = 'skill-bogus-not-a-def' as SkillDefinitionId;
      // 真實 progression：偽造/未學技能 knows() 回 false。fixture getSkillView 對未知 id 會 throw，
      // 故舊順序（先 getSkillView）會崩；新順序 knows() 先擋。
      const ctx = makeCombatContext({
        progression: { ...stubProgressionQuery(), knows: (_c, skillId) => skillId !== BOGUS },
      });
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;
      const res = handleUseCombatSkill(
        started.nextSlice,
        { type: 'useCombatSkill', encounterId, actorId, skillId: BOGUS, targetCombatantIds: [enemyId] },
        ctx,
      );
      // 拒絕碼本身就是「擋在 knows() 這一關」的證據：走到 getSkillView 會是例外而非拒絕。
      rejectedWith(res, 'combat/skill-not-learned');
    },
  },
  {
    name: '全滅 → resolved + 恰一次 MasteryEarned',
    run: () => {
      const ctx = makeCombatContext();
      let state: CombatState = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx),
      ).nextSlice;
      const encounterId = Object.keys(state.encounters)[0]! as EncounterId;

      const allEvents: CombatDomainEvent[] = [];
      // 驅動整場：玩家用 strike 打最前敵人；敵方走 AI。
      for (let guard = 0; guard < 50; guard += 1) {
        const encounter = state.encounters[encounterId]!;
        if (encounter.state === 'resolved') break;
        const actorId = encounter.currentActorId;
        if (actorId === undefined) break;
        const actor = encounter.combatants[actorId]!;
        let res;
        if (actor.side === 'player') {
          const target = aliveEnemies(encounter)[0];
          if (target === undefined) break;
          res = ok(
            handleUseCombatSkill(
              state,
              { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [target.combatantId] },
              ctx,
            ),
          );
        } else {
          res = ok(handleEnemyTurn(state, encounterId, ctx));
        }
        allEvents.push(...eventsOf(res.outgoingMessages));
        state = res.nextSlice;
      }

      const encounter = state.encounters[encounterId]!;
      assert(encounter.state === 'resolved', `應結算為 resolved，實際 ${encounter.state}`);
      assert(countEvent(allEvents, 'CombatEncounterResolved') === 1, '應恰發一次 CombatEncounterResolved');
      const resolved = allEvents.find((e) => e.type === 'CombatEncounterResolved');
      assert(resolved !== undefined && (resolved as { outcome: string }).outcome === 'victory', '結果應為 victory');
      assert(countEvent(allEvents, 'CombatAttackMasteryEarned') === 1, '攻擊 MXP 應恰發一次（結束時一次性）');
      assert(countEvent(allEvents, 'CombatTeamOutcome') === 1, '應恰發一次 CombatTeamOutcome');
    },
  },
  {
    // 迴歸測試：結算送出的 ApplyCombatCondition 是 delta，接收端做 condition.health + delta。
    // 基準必須是**開戰快照**而非上限——否則帶傷進場的角色會被再扣一次已受的傷。
    name: '結算 delta 相對開戰值，不是相對上限（帶傷進場不得被重複扣血）',
    run: () => {
      // 法師 40/80 帶傷進場、站後排（AI 只打前排），全場不該掉血 → delta 應為 0。
      const ctx = makeCombatContext({
        formation: {
          getPlayerFormation: () => ({
            teamId: 'team-player' as never,
            formationRevision: 0 as Revision,
            members: [
              { characterId: HERO_ID, cell: localCell(1, 1), activeWeaponSetId: WEAPON_SET_A, maxHealth: 100, maxMana: 30, startHealth: 100, startMana: 30 },
              { characterId: MAGE_ID, cell: localCell(2, 2), activeWeaponSetId: WEAPON_SET_A, maxHealth: 80, maxMana: 50, startHealth: 40, startMana: 50 },
            ],
          }),
        },
      });
      let state: CombatState = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx),
      ).nextSlice;
      const encounterId = Object.keys(state.encounters)[0]! as EncounterId;

      const allCommands: unknown[] = [];
      for (let guard = 0; guard < 50; guard += 1) {
        const encounter = state.encounters[encounterId]!;
        if (encounter.state === 'resolved') break;
        const actorId = encounter.currentActorId;
        if (actorId === undefined) break;
        const actor = encounter.combatants[actorId]!;
        let res;
        if (actor.side === 'player') {
          const target = aliveEnemies(encounter)[0];
          if (target === undefined) break;
          res = ok(
            handleUseCombatSkill(
              state,
              { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [target.combatantId] },
              ctx,
            ),
          );
        } else {
          res = ok(handleEnemyTurn(state, encounterId, ctx));
        }
        allCommands.push(...commandsOf(res.outgoingMessages));
        state = res.nextSlice;
      }

      const conditions = allCommands.filter(
        (c): c is ApplyCombatCondition =>
          typeof c === 'object' && c !== null && (c as { type?: string }).type === 'ApplyCombatCondition',
      );
      assert(conditions.length > 0, '結算應對角色送出 ApplyCombatCondition');

      const mage = conditions.find((c) => c.characterId === MAGE_ID);
      assert(mage !== undefined, '法師應收到寫回命令');
      assert(
        mage!.healthDelta === 0,
        `未受傷的帶傷進場角色 healthDelta 應為 0（用上限當基準會是 -40），實得 ${mage!.healthDelta}`,
      );

      // 每名角色的 delta 都不得低於「該場實際承受的傷害」。
      const encounter = state.encounters[encounterId]!;
      for (const c of conditions) {
        const combatant = Object.values(encounter.combatants).find(
          (b) => b.source.kind === 'character' && b.source.characterId === c.characterId,
        );
        assert(combatant !== undefined, '寫回對象應存在於 Encounter');
        assert(
          c.healthDelta === combatant!.health - combatant!.startHealth,
          `${c.characterId} 的 healthDelta 應等於 結束值−開戰值`,
        );
      }
    },
  },
  {
    name: '反擊架勢：敵方攻擊持架勢者 → 反擊解析一次並解除架勢',
    run: () => {
      const ctx = makeCombatContext();
      const stance = {
        skillId: SKILL_COUNTER,
        conditionResolverId: 'res-counter-cond' as never,
        counterDelayRuleId: DELAY_STANDARD,
        counterEffectIds: [EFF_COUNTER_DAMAGE],
      };
      let encounter = makeEncounter([
        { combatantId: 'p', side: 'player', characterId: HERO_ID, row: 1, col: 1, health: 100, counterStance: stance },
        { combatantId: 'e', side: 'enemy', row: 1, col: 2, health: 100 },
      ]);
      // 敵方 e 為當前行動者。
      encounter = { ...encounter, currentActorId: 'e' as CombatantId, readyQueue: ['e' as CombatantId] };
      const state = upsertEncounter(createInitialCombatState(), encounter);

      const res = ok(handleEnemyTurn(state, encounter.encounterId, ctx));
      const after = res.nextSlice.encounters[encounter.encounterId]!;
      const attacker = after.combatants['e' as CombatantId]!;
      const defender = after.combatants['p' as CombatantId]!;
      assert(attacker.health === 70, `攻擊者應受 30 反擊傷害（100→70），實際 ${attacker.health}`);
      assert(defender.counterStance === undefined, '反擊後架勢應解除');
      assert(defender.health === 95, `防守者應受敵方 5 點咬擊（100→95），實際 ${defender.health}`);
    },
  },
  {
    // 上一案把 counterStance 直接塞進 Encounter，因此**只測了反擊的解析、沒測架勢的建立**。
    // 建立那一側走的是 handleUseCombatSkill 的 counterStance 分支，整支測試檔一次都沒有驅動過它，
    // 所以當 targeting 改動讓「立架勢」永遠被 combat/target-resolver-illegal-side 擋下時，
    // 20 個既有案例全綠。這一案把建立→解析整條鏈接起來釘住。
    name: '反擊架勢：經由 handleUseCombatSkill 建立架勢（建立這一側先前完全沒有測試覆蓋）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;

      // 立架勢：SKILL_COUNTER 的 effectIds 是**反擊時**打在攻擊者身上的傷害，不是本次行動的效果；
      // 本次行動的目標是行動者自己（targeting resolver 回傳 self）。拿反擊效果推定側別會把
      // 「反擊會造成傷害」誤讀成「架勢必須指向敵人」，於是自身向的架勢永遠不合法。
      const established = ok(
        handleUseCombatSkill(
          started.nextSlice,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_COUNTER, targetCombatantIds: [actorId] },
          ctx,
        ),
      );
      const afterEstablish = established.nextSlice.encounters[encounterId]!;
      const stanceHolder = afterEstablish.combatants[actorId]!;
      assert(stanceHolder.counterStance !== undefined, '架勢應建立在行動者身上');
      assert(
        stanceHolder.counterStance!.skillId === SKILL_COUNTER,
        '架勢應記住建立它的技能（反擊時要用它的效果）',
      );
      // 建立架勢消耗本次行動、不立即套用效果：敵人不得因此受傷。
      for (const e of aliveEnemies(afterEstablish)) {
        assert(
          e.health === enc.combatants[e.combatantId]!.health,
          '建立架勢不得立即造成傷害（效果要等反擊條件成立才套用）',
        );
      }
      const stanceResult = actionResultsOf(established.outgoingMessages).find(
        (r) => r.kind === 'counterStanceEstablished',
      );
      assert(stanceResult !== undefined, '應回報一筆 counterStanceEstablished');
      if (stanceResult === undefined || stanceResult.kind !== 'counterStanceEstablished') return;
      assert(stanceResult.actorId === actorId, 'counterStanceEstablished 應帶 branded actorId');
      assert(stanceResult.skillId === SKILL_COUNTER, 'counterStanceEstablished 應帶建立架勢的技能');

      // 建立→解析整條鏈：讓敵方接著行動，架勢必須真的反擊回去並解除。
      const enemyId = aliveEnemies(afterEstablish)[0]!.combatantId;
      const enemyTurnState: CombatState = {
        ...established.nextSlice,
        encounters: {
          ...established.nextSlice.encounters,
          [encounterId]: { ...afterEstablish, currentActorId: enemyId },
        },
      };
      const countered = ok(handleEnemyTurn(enemyTurnState, encounterId, ctx));
      const afterCounter = countered.nextSlice.encounters[encounterId]!;
      assert(
        afterCounter.combatants[actorId]!.counterStance === undefined,
        '反擊解析後架勢應解除（一次性）',
      );
      assert(
        afterCounter.combatants[enemyId]!.health < afterEstablish.combatants[enemyId]!.health,
        '經由 Handler 建立的架勢必須真的能反擊——否則只是狀態欄位對，機制沒接上',
      );
    },
  },
  {
    // P1-6：這兩種情形原本合併成 `encounter === undefined || state === 'resolved'` 的同一個 no-op。
    // 合併掉的是有用資訊——「這場戰鬥不存在」與「這場戰鬥已經打完了」對呼叫端是不同的事。
    name: 'P1-6：Encounter 不存在與已結算是兩種不同的拒絕，不再是同一個 no-op',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;

      const GHOST = 'runtime:encounter~test~ghost' as EncounterId;
      rejectedWith(
        handleCombatRest(started.nextSlice, { type: 'combatRest', encounterId: GHOST, actorId }, ctx),
        'combat/encounter-not-found',
      );

      const resolvedState: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: { ...encounter, state: 'resolved' },
        },
      };
      rejectedWith(
        handleCombatRest(resolvedState, { type: 'combatRest', encounterId, actorId }, ctx),
        'combat/encounter-resolved',
      );
    },
  },
  {
    name: 'P1-6：combatRest 正常路徑接受；非當前行動者則拒絕',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;

      const rested = ok(
        handleCombatRest(started.nextSlice, { type: 'combatRest', encounterId, actorId }, ctx),
      );
      const after = rested.nextSlice.encounters[encounterId]!.combatants[actorId]!;
      const before = encounter.combatants[actorId]!;
      assert(after.currentCtb > before.currentCtb, '休息應增加行動延遲');

      // 別人的回合送 combatRest：原本是靜默 no-op，玩家看不出指令沒生效。
      const other = Object.values(encounter.combatants).find((c) => c.combatantId !== actorId)!;
      rejectedWith(
        handleCombatRest(
          started.nextSlice,
          { type: 'combatRest', encounterId, actorId: other.combatantId },
          ctx,
        ),
        'combat/not-current-actor',
      );
    },
  },
  {
    // 規範 §10：未閉合的 Capability 不得表現成「送出成功但什麼都沒發生」。
    // 正常情況下 Router 會在 dispatch 前就以 engine/feature-not-available 擋下；這是第二道保險。
    name: 'P1-6：commandAlly 尚未實作 → 明確拒絕，不是成功 no-op',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const allyId = Object.values(enc.combatants).find((c) => c.side === 'player')!.combatantId;
      rejectedWith(
        handleCommandAlly(started.nextSlice, { type: 'commandAlly', encounterId, allyId }, ctx),
        'combat/command-ally-not-implemented',
      );
    },
  },
  // ── 控制抗性（§2.6）─────────────────────────────────────────────────────
  // resistedCtbIncrease() 先前兩條分支同一個回傳值（整體 `return raw`），倍率恆為 1——
  // 規範 §5 點名的「缺少控制抗性時使用倍率 1」。以下四案釘住三個量全部來自抗性檔資料。
  {
    name: '控制抗性：外來 CTB 增加依抗性檔折算並向下取整',
    run: () => {
      // 同一個 raw（resolvePower stub 給 14，取自設計基準「標準 +14 CTB」），只換抗性檔 →
      // 結果必須不同。這就是「同一套 Runtime 換一份 Content Pack，行為要跟著改變」。
      const appliedFor = (profile: Parameters<typeof stubDefinitionReader>[0]): number => {
        const ctx = makeCombatContext({
          definitions: stubDefinitionReader(profile),
          loadout: stubLoadoutQuery([SKILL_CTB_DELAY, SKILL_INTERRUPT, SKILL_STRIKE]),
        });
        const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
        const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
        const encounter = started.nextSlice.encounters[encounterId]!;
        const actorId = encounter.currentActorId!;
        const enemyId = aliveEnemies(encounter)[0]!.combatantId;
        const before = encounter.combatants[enemyId]!.currentCtb;
        const res = ok(
          handleUseCombatSkill(
            started.nextSlice,
            { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_CTB_DELAY, targetCombatantIds: [enemyId] },
            ctx,
          ),
        );
        const after = res.nextSlice.encounters[encounterId]!.combatants[enemyId]!;
        assert(
          after.externalCtbIncreaseSinceOwnAction === after.currentCtb - before,
          '累積量必須等於實際套用量',
        );
        return after.currentCtb - before;
      };

      const normal = appliedFor(undefined);
      const elite = appliedFor(CTRL_ELITE);
      const boss = appliedFor(CTRL_BOSS);
      assert(normal === 14, `一般 ×1.00 → 14（實得 ${normal}）`);
      // 14 × 0.75 = 10.5 → floor 10。設計要求「單次 CTB 增加向下取整」，不是四捨五入的 11。
      assert(elite === 10, `菁英 ×0.75 → floor(10.5)=10（實得 ${elite}）`);
      assert(boss === 7, `Boss ×0.50 → 7（實得 ${boss}）`);
    },
  },
  {
    name: '控制抗性：兩次自身行動間的累積上限會夾住，額滿後不再增加',
    run: () => {
      // Boss 檔：×0.5、上限 18。預先設好累積量，驗證夾的是「剩餘額度」而不是單次值。
      const applyWithAccumulated = (accumulated: number): number => {
        const ctx = makeCombatContext({
          definitions: stubDefinitionReader(CTRL_BOSS),
          loadout: stubLoadoutQuery([SKILL_CTB_DELAY, SKILL_INTERRUPT, SKILL_STRIKE]),
        });
        const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
        const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
        const encounter = started.nextSlice.encounters[encounterId]!;
        const actorId = encounter.currentActorId!;
        const enemyId = aliveEnemies(encounter)[0]!.combatantId;
        const primed: CombatState = {
          ...started.nextSlice,
          encounters: {
            ...started.nextSlice.encounters,
            [encounterId]: {
              ...encounter,
              combatants: {
                ...encounter.combatants,
                [enemyId]: {
                  ...encounter.combatants[enemyId]!,
                  externalCtbIncreaseSinceOwnAction: accumulated,
                },
              },
            },
          },
        };
        const before = primed.encounters[encounterId]!.combatants[enemyId]!.currentCtb;
        const res = ok(
          handleUseCombatSkill(
            primed,
            { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_CTB_DELAY, targetCombatantIds: [enemyId] },
            ctx,
          ),
        );
        return res.nextSlice.encounters[encounterId]!.combatants[enemyId]!.currentCtb - before;
      };

      assert(applyWithAccumulated(0) === 7, '尚未累積 → 完整的 7');
      // 已累積 14、上限 18 → 只剩 4 的額度，折算後的 7 被夾成 4。
      const nearCap = applyWithAccumulated(14);
      assert(nearCap === 4, `剩餘額度 4 應夾住折算值 7（實得 ${nearCap}）`);
      assert(applyWithAccumulated(18) === 0, '額度已滿 → 完全不再增加');
      assert(applyWithAccumulated(25) === 0, '超額（例如中途換過抗性檔）→ 不得變成負值倒扣');
    },
  },
  {
    name: '控制抗性：Boss 成功被中斷一次後免疫再次中斷，一般怪物不免疫',
    run: () => {
      const runInterrupt = (
        profile: Parameters<typeof stubDefinitionReader>[0],
      ): { firstCleared: boolean; immuneAfterFirst: boolean; secondCleared: boolean } => {
        const ctx = makeCombatContext({
          definitions: stubDefinitionReader(profile),
          loadout: stubLoadoutQuery([SKILL_CTB_DELAY, SKILL_INTERRUPT, SKILL_STRIKE]),
        });
        const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
        const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
        const encounter = started.nextSlice.encounters[encounterId]!;
        const actorId = encounter.currentActorId!;
        const enemyId = aliveEnemies(encounter)[0]!.combatantId;

        // 讓敵人處於讀條狀態（interruptCasting 的前置條件），並指定當前行動者為玩家。
        const casting = {
          skillId: SKILL_BITE,
          actionKind: 'cast' as const,
          targetCombatantIds: [actorId],
          remainingDelay: 20,
        };
        const withCasting = (state: CombatState, immune: boolean): CombatState => {
          const enc = state.encounters[encounterId]!;
          return {
            ...state,
            encounters: {
              ...state.encounters,
              [encounterId]: {
                ...enc,
                currentActorId: actorId,
                combatants: {
                  ...enc.combatants,
                  [enemyId]: {
                    ...enc.combatants[enemyId]!,
                    casting,
                    interruptionImmuneUntilOwnAction: immune,
                  },
                },
              },
            },
          };
        };

        const first = ok(
          handleUseCombatSkill(
            withCasting(started.nextSlice, false),
            { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_INTERRUPT, targetCombatantIds: [enemyId] },
            ctx,
          ),
        );
        const afterFirst = first.nextSlice.encounters[encounterId]!.combatants[enemyId]!;

        // 第二次中斷：沿用第一次得到的免疫旗標，並讓敵人再次讀條。
        const second = ok(
          handleUseCombatSkill(
            withCasting(first.nextSlice, afterFirst.interruptionImmuneUntilOwnAction),
            { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_INTERRUPT, targetCombatantIds: [enemyId] },
            ctx,
          ),
        );
        const afterSecond = second.nextSlice.encounters[encounterId]!.combatants[enemyId]!;

        return {
          firstCleared: afterFirst.casting === undefined,
          immuneAfterFirst: afterFirst.interruptionImmuneUntilOwnAction,
          secondCleared: afterSecond.casting === undefined,
        };
      };

      const boss = runInterrupt(CTRL_BOSS);
      assert(boss.firstCleared, 'Boss 第一次應被成功中斷');
      assert(boss.immuneAfterFirst, 'Boss 抗性檔宣告「成功中斷後取得免疫」');
      assert(!boss.secondCleared, 'Boss 第二次中斷應被免疫擋下（讀條仍在）');

      const normal = runInterrupt(undefined);
      assert(normal.firstCleared, '一般怪物第一次應被成功中斷');
      assert(!normal.immuneAfterFirst, '一般抗性檔不授予中斷免疫');
      assert(normal.secondCleared, '一般怪物第二次中斷照樣生效');
    },
  },
  {
    name: '自身行動完成時清空行動窗：combatRest 與 useCombatSkill 一致',
    run: () => {
      // combatRest 曾經只清 externalCtbIncreaseSinceOwnAction、漏掉 interruptionImmuneUntilOwnAction。
      // 免疫實作之後，那會讓休息過一次的 Boss 永久免疫中斷。兩條路徑現在共用 clearOwnActionWindow()。
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const encounter = started.nextSlice.encounters[encounterId]!;
      const actorId = encounter.currentActorId!;
      const enemyId = aliveEnemies(encounter)[0]!.combatantId;
      const primed: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...encounter,
            combatants: {
              ...encounter.combatants,
              [actorId]: {
                ...encounter.combatants[actorId]!,
                externalCtbIncreaseSinceOwnAction: 12,
                interruptionImmuneUntilOwnAction: true,
              },
            },
          },
        },
      };

      const rested = ok(handleCombatRest(primed, { type: 'combatRest', encounterId, actorId }, ctx));
      const afterRest = rested.nextSlice.encounters[encounterId]!.combatants[actorId]!;
      assert(afterRest.externalCtbIncreaseSinceOwnAction === 0, 'combatRest 應清空累積的外來 CTB');
      assert(!afterRest.interruptionImmuneUntilOwnAction, 'combatRest 也必須清掉中斷免疫');

      const acted = ok(
        handleUseCombatSkill(
          primed,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [enemyId] },
          ctx,
        ),
      );
      const afterAct = acted.nextSlice.encounters[encounterId]!.combatants[actorId]!;
      assert(afterAct.externalCtbIncreaseSinceOwnAction === 0, 'useCombatSkill 應清空累積的外來 CTB');
      assert(!afterAct.interruptionImmuneUntilOwnAction, 'useCombatSkill 也必須清掉中斷免疫');
    },
  },
  // ── (A) targeting.targetResolverId 資料化（§2.4）───────────────────────────
  // 先前這個欄位**完全沒有消費者**：合法目標靠「有 dealDamage → 敵方、有 heal → 己方」推定並就地
  // 過濾，範圍／形狀／距離／人數上限一項都沒驗。以下六案釘住「目標集合由內容決定、結構不變量由程式守」。
  {
    name: 'targeting：命中誰由 targeting resolver 決定，不是由指令請求決定（換一份 targeting 內容，結果就不同）',
    run: () => {
      const started0 = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), makeCombatContext()),
      );
      const encounterId = Object.keys(started0.nextSlice.encounters)[0]! as EncounterId;
      const enc = started0.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const [first, second] = aliveEnemies(enc);
      assert(first !== undefined && second !== undefined, 'fixture 應有兩隻敵人');

      // 同一道指令（請求 first），只換 targeting resolver 的解析結果。
      const strike = {
        type: 'useCombatSkill' as const,
        encounterId,
        actorId,
        skillId: SKILL_STRIKE,
        targetCombatantIds: [first!.combatantId],
      };
      const healthAfter = (resolved: readonly CombatantId[], id: CombatantId): number => {
        const ctx = makeCombatContext({
          resolvers: stubResolverPort({ resolveSkillTargets: () => resolved }),
        });
        return ok(handleUseCombatSkill(started0.nextSlice, strike, ctx))
          .nextSlice.encounters[encounterId]!.combatants[id]!.health;
      };

      // resolver 說打 second → 受擊的是 second，被請求的 first 毫髮無傷。
      assert(healthAfter([second!.combatantId], second!.combatantId) === 0, 'resolver 指定的目標應受擊');
      assert(
        healthAfter([second!.combatantId], first!.combatantId) === first!.health,
        '未被 resolver 選中的請求目標不得受擊——目標集合的權威是 targeting 規則，不是 UI 傳入的清單',
      );
      // resolver 說打 first → 換成 first 受擊。同一支程式、同一道指令，只有內容不同。
      assert(healthAfter([first!.combatantId], first!.combatantId) === 0, '換一份 targeting 解析結果，命中對象就改變');
    },
  },
  {
    name: 'targeting：resolver 回空集合 → no-legal-target 拒絕（不付資源、不空耗行動）',
    run: () => {
      const ctx = makeCombatContext({ resolvers: stubResolverPort({ resolveSkillTargets: () => [] }) });
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;

      // SKILL_HEAL 有法力成本：拒絕後不得扣任何資源、不得推進 CTB。
      // 快照必須取**原始值**而不是物件參考：存成參考的話，Handler 就地改寫同一個物件時
      // before 會跟著變，斷言就永遠成立（等於什麼都沒測）。
      const beforeMana = enc.combatants[actorId]!.mana;
      const beforeCtb = enc.combatants[actorId]!.currentCtb;
      const res = handleUseCombatSkill(
        started.nextSlice,
        { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_HEAL, targetCombatantIds: [enemyId] },
        ctx,
      );
      rejectedWith(res, 'combat/no-legal-target');
      const after = started.nextSlice.encounters[encounterId]!.combatants[actorId]!;
      assert(after.mana === beforeMana, '拒絕不得扣法力');
      assert(after.currentCtb === beforeCtb, '拒絕不得加行動延遲');
    },
  },
  {
    name: 'targeting：resolver 回傳不存在的目標 → typed rejection（不得靜默略過）',
    run: () => {
      const GHOST = 'cbt-not-in-this-encounter' as CombatantId;
      const ctx = makeCombatContext({ resolvers: stubResolverPort({ resolveSkillTargets: () => [GHOST] }) });
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      rejectedWith(
        handleUseCombatSkill(
          started.nextSlice,
          {
            type: 'useCombatSkill',
            encounterId,
            actorId,
            skillId: SKILL_STRIKE,
            targetCombatantIds: [aliveEnemies(enc)[0]!.combatantId],
          },
          ctx,
        ),
        'combat/target-resolver-unknown-target',
      );
    },
  },
  {
    name: 'targeting：resolver 回傳已死目標 → typed rejection',
    run: () => {
      const base = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), makeCombatContext()),
      );
      const encounterId = Object.keys(base.nextSlice.encounters)[0]! as EncounterId;
      const enc = base.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const corpseId = aliveEnemies(enc)[0]!.combatantId;
      const withCorpse: CombatState = {
        ...base.nextSlice,
        encounters: {
          ...base.nextSlice.encounters,
          [encounterId]: {
            ...enc,
            combatants: {
              ...enc.combatants,
              [corpseId]: { ...enc.combatants[corpseId]!, health: 0, state: 'dead' },
            },
          },
        },
      };
      const ctx = makeCombatContext({
        resolvers: stubResolverPort({ resolveSkillTargets: () => [corpseId] }),
      });
      rejectedWith(
        handleUseCombatSkill(
          withCorpse,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [corpseId] },
          ctx,
        ),
        'combat/target-resolver-dead-target',
      );
    },
  },
  {
    name: 'targeting：resolver 回傳重複目標 → typed rejection（重複命中是結構違規，不是靜默去重）',
    run: () => {
      const base = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), makeCombatContext()),
      );
      const encounterId = Object.keys(base.nextSlice.encounters)[0]! as EncounterId;
      const enc = base.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;
      const ctx = makeCombatContext({
        resolvers: stubResolverPort({ resolveSkillTargets: () => [enemyId, enemyId] }),
      });
      // 原始值快照：兩邊都寫 `...combatants[enemyId]!.health` 的話，比的是同一個物件的同一個欄位，
      // 恆等成立，測不到任何東西。
      const beforeHealth = enc.combatants[enemyId]!.health;
      const res = handleUseCombatSkill(
        base.nextSlice,
        { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [enemyId] },
        ctx,
      );
      rejectedWith(res, 'combat/target-resolver-duplicate-target');
      assert(
        base.nextSlice.encounters[encounterId]!.combatants[enemyId]!.health === beforeHealth,
        '拒絕不得留下任何傷害',
      );
    },
  },
  {
    name: 'targeting：resolver 回傳側別非法的目標 → typed rejection（側別是最終結構不變量）',
    run: () => {
      const base = ok(
        handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), makeCombatContext()),
      );
      const encounterId = Object.keys(base.nextSlice.encounters)[0]! as EncounterId;
      const enc = base.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const allyId = Object.values(enc.combatants).find(
        (c) => c.side === 'player' && c.combatantId !== actorId,
      )!.combatantId;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;

      // 壞掉的 targeting 內容：把隊友交給一招 dealDamage 技能。
      const damageAtAlly = makeCombatContext({
        resolvers: stubResolverPort({ resolveSkillTargets: () => [allyId] }),
      });
      const allyHealthBefore = enc.combatants[allyId]!.health; // 原始值快照，不是物件參考
      rejectedWith(
        handleUseCombatSkill(
          base.nextSlice,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [allyId] },
          damageAtAlly,
        ),
        'combat/target-resolver-illegal-side',
      );
      assert(
        base.nextSlice.encounters[encounterId]!.combatants[allyId]!.health === allyHealthBefore,
        '隊友不得因壞掉的 targeting 內容受傷',
      );

      // 反向：把敵人交給一招 heal 技能。
      const healAtEnemy = makeCombatContext({
        resolvers: stubResolverPort({ resolveSkillTargets: () => [enemyId] }),
      });
      rejectedWith(
        handleUseCombatSkill(
          base.nextSlice,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_HEAL, targetCombatantIds: [enemyId] },
          healAtEnemy,
        ),
        'combat/target-resolver-illegal-side',
      );
    },
  },
  // ── (B) 跨武器組切換延遲（§8.3）────────────────────────────────────────────
  {
    name: '武器組切換：跨組施放先付切換延遲（原本恆為 0），延遲值來自 CombatRule 的規則資料',
    run: () => {
      // CTB 在 finishTurn 會整體倒扣同一個最小值，所以絕對值不可比；比的是行動者與另一名
      // 玩家（未行動、同樣受倒扣）之間的**差**——倒扣對兩者相同，差值因此完整保留延遲量。
      const gapAfterStrike = (
        switchTo: 'same' | 'other',
        switchDelayRule?: ActionDelayRuleDefinition,
      ): number => {
        const reader = stubDefinitionReader();
        const ctx = makeCombatContext({
          definitions:
            switchDelayRule === undefined
              ? reader
              : {
                  ...reader,
                  getActionDelayRule: (id) =>
                    String(id) === String(DELAY_WEAPON_SWITCH)
                      ? switchDelayRule
                      : reader.getActionDelayRule(id),
                },
        });
        const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
        const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
        const enc = started.nextSlice.encounters[encounterId]!;
        const actorId = enc.currentActorId!;
        const otherId = Object.values(enc.combatants).find(
          (c) => c.side === 'player' && c.combatantId !== actorId,
        )!.combatantId;
        assert(
          enc.combatants[actorId]!.activeWeaponSetId === WEAPON_SET_A,
          '開場應處於武器組 A（切換的起點）',
        );
        const after = ok(
          handleUseCombatSkill(
            started.nextSlice,
            {
              type: 'useCombatSkill',
              encounterId,
              actorId,
              skillId: SKILL_STRIKE,
              ...(switchTo === 'other' ? { weaponSetId: WEAPON_SET_B } : {}),
              targetCombatantIds: [aliveEnemies(enc)[0]!.combatantId],
            },
            ctx,
          ),
        ).nextSlice.encounters[encounterId]!;
        assert(
          after.combatants[actorId]!.activeWeaponSetId ===
            (switchTo === 'other' ? WEAPON_SET_B : WEAPON_SET_A),
          '生效武器組應更新為指令指定的那一組',
        );
        return after.combatants[actorId]!.currentCtb - after.combatants[otherId]!.currentCtb;
      };

      const same = gapAfterStrike('same');
      const switched = gapAfterStrike('other');
      assert(switched > same, '跨組延遲必須嚴格大於同組——恆等於 0 正是先前的缺陷');
      assert(
        switched - same === WEAPON_SWITCH_DELAY,
        `跨組應額外付 ${WEAPON_SWITCH_DELAY} 切換延遲（實得 ${switched - same}）`,
      );

      // 換一份規則資料，切換成本就不同：這一段確實來自 weaponSetSwitchDelayRuleId，不是常數。
      const cheaper: ActionDelayRuleDefinition = {
        id: DELAY_WEAPON_SWITCH,
        schemaVersion: 1,
        packId: 'pack-test' as never,
        enabled: true,
        baseDelay: 20,
        reductions: [],
        minimumDelay: 5,
      };
      const cheapSwitched = gapAfterStrike('other', cheaper);
      assert(
        cheapSwitched - same === cheaper.baseDelay,
        `換一份規則資料後切換延遲應為 ${cheaper.baseDelay}（實得 ${cheapSwitched - same}）`,
      );
    },
  },
  // ── (C) CombatActionResolved.results 具名欄位（袋子拆成判別聯集）─────────────
  {
    name: 'results：dealDamage 帶具名必填欄位與 branded targetId（不再是 Record<string, JsonValue>）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;
      const res = ok(
        handleUseCombatSkill(
          started.nextSlice,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_STRIKE, targetCombatantIds: [enemyId] },
          ctx,
        ),
      );
      const damage = actionResultsOf(res.outgoingMessages).find((r) => r.kind === 'dealDamage');
      assert(damage !== undefined, '應有一筆 dealDamage 結果');
      if (damage === undefined || damage.kind !== 'dealDamage') return;
      // targetId 是 CombatantId 本身，不是 String(id) 攤平後的裸字串。
      assert(damage.targetId === enemyId, 'targetId 應原樣保留 branded CombatantId');
      assert(damage.amount === 30, `面板傷害應為 30（實得 ${damage.amount}）`);
      assert(damage.targetDied, 'HP20 受 30 傷應致死');
    },
  },
  {
    name: 'results：adjustCtb 回報的是**折算後實際套用**的量，不是 resolver 的原始值',
    run: () => {
      const ctx = makeCombatContext({
        definitions: stubDefinitionReader(CTRL_ELITE),
        loadout: stubLoadoutQuery([SKILL_CTB_DELAY, SKILL_INTERRUPT, SKILL_STRIKE]),
      });
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;
      const enemyId = aliveEnemies(enc)[0]!.combatantId;
      const res = ok(
        handleUseCombatSkill(
          started.nextSlice,
          { type: 'useCombatSkill', encounterId, actorId, skillId: SKILL_CTB_DELAY, targetCombatantIds: [enemyId] },
          ctx,
        ),
      );
      const adjust = actionResultsOf(res.outgoingMessages).find((r) => r.kind === 'adjustCtb');
      assert(adjust !== undefined, '應有一筆 adjustCtb 結果');
      if (adjust === undefined || adjust.kind !== 'adjustCtb') return;
      // 原始 14、菁英抗性 ×0.75 → floor 10。袋子時代這個欄位叫 `amount`，看不出是哪一個。
      assert(adjust.appliedCtbDelta === 10, `應回報折算後的 10（實得 ${adjust.appliedCtbDelta}）`);
    },
  },
  {
    name: 'results：rest 回報實際回復量（滿血休息為 0，受傷休息為規則值）',
    run: () => {
      const ctx = makeCombatContext();
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc = started.nextSlice.encounters[encounterId]!;
      const actorId = enc.currentActorId!;

      const restResultOf = (state: CombatState): CombatActionResult => {
        const res = ok(handleCombatRest(state, { type: 'combatRest', encounterId, actorId }, ctx));
        const rest = actionResultsOf(res.outgoingMessages).find((r) => r.kind === 'rest');
        if (rest === undefined) throw new Error('應有一筆 rest 結果');
        return rest;
      };

      const full = restResultOf(started.nextSlice);
      if (full.kind !== 'rest') throw new Error('rest 結果的 kind 應為 rest');
      assert(full.actorId === actorId, 'rest 應記錄行動者');
      assert(full.healthRestored === 0, `滿血休息實際回復 0（實得 ${full.healthRestored}）`);
      assert(full.manaRestored === 5, `法力應依 CombatRule 回復 5（實得 ${full.manaRestored}）`);

      const wounded: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...enc,
            combatants: { ...enc.combatants, [actorId]: { ...enc.combatants[actorId]!, health: 50 } },
          },
        },
      };
      const hurt = restResultOf(wounded);
      if (hurt.kind !== 'rest') throw new Error('rest 結果的 kind 應為 rest');
      assert(hurt.healthRestored === 5, `受傷休息應回復 CombatRule 的 5（實得 ${hurt.healthRestored}）`);
    },
  },
  {
    name: '敵方無合法行動 → 走 combatRest 主路（延遲與回復皆來自資料，不是寫死的 +100）',
    run: () => {
      const ctx = makeCombatContext({ resolvers: stubResolverPort({ chooseEnemyAction: () => undefined }) });
      const started = ok(handleStartCombatEncounter(createInitialCombatState(), fixtureStartCommand(), ctx));
      const encounterId = Object.keys(started.nextSlice.encounters)[0]! as EncounterId;
      const enc0 = started.nextSlice.encounters[encounterId]!;
      const enemyId = aliveEnemies(enc0)[0]!.combatantId;
      // 讓該敵人成為當前行動者，且帶傷（才看得出「休息」真的回了血）。
      const primed: CombatState = {
        ...started.nextSlice,
        encounters: {
          ...started.nextSlice.encounters,
          [encounterId]: {
            ...enc0,
            currentActorId: enemyId,
            combatants: { ...enc0.combatants, [enemyId]: { ...enc0.combatants[enemyId]!, health: 10 } },
          },
        },
      };
      const res = ok(handleEnemyTurn(primed, encounterId, ctx));
      const rest = actionResultsOf(res.outgoingMessages).find((r) => r.kind === 'rest');
      assert(rest !== undefined, '無合法行動應走 combatRest 主路並回報 rest 結果');
      if (rest === undefined || rest.kind !== 'rest') return;
      assert(rest.actorId === enemyId, 'rest 的行動者應為該敵人');
      assert(rest.healthRestored === 5, `回復量應來自 CombatRule（5），實得 ${rest.healthRestored}`);
      assert(
        res.nextSlice.encounters[encounterId]!.combatants[enemyId]!.health === 15,
        '敵人休息後 HP 應實際回復',
      );
    },
  },
];

export type CombatTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly CombatTestResult[] {
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
    throw new Error(`combat module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
