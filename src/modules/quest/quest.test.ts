// modules/quest/quest.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋要求對照：
//   * 每個登記進 ModuleContract 的 Handler 至少一個 accept 案例。
//   * 每一種 typed rejection 至少一個案例。
//   * 每一條宣稱的不變量至少一個案例。
//   * 冪等 no-op 一律有測試釘住它是冪等（不是碰巧沒變）。
//   * 本模組沒有任何 RNG 路徑（距離 RNG 屬未註冊的生成流程），故無 cursor 測試。

import type { CharacterId, ContentInstanceId, TransactionMessageDraft, WorldDay } from '../../contracts/core';
import type { QuestDomainEvent } from '../../contracts/quest';
import type { MapContentResolved } from '../../contracts/map';
import type { TeamLocationChangedEvent } from '../../contracts/team';
import type { CombatEncounterResolvedPayload } from '../../contracts/combat';
import type { CharacterCreatedEvent, CharacterDiedEvent } from '../../contracts/character';

import type { QuestHandlerResult } from './system';
import {
  handleAcceptQuest,
  handleAcceptQuestForNpcTeam,
  handleClaimQuestForNpcTeam,
  handleQuestDeadline,
  handleReleaseNpcQuestClaim,
  onCharacterCreated,
  onCharacterDied,
  onCombatEncounterResolved,
  onMapContentResolved,
  onTeamLocationChanged,
} from './system';
import { createQuestQuery } from './queries';
import { tryGetClaim, tryGetQuest, type QuestState } from './state';
import {
  CAPTIVE_ARCHETYPE_ID,
  CAPTIVE_ID,
  CHAIN_ID,
  CITY_DESTINATION,
  CITY_GUILD,
  CONTENT_BOSS,
  CONTENT_KIDNAP,
  CONTENT_MOB_A,
  CONTENT_MOB_B,
  ESCORTEE_ID,
  MAP_ID,
  MEMBER_A,
  MEMBER_B,
  MISSING_REWARD_RULE_ID,
  OBJECTIVE_DELIVERY,
  OBJECTIVE_ESCORT,
  OBJECTIVE_HUNT,
  OBJECTIVE_PURCHASE,
  OBJECTIVE_RESCUE,
  OBJECTIVE_SUPPRESSION,
  OTHER_CHAIN_ID,
  OTHER_TEAM_ID,
  TEAM_ID,
  deadlineJob,
  kidnapContent,
  makeClaim,
  makeContext,
  makeQuest,
  questStateWith,
  stubMapContentPort,
  stubTeamPort,
  stubTemporaryCharacterPort,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): QuestDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as QuestDomainEvent);
}

type CommandDraft = Readonly<{ targetModule: string; command: Record<string, unknown> }>;

function commandsOf(messages: readonly TransactionMessageDraft[]): CommandDraft[] {
  const out: CommandDraft[] = [];
  for (const m of messages) {
    if (!('command' in m)) continue;
    out.push({
      targetModule: String(m.targetModule),
      command: m.command as Record<string, unknown>,
    });
  }
  return out;
}

function commandTypesOf(messages: readonly TransactionMessageDraft[]): string[] {
  return commandsOf(messages).map((c) => String(c.command.type));
}

function findEvent<K extends QuestDomainEvent['type']>(
  events: readonly QuestDomainEvent[],
  type: K,
): Extract<QuestDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<QuestDomainEvent, { type: K }> | undefined;
}

function expectOk(r: QuestHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject ${r.rejection.code}`);
  return r.result;
}

function expectReject(r: QuestHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(r.rejection.code === code, `${label}: expected code '${code}', got '${r.rejection.code}'`);
}

function statusOf(state: QuestState, questId: string): string {
  const quest = tryGetQuest(state, questId as never);
  if (quest === undefined) throw new Error(`quest "${questId}" not in state`);
  return quest.status;
}

function mapResolved(
  contentId: ContentInstanceId,
  outcome: 'success' | 'failure' = 'success',
): MapContentResolved {
  return {
    type: 'MapContentResolved',
    mapId: MAP_ID,
    contentId,
    resolution: { kind: 'combatEncounter', encounterId: 'encounter-1' as never, outcome },
  };
}

function locationChanged(
  from: TeamLocationChangedEvent['from'],
  to: TeamLocationChangedEvent['to'],
  teamId = TEAM_ID,
): TeamLocationChangedEvent {
  return { type: 'TeamLocationChanged', teamId, from, to };
}

function combatResolved(
  outcome: 'victory' | 'defeat',
  teamId = TEAM_ID,
): CombatEncounterResolvedPayload {
  return {
    type: 'CombatEncounterResolved',
    encounterId: 'encounter-1' as never,
    teamId,
    participantCharacterIds: [MEMBER_A],
    source: { kind: 'mapContent', mapId: MAP_ID, contentId: CONTENT_MOB_A } as never,
    outcome,
  };
}

function characterDied(characterId: CharacterId): CharacterDiedEvent {
  return { type: 'CharacterDied', characterId, deathDay: 100 as WorldDay, reason: 'escort-ambush' };
}

function characterCreated(characterId: CharacterId): CharacterCreatedEvent {
  return {
    type: 'CharacterCreated',
    characterId,
    origin: 'questTemporary',
    archetypeId: CAPTIVE_ARCHETYPE_ID,
  };
}

// ── 測試案例 ─────────────────────────────────────────────────────────────────
type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  // ── acceptQuest ───────────────────────────────────────────────────────────
  {
    name: 'acceptQuest：unaccepted → incomplete，保存正式成員快照並發 QuestAccepted',
    run: () => {
      const state = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]);
      const r = expectOk(
        handleAcceptQuest(state, { type: 'acceptQuest', questId: 'q1' as never }, TEAM_ID, makeContext()),
        'acceptQuest',
      );
      const quest = tryGetQuest(r.nextSlice, 'q1' as never)!;
      assert(quest.status === 'incomplete', `status 應為 incomplete（實得 ${quest.status}）`);
      assert(quest.acceptedByTeamId === TEAM_ID, 'acceptedByTeamId 應綁定發令隊伍');
      assert(quest.acceptedOnDay === 100, `acceptedOnDay 應為世界日 100（實得 ${String(quest.acceptedOnDay)}）`);
      // 不變量 11：participantCharacterIds 只含接取當下的正式成員。
      assert(
        quest.participantCharacterIds.length === 2 &&
          quest.participantCharacterIds.includes(MEMBER_A) &&
          quest.participantCharacterIds.includes(MEMBER_B),
        '應保存兩名正式成員',
      );
      // 不變量 2：接取不修改兩個 deadline 與距離 RNG。
      assert(quest.acceptDeadline === 104 && quest.actualEndDeadline === 131, '期限不得因接取改變');
      assert(quest.deadlineRolls.length === 2, 'deadlineRolls 不得因接取改變');
      const accepted = findEvent(eventsOf(r.outgoingMessages), 'QuestAccepted');
      assert(accepted !== undefined && accepted.teamId === TEAM_ID, '應發 QuestAccepted');
      // 不變量 3：actualEndDeadline >= acceptDeadline。
      assert(quest.actualEndDeadline >= quest.acceptDeadline, 'actualEnd 不得早於 accept 期限');
    },
  },
  {
    name: 'acceptQuest（rescue）：送出 ProtectMapContent(protect)，且未接取前不建立救援角色',
    run: () => {
      const state = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_RESCUE })]);
      const r = expectOk(
        handleAcceptQuest(state, { type: 'acceptQuest', questId: 'q1' as never }, TEAM_ID, makeContext()),
        'acceptQuest rescue',
      );
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1, `應只送出 1 筆命令（實得 ${commands.length}）`);
      assert(commands[0]!.targetModule === 'map', 'ProtectMapContent 應送給 map');
      assert(commands[0]!.command.type === 'ProtectMapContent', '應為 ProtectMapContent');
      assert(commands[0]!.command.mode === 'protect', 'mode 應為 protect');
      // 不變量 7：未接取 Quest 不建立護衛 Character；接取 rescue 也不在此刻建立（救出後才建）。
      assert(
        !commandTypesOf(r.outgoingMessages).includes('CreateQuestTemporaryCharacter'),
        '接取當下不得建立任務角色',
      );
    },
  },
  {
    name: 'acceptQuest：接取成功時移除舊 NPC Claim 並公告 released（不留孤兒 Claim）',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: OTHER_CHAIN_ID })],
      );
      const r = expectOk(
        handleAcceptQuest(state, { type: 'acceptQuest', questId: 'q1' as never }, TEAM_ID, makeContext()),
        'acceptQuest with claim',
      );
      assert(tryGetClaim(r.nextSlice, 'q1' as never) === undefined, 'Claim 應被移除');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'NpcQuestClaimChanged');
      assert(changed !== undefined && changed.state === 'released', '應公告 Claim released');
      assert(changed!.teamId === OTHER_TEAM_ID, 'released 事件應帶原 Claim 的 teamId');
    },
  },
  {
    name: 'acceptQuest 拒絕：unknown-quest / not-unaccepted / accept-deadline-passed',
    run: () => {
      const ctx = makeContext();
      expectReject(
        handleAcceptQuest(questStateWith([]), { type: 'acceptQuest', questId: 'nope' as never }, TEAM_ID, ctx),
        'quest/unknown-quest',
        'unknown',
      );
      const accepted = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      expectReject(
        handleAcceptQuest(accepted, { type: 'acceptQuest', questId: 'q1' as never }, TEAM_ID, ctx),
        'quest/not-unaccepted',
        'not-unaccepted',
      );
      // 半開區間：worldDay === acceptDeadline 已不合法。
      const late = makeContext({ worldDay: 104 as WorldDay });
      expectReject(
        handleAcceptQuest(
          questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]),
          { type: 'acceptQuest', questId: 'q1' as never },
          TEAM_ID,
          late,
        ),
        'quest/accept-deadline-passed',
        'deadline',
      );
    },
  },
  {
    name: 'acceptQuest 拒絕：team-not-at-posting-guild / no-formal-members / reward-rule-unreadable',
    run: () => {
      const state = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]);
      expectReject(
        handleAcceptQuest(
          state,
          { type: 'acceptQuest', questId: 'q1' as never },
          TEAM_ID,
          makeContext({ teams: stubTeamPort({ location: { kind: 'adventureMap', mapId: MAP_ID } }) }),
        ),
        'quest/team-not-at-posting-guild',
        'not-at-guild',
      );
      expectReject(
        handleAcceptQuest(
          state,
          { type: 'acceptQuest', questId: 'q1' as never },
          TEAM_ID,
          makeContext({ teams: stubTeamPort({ members: [] }) }),
        ),
        'quest/no-formal-members',
        'no-members',
      );
      const badReward = questStateWith([
        makeQuest({ questId: 'q2', objective: OBJECTIVE_SUPPRESSION, rewardRuleId: MISSING_REWARD_RULE_ID }),
      ]);
      expectReject(
        handleAcceptQuest(badReward, { type: 'acceptQuest', questId: 'q2' as never }, TEAM_ID, makeContext()),
        'quest/reward-rule-unreadable',
        'reward-missing',
      );
    },
  },
  {
    name: 'acceptQuest 拒絕：清理流程缺 Handler 的 kind 一律指名缺口（purchase / delivery / escort）',
    run: () => {
      const ctx = makeContext();
      for (const [questId, objective, missing] of [
        ['qp', OBJECTIVE_PURCHASE, 'city.ReserveShopOfferForQuest'],
        ['qd', OBJECTIVE_DELIVERY, 'inventory.ReleaseExpiredQuestCargo'],
        ['qe', OBJECTIVE_ESCORT, 'city.EscortCandidateQuery'],
      ] as const) {
        const state = questStateWith([makeQuest({ questId, objective })]);
        const r = handleAcceptQuest(state, { type: 'acceptQuest', questId: questId as never }, TEAM_ID, ctx);
        expectReject(r, 'quest/lifecycle-dependency-unavailable', questId);
        if (r.ok) return;
        assert(r.rejection.details?.missing === missing, `${questId}: rejection 應指名缺口 ${missing}`);
      }
    },
  },

  // ── AcceptQuestForNpcTeam ─────────────────────────────────────────────────
  {
    name: 'AcceptQuestForNpcTeam：重用接取驗證並發同一種 QuestAccepted',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_HUNT })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      const r = expectOk(
        handleAcceptQuestForNpcTeam(
          state,
          { type: 'AcceptQuestForNpcTeam', questId: 'q1' as never, teamId: OTHER_TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'npc accept',
      );
      const quest = tryGetQuest(r.nextSlice, 'q1' as never)!;
      assert(quest.status === 'incomplete' && quest.acceptedByTeamId === OTHER_TEAM_ID, 'NPC 隊應成功接取');
      assert(findEvent(eventsOf(r.outgoingMessages), 'QuestAccepted') !== undefined, '應發同一種 QuestAccepted');
      assert(tryGetClaim(r.nextSlice, 'q1' as never) === undefined, '自己的 Claim 也要清掉');
    },
  },
  {
    name: 'AcceptQuestForNpcTeam 拒絕：別隊持有 Claim / 同隊不同 chain',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_HUNT })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      expectReject(
        handleAcceptQuestForNpcTeam(
          state,
          { type: 'AcceptQuestForNpcTeam', questId: 'q1' as never, teamId: TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'quest/claim-held-by-other-team',
        'other-team-claim',
      );
      expectReject(
        handleAcceptQuestForNpcTeam(
          state,
          { type: 'AcceptQuestForNpcTeam', questId: 'q1' as never, teamId: OTHER_TEAM_ID, chainId: OTHER_CHAIN_ID },
          makeContext(),
        ),
        'quest/claim-source-mismatch',
        'chain-mismatch',
      );
      // 玩家不受 Claim 限制（doc §5.1.1：不得阻止玩家 acceptQuest）。
      expectOk(
        handleAcceptQuest(state, { type: 'acceptQuest', questId: 'q1' as never }, TEAM_ID, makeContext()),
        'player over npc claim',
      );
    },
  },

  // ── Claim / Release ───────────────────────────────────────────────────────
  {
    name: 'ClaimQuestForNpcTeam：建立排他 Claim 並公告 claimed；重複 claim 是 rejection',
    run: () => {
      const state = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]);
      const first = expectOk(
        handleClaimQuestForNpcTeam(
          state,
          { type: 'ClaimQuestForNpcTeam', questId: 'q1' as never, teamId: OTHER_TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'claim',
      );
      const claim = tryGetClaim(first.nextSlice, 'q1' as never);
      assert(claim !== undefined && claim.teamId === OTHER_TEAM_ID, 'Claim 應建立');
      assert(claim!.claimedOnDay === 100, 'claimedOnDay 應為世界日');
      const changed = findEvent(eventsOf(first.outgoingMessages), 'NpcQuestClaimChanged');
      assert(changed !== undefined && changed.state === 'claimed', '應公告 claimed');
      // 排他：同隊同 chain 再送一次也拒絕。
      expectReject(
        handleClaimQuestForNpcTeam(
          first.nextSlice,
          { type: 'ClaimQuestForNpcTeam', questId: 'q1' as never, teamId: OTHER_TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'quest/already-claimed',
        'duplicate claim same chain',
      );
      // 別隊也拒絕。
      expectReject(
        handleClaimQuestForNpcTeam(
          first.nextSlice,
          { type: 'ClaimQuestForNpcTeam', questId: 'q1' as never, teamId: TEAM_ID, chainId: OTHER_CHAIN_ID },
          makeContext(),
        ),
        'quest/already-claimed',
        'duplicate claim other team',
      );
    },
  },
  {
    name: 'ClaimQuestForNpcTeam 拒絕：unknown-quest / not-unaccepted / accept-deadline-passed',
    run: () => {
      const cmd = { type: 'ClaimQuestForNpcTeam', questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID } as never;
      expectReject(handleClaimQuestForNpcTeam(questStateWith([]), cmd, makeContext()), 'quest/unknown-quest', 'unknown');
      expectReject(
        handleClaimQuestForNpcTeam(
          questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION, status: 'incomplete' })]),
          cmd,
          makeContext(),
        ),
        'quest/not-unaccepted',
        'not-unaccepted',
      );
      expectReject(
        handleClaimQuestForNpcTeam(
          questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]),
          cmd,
          makeContext({ worldDay: 200 as WorldDay }),
        ),
        'quest/accept-deadline-passed',
        'deadline',
      );
    },
  },
  {
    name: 'ReleaseNpcQuestClaim：來源相符即清除；來源不符但 Quest 已非 unaccepted 亦可清',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      const r = expectOk(
        handleReleaseNpcQuestClaim(
          state,
          { type: 'ReleaseNpcQuestClaim', questId: 'q1' as never, teamId: OTHER_TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'release',
      );
      assert(tryGetClaim(r.nextSlice, 'q1' as never) === undefined, 'Claim 應清除');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'NpcQuestClaimChanged');
      assert(changed !== undefined && changed.state === 'released', '應公告 released');

      const expiredQuest = questStateWith(
        [makeQuest({ questId: 'q2', objective: OBJECTIVE_SUPPRESSION, status: 'expired' })],
        [makeClaim({ questId: 'q2', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      expectOk(
        handleReleaseNpcQuestClaim(
          expiredQuest,
          { type: 'ReleaseNpcQuestClaim', questId: 'q2' as never, teamId: TEAM_ID, chainId: OTHER_CHAIN_ID },
          makeContext(),
        ),
        'release on non-unaccepted quest',
      );
    },
  },
  {
    name: 'ReleaseNpcQuestClaim 拒絕：claim-not-found / claim-source-mismatch',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      expectReject(
        handleReleaseNpcQuestClaim(
          questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]),
          { type: 'ReleaseNpcQuestClaim', questId: 'q1' as never, teamId: TEAM_ID, chainId: CHAIN_ID },
          makeContext(),
        ),
        'quest/claim-not-found',
        'no-claim',
      );
      expectReject(
        handleReleaseNpcQuestClaim(
          state,
          { type: 'ReleaseNpcQuestClaim', questId: 'q1' as never, teamId: TEAM_ID, chainId: OTHER_CHAIN_ID },
          makeContext(),
        ),
        'quest/claim-source-mismatch',
        'mismatch',
      );
    },
  },

  // ── questDeadline Job ─────────────────────────────────────────────────────
  {
    name: 'questDeadline(accept)：仍未接取者轉 expired 並清掉 Claim',
    run: () => {
      const state = questStateWith(
        [makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })],
        [makeClaim({ questId: 'q1', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      const r = expectOk(
        handleQuestDeadline(state, deadlineJob('q1', 'accept', 104), makeContext({ worldDay: 104 as WorldDay })),
        'accept deadline',
      );
      assert(statusOf(r.nextSlice, 'q1') === 'expired', '應轉 expired');
      assert(tryGetClaim(r.nextSlice, 'q1' as never) === undefined, '到期不得留下孤兒 Claim');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'QuestStateChanged');
      assert(changed !== undefined, '應發 QuestStateChanged');
      assert(changed!.newStatus === 'expired' && changed!.reason === 'acceptDeadline', 'reason 應為 acceptDeadline');
      // 不變量 9：到期不使用「失敗」狀態或事件。
      assert(
        eventsOf(r.outgoingMessages).every((e) => e.type !== 'QuestObjectiveCompleted'),
        '到期不得發完成事件',
      );
    },
  },
  {
    name: 'questDeadline(accept)：已接取者為冪等 no-op（資料齊全時同樣不動作）',
    run: () => {
      const state = questStateWith([
        makeQuest({
          questId: 'q1',
          objective: OBJECTIVE_SUPPRESSION,
          status: 'incomplete',
          acceptedByTeamId: TEAM_ID,
          acceptedOnDay: 100 as WorldDay,
        }),
      ]);
      const first = expectOk(
        handleQuestDeadline(state, deadlineJob('q1', 'accept', 104), makeContext({ worldDay: 104 as WorldDay })),
        'accept deadline noop',
      );
      assert(first.nextSlice === state, 'Slice 應原封不動（同一參考）');
      assert(first.outgoingMessages.length === 0, '不得發任何訊息');
      // 冪等：再跑一次仍相同。
      const second = expectOk(
        handleQuestDeadline(first.nextSlice, deadlineJob('q1', 'accept', 104), makeContext({ worldDay: 104 as WorldDay })),
        'accept deadline noop twice',
      );
      assert(second.nextSlice === state, '第二次仍應原封不動');
      assert(statusOf(second.nextSlice, 'q1') === 'incomplete', '狀態不得被改動');
    },
  },
  {
    name: 'questDeadline(actualEnd)：完成但未回公會結案一樣 expired（不變量 4）',
    run: () => {
      const state = questStateWith([
        makeQuest({
          questId: 'q1',
          objective: OBJECTIVE_SUPPRESSION,
          status: 'completed',
          acceptedByTeamId: TEAM_ID,
          completedOnDay: 120 as WorldDay,
        }),
      ]);
      const r = expectOk(
        handleQuestDeadline(state, deadlineJob('q1', 'actualEnd', 131), makeContext({ worldDay: 131 as WorldDay })),
        'actualEnd on completed',
      );
      assert(statusOf(r.nextSlice, 'q1') === 'expired', 'completed → expired');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'QuestStateChanged');
      assert(changed!.oldStatus === 'completed' && changed!.reason === 'actualEndDeadline', 'reason 應為 actualEndDeadline');
      const quest = tryGetQuest(r.nextSlice, 'q1' as never)!;
      assert(quest.settlement === undefined, '到期不得寫入 settlement，也就沒有報酬與任務 MXP');
    },
  },
  {
    name: 'questDeadline(actualEnd)：已接取的 rescue 到期時解除內容保護',
    run: () => {
      const state = questStateWith([
        makeQuest({
          questId: 'q1',
          objective: OBJECTIVE_RESCUE,
          status: 'incomplete',
          acceptedByTeamId: TEAM_ID,
        }),
      ]);
      const r = expectOk(
        handleQuestDeadline(state, deadlineJob('q1', 'actualEnd', 131), makeContext({ worldDay: 131 as WorldDay })),
        'actualEnd rescue',
      );
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1 && commands[0]!.command.mode === 'release', '應送出 ProtectMapContent(release)');
    },
  },
  {
    name: 'questDeadline(actualEnd)：已 expired／已歸檔皆為冪等 no-op',
    run: () => {
      const expired = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION, status: 'expired' }),
      ]);
      const a = expectOk(
        handleQuestDeadline(expired, deadlineJob('q1', 'actualEnd', 131), makeContext({ worldDay: 131 as WorldDay })),
        'expired noop',
      );
      assert(a.nextSlice === expired && a.outgoingMessages.length === 0, '已到期應原封不動');

      const settled = questStateWith([
        makeQuest({
          questId: 'q2',
          objective: OBJECTIVE_SUPPRESSION,
          status: 'completed',
          acceptedByTeamId: TEAM_ID,
          completedOnDay: 120 as WorldDay,
          settlement: {
            settledOnDay: 121 as WorldDay,
            settledAtCityId: CITY_GUILD,
            settledByTeamId: TEAM_ID,
            beneficiaryCharacterIds: [MEMBER_A],
            rewardDistributionId: 'distribution-1' as never,
          },
        }),
      ]);
      const b = expectOk(
        handleQuestDeadline(settled, deadlineJob('q2', 'actualEnd', 131), makeContext({ worldDay: 131 as WorldDay })),
        'settled noop',
      );
      assert(b.nextSlice === settled && b.outgoingMessages.length === 0, '已歸檔應原封不動');
      assert(statusOf(b.nextSlice, 'q2') === 'completed', '不變量：結案後最終狀態仍為 completed');
    },
  },
  {
    name: 'questDeadline 拒絕：目標 Quest 不在 Slice / 清理流程缺 Handler',
    run: () => {
      expectReject(
        handleQuestDeadline(questStateWith([]), deadlineJob('nope', 'accept', 104), makeContext()),
        'quest/deadline-target-missing',
        'missing target',
      );
      // 未接取的送貨到期需要 inventory 的 ApplyQuestItemLifecycle(remove)；缺就整筆拒絕，
      // 不可只改狀態把 Item 永久留在保留位置。
      const r = handleQuestDeadline(
        questStateWith([makeQuest({ questId: 'qd', objective: OBJECTIVE_DELIVERY })]),
        deadlineJob('qd', 'accept', 104),
        makeContext({ worldDay: 104 as WorldDay }),
      );
      expectReject(r, 'quest/lifecycle-dependency-unavailable', 'delivery cleanup');
      if (r.ok) return;
      assert(
        r.rejection.details?.missing === 'inventory.ApplyQuestItemLifecycle',
        'rejection 應指名未接取到期所缺的 Handler',
      );
    },
  },
  {
    name: 'questDeadline：沒有綁定實體要清的 kind 不受別的 kind 缺口影響（護衛未接取即到期）',
    run: () => {
      // 護衛**接取**端另有缺口（city 的 EscortCandidate），但「未接取即到期」不需要任何清理，
      // 因此期限 Job 必須照常結案，不得被接取端的缺口一起擋下（否則那筆 Job 會變成殭屍）。
      const r = expectOk(
        handleQuestDeadline(
          questStateWith([makeQuest({ questId: 'qe', objective: OBJECTIVE_ESCORT })]),
          deadlineJob('qe', 'accept', 104),
          makeContext({ worldDay: 104 as WorldDay }),
        ),
        'escort accept deadline',
      );
      assert(statusOf(r.nextSlice, 'qe') === 'expired', '未接取的護衛委託應正常到期');
      assert(commandsOf(r.outgoingMessages).length === 0, '未接取者沒有任何實體要清');
    },
  },

  // ── MapContentResolved ────────────────────────────────────────────────────
  {
    name: 'MapContentResolved：鎮壓要全部怪群 resolved 才 completed（逐筆累計、去重）',
    run: () => {
      const state = questStateWith([
        makeQuest({
          questId: 'q1',
          objective: OBJECTIVE_SUPPRESSION,
          status: 'incomplete',
          acceptedByTeamId: TEAM_ID,
        }),
      ]);
      const ctx = makeContext({ worldDay: 110 as WorldDay });
      const first = onMapContentResolved(mapResolved(CONTENT_MOB_A), state, ctx);
      assert(statusOf(first.nextSlice, 'q1') === 'incomplete', '打掉一群還不算完成');
      // 同一筆重複到達不重複累計。
      const again = onMapContentResolved(mapResolved(CONTENT_MOB_A), first.nextSlice, ctx);
      assert(
        tryGetQuest(again.nextSlice, 'q1' as never)!.progress.resolvedTargetContentIds.length === 1,
        '重複事件不得重複累計',
      );
      const second = onMapContentResolved(mapResolved(CONTENT_MOB_B), again.nextSlice, ctx);
      assert(statusOf(second.nextSlice, 'q1') === 'completed', '最後一群倒下才 completed');
      const quest = tryGetQuest(second.nextSlice, 'q1' as never)!;
      assert(quest.completedOnDay === 110, 'completedOnDay 應為世界日');
      const events = eventsOf(second.outgoingMessages);
      assert(findEvent(events, 'QuestObjectiveCompleted') !== undefined, '應發 QuestObjectiveCompleted');
      const changed = findEvent(events, 'QuestStateChanged');
      assert(changed!.newStatus === 'completed' && changed!.reason === 'completedUnsettled', 'reason 應為 completedUnsettled');
    },
  },
  {
    name: 'MapContentResolved：討伐單 Boss 一隻即完成；outcome=failure 不推進',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_HUNT, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const ctx = makeContext();
      const failed = onMapContentResolved(mapResolved(CONTENT_BOSS, 'failure'), state, ctx);
      assert(failed.nextSlice === state, '失敗的處理不得推進目標');
      const won = onMapContentResolved(mapResolved(CONTENT_BOSS), state, ctx);
      assert(statusOf(won.nextSlice, 'q1') === 'completed', '單 Boss 任務即一隻');
    },
  },
  {
    name: 'MapContentResolved：救援救出被擄者 → 建立救援任務角色，但尚未 completed',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_RESCUE, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const r = onMapContentResolved(mapResolved(CONTENT_KIDNAP), state, makeContext({ worldDay: 111 as WorldDay }));
      const quest = tryGetQuest(r.nextSlice, 'q1' as never)!;
      assert(quest.progress.captiveRescuedOnDay === 111, '應記錄救出日');
      assert(quest.status === 'incomplete', '還沒離圖，不算完成');
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1 && commands[0]!.targetModule === 'character', '應請 character 建立救援角色');
      assert(commands[0]!.command.kind === 'rescue', 'kind 應為 rescue');
      assert(
        String(commands[0]!.command.archetypeId) === String(CAPTIVE_ARCHETYPE_ID),
        '身分原型應取自 map 的 content payload，不得自行決定',
      );
      // 冪等：同一筆內容再 resolved 一次不重複建立角色。
      const again = onMapContentResolved(mapResolved(CONTENT_KIDNAP), r.nextSlice, makeContext({ worldDay: 112 as WorldDay }));
      assert(again.outgoingMessages.length === 0, '重複事件不得再建立角色');
      assert(
        tryGetQuest(again.nextSlice, 'q1' as never)!.progress.captiveRescuedOnDay === 111,
        '救出日不得被覆寫',
      );
    },
  },
  {
    name: 'MapContentResolved：綁定內容不見了 → expired(contentUnavailable)，不代它編一筆原型',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_RESCUE, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const r = onMapContentResolved(
        mapResolved(CONTENT_KIDNAP),
        state,
        makeContext({ mapContents: stubMapContentPort([]) }),
      );
      assert(statusOf(r.nextSlice, 'q1') === 'expired', '應轉 expired');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'QuestStateChanged');
      assert(changed!.reason === 'contentUnavailable', 'reason 應為 contentUnavailable');
      assert(
        !commandTypesOf(r.outgoingMessages).includes('CreateQuestTemporaryCharacter'),
        '不得在缺內容時仍建立角色',
      );
    },
  },

  // ── TeamLocationChanged ───────────────────────────────────────────────────
  {
    name: 'TeamLocationChanged：護衛進入目的城市 → completed（護衛角色已綁定為前提）',
    run: () => {
      const bound = makeQuest({
        questId: 'q1',
        objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID },
        status: 'incomplete',
        acceptedByTeamId: TEAM_ID,
      });
      const state = questStateWith([bound]);
      const ctx = makeContext({ worldDay: 115 as WorldDay });
      // 抵達別的城市不算。
      const elsewhere = onTeamLocationChanged(
        locationChanged({ kind: 'travelling', routeId: 'route-1' as never, progress: { kind: 'npcDirect' } }, { kind: 'city', cityId: CITY_GUILD }),
        state,
        ctx,
      );
      assert(statusOf(elsewhere.nextSlice, 'q1') === 'incomplete', '抵達非目的城市不得完成');
      const arrived = onTeamLocationChanged(
        locationChanged({ kind: 'travelling', routeId: 'route-1' as never, progress: { kind: 'npcDirect' } }, { kind: 'city', cityId: CITY_DESTINATION }),
        state,
        ctx,
      );
      assert(statusOf(arrived.nextSlice, 'q1') === 'completed', '抵達目的城市應完成');
      assert(findEvent(eventsOf(arrived.outgoingMessages), 'QuestObjectiveCompleted') !== undefined, '應發完成事件');

      // 護衛角色未綁定時不得完成（角色不存在＝沒有護送對象）。
      const unbound = questStateWith([
        makeQuest({ questId: 'q2', objective: OBJECTIVE_ESCORT, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const noChar = onTeamLocationChanged(
        locationChanged({ kind: 'travelling', routeId: 'route-1' as never, progress: { kind: 'npcDirect' } }, { kind: 'city', cityId: CITY_DESTINATION }),
        unbound,
        ctx,
      );
      assert(statusOf(noChar.nextSlice, 'q2') === 'incomplete', '未綁定護衛角色不得完成');
    },
  },
  {
    name: 'TeamLocationChanged：救援離開該 Map 才 completed，並解除內容保護',
    run: () => {
      const rescued = makeQuest({
        questId: 'q1',
        objective: OBJECTIVE_RESCUE,
        status: 'incomplete',
        acceptedByTeamId: TEAM_ID,
        progress: { resolvedTargetContentIds: [], captiveRescuedOnDay: 110 as WorldDay },
      });
      const notRescued = makeQuest({
        questId: 'q2',
        objective: OBJECTIVE_RESCUE,
        status: 'incomplete',
        acceptedByTeamId: TEAM_ID,
      });
      const state = questStateWith([rescued, notRescued]);
      const r = onTeamLocationChanged(
        locationChanged({ kind: 'adventureMap', mapId: MAP_ID }, { kind: 'city', cityId: CITY_GUILD }),
        state,
        makeContext({ worldDay: 112 as WorldDay }),
      );
      assert(statusOf(r.nextSlice, 'q1') === 'completed', '救出且離圖應完成');
      assert(statusOf(r.nextSlice, 'q2') === 'incomplete', '沒救到人就離圖不算完成');
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1 && commands[0]!.command.mode === 'release', '完成後應解除內容保護');
    },
  },

  // ── CombatEncounterResolved（不變量 18）────────────────────────────────────
  {
    name: 'CombatEncounterResolved(defeat)：同隊全部 incomplete 護衛轉 expired(combatDefeat)',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'e1', objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'e2', objective: { ...OBJECTIVE_ESCORT, characterId: CAPTIVE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'e3', objective: OBJECTIVE_ESCORT, status: 'completed', acceptedByTeamId: TEAM_ID, completedOnDay: 105 as WorldDay }),
        makeQuest({ questId: 'e4', objective: OBJECTIVE_ESCORT, status: 'incomplete', acceptedByTeamId: OTHER_TEAM_ID }),
        makeQuest({ questId: 's1', objective: OBJECTIVE_SUPPRESSION, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const r = onCombatEncounterResolved(combatResolved('defeat'), state, makeContext());
      assert(statusOf(r.nextSlice, 'e1') === 'expired', 'e1 應到期');
      assert(statusOf(r.nextSlice, 'e2') === 'expired', 'e2 應到期');
      assert(statusOf(r.nextSlice, 'e3') === 'completed', '已完成的護衛不受影響');
      assert(statusOf(r.nextSlice, 'e4') === 'incomplete', '其他隊伍的護衛不受影響');
      assert(statusOf(r.nextSlice, 's1') === 'incomplete', '非護衛委託不受影響');
      const changed = eventsOf(r.outgoingMessages).filter((e) => e.type === 'QuestStateChanged');
      assert(changed.length === 2, `應只發 2 筆 QuestStateChanged（實得 ${changed.length}）`);
      assert(
        changed.every((e) => e.type === 'QuestStateChanged' && e.reason === 'combatDefeat'),
        'reason 應為 combatDefeat',
      );
      // 勝利不改任何狀態。
      const win = onCombatEncounterResolved(combatResolved('victory'), state, makeContext());
      assert(win.nextSlice === state, '勝利不得改動任何 Quest');
    },
  },

  // ── CharacterDied / CharacterCreated ──────────────────────────────────────
  {
    name: 'CharacterDied：護送對象死亡 → expired(targetDied)；救援對象死亡同時解除保護',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'e1', objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'r1', objective: { ...OBJECTIVE_RESCUE, characterId: CAPTIVE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const escortDeath = onCharacterDied(characterDied(ESCORTEE_ID), state, makeContext());
      assert(statusOf(escortDeath.nextSlice, 'e1') === 'expired', '護送對象死亡應到期');
      const changed = findEvent(eventsOf(escortDeath.outgoingMessages), 'QuestStateChanged');
      assert(changed!.reason === 'targetDied', 'reason 應為 targetDied');
      assert(statusOf(escortDeath.nextSlice, 'r1') === 'incomplete', '不相干的任務不受影響');

      const rescueDeath = onCharacterDied(characterDied(CAPTIVE_ID), state, makeContext());
      assert(statusOf(rescueDeath.nextSlice, 'r1') === 'expired', '救援對象死亡應到期');
      const commands = commandsOf(rescueDeath.outgoingMessages);
      assert(commands.length === 1 && commands[0]!.command.mode === 'release', '應解除內容保護');

      // 無關角色死亡不改動任何狀態。
      const unrelated = onCharacterDied(characterDied(MEMBER_A), state, makeContext());
      assert(unrelated.nextSlice === state, '無關角色死亡不得改動 Slice');
    },
  },
  {
    name: 'CharacterCreated：以 getTemporaryOrigin 反查並綁定任務角色；已綁定則冪等',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_RESCUE, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const ctx = makeContext({
        characters: stubTemporaryCharacterPort({
          [String(CAPTIVE_ID)]: { kind: 'rescue', sourceQuestId: 'q1' as never, recoveryPolicy: 'rescueQuestLifecycle' },
        }),
      });
      const r = onCharacterCreated(characterCreated(CAPTIVE_ID), state, ctx);
      const objective = tryGetQuest(r.nextSlice, 'q1' as never)!.objective;
      assert(objective.kind === 'rescue' && objective.characterId === CAPTIVE_ID, '應綁定救援角色');
      // 冪等：第二個角色不得換綁。
      const secondCtx = makeContext({
        characters: stubTemporaryCharacterPort({
          [String(ESCORTEE_ID)]: { kind: 'rescue', sourceQuestId: 'q1' as never, recoveryPolicy: 'rescueQuestLifecycle' },
        }),
      });
      const again = onCharacterCreated(characterCreated(ESCORTEE_ID), r.nextSlice, secondCtx);
      assert(again.nextSlice === r.nextSlice, '已綁定時不得改動 Slice');
      // 非任務角色與 Quest 無關。
      const plain = onCharacterCreated(characterCreated(MEMBER_B), state, makeContext());
      assert(plain.nextSlice === state, '非任務角色不得改動 Slice');
    },
  },

  // ── QuestQuery ────────────────────────────────────────────────────────────
  {
    name: 'QuestQuery：公會佈告／隊伍清單／NPC 可 claim 清單各自過濾正確',
    run: () => {
      const state = questStateWith(
        [
          makeQuest({ questId: 'p1', objective: OBJECTIVE_SUPPRESSION }),
          makeQuest({ questId: 'p2', objective: OBJECTIVE_HUNT }),
          makeQuest({ questId: 'p3', objective: OBJECTIVE_SUPPRESSION, status: 'expired' }),
          makeQuest({ questId: 'a1', objective: OBJECTIVE_HUNT, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
          makeQuest({ questId: 'c1', objective: OBJECTIVE_HUNT, status: 'completed', acceptedByTeamId: TEAM_ID, completedOnDay: 110 as WorldDay }),
        ],
        [makeClaim({ questId: 'p2', teamId: OTHER_TEAM_ID, chainId: CHAIN_ID })],
      );
      const query = createQuestQuery(state);
      const postings = query.listGuildPostings(CITY_GUILD).map((q) => String(q.questId));
      assert(postings.join(',') === 'p1,p2', `佈告板只列未接取且依 QuestId 排序（實得 ${postings.join(',')}）`);
      const claimable = query.listNpcClaimablePostings(CITY_GUILD, 100 as WorldDay).map((q) => String(q.questId));
      assert(claimable.join(',') === 'p1', `已被 claim 的不得再列（實得 ${claimable.join(',')}）`);
      assert(
        query.listNpcClaimablePostings(CITY_GUILD, 104 as WorldDay).length === 0,
        '接受期限當日起不得再 claim（半開區間）',
      );
      const active = query.listTeamActiveQuests(TEAM_ID).map((q) => String(q.questId));
      assert(active.join(',') === 'a1,c1', `進行中應含完成未結案（實得 ${active.join(',')}）`);
      const unsettled = query.listTeamCompletedUnsettled(TEAM_ID).map((q) => String(q.questId));
      assert(unsettled.join(',') === 'c1', `完成未結案（實得 ${unsettled.join(',')}）`);
      assert(query.getNpcClaim('p2' as never)?.teamId === OTHER_TEAM_ID, 'getNpcClaim 應回既有 Claim');
      assert(query.getNpcClaim('p1' as never) === undefined, '沒有 Claim 應回 undefined');
      assert(String(query.getQuest('p1' as never).questId) === 'p1', 'getQuest 應回 View');
      assert(query.getQuestIdsForSource(MAP_ID).length === 5, 'sourceContentIndex 應收錄全部同來源 Quest');
    },
  },
  {
    name: 'QuestQuery：canSettle 四個條件與半開區間',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'c1', objective: OBJECTIVE_HUNT, status: 'completed', acceptedByTeamId: TEAM_ID, completedOnDay: 110 as WorldDay }),
        makeQuest({ questId: 'i1', objective: OBJECTIVE_HUNT, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const query = createQuestQuery(state);
      assert(query.canSettle('c1' as never, TEAM_ID, CITY_GUILD, 120 as WorldDay), '完成 + 原公會 + 期限內應可結案');
      assert(!query.canSettle('c1' as never, OTHER_TEAM_ID, CITY_GUILD, 120 as WorldDay), '別的隊伍不可結案');
      assert(!query.canSettle('c1' as never, TEAM_ID, CITY_DESTINATION, 120 as WorldDay), '不是原發布公會不可結案（不變量 5）');
      assert(!query.canSettle('c1' as never, TEAM_ID, CITY_GUILD, 131 as WorldDay), '期限當日起不可結案（半開區間）');
      assert(!query.canSettle('i1' as never, TEAM_ID, CITY_GUILD, 120 as WorldDay), '未完成不可結案');
      assert(!query.canSettle('nope' as never, TEAM_ID, CITY_GUILD, 120 as WorldDay), '不存在的 Quest 不可結案');
    },
  },
  {
    name: 'QuestQuery：玩家旅行護衛 Query 只回合法進行中護衛、順序穩定且不改 State',
    run: () => {
      const state = questStateWith([
        makeQuest({ questId: 'z-escort', objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'a-escort', objective: { ...OBJECTIVE_ESCORT, characterId: CAPTIVE_ID }, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'done', objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID }, status: 'completed', acceptedByTeamId: TEAM_ID, completedOnDay: 110 as WorldDay }),
        makeQuest({ questId: 'nochar', objective: OBJECTIVE_ESCORT, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
        makeQuest({ questId: 'other', objective: { ...OBJECTIVE_ESCORT, characterId: ESCORTEE_ID }, status: 'incomplete', acceptedByTeamId: OTHER_TEAM_ID }),
      ]);
      const query = createQuestQuery(state);
      const first = query.listIncompleteEscortQuestsForPlayerTravel(TEAM_ID, 110 as WorldDay);
      assert(
        first.map((q) => String(q.questId)).join(',') === 'a-escort,z-escort',
        `應依 QuestId 穩定排序（實得 ${first.map((q) => String(q.questId)).join(',')}）`,
      );
      const second = query.listIncompleteEscortQuestsForPlayerTravel(TEAM_ID, 110 as WorldDay);
      assert(
        JSON.stringify(first) === JSON.stringify(second),
        '相同 State／Day 應輸出相同結果（不變量 19）',
      );
      assert(
        query.listIncompleteEscortQuestsForPlayerTravel(TEAM_ID, 131 as WorldDay).length === 0,
        '實際期限當日起不得列入',
      );
      // NPC 隊伍不得由此 Query 取得任何東西以外的副作用：Query 本身不改 State。
      assert(createQuestQuery(state) !== undefined && statusOf(state, 'z-escort') === 'incomplete', 'Query 不得改寫 State');
    },
  },
  {
    name: 'QuestQuery：已接取的任務保留其地圖與綁定內容；歸檔後解除',
    run: () => {
      const live = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION, status: 'incomplete', acceptedByTeamId: TEAM_ID }),
      ]);
      const liveQuery = createQuestQuery(live);
      assert(liveQuery.isMapReservedForAcceptedQuest(MAP_ID), '已接取應保留地圖');
      assert(liveQuery.isContentProtected(CONTENT_MOB_A), '已接取應保護目標內容');
      assert(!liveQuery.isContentProtected(CONTENT_BOSS), '非目標內容不受保護');

      const unaccepted = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]);
      assert(
        !createQuestQuery(unaccepted).isMapReservedForAcceptedQuest(MAP_ID),
        '未接取不保留地圖',
      );
      const expired = questStateWith([
        makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION, status: 'expired', acceptedByTeamId: TEAM_ID }),
      ]);
      assert(
        !createQuestQuery(expired).isContentProtected(CONTENT_MOB_A),
        '到期後解除保護（doc §9.2）',
      );
    },
  },
  {
    name: 'QuestState：索引指向不存在的 Quest 時 Query 跳過該筆而不整個炸掉',
    run: () => {
      const base = questStateWith([makeQuest({ questId: 'q1', objective: OBJECTIVE_SUPPRESSION })]);
      const broken: QuestState = {
        ...base,
        guildPostingIndex: { ...base.guildPostingIndex, [CITY_GUILD]: ['q1' as never, 'ghost' as never] },
      };
      const postings = createQuestQuery(broken).listGuildPostings(CITY_GUILD);
      assert(postings.length === 1, '壞索引項應被跳過');
      let threw = false;
      try {
        createQuestQuery(broken).getQuest('ghost' as never);
      } catch {
        threw = true;
      }
      assert(threw, 'getQuest 對未知 id 應明確拋錯（不回一筆編出來的 View）');
    },
  },
];

export type QuestTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly QuestTestResult[] {
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
    throw new Error(`quest module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
