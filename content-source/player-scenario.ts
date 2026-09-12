import type { NewGameConfig } from '../src/app/composition/new-game-bootstrap';
import { MASTERY_IDS } from './core/progression';
/** 第一版方案（待討論）：25 歲、受過基礎武藝訓練的旅人；數值在作者層調校。 */
export const PLAYER_SCENARIO: NewGameConfig = {
  worldSeed: 'greeting-adventurer-v1', startDay: 14600,
  startingArchetypeId: 'character-archetype.core.player-lineage' as NewGameConfig['startingArchetypeId'],
  startCityId: 'city-node.yunhua.yunjing' as NewGameConfig['startCityId'],
  leaderSex: 'female', leaderBirthDay: 5475, startingMoney: 5000,
  startingMasteries: [
    { masteryId: MASTERY_IDS['one-hand-weapon']!, level: 5 },
    { masteryId: MASTERY_IDS['medium-armor']!, level: 5 },
    { masteryId: MASTERY_IDS['throwing-weapon']!, level: 3 },
  ],
};
