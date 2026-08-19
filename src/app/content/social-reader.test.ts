// app/content/social-reader.test.ts
// 證明 data-runtime → SocialDefinitionReader 的 adapter 路徑：
//   1. 單元層——由記憶體內 content pack 建 DefinitionRegistry → createSocialDefinitionReader，
//      四個 getter 都回傳正確定義；未知 id / 跨 kind 存取明確拋錯。
//   2. 驅動層——把這個**真** reader 換進 Social Handler 的 Context，跑 interactWithAdventurer：
//      好感度上下限、每日對話上限與 experienceAwardRuleId 全部來自 registry。證明 adapter 不只型別對，
//      還能真的驅動 Handler。
//
// 樣板：dungeon-reader.test.ts。此處不做引擎 Session 端到端——social 尚未進 composition 的
// GameState 與 Manifest（那是整合者的接線工作），因此以模組 Handler 直接驅動。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  AFFINITY_RULE_ID,
  CONVERSATION_RULE_ID,
  DELTA_RESOLVER_ID,
  EXPERIENCE_AWARD_RULE_ID,
  FIXTURE,
  INITIAL_RESOLVER_ID,
  MEMBER_ID,
  NPC_MARRIAGE_RESOLVER_ID,
  NPC_MARRIAGE_RULE_ID,
  PROPOSAL_RESOLVER_ID,
  SOCIAL_SYSTEM_ID,
  TUTOR_RESOLVER_ID,
  fixtureSocialState,
  makeContext,
} from '../../modules/social/fixtures';
import { handleInteractWithAdventurer } from '../../modules/social/system';
import { tryGetAffinity } from '../../modules/social/state';
import type { SocialDomainEvent } from '../../contracts/social';

import { createSocialDefinitionReader, SOCIAL_DEFINITION_KINDS } from './social-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:social-bringup' as ContentPackId;

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 對齊 social FIXTURE 的最小定義集（與 fixtures 的 stub reader 同值）。
function socialDefinitions(): readonly ContentDefinition[] {
  return [
    def(SOCIAL_SYSTEM_ID, SOCIAL_DEFINITION_KINDS.socialSystem, {
      playerAffinityRuleId: AFFINITY_RULE_ID,
      playerConversationRuleId: CONVERSATION_RULE_ID,
    }),
    def(AFFINITY_RULE_ID, SOCIAL_DEFINITION_KINDS.playerAffinityRule, {
      minValue: FIXTURE.affinityMin,
      maxValue: FIXTURE.affinityMax,
      initialValueResolverId: INITIAL_RESOLVER_ID,
      conversationDeltaResolverId: DELTA_RESOLVER_ID,
      playerProposalAcceptanceResolverId: PROPOSAL_RESOLVER_ID,
      homeTutorPriceModifierResolverId: TUTOR_RESOLVER_ID,
    }),
    def(CONVERSATION_RULE_ID, SOCIAL_DEFINITION_KINDS.playerConversationRule, {
      maxCompletedPerDay: FIXTURE.maxCompletedPerDay,
      experienceAwardRuleId: EXPERIENCE_AWARD_RULE_ID,
    }),
    def(NPC_MARRIAGE_RULE_ID, SOCIAL_DEFINITION_KINDS.npcMarriageRule, {
      acceptanceChanceResolverId: NPC_MARRIAGE_RESOLVER_ID,
    }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(socialDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getSocialSystem 由 registry 投影出領域定義（header + 兩條 Rule 引用）',
    run: () => {
      const reader = createSocialDefinitionReader(registry());
      const system = reader.getSocialSystem(SOCIAL_SYSTEM_ID);
      assert(String(system.id) === String(SOCIAL_SYSTEM_ID), 'id 應為 registry 權威值');
      assert(system.enabled === true, 'enabled 應取自 registry header');
      assert(system.packId === PACK, 'packId 應取自 registry header');
      assert(
        String(system.playerAffinityRuleId) === String(AFFINITY_RULE_ID),
        'playerAffinityRuleId 應取自 data',
      );
      assert(
        String(system.playerConversationRuleId) === String(CONVERSATION_RULE_ID),
        'playerConversationRuleId 應取自 data',
      );
    },
  },
  {
    name: 'getPlayerAffinityRule 投影出四個 Resolver 引用與 min／max',
    run: () => {
      const rule = createSocialDefinitionReader(registry()).getPlayerAffinityRule(AFFINITY_RULE_ID);
      assert(rule.minValue === FIXTURE.affinityMin, `minValue（實得 ${rule.minValue}）`);
      assert(rule.maxValue === FIXTURE.affinityMax, `maxValue（實得 ${rule.maxValue}）`);
      assert(
        String(rule.initialValueResolverId) === String(INITIAL_RESOLVER_ID),
        'initialValueResolverId',
      );
      assert(
        String(rule.conversationDeltaResolverId) === String(DELTA_RESOLVER_ID),
        'conversationDeltaResolverId',
      );
      assert(
        String(rule.playerProposalAcceptanceResolverId) === String(PROPOSAL_RESOLVER_ID),
        'playerProposalAcceptanceResolverId',
      );
      assert(
        String(rule.homeTutorPriceModifierResolverId) === String(TUTOR_RESOLVER_ID),
        'homeTutorPriceModifierResolverId',
      );
    },
  },
  {
    name: 'getPlayerConversationRule / getNpcMarriageRule 各自窄化到自己的 kind',
    run: () => {
      const reader = createSocialDefinitionReader(registry());
      const conversation = reader.getPlayerConversationRule(CONVERSATION_RULE_ID);
      assert(
        conversation.maxCompletedPerDay === FIXTURE.maxCompletedPerDay,
        `maxCompletedPerDay（實得 ${conversation.maxCompletedPerDay}）`,
      );
      assert(
        String(conversation.experienceAwardRuleId) === String(EXPERIENCE_AWARD_RULE_ID),
        'experienceAwardRuleId 應取自 data（MXP 由 progression 依此發放）',
      );
      const marriage = reader.getNpcMarriageRule(NPC_MARRIAGE_RULE_ID);
      assert(
        String(marriage.acceptanceChanceResolverId) === String(NPC_MARRIAGE_RESOLVER_ID),
        'acceptanceChanceResolverId 應取自 data',
      );
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined，也不回預設定義）',
    run: () => {
      const reader = createSocialDefinitionReader(registry());
      let threw = false;
      try {
        reader.getPlayerAffinityRule('definition:player-affinity-rule:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（affinity reader 不得取到 conversation 定義）',
    run: () => {
      const reader = createSocialDefinitionReader(registry());
      let threw = false;
      try {
        reader.getPlayerAffinityRule(CONVERSATION_RULE_ID as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
    },
  },
  {
    name: '驅動層：真 reader 換進 Social Handler Context，interactWithAdventurer 的上限／夾取／MXP 規則全來自 registry',
    run: () => {
      const definitions = createSocialDefinitionReader(registry());
      const ctx = makeContext({ definitions });

      const r = handleInteractWithAdventurer(
        fixtureSocialState(),
        { type: 'interactWithAdventurer', targetCharacterId: MEMBER_ID },
        ctx,
      );
      assert(r.ok, `交流應被接受（實得 ${r.ok ? 'accept' : r.rejection.code}）`);
      if (!r.ok) return;

      const affinity = tryGetAffinity(r.result.nextSlice, MEMBER_ID)!;
      assert(
        affinity.value === FIXTURE.initialAffinityBase + FIXTURE.deltaPartyChat,
        `好感度應依真 reader 的 min／max 夾取後套用（實得 ${affinity.value}）`,
      );

      const events = r.result.outgoingMessages
        .filter((m): m is { event: unknown } => 'event' in m)
        .map((m) => m.event as SocialDomainEvent);
      const completed = events.find((e) => e.type === 'PlayerConversationCompleted');
      assert(completed !== undefined, '應發出 PlayerConversationCompleted');
      if (completed === undefined || completed.type !== 'PlayerConversationCompleted') return;
      assert(
        String(completed.experienceAwardRuleId) === String(EXPERIENCE_AWARD_RULE_ID),
        'experienceAwardRuleId 應由真 reader 供給',
      );

      // 真 reader 的 maxCompletedPerDay 也真的擋得住：第 7 次被拒。
      let state = fixtureSocialState();
      for (let i = 0; i < FIXTURE.maxCompletedPerDay; i += 1) {
        const step = handleInteractWithAdventurer(
          state,
          { type: 'interactWithAdventurer', targetCharacterId: MEMBER_ID },
          ctx,
        );
        assert(step.ok, `第 ${i + 1} 次交流應被接受`);
        if (!step.ok) return;
        state = step.result.nextSlice;
      }
      const overflow = handleInteractWithAdventurer(
        state,
        { type: 'interactWithAdventurer', targetCharacterId: MEMBER_ID },
        ctx,
      );
      assert(!overflow.ok, '超過真 reader 的每日上限應被拒絕');
      if (overflow.ok) return;
      assert(
        overflow.rejection.code === 'social/daily-conversation-limit-reached',
        `拒絕碼（實得 ${overflow.rejection.code}）`,
      );
    },
  },
];

export function runTestResults(): readonly ReaderTestResult[] {
  return CASES.map((c) => {
    try {
      c.run();
      return { name: c.name, pass: true };
    } catch (e) {
      return { name: c.name, pass: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function runTests(): void {
  const results = runTestResults();
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? ''}`).join('\n');
    throw new Error(`social-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
