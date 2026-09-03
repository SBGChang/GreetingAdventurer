// app/content/team-resolver-port.ts
// `TeamResolverPort` 的正式組裝（招募擲骰／離隊擲骰／預設站位）。
//
// 三個方法各自指名一個 Resolver ID，而**哪一個 ID** 由內容的規則定義說了算：
//   * 招募 → `RecruitmentRuleDefinition.successChanceResolverId`
//   * 離隊 → `MemberRetentionRuleDefinition.departureChanceResolverId`
//   * 站位 → `TeamFormationRuleDefinition.defaultPlacementResolverId`
// 這裡一個 resolverId 都不寫死；換一份 Content Pack 換一組曲線，本檔不動。
//
// 擲骰型回傳 `RngStep<boolean>`：`nextCursor` 必須顯式串接回呼叫端（見 team/system.ts 的離隊
// 迴圈）。Resolver 沒有回傳 `nextRngCursor` 時**不能**默默沿用同一格——那會讓同一次調用裡的
// 連續抽取全部落在同一個 cursor 上（全成功或全失敗）。所以缺就明確拋。

import type { DeterministicRng, ResolverId, RngContext, RngCursor } from '../../contracts/core';
import type {
  MemberRetentionRuleDefinition,
  RecruitmentRuleDefinition,
  TeamFormationRuleDefinition,
} from '../../contracts/team';
import type { DefinitionRegistry, ResolverRegistry } from '../../data-runtime';
import type { TeamResolverPort } from '../../modules/team/public';
import { narrowedDomainReader } from './reader-adapter';
import { runResolver, resolverContext } from './resolver-adapter';
import { TEAM_DEFINITION_KINDS } from './team-reader';

// 曲線 params 的窄門：`team:logistic-roll` shape 會以 `getLogisticRollParams(id)` 取它。
const LOGISTIC_ROLL_PARAMS_KIND = 'logistic-roll-params';

export type TeamResolverPortDeps = Readonly<{
  registry: DefinitionRegistry;
  resolvers: ResolverRegistry;
  rng: DeterministicRng;
  rngContext: RngContext;
}>;

export function createTeamResolverPort(deps: TeamResolverPortDeps): TeamResolverPort {
  const logisticParams = narrowedDomainReader<{ id: string; bias: number }>(
    deps.registry,
    'reader:team.logistic-roll-params',
    [LOGISTIC_ROLL_PARAMS_KIND],
  );
  const recruitment = narrowedDomainReader<RecruitmentRuleDefinition>(
    deps.registry,
    'reader:team.recruitment-rule',
    [TEAM_DEFINITION_KINDS.recruitmentRule],
  );
  const retention = narrowedDomainReader<MemberRetentionRuleDefinition>(
    deps.registry,
    'reader:team.member-retention-rule',
    [TEAM_DEFINITION_KINDS.memberRetentionRule],
  );
  const formation = narrowedDomainReader<TeamFormationRuleDefinition>(
    deps.registry,
    'reader:team.team-formation-rule',
    [TEAM_DEFINITION_KINDS.teamFormationRule],
  );

  // 內容裡恰好一筆的規則（與 requireMemberRetentionRuleId 同慣例：缺或重複都明確失敗）。
  const only = <T extends { id: string }>(
    rows: readonly T[],
    kind: string,
  ): T => {
    if (rows.length !== 1) {
      throw new Error(`team-resolver-port：期望恰好一筆 ${kind}，實得 ${rows.length}`);
    }
    return rows[0]!;
  };

  const ctx = resolverContext({
    definitions: {
      getLogisticRollParams: (id: string) => logisticParams.get(id as never),
    },
    rng: deps.rng,
    rngContext: deps.rngContext,
  });

  const roll = (resolverId: ResolverId, input: object, rngContext: RngContext | undefined) => {
    const runContext =
      rngContext === undefined
        ? ctx
        : resolverContext({
            definitions: {
              getLogisticRollParams: (id: string) => logisticParams.get(id as never),
            },
            rng: deps.rng,
            rngContext,
          });
    const result = runResolver<boolean>(deps.resolvers, resolverId, input, runContext);
    if (result.nextRngCursor === undefined) {
      throw new Error(
        `team-resolver-port：擲骰 Resolver "${String(resolverId)}" 沒有回傳 nextRngCursor——` +
          `連續抽取會全部落在同一格，結果會是「全成功」或「全失敗」。`,
      );
    }
    return { value: result.value, nextCursor: result.nextRngCursor as RngCursor };
  };

  return {
    resolveRecruitmentSuccess: (input) =>
      roll(
        only(recruitment.list(), 'recruitment-rule').successChanceResolverId,
        input,
        input.rngContext,
      ),
    resolveMemberDeparture: (input) =>
      roll(
        only(retention.list(), 'member-retention-rule').departureChanceResolverId,
        input,
        input.rngContext,
      ),
    resolveDefaultPlacement: (input) =>
      runResolver<ReturnType<TeamResolverPort['resolveDefaultPlacement']>>(
        deps.resolvers,
        only(formation.list(), 'team-formation-rule').defaultPlacementResolverId,
        input,
        ctx,
      ).value,
  };
}
