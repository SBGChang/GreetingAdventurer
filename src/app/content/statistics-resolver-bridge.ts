// app/content/statistics-resolver-bridge.ts
// StatisticsResolverPort 的真實實作：4 個方法都橋到 data-runtime ResolverRegistry（resolverId 由
// 副屬規則/統計規則帶入）。ctx.definitions 提供派生統計 shape 需要的各 params reader（weighted-product /
// ratio-saturation / mastery-multiplier / primary-attribute-modifier）。無 RNG、無 Query。

import { narrowedDomainReader } from './reader-adapter';
import { resolverContext, runResolver } from './resolver-adapter';
import { RESOLVER_PARAMS_KINDS } from './resolvers';
import type {
  MasteryMultiplierParams,
  PrimaryAttributeModifierParams,
  StatisticsParamsReader,
} from './statistics-resolvers';
import type {
  DefinitionRegistry,
  RatioSaturationParams,
  ResolverRegistry,
  WeightedLinearProductParams,
} from '../../data-runtime';
import type {
  AgeModifierResolverInput,
  FinalSecondaryResolverInput,
  MasteryCoefficientResolverInput,
  PrimaryAttributeDeltas,
  ReputationContributionResolverInput,
  StatisticsResolverPort,
} from '../../domain-services/statistics/statistics';

export function createStatisticsResolverPort(
  registry: ResolverRegistry,
  definitions: DefinitionRegistry,
): StatisticsResolverPort {
  const weighted = narrowedDomainReader<WeightedLinearProductParams>(definitions, 'bridge:stat.weighted', [
    RESOLVER_PARAMS_KINDS.weightedProduct,
  ]);
  const saturation = narrowedDomainReader<RatioSaturationParams>(definitions, 'bridge:stat.saturation', [
    RESOLVER_PARAMS_KINDS.ratioSaturation,
  ]);
  const mastery = narrowedDomainReader<MasteryMultiplierParams>(definitions, 'bridge:stat.mastery', [
    RESOLVER_PARAMS_KINDS.masteryMultiplier,
  ]);
  const attrMod = narrowedDomainReader<PrimaryAttributeModifierParams>(definitions, 'bridge:stat.attr-mod', [
    RESOLVER_PARAMS_KINDS.primaryAttributeModifier,
  ]);

  const paramsReader: StatisticsParamsReader = {
    getWeightedParams: (id) => weighted.get(id),
    getRatioSaturationParams: (id) => saturation.get(id),
    getMasteryMultiplierParams: (id) => mastery.get(id),
    getAttributeModifierParams: (id) => attrMod.get(id),
  };
  const ctx = resolverContext({ definitions: paramsReader });

  return {
    resolveAgeModifier: (resolverId, input: AgeModifierResolverInput): PrimaryAttributeDeltas =>
      runResolver<PrimaryAttributeDeltas>(registry, resolverId, input, ctx).value,
    resolveReputationContribution: (
      resolverId,
      input: ReputationContributionResolverInput,
    ): PrimaryAttributeDeltas =>
      runResolver<PrimaryAttributeDeltas>(registry, resolverId, input, ctx).value,
    resolveMasteryCoefficient: (resolverId, input: MasteryCoefficientResolverInput): number =>
      runResolver<number>(registry, resolverId, input, ctx).value,
    resolveFinalSecondaryValue: (resolverId, input: FinalSecondaryResolverInput): number =>
      runResolver<number>(registry, resolverId, input, ctx).value,
  };
}
