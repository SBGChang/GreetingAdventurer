// modules/progression/queries.ts
// Progression 公開 Query port 實作（doc §4）。
// 純讀取：以目前 slice + Reader 推導 View，不改動 state。

import type { CharacterId, MasteryId, DefinitionId } from '../../contracts/core';
import type {
  ProgressionDefinitionReader,
  ProgressionQuery,
  MasteryProgressView,
  PrimaryAttributes,
  SocialMasteryBenefitsView,
  MasteryRequirement,
  TeachingSessionView,
} from '../../contracts/progression';

import type { ProgressionModuleState } from './state';
import { createMasteryProgress } from './state';
import { derivePrimaryAttributes } from './system';

// 依目前等級對三條交流效果做「各級新增值累加」（doc §2.2）。
function cumulativeAtLevel(gainsByLevel: readonly number[], level: number): number {
  let sum = 0;
  const upTo = Math.min(level, gainsByLevel.length - 1);
  for (let i = 0; i <= upTo; i += 1) {
    const g = gainsByLevel[i];
    if (g !== undefined) sum += g;
  }
  return sum;
}

// 建立一個綁定當前 slice 的 ProgressionQuery。
export function makeProgressionQuery(
  state: ProgressionModuleState,
  reader: ProgressionDefinitionReader,
): ProgressionQuery {
  function progressionOf(characterId: CharacterId) {
    return state.characterProgress[characterId];
  }

  return {
    getMastery(characterId: CharacterId, masteryId: MasteryId): MasteryProgressView {
      const progression = progressionOf(characterId);
      const mp = progression?.masteries[masteryId];
      return mp ?? createMasteryProgress(masteryId);
    },

    getPrimaryAttributes(characterId: CharacterId): PrimaryAttributes {
      const progression = progressionOf(characterId);
      if (progression === undefined) {
        return { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 };
      }
      return derivePrimaryAttributes(progression, reader);
    },

    getSocialMasteryBenefits(characterId: CharacterId): SocialMasteryBenefitsView {
      const progression = progressionOf(characterId);
      let personalTradeBonus = 0;
      let inviteSuccessBonus = 0;
      let memberDepartureResistance = 0;
      if (progression !== undefined) {
        for (const benefit of reader.listSocialMasteryBenefits()) {
          const mp = progression.masteries[benefit.masteryId];
          if (mp === undefined) continue;
          personalTradeBonus += cumulativeAtLevel(benefit.personalTradeBonusGainsByLevel, mp.level);
          inviteSuccessBonus += cumulativeAtLevel(benefit.inviteSuccessBonusGainsByLevel, mp.level);
          memberDepartureResistance += cumulativeAtLevel(
            benefit.memberDepartureResistanceGainsByLevel,
            mp.level,
          );
        }
      }
      return { personalTradeBonus, inviteSuccessBonus, memberDepartureResistance };
    },

    knows(characterId: CharacterId, knowledgeId: DefinitionId): boolean {
      const progression = progressionOf(characterId);
      return progression?.learnedKnowledgeIds.includes(knowledgeId) ?? false;
    },

    meetsRequirements(
      characterId: CharacterId,
      requirements: readonly MasteryRequirement[],
    ): boolean {
      const progression = progressionOf(characterId);
      return requirements.every((req) => {
        const mp = progression?.masteries[req.masteryId];
        return (mp?.level ?? 0) >= req.minLevel;
      });
    },

    getTeachingSession(characterId: CharacterId): TeachingSessionView | undefined {
      // 不變量 §3.5.3：同一角色同時點至多一筆 active。
      for (const sessionId of Object.keys(state.teachingSessions)) {
        const session = state.teachingSessions[sessionId as keyof typeof state.teachingSessions];
        if (session !== undefined && session.learnerId === characterId && session.status === 'active') {
          return session;
        }
      }
      return undefined;
    },
  };
}

// 容量投影（doc §8 ProgressionCapacityChanged 的讀取面）：
// Progression 只公開主屬真相；最大生命／魔力由 Character 依主屬 + 年齡推導。
export type ProgressionCapacityView = Readonly<{
  characterId: CharacterId;
  primaryAttributes: PrimaryAttributes;
}>;

export function getProgressionCapacity(
  state: ProgressionModuleState,
  reader: ProgressionDefinitionReader,
  characterId: CharacterId,
): ProgressionCapacityView {
  const progression = state.characterProgress[characterId];
  const primaryAttributes =
    progression === undefined
      ? { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 }
      : derivePrimaryAttributes(progression, reader);
  return { characterId, primaryAttributes };
}
