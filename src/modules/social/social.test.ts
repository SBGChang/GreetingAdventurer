// modules/social/social.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。
// runTests() 執行全部案例；任一失敗即 throw，供最外層 harness 判定。
//
// 覆蓋要求對照：
//   * 四個登記進 ModuleContract 的 Handler 各至少一個 accept 案例。
//   * 九種 typed rejection 各至少一個案例。
//   * public.ts 宣告的七條不變量各至少一個案例。
//   * 兩處冪等 no-op（ProvisionPlayerAffinity 重送、同一 Interaction ID 重送）各有測試釘住。
//   * 有 RNG 的路徑：同 cursor 同結果 + 不同 cursor 不同結果（證明 Handler 真的吃注入的 cursor）。

import type {
  CharacterId,
  InteractionId,
  RngContext,
  TransactionMessageDraft,
  WorldDay,
} from '../../contracts/core';
import type {
  SocialDomainEvent,
  ProvisionPlayerAffinityCommand,
  ConsumePlayerConversationAllowanceCommand,
  InteractWithAdventurerCommand,
  ProposeMarriageToTeamMemberCommand,
} from '../../contracts/social';
import type { CreatePartnerFamilyLink } from '../../contracts/character';

import type { SocialHandlerResult, SocialResolverPort } from './system';
import {
  SOCIAL_MODULE_ID,
  handleInteractWithAdventurer,
  handleProposeMarriageToTeamMember,
  handleProvisionPlayerAffinity,
  handleConsumePlayerConversationAllowance,
} from './system';
import { createSocialQuery } from './queries';
import { createSocialState, tryGetAffinity, usageForDay } from './state';
import type { SocialState } from './state';
import {
  AFFINITY_RULE_ID,
  AFFINITY_RULE_ALT_ID,
  CITY_ID,
  CONVERSATION_RULE_ID,
  EXPERIENCE_AWARD_RULE_ID,
  FIXTURE,
  MEMBER_ID,
  PLAYER_ID,
  SOCIAL_SYSTEM_ID,
  STRANGER_ID,
  TAVERN_ID,
  UNPROVISIONED_ID,
  WORLD_DAY,
  fixtureRngContext,
  fixtureSocialState,
  fixtureUsage,
  makeContext,
  stubDefinitionReader,
  stubResolvers,
  stubTeamQuery,
} from './fixtures';

// ── 迷你斷言工具 ─────────────────────────────────────────────────────────────

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function eventsOf(messages: readonly TransactionMessageDraft[]): SocialDomainEvent[] {
  return messages
    .filter((m): m is { event: unknown } => 'event' in m)
    .map((m) => m.event as SocialDomainEvent);
}

function commandsOf(messages: readonly TransactionMessageDraft[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if ('command' in m) out.push(m.command);
  }
  return out;
}

function findEvent<K extends SocialDomainEvent['type']>(
  events: readonly SocialDomainEvent[],
  type: K,
): Extract<SocialDomainEvent, { type: K }> | undefined {
  return events.find((e) => e.type === type) as Extract<SocialDomainEvent, { type: K }> | undefined;
}

function expectOk(r: SocialHandlerResult, label: string) {
  if (!r.ok) throw new Error(`${label}: expected accept, got reject '${r.rejection.code}'`);
  return r.result;
}

function expectReject(r: SocialHandlerResult, code: string, label: string) {
  if (r.ok) throw new Error(`${label}: expected reject '${code}', got accept`);
  assert(
    r.rejection.code === code,
    `${label}: expected code '${code}', got '${r.rejection.code}'`,
  );
  assert(
    r.rejection.source === SOCIAL_MODULE_ID,
    `${label}: rejection.source 應為 social（實得 ${String(r.rejection.source)}）`,
  );
}

// ── 命令建構子 ───────────────────────────────────────────────────────────────

function interact(target: CharacterId): InteractWithAdventurerCommand {
  return { type: 'interactWithAdventurer', targetCharacterId: target };
}

function propose(target: CharacterId): ProposeMarriageToTeamMemberCommand {
  return { type: 'proposeMarriageToTeamMember', targetCharacterId: target };
}

function provision(
  adventurerId: CharacterId,
  ruleId = AFFINITY_RULE_ID,
): ProvisionPlayerAffinityCommand {
  return { type: 'ProvisionPlayerAffinity', adventurerId, ruleId };
}

function consume(
  interactionId: string,
  input: Readonly<{ playerCharacterId?: CharacterId; worldDay?: WorldDay }> = {},
): ConsumePlayerConversationAllowanceCommand {
  return {
    type: 'ConsumePlayerConversationAllowance',
    playerCharacterId: input.playerCharacterId ?? PLAYER_ID,
    worldDay: input.worldDay ?? WORLD_DAY,
    interactionId: interactionId as InteractionId,
  };
}

// ── 案例 ─────────────────────────────────────────────────────────────────────

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── interactWithAdventurer：accept ─────────────────────────────────────────
  {
    name: 'interactWithAdventurer：與正式隊友交流 → partyChat、計數 1、好感度依資料增加、兩個事件',
    run: () => {
      const state = fixtureSocialState();
      const r = expectOk(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext()),
        'interact/member',
      );

      const affinity = tryGetAffinity(r.nextSlice, MEMBER_ID)!;
      assert(
        affinity.value === FIXTURE.initialAffinityBase + FIXTURE.deltaPartyChat,
        `好感度應為 base+partyChat delta（實得 ${affinity.value}）`,
      );
      assert(affinity.revision === 1, `revision 應遞增（實得 ${affinity.revision}）`);

      const usage = usageForDay(r.nextSlice, PLAYER_ID, WORLD_DAY)!;
      assert(usage.completedCount === 1, `完成數應為 1（實得 ${usage.completedCount}）`);
      assert(usage.ruleId === CONVERSATION_RULE_ID, '用量應記下 Rule ID');
      assert(usage.appliedInteractionIds.length === 1, '應記下 1 筆已套用 Interaction ID');

      const events = eventsOf(r.outgoingMessages);
      const completed = findEvent(events, 'PlayerConversationCompleted')!;
      assert(completed.kind === 'partyChat', `kind 應為 partyChat（實得 ${completed.kind}）`);
      assert(completed.worldDay === WORLD_DAY, 'worldDay 應取自 ctx');
      assert(
        completed.experienceAwardRuleId === EXPERIENCE_AWARD_RULE_ID,
        'experienceAwardRuleId 應取自 Conversation Rule（MXP 由 progression 發放）',
      );
      assert(
        completed.affinityDelta === FIXTURE.deltaPartyChat,
        `affinityDelta 應等於實際套用量（實得 ${completed.affinityDelta}）`,
      );
      assert(completed.targetCharacterId === MEMBER_ID, 'targetCharacterId 應為交流對象');

      const changed = findEvent(events, 'PlayerAffinityChanged')!;
      assert(changed.reason === 'conversation', `reason 應為 conversation（實得 ${changed.reason}）`);
      assert(changed.oldValue === FIXTURE.initialAffinityBase, 'oldValue 應為交流前的值');
      assert(changed.newValue === affinity.value, 'newValue 應等於 State 的新值');
      assert(changed.sourceId === completed.interactionId, '兩個事件應引用同一 Interaction ID');
    },
  },
  {
    name: 'interactWithAdventurer：與同城酒館冒險者交流 → tavernChat（種類由關係決定）',
    run: () => {
      const r = expectOk(
        handleInteractWithAdventurer(fixtureSocialState(), interact(TAVERN_ID), makeContext()),
        'interact/tavern',
      );
      const completed = findEvent(eventsOf(r.outgoingMessages), 'PlayerConversationCompleted')!;
      assert(completed.kind === 'tavernChat', `kind 應為 tavernChat（實得 ${completed.kind}）`);
      assert(
        completed.affinityDelta === FIXTURE.deltaTavernChat,
        `酒館聊天應套用 tavern delta（實得 ${completed.affinityDelta}）`,
      );
    },
  },
  {
    name: 'interactWithAdventurer：隊友交流與酒館聊天共用同一每日計數',
    run: () => {
      const first = expectOk(
        handleInteractWithAdventurer(fixtureSocialState(), interact(MEMBER_ID), makeContext()),
        'interact/first',
      );
      const second = expectOk(
        handleInteractWithAdventurer(first.nextSlice, interact(TAVERN_ID), makeContext()),
        'interact/second',
      );
      const usage = usageForDay(second.nextSlice, PLAYER_ID, WORLD_DAY)!;
      assert(usage.completedCount === 2, `兩種對話應共用計數（實得 ${usage.completedCount}）`);
    },
  },

  // ── interactWithAdventurer：rejection ─────────────────────────────────────
  {
    name: 'reject social/target-is-player-character：不得與玩家主角自己交流',
    run: () => {
      expectReject(
        handleInteractWithAdventurer(fixtureSocialState(), interact(PLAYER_ID), makeContext()),
        'social/target-is-player-character',
        'interact/self',
      );
    },
  },
  {
    name: 'reject social/affinity-not-provisioned：未 provision 的角色沒有可調整的好感度',
    run: () => {
      const ctx = makeContext({
        team: stubTeamQuery({ formalMembers: [PLAYER_ID, UNPROVISIONED_ID] }),
      });
      expectReject(
        handleInteractWithAdventurer(fixtureSocialState(), interact(UNPROVISIONED_ID), ctx),
        'social/affinity-not-provisioned',
        'interact/unprovisioned',
      );
    },
  },
  {
    name: 'reject social/target-not-reachable：既非正式隊友也不在同城酒館',
    run: () => {
      expectReject(
        handleInteractWithAdventurer(fixtureSocialState(), interact(STRANGER_ID), makeContext()),
        'social/target-not-reachable',
        'interact/stranger',
      );
    },
  },
  {
    name: 'reject social/target-not-reachable：隊伍不在城市時酒館冒險者不可交流（隊友仍可）',
    run: () => {
      const ctx = makeContext({
        team: stubTeamQuery({
          location: { kind: 'travelling', routeId: 'route-1' as never, progress: { kind: 'npcDirect' } },
        }),
      });
      expectReject(
        handleInteractWithAdventurer(fixtureSocialState(), interact(TAVERN_ID), ctx),
        'social/target-not-reachable',
        'interact/travelling-tavern',
      );
      expectOk(
        handleInteractWithAdventurer(fixtureSocialState(), interact(MEMBER_ID), ctx),
        'interact/travelling-member',
      );
    },
  },
  {
    name: 'reject social/daily-conversation-limit-reached：當日已達 Rule 上限',
    run: () => {
      const state = fixtureSocialState({
        conversationUsage: fixtureUsage({ completedCount: FIXTURE.maxCompletedPerDay }),
      });
      expectReject(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext()),
        'social/daily-conversation-limit-reached',
        'interact/limit',
      );
    },
  },

  // ── proposeMarriageToTeamMember ───────────────────────────────────────────
  {
    name: 'proposeMarriageToTeamMember：好感度達門檻 → 送 character 的 CreatePartnerFamilyLink，Social Slice 不變',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.proposalThreshold });
      const r = expectOk(
        handleProposeMarriageToTeamMember(state, propose(MEMBER_ID), makeContext()),
        'propose/accept',
      );
      assert(r.nextSlice === state, '求婚成功不得改動 Social Slice（家族狀態屬 character）');
      const commands = commandsOf(r.outgoingMessages);
      assert(commands.length === 1, `應只送出一筆命令（實得 ${commands.length}）`);
      const link = commands[0] as CreatePartnerFamilyLink;
      assert(link.type === 'CreatePartnerFamilyLink', `命令型別（實得 ${link.type}）`);
      assert(
        link.characterIds[0] === PLAYER_ID && link.characterIds[1] === MEMBER_ID,
        '應為玩家主角與目標的配對',
      );
      assert(
        eventsOf(r.outgoingMessages).length === 0,
        '求婚本身不發 Social 事件（婚姻事件屬 character）',
      );
    },
  },
  {
    name: 'reject social/proposal-affinity-too-low：好感度未達門檻，且不消耗次數、不改好感度',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.proposalThreshold - 1 });
      const r = handleProposeMarriageToTeamMember(state, propose(MEMBER_ID), makeContext());
      expectReject(r, 'social/proposal-affinity-too-low', 'propose/too-low');
      assert(
        usageForDay(state, PLAYER_ID, WORLD_DAY) === undefined,
        '求婚不消耗每日對話次數',
      );
    },
  },
  {
    name: 'reject social/target-not-formal-member：酒館冒險者不是求婚對象',
    run: () => {
      const state = fixtureSocialState({ tavernValue: FIXTURE.affinityMax });
      expectReject(
        handleProposeMarriageToTeamMember(state, propose(TAVERN_ID), makeContext()),
        'social/target-not-formal-member',
        'propose/tavern',
      );
    },
  },
  {
    name: 'reject social/target-is-player-character：不得對自己求婚（character 也擋，本模組先擋）',
    run: () => {
      expectReject(
        handleProposeMarriageToTeamMember(fixtureSocialState(), propose(PLAYER_ID), makeContext()),
        'social/target-is-player-character',
        'propose/self',
      );
    },
  },
  {
    name: 'reject social/affinity-not-provisioned：求婚對象沒有好感度記錄',
    run: () => {
      const ctx = makeContext({
        team: stubTeamQuery({ formalMembers: [PLAYER_ID, UNPROVISIONED_ID] }),
      });
      expectReject(
        handleProposeMarriageToTeamMember(fixtureSocialState(), propose(UNPROVISIONED_ID), ctx),
        'social/affinity-not-provisioned',
        'propose/unprovisioned',
      );
    },
  },

  // ── ProvisionPlayerAffinity ──────────────────────────────────────────────
  {
    name: 'ProvisionPlayerAffinity：建立唯一初始值並發 PlayerAffinityChanged(reason=provisioned)',
    run: () => {
      const state = createSocialState();
      const r = expectOk(
        handleProvisionPlayerAffinity(provision(MEMBER_ID), state, makeContext()),
        'provision/accept',
      );
      const affinity = tryGetAffinity(r.nextSlice, MEMBER_ID)!;
      assert(
        affinity.value === FIXTURE.initialAffinityBase,
        `初始值應由 Resolver 供給（實得 ${affinity.value}）`,
      );
      assert(affinity.ruleId === AFFINITY_RULE_ID, 'ruleId 應為命令帶來的 Rule');
      const changed = findEvent(eventsOf(r.outgoingMessages), 'PlayerAffinityChanged')!;
      assert(changed.reason === 'provisioned', `reason（實得 ${changed.reason}）`);
      assert(changed.oldValue === undefined, 'provisioning 沒有前值');
      assert(changed.newValue === affinity.value, 'newValue 應等於建立的值');
    },
  },
  {
    name: 'reject social/target-is-player-character：玩家主角不建立可用好感度',
    run: () => {
      expectReject(
        handleProvisionPlayerAffinity(provision(PLAYER_ID), createSocialState(), makeContext()),
        'social/target-is-player-character',
        'provision/player',
      );
    },
  },
  {
    name: 'reject social/affinity-rule-conflict：同角色換 Rule 重送不是冪等',
    run: () => {
      const state = fixtureSocialState();
      expectReject(
        handleProvisionPlayerAffinity(
          provision(MEMBER_ID, AFFINITY_RULE_ALT_ID),
          state,
          makeContext(),
        ),
        'social/affinity-rule-conflict',
        'provision/conflict',
      );
    },
  },

  // ── ConsumePlayerConversationAllowance ───────────────────────────────────
  {
    name: 'ConsumePlayerConversationAllowance：計數 +1 並發 PlayerConversationCompleted(kind=intel)',
    run: () => {
      const state = fixtureSocialState();
      const r = expectOk(
        handleConsumePlayerConversationAllowance(consume('intel-1'), state, makeContext()),
        'consume/accept',
      );
      const usage = usageForDay(r.nextSlice, PLAYER_ID, WORLD_DAY)!;
      assert(usage.completedCount === 1, `完成數應為 1（實得 ${usage.completedCount}）`);
      const completed = findEvent(eventsOf(r.outgoingMessages), 'PlayerConversationCompleted')!;
      assert(completed.kind === 'intel', `kind（實得 ${completed.kind}）`);
      assert(
        completed.targetCharacterId === undefined,
        '打聽情報沒有交流對象',
      );
      assert(
        completed.affinityDelta === 0,
        `沒有對象即沒有套用任何好感度（實得 ${completed.affinityDelta}）`,
      );
      assert(
        findEvent(eventsOf(r.outgoingMessages), 'PlayerAffinityChanged') === undefined,
        '不應發出好感度變更事件',
      );
    },
  },
  {
    name: 'reject social/world-day-mismatch：命令帶來的世界日必須與 Kernel 的世界日相符',
    run: () => {
      expectReject(
        handleConsumePlayerConversationAllowance(
          consume('intel-1', { worldDay: (WORLD_DAY + 1) as WorldDay }),
          fixtureSocialState(),
          makeContext(),
        ),
        'social/world-day-mismatch',
        'consume/day',
      );
    },
  },
  {
    name: 'reject social/not-player-character：額度只屬目前玩家主角',
    run: () => {
      expectReject(
        handleConsumePlayerConversationAllowance(
          consume('intel-1', { playerCharacterId: MEMBER_ID }),
          fixtureSocialState(),
          makeContext(),
        ),
        'social/not-player-character',
        'consume/not-player',
      );
    },
  },
  {
    name: 'reject social/daily-conversation-limit-reached：情報與聊天共用同一上限',
    run: () => {
      const state = fixtureSocialState({
        conversationUsage: fixtureUsage({ completedCount: FIXTURE.maxCompletedPerDay }),
      });
      expectReject(
        handleConsumePlayerConversationAllowance(consume('intel-1'), state, makeContext()),
        'social/daily-conversation-limit-reached',
        'consume/limit',
      );
    },
  },

  // ── 不變量 ───────────────────────────────────────────────────────────────
  {
    name: '不變量 social.oneAffinityPerAdventurer + 冪等：同 Rule 重送 provision 為 no-op（不重建、不發事件）',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.affinityMax });
      const r = expectOk(
        handleProvisionPlayerAffinity(provision(MEMBER_ID), state, makeContext()),
        'provision/idempotent',
      );
      assert(r.nextSlice === state, '冪等重送不得產生新的 Slice');
      assert(
        tryGetAffinity(r.nextSlice, MEMBER_ID)!.value === FIXTURE.affinityMax,
        '既有值不得被初始值覆寫',
      );
      assert(r.outgoingMessages.length === 0, '冪等重送不得發事件');
      assert(
        Object.keys(r.nextSlice.playerAffinities).length ===
          Object.keys(state.playerAffinities).length,
        '好感度筆數不得增加（每名冒險者至多一筆）',
      );
    },
  },
  {
    name: '不變量 social.affinityClampedToRule：交流變化量被 Rule 的 max 夾住',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.affinityMax });
      const r = expectOk(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext()),
        'clamp/max',
      );
      const affinity = tryGetAffinity(r.nextSlice, MEMBER_ID)!;
      assert(affinity.value === FIXTURE.affinityMax, `應夾在 max（實得 ${affinity.value}）`);
      const completed = findEvent(eventsOf(r.outgoingMessages), 'PlayerConversationCompleted')!;
      assert(
        completed.affinityDelta === 0,
        `affinityDelta 應反映實際套用量（夾住後為 0，實得 ${completed.affinityDelta}）`,
      );
    },
  },
  {
    name: '不變量 social.affinityClampedToRule：負向變化量被 Rule 的 min 夾住',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.affinityMin });
      const resolvers: SocialResolverPort = stubResolvers({
        resolveConversationDelta: (input) => ({
          value: -1000,
          nextCursor: (input.rngContext === undefined ? 1 : input.rngContext.cursor + 1) as never,
        }),
      });
      const r = expectOk(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext({ resolvers })),
        'clamp/min',
      );
      assert(
        tryGetAffinity(r.nextSlice, MEMBER_ID)!.value === FIXTURE.affinityMin,
        '應夾在 min',
      );
    },
  },
  {
    name: '不變量 social.singleDailyConversationUsage：跨世界日的舊用量被整筆替換，不累積歷史',
    run: () => {
      const state = fixtureSocialState({
        conversationUsage: fixtureUsage({
          worldDay: (WORLD_DAY - 1) as WorldDay,
          completedCount: FIXTURE.maxCompletedPerDay,
        }),
      });
      // 昨天已滿 6 次，今天仍可交流——重置點由世界日推導，不需要午夜 Job。
      const r = expectOk(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext()),
        'usage/new-day',
      );
      const usage = r.nextSlice.playerConversationUsage!;
      assert(usage.worldDay === WORLD_DAY, '用量應改記今日');
      assert(usage.completedCount === 1, `新的一天從 1 起算（實得 ${usage.completedCount}）`);
      assert(
        usage.appliedInteractionIds.length === 1,
        '已套用 Interaction 帳本隨日歸零，只留今日這一筆',
      );
    },
  },
  {
    name: '不變量 social.singleDailyConversationUsage：換玩家主角時舊用量同樣被替換',
    run: () => {
      const state = fixtureSocialState({
        conversationUsage: fixtureUsage({
          playerCharacterId: STRANGER_ID,
          completedCount: FIXTURE.maxCompletedPerDay,
        }),
      });
      const r = expectOk(
        handleInteractWithAdventurer(state, interact(MEMBER_ID), makeContext()),
        'usage/new-player',
      );
      const usage = r.nextSlice.playerConversationUsage!;
      assert(usage.playerCharacterId === PLAYER_ID, '用量應改記目前玩家主角');
      assert(usage.completedCount === 1, `應從 1 起算（實得 ${usage.completedCount}）`);
    },
  },
  {
    name: '不變量 social.interactionAppliedAtMostOnce + 冪等：同一 Interaction ID 重送額度消耗為 no-op',
    run: () => {
      const first = expectOk(
        handleConsumePlayerConversationAllowance(
          consume('intel-1'),
          fixtureSocialState(),
          makeContext(),
        ),
        'consume/first',
      );
      const second = expectOk(
        handleConsumePlayerConversationAllowance(consume('intel-1'), first.nextSlice, makeContext()),
        'consume/replay',
      );
      assert(second.nextSlice === first.nextSlice, '重送不得產生新的 Slice');
      assert(
        usageForDay(second.nextSlice, PLAYER_ID, WORLD_DAY)!.completedCount === 1,
        '重送不得再計數',
      );
      assert(second.outgoingMessages.length === 0, '重送不得再發事件');
      // 不同 Interaction ID 才是新的一次消耗。
      const third = expectOk(
        handleConsumePlayerConversationAllowance(consume('intel-2'), second.nextSlice, makeContext()),
        'consume/second-id',
      );
      assert(
        usageForDay(third.nextSlice, PLAYER_ID, WORLD_DAY)!.completedCount === 2,
        '不同 Interaction ID 應計數',
      );
    },
  },
  {
    name: '不變量 social.playerProposalUsesNoRng：不同 RNG cursor 得到相同的求婚判定',
    run: () => {
      const state = fixtureSocialState({ memberValue: FIXTURE.proposalThreshold - 1 });
      const a = handleProposeMarriageToTeamMember(
        state,
        propose(MEMBER_ID),
        makeContext({ rngContext: fixtureRngContext(0) }),
      );
      const b = handleProposeMarriageToTeamMember(
        state,
        propose(MEMBER_ID),
        makeContext({ rngContext: fixtureRngContext(77) }),
      );
      expectReject(a, 'social/proposal-affinity-too-low', 'propose/rng-0');
      expectReject(b, 'social/proposal-affinity-too-low', 'propose/rng-77');
      // 達門檻時同樣兩者一致。
      const high = fixtureSocialState({ memberValue: FIXTURE.proposalThreshold });
      const okA = expectOk(
        handleProposeMarriageToTeamMember(
          high,
          propose(MEMBER_ID),
          makeContext({ rngContext: fixtureRngContext(0) }),
        ),
        'propose/high-0',
      );
      const okB = expectOk(
        handleProposeMarriageToTeamMember(
          high,
          propose(MEMBER_ID),
          makeContext({ rngContext: fixtureRngContext(77) }),
        ),
        'propose/high-77',
      );
      assert(
        okA.outgoingMessages.length === okB.outgoingMessages.length,
        '求婚結果不得隨 cursor 改變',
      );
    },
  },
  {
    name: '不變量 social.rejectedInteractionConsumesNothing：被拒絕的互動不改 Slice',
    run: () => {
      const state = fixtureSocialState();
      const r = handleInteractWithAdventurer(state, interact(STRANGER_ID), makeContext());
      assert(!r.ok, '應被拒絕');
      // 拒絕回傳 CommandRejection，沒有 nextSlice 可寫回；原 Slice 必然不變。
      assert(
        state.playerConversationUsage === undefined &&
          tryGetAffinity(state, STRANGER_ID)!.value === FIXTURE.initialAffinityBase,
        '原 Slice 不得被 mutate',
      );
    },
  },
  {
    name: '不變量 social.playerCharacterHasNoUsableAffinity：殘留於玩家主角的好感度記錄被所有 Query 忽略',
    run: () => {
      // 角色 X 先前是 NPC（有好感度），之後成為玩家主角：值可保留作歷史，但 Query 必須忽略。
      const state = fixtureSocialState();
      const query = createSocialQuery(state, {
        definitions: stubDefinitionReader(),
        socialSystemDefinitionId: SOCIAL_SYSTEM_ID,
        resolvers: stubResolvers(),
        playerCharacterId: MEMBER_ID,
      });
      assert(query.getPlayerAffinity(MEMBER_ID) === undefined, '不得回報自我好感度');
      assert(
        query.getPlayerProposalAffinityResult(MEMBER_ID) === undefined,
        '不得對玩家主角自己做求婚判定',
      );
      assert(
        query.getHomeTutorPriceModifier(MEMBER_ID) === undefined,
        '不得對玩家主角自己算家教價格修正',
      );
      // 別人的記錄照常可讀。
      assert(query.getPlayerAffinity(TAVERN_ID) === FIXTURE.initialAffinityBase, '他人記錄應可讀');
    },
  },

  // ── RNG 紀律 ─────────────────────────────────────────────────────────────
  {
    name: 'RNG：同一 cursor 得到相同初始好感度；不同 cursor 得到不同值（Handler 真的吃注入的 cursor）',
    run: () => {
      const seen: number[] = [];
      const resolvers = stubResolvers({
        resolveInitialAffinity: (input) => {
          const cursor = input.rngContext === undefined ? -1 : input.rngContext.cursor;
          seen.push(cursor);
          return {
            value: FIXTURE.initialAffinityBase + cursor,
            nextCursor: (cursor + 1) as never,
          };
        },
      });
      const runWith = (cursor: number) =>
        expectOk(
          handleProvisionPlayerAffinity(
            provision(MEMBER_ID),
            createSocialState(),
            makeContext({ resolvers, rngContext: fixtureRngContext(cursor) }),
          ),
          `provision/cursor-${cursor}`,
        );

      const a1 = runWith(3);
      const a2 = runWith(3);
      assert(
        tryGetAffinity(a1.nextSlice, MEMBER_ID)!.value ===
          tryGetAffinity(a2.nextSlice, MEMBER_ID)!.value,
        '同 cursor 必須同結果（決定性可重播）',
      );

      const b = runWith(9);
      assert(
        tryGetAffinity(b.nextSlice, MEMBER_ID)!.value !==
          tryGetAffinity(a1.nextSlice, MEMBER_ID)!.value,
        '不同 cursor 必須得到不同結果（否則 cursor 沒有真的被使用）',
      );
      assert(
        seen.length === 3 && seen.every((c) => c !== -1) && seen.includes(9),
        `Resolver 應收到注入的 cursor，不得重用 cursor 0（實得 ${seen.join(',')}）`,
      );
    },
  },
  {
    name: 'RNG：交流變化量同樣走注入的 cursor（同 cursor 同 delta、不同 cursor 不同 delta）',
    run: () => {
      const deltaWith = (cursor: number): number => {
        const r = expectOk(
          handleInteractWithAdventurer(
            fixtureSocialState(),
            interact(MEMBER_ID),
            makeContext({ rngContext: fixtureRngContext(cursor) }),
          ),
          `interact/cursor-${cursor}`,
        );
        return findEvent(eventsOf(r.outgoingMessages), 'PlayerConversationCompleted')!.affinityDelta;
      };
      assert(deltaWith(2) === deltaWith(2), '同 cursor 同 delta');
      assert(deltaWith(2) !== deltaWith(3), '不同 cursor 不同 delta（fixture resolver 依 cursor 奇偶）');
    },
  },

  // ── Query ────────────────────────────────────────────────────────────────
  {
    name: 'SocialQuery：usage view 的 completedCount／remainingCount 由 Rule 上限推導',
    run: () => {
      const makeQuery = (state: SocialState) =>
        createSocialQuery(state, {
          definitions: stubDefinitionReader(),
          socialSystemDefinitionId: SOCIAL_SYSTEM_ID,
          resolvers: stubResolvers(),
          playerCharacterId: PLAYER_ID,
        });

      const empty = makeQuery(fixtureSocialState()).getPlayerConversationUsage(PLAYER_ID, WORLD_DAY);
      assert(empty.completedCount === 0, `尚無記錄應為 0（實得 ${empty.completedCount}）`);
      assert(
        empty.remainingCount === FIXTURE.maxCompletedPerDay,
        `剩餘應為上限（實得 ${empty.remainingCount}）`,
      );

      const used = makeQuery(
        fixtureSocialState({ conversationUsage: fixtureUsage({ completedCount: 4 }) }),
      ).getPlayerConversationUsage(PLAYER_ID, WORLD_DAY);
      assert(used.completedCount === 4, `實得 ${used.completedCount}`);
      assert(
        used.remainingCount === FIXTURE.maxCompletedPerDay - 4,
        `實得 ${used.remainingCount}`,
      );

      // 舊日的記錄不算今天的用量。
      const stale = makeQuery(
        fixtureSocialState({
          conversationUsage: fixtureUsage({
            worldDay: (WORLD_DAY - 1) as WorldDay,
            completedCount: 6,
          }),
        }),
      ).getPlayerConversationUsage(PLAYER_ID, WORLD_DAY);
      assert(stale.completedCount === 0, `跨日應歸零（實得 ${stale.completedCount}）`);
    },
  },
  {
    name: 'SocialQuery：求婚門檻與家教價格修正皆走 Rule 的 deterministic Resolver；查無記錄回 undefined',
    run: () => {
      const query = createSocialQuery(
        fixtureSocialState({ memberValue: FIXTURE.proposalThreshold, tavernValue: FIXTURE.affinityMin }),
        {
          definitions: stubDefinitionReader(),
          socialSystemDefinitionId: SOCIAL_SYSTEM_ID,
          resolvers: stubResolvers(),
          playerCharacterId: PLAYER_ID,
        },
      );
      const accepted = query.getPlayerProposalAffinityResult(MEMBER_ID)!;
      assert(accepted.acceptedByAffinity, '達門檻應為 true');
      assert(accepted.ruleId === AFFINITY_RULE_ID, 'ruleId 應為該筆好感度的 Rule');
      assert(
        query.getPlayerProposalAffinityResult(TAVERN_ID)!.acceptedByAffinity === false,
        '未達門檻應為 false',
      );
      assert(
        query.getPlayerProposalAffinityResult(UNPROVISIONED_ID) === undefined,
        '查無好感度記錄應回 undefined（不得回固定結果）',
      );
      assert(
        query.getHomeTutorPriceModifier(UNPROVISIONED_ID) === undefined,
        '查無好感度記錄不得憑空給價格修正',
      );
      const modifier = query.getHomeTutorPriceModifier(MEMBER_ID)!;
      assert(
        modifier ===
          (FIXTURE.tutorModifierBase - FIXTURE.proposalThreshold) / FIXTURE.tutorModifierBase,
        `價格修正應由 Resolver 決定（實得 ${modifier}）`,
      );
    },
  },
  {
    name: 'SocialQuery：listTavernVisitorIds 只在同城生效（窄化 team Port 的行為對齊）',
    run: () => {
      const team = stubTeamQuery();
      assert(team.listTavernVisitorIds(CITY_ID).includes(TAVERN_ID), '同城應可見');
      assert(
        team.listTavernVisitorIds('city-other' as never).length === 0,
        '他城不可見',
      );
    },
  },
];

// ── Harness ─────────────────────────────────────────────────────────────────

export type SocialTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly SocialTestResult[] {
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
    throw new Error(`social module: ${failed.length}/${results.length} tests failed\n${detail}`);
  }
}
