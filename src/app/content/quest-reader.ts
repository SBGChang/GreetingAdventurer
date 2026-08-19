// app/content/quest-reader.ts
// QuestDefinitionReader 的真實實作：由 data-runtime 的 DefinitionRegistry 組出來
// （樣板見 dungeon-reader.ts）。一個 kind 家族一個窄化 Reader，領域 getter 委派到對應的 `.get(id)`。
//
// 四個家族彼此不得互通：Reaction Rule 的 id 拿去查 Deadline Rule 一律拋錯，
// 而不是回一筆看起來合理的定義。

import type {
  QuestDeadlineRuleDefinition,
  QuestDefinitionReader,
  QuestObjectiveRuleDefinition,
  QuestReactionRuleDefinition,
  QuestRewardRuleDefinition,
} from '../../contracts/quest';
import type { DefinitionRegistry } from '../../data-runtime';
import { narrowedDomainReader } from './reader-adapter';

// Definition `kind` 命名（本專案定義；內容作者以此標注每筆 definition 的 kind 欄位）。
export const QUEST_DEFINITION_KINDS = {
  reactionRule: 'quest-reaction-rule',
  deadlineRule: 'quest-deadline-rule',
  objectiveRule: 'quest-objective-rule',
  rewardRule: 'quest-reward-rule',
} as const;

export function createQuestDefinitionReader(registry: DefinitionRegistry): QuestDefinitionReader {
  const reaction = narrowedDomainReader<QuestReactionRuleDefinition>(
    registry,
    'reader:quest.reaction-rule',
    [QUEST_DEFINITION_KINDS.reactionRule],
  );
  const deadline = narrowedDomainReader<QuestDeadlineRuleDefinition>(
    registry,
    'reader:quest.deadline-rule',
    [QUEST_DEFINITION_KINDS.deadlineRule],
  );
  const objective = narrowedDomainReader<QuestObjectiveRuleDefinition>(
    registry,
    'reader:quest.objective-rule',
    [QUEST_DEFINITION_KINDS.objectiveRule],
  );
  const reward = narrowedDomainReader<QuestRewardRuleDefinition>(
    registry,
    'reader:quest.reward-rule',
    [QUEST_DEFINITION_KINDS.rewardRule],
  );

  return {
    getQuestReactionRule: (id) => reaction.get(id),
    getQuestDeadlineRule: (id) => deadline.get(id),
    getQuestObjectiveRule: (id) => objective.get(id),
    getQuestRewardRule: (id) => reward.get(id),
  };
}
