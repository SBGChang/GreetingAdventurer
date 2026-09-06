// app/content/quest-resolvers.ts
// 委託生成期的兩個 Resolver shape（07_quest_module.md §2.1／§2.4）。
//
//   * `quest-guild:local-city`      委託貼在**這張地圖所屬**的那座城的公會
//   * `quest-guild:random-city`     委託貼在任意一座合法城市的公會（綁架案是這樣：被擄者的
//                                   家人未必住在案發地）
//   * `quest-actual-end:day-range`  從接取期限起算，還有幾天可以完成（一個閉區間裡抽一個整數）
//
// 前兩個 shape 都不帶 params：它們的規則就是名字本身，沒有可調的數字。第三個的區間住在
// `integer-range-params`（與世界冒險者的起始年齡共用同一個 shape 家族）。

import type { CityId, MapInstanceId, ResolverBinding, SchemaId } from '../../contracts/core';
import type {
  AnyResolverRegistration,
  ResolverContext,
  ResolverRegistration,
} from '../../data-runtime';
import type { IntegerRangeParams } from './character-resolvers';

const GUILD_INPUT_SCHEMA = 'schema:quest-guild-input' as SchemaId;
const CITY_RESULT_SCHEMA = 'schema:city-id-result' as SchemaId;
const NUMBER_RESULT_SCHEMA = 'schema:number-result' as SchemaId;

// Resolver 執行期需要的兩件世界事實（由 quest context 注入）：
//   * 這張地圖屬於哪一座城（據點 → 城市）
//   * 這個世界有哪些城市（依 id 排序，讓「隨機挑一座」是決定性的）
export type QuestGuildQueries = Readonly<{
  getCityOfMap(mapId: MapInstanceId): CityId | undefined;
  listCityIds(): readonly CityId[];
}>;

export type QuestRangeDefinitions = Readonly<{
  getIntegerRangeParams(id: string): IntegerRangeParams;
}>;

export type GuildResolverInput = Readonly<{ mapId: MapInstanceId }>;

// 送貨目的地：世界上任何一座**不是出發地**的城。送到自己所在的城不是送貨。
export type DestinationResolverInput = Readonly<{ excludeCityId: CityId }>;

function requireRng(ctx: ResolverContext): Readonly<{
  rng: NonNullable<ResolverContext['rng']>;
  rngContext: NonNullable<ResolverContext['rngContext']>;
}> {
  if (ctx.rng === undefined || ctx.rngContext === undefined) {
    throw new Error('quest-resolvers：此 Resolver 需要 rng/rngContext，但 ResolverContext 沒有注入');
  }
  return { rng: ctx.rng, rngContext: ctx.rngContext };
}

// 本地公會：地圖所屬的那座城。查不到就明確拋——那代表世界裡有一張沒有歸屬城市的地圖，
// 隨便挑一座城會讓那筆錯誤永遠不被發現。
function localCityRegistration(
  binding: ResolverBinding,
): ResolverRegistration<GuildResolverInput, CityId> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: GUILD_INPUT_SCHEMA,
    resultSchemaId: CITY_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const queries = ctx.queries as QuestGuildQueries;
      const cityId = queries.getCityOfMap(input.mapId);
      if (cityId === undefined) {
        throw new Error(
          `quest-resolvers：地圖實例 "${String(input.mapId)}" 找不到所屬城市——` +
            `本地公會委託貼不出去。`,
        );
      }
      // 不消費 RNG：這條規則沒有隨機性。游標原樣回傳讓呼叫端照樣串接。
      const { rngContext } = requireRng(ctx);
      return { value: cityId, nextRngCursor: rngContext.cursor };
    },
  };
}

// 隨機合法城市：世界上任何一座城的公會都可能貼出這筆委託。
function randomCityRegistration(
  binding: ResolverBinding,
): ResolverRegistration<GuildResolverInput, CityId> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: GUILD_INPUT_SCHEMA,
    resultSchemaId: CITY_RESULT_SCHEMA,
    resolve: (_input, ctx) => {
      const queries = ctx.queries as QuestGuildQueries;
      const cities = queries.listCityIds();
      if (cities.length === 0) {
        throw new Error('quest-resolvers：世界裡一座城市都沒有，委託貼不出去。');
      }
      const { rng, rngContext } = requireRng(ctx);
      const step = rng.nextInt({ ...rngContext, minInclusive: 0, maxInclusive: cities.length - 1 });
      return { value: cities[step.value]!, nextRngCursor: step.nextCursor };
    },
  };
}

// 送貨目的地。候選＝所有城市扣掉出發地；只有一座城的世界不可能有送貨委託，明確拋。
function otherCityRegistration(
  binding: ResolverBinding,
): ResolverRegistration<DestinationResolverInput, CityId> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: GUILD_INPUT_SCHEMA,
    resultSchemaId: CITY_RESULT_SCHEMA,
    resolve: (input, ctx) => {
      const queries = ctx.queries as QuestGuildQueries;
      const candidates = queries.listCityIds().filter((id) => String(id) !== String(input.excludeCityId));
      if (candidates.length === 0) {
        throw new Error(
          `quest-resolvers：除了 "${String(input.excludeCityId)}" 之外沒有別的城市——送貨委託送不出去。`,
        );
      }
      const { rng, rngContext } = requireRng(ctx);
      const step = rng.nextInt({ ...rngContext, minInclusive: 0, maxInclusive: candidates.length - 1 });
      return { value: candidates[step.value]!, nextRngCursor: step.nextCursor };
    },
  };
}

// 實際結束期限：一個閉區間裡抽一個整數天數。
function actualEndRegistration(binding: ResolverBinding): ResolverRegistration<object, number> {
  const paramsDefId = binding.paramsDefId;
  if (paramsDefId === undefined) {
    throw new Error(
      `quest-actual-end:day-range 綁定缺 paramsDefId（Resolver ${String(binding.resolverId)}）——` +
        `天數區間住在一筆 integer-range-params。`,
    );
  }
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: GUILD_INPUT_SCHEMA,
    resultSchemaId: NUMBER_RESULT_SCHEMA,
    resolve: (_input, ctx) => {
      const defs = ctx.definitions as QuestRangeDefinitions;
      const params = defs.getIntegerRangeParams(String(paramsDefId));
      const { rng, rngContext } = requireRng(ctx);
      const step = rng.nextInt({
        ...rngContext,
        minInclusive: params.min,
        maxInclusive: params.max,
      });
      return { value: step.value, nextRngCursor: step.nextCursor };
    },
  };
}

export const QUEST_GENERATION_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'quest-guild:local-city': localCityRegistration,
  'quest-guild:random-city': randomCityRegistration,
  'quest-destination:other-city': otherCityRegistration,
  'quest-actual-end:day-range': actualEndRegistration,
};
