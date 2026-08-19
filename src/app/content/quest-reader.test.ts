// app/content/quest-reader.test.ts
// 證明 data-runtime → QuestDefinitionReader 的 adapter 路徑：由記憶體內 content pack 建
// DefinitionRegistry → createQuestDefinitionReader，四個 getter 各自回傳正確定義；
// 未知 id 與跨 kind 存取一律明確拋錯。
//
// 沒有端到端一段：quest 尚未進入 composition 的註冊表（見 modules/quest/public.ts 的說明），
// 因此無法像 dungeon-reader.test 那樣在真交易裡驗證。此處只驗 adapter 本身。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import {
  ACTUAL_END_RESOLVER_ID,
  DEADLINE_RULE_ID,
  GUILD_RESOLVER_ID,
  MASTERY_EXPERIENCE_RULE_ID,
  OBJECTIVE_RULE_ID,
  REACTION_RULE_ID,
  REPUTATION_EFFECT_ID,
  REWARD_RULE_ID,
} from '../../modules/quest/fixtures';

import { createQuestDefinitionReader, QUEST_DEFINITION_KINDS } from './quest-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:quest-bringup' as ContentPackId;

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

function questDefinitions(): readonly ContentDefinition[] {
  return [
    def(REACTION_RULE_ID, QUEST_DEFINITION_KINDS.reactionRule, {
      sourceKind: 'monsterGroup',
      questKind: 'suppression',
      creationChance: 1,
      guildResolverId: GUILD_RESOLVER_ID,
      deadlineRuleId: DEADLINE_RULE_ID,
      objectiveRuleId: OBJECTIVE_RULE_ID,
      rewardRuleId: REWARD_RULE_ID,
    }),
    def(DEADLINE_RULE_ID, QUEST_DEFINITION_KINDS.deadlineRule, {
      acceptDurationDays: 14,
      actualEndResolverId: ACTUAL_END_RESOLVER_ID,
      maxCityGapCount: 2,
    }),
    def(OBJECTIVE_RULE_ID, QUEST_DEFINITION_KINDS.objectiveRule, {
      questKind: 'suppression',
    }),
    def(REWARD_RULE_ID, QUEST_DEFINITION_KINDS.rewardRule, {
      masteryExperienceRuleId: MASTERY_EXPERIENCE_RULE_ID,
      reputationEffectIds: [REPUTATION_EFFECT_ID],
    }),
  ];
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-bringup',
  manifestHash: 'bringup',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'bringup' }],
};

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(questDefinitions(), IDENTITY);
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getQuestReactionRule 由 registry 投影出領域定義（header + 領域欄位）',
    run: () => {
      const reader = createQuestDefinitionReader(registry());
      const rule = reader.getQuestReactionRule(REACTION_RULE_ID);
      assert(String(rule.id) === String(REACTION_RULE_ID), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(rule.packId === PACK, 'packId 應取自 registry header');
      assert(rule.sourceKind === 'monsterGroup', `sourceKind（實得 ${rule.sourceKind}）`);
      assert(rule.questKind === 'suppression', `questKind（實得 ${rule.questKind}）`);
      assert(rule.creationChance === 1, `creationChance（實得 ${rule.creationChance}）`);
      assert(
        String(rule.deadlineRuleId) === String(DEADLINE_RULE_ID),
        'deadlineRuleId 應取自 data',
      );
    },
  },
  {
    name: 'getQuestDeadlineRule 投影出期限天數與 actualEnd resolver',
    run: () => {
      const reader = createQuestDefinitionReader(registry());
      const rule = reader.getQuestDeadlineRule(DEADLINE_RULE_ID);
      assert(rule.acceptDurationDays === 14, `acceptDurationDays（實得 ${rule.acceptDurationDays}）`);
      assert(
        String(rule.actualEndResolverId) === String(ACTUAL_END_RESOLVER_ID),
        'actualEndResolverId 應取自 data',
      );
      assert(rule.maxCityGapCount === 2, `maxCityGapCount（實得 ${String(rule.maxCityGapCount)}）`);
    },
  },
  {
    name: 'getQuestRewardRule / getQuestObjectiveRule 各自窄化到自己的 kind',
    run: () => {
      const reader = createQuestDefinitionReader(registry());
      const reward = reader.getQuestRewardRule(REWARD_RULE_ID);
      assert(
        String(reward.masteryExperienceRuleId) === String(MASTERY_EXPERIENCE_RULE_ID),
        'masteryExperienceRuleId 應取自 data',
      );
      assert(
        reward.reputationEffectIds !== undefined && reward.reputationEffectIds.length === 1,
        '應有 1 筆 reputationEffectId',
      );
      assert(reward.currencyRewardRuleId === undefined, '本筆內容沒有貨幣報酬，不得憑空補上');
      const objective = reader.getQuestObjectiveRule(OBJECTIVE_RULE_ID);
      assert(objective.questKind === 'suppression', `objective questKind（實得 ${objective.questKind}）`);
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined）',
    run: () => {
      const reader = createQuestDefinitionReader(registry());
      let threw = false;
      try {
        reader.getQuestRewardRule('definition:quest-reward-rule:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（reward reader 不得取到 deadline 定義）',
    run: () => {
      const reader = createQuestDefinitionReader(registry());
      let threw = false;
      try {
        reader.getQuestRewardRule(DEADLINE_RULE_ID as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
      let threwReaction = false;
      try {
        reader.getQuestReactionRule(REWARD_RULE_ID as never);
      } catch {
        threwReaction = true;
      }
      assert(threwReaction, 'reaction reader 不得取到 reward 定義');
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
    throw new Error(`quest-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
