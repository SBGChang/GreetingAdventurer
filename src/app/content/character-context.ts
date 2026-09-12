import { UnavailableCapabilityError } from '../composition/capability';
// app/content/character-context.ts
// `CharacterResolverPort` 的正式組裝——目前只接**世界冒險者生成**那一條路。
//
// 為什麼只接一條：`CharacterResolverPort` 有五個方法（退休、自然死亡、生育、世界冒險者、
// 任務暫時角色），五者各自需要自己的 Resolver shape 與 params。世界冒險者這一條是酒館招募的
// 前提（沒有冒險者就沒有名單），其餘四條在接上之前保持 pending：一被存取就拋並指名是誰，
// 不給一個編造的結果。
//
// 生成的四項決定全部由內容的 `WorldAdventurerGenerationRuleDefinition` 指名 Resolver：
//   archetypeWeightResolverId / sexWeightResolverId / startingAgeResolverId / innateTraitResolverId
// 本檔一個權重、一個年齡、一個機率都不寫。

import type {
  CharacterArchetypeId,
  CharacterTraitDefinitionId,
  DeterministicRng,
  ResolverId,
  RngContext,
  RngCursor,
  RngStreamId,
  WorldDay,
} from '../../contracts/core';
import type { Sex } from '../../contracts/character';
import type { DefinitionRegistry, ResolverRegistry } from '../../data-runtime';
import type { CharacterResolverPort, WorldAdventurerDraft } from '../../modules/character/public';
import { createCharacterDefinitionReader } from './character-reader';
import { narrowedDomainReader } from './reader-adapter';
import { runResolver, resolverContext } from './resolver-adapter';
import type {
  IntegerRangeParams,
  WeightedChoiceParams,
  WeightedDrawParams,
} from './character-resolvers';

const WEIGHTED_CHOICE_KIND = 'weighted-choice-params';
const INTEGER_RANGE_KIND = 'integer-range-params';
const WEIGHTED_DRAW_KIND = 'weighted-draw-params';

function pendingMethod(name: string): never {
  throw new UnavailableCapabilityError(name);
}

export type CharacterResolverPortDeps = Readonly<{
  registry: DefinitionRegistry;
  resolvers: ResolverRegistry;
  rng: DeterministicRng;
}>;

export function createCharacterResolverPort(deps: CharacterResolverPortDeps): CharacterResolverPort {
  const definitions = createCharacterDefinitionReader(deps.registry);
  const choiceParams = narrowedDomainReader<WeightedChoiceParams>(
    deps.registry,
    'reader:character.weighted-choice-params',
    [WEIGHTED_CHOICE_KIND],
  );
  const rangeParams = narrowedDomainReader<IntegerRangeParams>(
    deps.registry,
    'reader:character.integer-range-params',
    [INTEGER_RANGE_KIND],
  );
  const drawParams = narrowedDomainReader<WeightedDrawParams>(
    deps.registry,
    'reader:character.weighted-draw-params',
    [WEIGHTED_DRAW_KIND],
  );

  const paramsView = {
    getWeightedChoiceParams: (id: string) => choiceParams.get(id as never),
    getIntegerRangeParams: (id: string) => rangeParams.get(id as never),
    getWeightedDrawParams: (id: string) => drawParams.get(id as never),
  };

  // 四次抽取共用同一條 RNG 串流，游標顯式串接：不串接的話四項全落在同一格，
  // 於是一整批冒險者會是同一個人（同性別、同年齡）。
  const draw = <T>(resolverId: ResolverId, input: object, rngContext: RngContext): Readonly<{ value: T; nextCursor: RngCursor }> => {
    const result = runResolver<T>(
      deps.resolvers,
      resolverId,
      input,
      resolverContext({ definitions: paramsView, rng: deps.rng, rngContext }),
    );
    if (result.nextRngCursor === undefined) {
      throw new Error(
        `character-context：生成 Resolver "${String(resolverId)}" 沒有回傳 nextRngCursor——` +
          `同一批角色的連續抽取會全部落在同一格。`,
      );
    }
    return { value: result.value, nextCursor: result.nextRngCursor as RngCursor };
  };

  return {
    resolveNaturalDeath: () => pendingMethod('character.resolveNaturalDeath'),
    resolveRetirement: () => pendingMethod('character.resolveRetirement'),
    resolveBirth: () => pendingMethod('character.resolveBirth'),
    resolveQuestTemporaryCharacter: () => pendingMethod('character.resolveQuestTemporaryCharacter'),
    resolveReputationDelta: () => pendingMethod('character.resolveReputationDelta'),

    resolveWorldAdventurer: ({ index, command, onDay }): WorldAdventurerDraft => {
      const rule = definitions.getWorldAdventurerGenerationRule(command.generationRuleId);
      // 同一批裡的每個人用**自己的 stream**，而不是在同一條 stream 上以固定步長錯開游標。
      // 錯開需要知道「每人抽幾次」——那個數字會隨 Resolver 的實作漂移（例如天賦改成抽兩次），
      // 一漂移就會重疊，而重疊的症狀是「兩個人一模一樣」，很難追。分流則不可能重疊。
      const batchStream = `${String(command.rngContext.streamId)}:${index}` as RngStreamId;
      let cursor = command.rngContext.cursor;
      const at = (): RngContext => ({ ...command.rngContext, streamId: batchStream, cursor });

      const archetype = draw<string>(rule.archetypeWeightResolverId, {
        candidates: rule.allowedArchetypeIds.map(String),
      }, at());
      cursor = archetype.nextCursor;

      const sex = draw<string>(rule.sexWeightResolverId, {}, at());
      cursor = sex.nextCursor;
      if (sex.value !== 'male' && sex.value !== 'female') {
        throw new Error(
          `character-context：性別 Resolver "${String(rule.sexWeightResolverId)}" 回了 "${sex.value}"——` +
            `契約只允許 'male' | 'female'（內容的選項值打錯了）。`,
        );
      }

      const ageDays = draw<number>(rule.startingAgeResolverId, {}, at());
      cursor = ageDays.nextCursor;

      const traits = draw<readonly string[]>(rule.innateTraitResolverId, {}, at());

      return {
        archetypeId: archetype.value as CharacterArchetypeId,
        sex: sex.value as Sex,
        // 起始年齡以「日」給出（與 LifecycleRuleDefinition 的 adulthoodAgeDays 同尺度）。
        // 生成日在世界第 0 天之前是不可能的，內容給出比 onDay 還大的年齡即為資料錯誤。
        birthDay: requireNonNegativeDay(onDay, ageDays.value, rule.startingAgeResolverId),
        innateTraitIds: traits.value as readonly CharacterTraitDefinitionId[],
      };
    },
  };
}

function requireNonNegativeDay(onDay: WorldDay, ageDays: number, resolverId: ResolverId): WorldDay {
  const birthDay = Number(onDay) - ageDays;
  if (birthDay < 0) {
    throw new Error(
      `character-context：起始年齡 Resolver "${String(resolverId)}" 給出 ${ageDays} 日，` +
        `但世界現在才第 ${Number(onDay)} 日——這個人會在世界開始之前出生。` +
        `開新遊戲的 startDay 必須不小於最大起始年齡。`,
    );
  }
  return birthDay as WorldDay;
}
