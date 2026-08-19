// app/content/npc-behavior-reader.test.ts
// 證明 data-runtime → NpcBehaviorDefinitionReader 的 adapter 路徑：
//   1. 由記憶體內 content pack 建 DefinitionRegistry → createNpcBehaviorDefinitionReader，
//      五個 getter 各自回傳正確定義（含 header 由 registry 為權威）。
//   2. 未知 id / 跨 kind 存取明確拋錯（不靜默回 undefined、不代填預設定義）。
//   3. **端到端資料驅動**：把這個真 Reader 換進 npcDecisionDue，兩份不同的 pack JSON
//      （只有權重、模板與週期不同）產生不同的 NPC 決策。這是本模組的驗收核心——
//      沒有這一條，Reader 只證明了型別對得上，證不了「換 Pack 就換行為」。
//
// 樣板同 dungeon-reader.test.ts。

import type { ContentPackId, DefinitionId, TeamId, WorldDay } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import type { NpcDecisionDueJob } from '../../contracts/npc-behavior';
import type { StartNpcTeamPlanPayload } from '../../contracts/team';
import {
  NPC_BEHAVIOR_MODULE_ID,
  npcDecisionDue,
} from '../../modules/npc-behavior/system';
import { createController, createNpcBehaviorState } from '../../modules/npc-behavior/state';
import {
  FIXTURE,
  makeContext,
  stubConditionPort,
  stubResolverPort,
} from '../../modules/npc-behavior/fixtures';

import {
  createNpcBehaviorDefinitionReader,
  NPC_BEHAVIOR_DEFINITION_KINDS,
} from './npc-behavior-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK_CALM = 'pack:npc-behavior-calm' as ContentPackId;
const PACK_BOLD = 'pack:npc-behavior-bold' as ContentPackId;

function def(
  packId: ContentPackId,
  id: string,
  kind: string,
  data: Record<string, unknown>,
): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

// 兩份 pack 共用的定義（旅行規則、模板、市場規則、自由行動規則）。
function commonDefinitions(packId: ContentPackId): readonly ContentDefinition[] {
  return [
    def(packId, FIXTURE.travelRule, NPC_BEHAVIOR_DEFINITION_KINDS.npcTravelRule, {
      durationDays: 6,
      travelExperienceRuleId: 'definition:experience-award-rule:travel',
      travelExperienceMultiplier: 1,
      eventPolicy: 'none',
    }),
    def(packId, FIXTURE.restRule, NPC_BEHAVIOR_DEFINITION_KINDS.freeActionRule, {
      kind: 'rest',
    }),
    def(packId, FIXTURE.marketPolicy, NPC_BEHAVIOR_DEFINITION_KINDS.marketPolicy, {
      budgetReserveRuleId: 'resolver:npc-budget-reserve',
      purchaseNeedRules: [
        {
          target: 'combatConsumable',
          needResolverId: 'resolver:npc-need-potion',
          offerSelectorId: 'resolver:npc-offer-potion',
        },
      ],
      sellRules: [],
      maxTransactionsPerFreeCycle: 2,
    }),
    def(packId, FIXTURE.templateTravelNorth, NPC_BEHAVIOR_DEFINITION_KINDS.actionChainTemplate, {
      purpose: 'travel',
      nodes: [
        { kind: 'travelToCity', destinationResolverId: FIXTURE.destNorth },
        { kind: 'complete' },
      ],
    }),
    def(packId, FIXTURE.templateTravelSouth, NPC_BEHAVIOR_DEFINITION_KINDS.actionChainTemplate, {
      purpose: 'travel',
      nodes: [{ kind: 'travelToCity', destinationResolverId: FIXTURE.destSouth }],
    }),
  ];
}

// pack「calm」：唯一候選指向北城旅行模板，複審週期 30 日。
function calmDefinitions(): readonly ContentDefinition[] {
  return [
    ...commonDefinitions(PACK_CALM),
    def(PACK_CALM, FIXTURE.policyA, NPC_BEHAVIOR_DEFINITION_KINDS.decisionPolicy, {
      reviewIntervalDays: 30,
      candidates: [
        {
          intentKind: 'travelToCity',
          chainTemplateId: FIXTURE.templateTravelNorth,
          conditionId: FIXTURE.condAlways,
          weightResolverId: FIXTURE.weightTravelHigh,
        },
      ],
      memberFreeActionCandidates: [],
      fallbackChainTemplateId: FIXTURE.templateTravelNorth,
      forcedFreeDurationDays: { min: 2, max: 7 },
      npcTravelRuleId: FIXTURE.travelRule,
      marketPolicyId: FIXTURE.marketPolicy,
    }),
  ];
}

// pack「bold」：同一個 policy ID、同一支 Runtime，但候選指向南城旅行模板、複審週期 10 日。
function boldDefinitions(): readonly ContentDefinition[] {
  return [
    ...commonDefinitions(PACK_BOLD),
    def(PACK_BOLD, FIXTURE.policyA, NPC_BEHAVIOR_DEFINITION_KINDS.decisionPolicy, {
      reviewIntervalDays: 10,
      candidates: [
        {
          intentKind: 'travelToCity',
          chainTemplateId: FIXTURE.templateTravelSouth,
          conditionId: FIXTURE.condAlways,
          weightResolverId: FIXTURE.weightTravelHigh,
        },
      ],
      memberFreeActionCandidates: [],
      fallbackChainTemplateId: FIXTURE.templateTravelSouth,
      forcedFreeDurationDays: { min: 3, max: 3 },
      npcTravelRuleId: FIXTURE.travelRule,
      marketPolicyId: FIXTURE.marketPolicy,
    }),
  ];
}

function identity(packId: ContentPackId): ContentManifestIdentity {
  return {
    manifestVersion: '0.0.0-npc-behavior-reader-test',
    manifestHash: 'npc-behavior-reader-test',
    packs: [{ packId, version: '0.0.0', hash: 'npc-behavior-reader-test' }],
  };
}

function registryFor(defs: readonly ContentDefinition[], packId: ContentPackId): DefinitionRegistry {
  return createDefinitionRegistry(defs, identity(packId));
}

function decisionJob(): NpcDecisionDueJob {
  return {
    jobId: 'runtime:job:reader-decision' as NpcDecisionDueJob['jobId'],
    type: 'npcDecisionDue',
    dueDay: 100 as WorldDay,
    ownerModule: NPC_BEHAVIOR_MODULE_ID,
    targetId: FIXTURE.npcTeamId as TeamId,
    payload: { policyId: FIXTURE.policyA },
  };
}

function seedState() {
  return createNpcBehaviorState({
    controllers: [
      createController({
        teamId: FIXTURE.npcTeamId,
        policyId: FIXTURE.policyA,
        nextDecisionOnDay: 100 as WorldDay,
      }),
    ],
  });
}

// 用真 Reader 跑一次抽選，回傳 (目的城市, 重排日)。
function runWithPack(defs: readonly ContentDefinition[], packId: ContentPackId) {
  const ctx = makeContext({
    definitions: createNpcBehaviorDefinitionReader(registryFor(defs, packId)),
    conditions: stubConditionPort([FIXTURE.condAlways]),
    resolvers: stubResolverPort(),
  });
  const outcome = npcDecisionDue(seedState(), decisionJob(), ctx);
  if (!outcome.ok) throw new Error(`抽選應被接受，實得 rejection ${outcome.rejection.code}`);
  const command = outcome.result.outgoingMessages
    .filter((m): m is { targetModule: never; command: unknown } => 'command' in m)
    .map((m) => m.command as StartNpcTeamPlanPayload)[0];
  if (command === undefined || command.payload.kind !== 'cityTravel') {
    throw new Error('應送出一筆 cityTravel Plan');
  }
  const travel = command.payload.travel;
  if (travel.kind !== 'npcTravel') throw new Error('應為 npcTravel');
  return {
    toCityId: travel.toCityId,
    arrivalDay: travel.arrivalDay,
    // Chain 剛啟動時 nextDecisionOnDay 仍是 100（== worldDay），因此重排走複審週期。
    rearmDay: outcome.result.scheduledJobs[0]?.dueDay,
  };
}

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getDecisionPolicy 由 registry 投影出領域定義（header 以 registry 為權威 + 領域欄位）',
    run: () => {
      const reader = createNpcBehaviorDefinitionReader(registryFor(calmDefinitions(), PACK_CALM));
      const policy = reader.getDecisionPolicy(FIXTURE.policyA);
      assert(String(policy.id) === String(FIXTURE.policyA), 'id 應為 registry 權威值');
      assert(policy.packId === PACK_CALM, 'packId 應取自 registry header');
      assert(policy.enabled === true, 'enabled 應取自 registry header');
      assert(policy.reviewIntervalDays === 30, `reviewIntervalDays（實得 ${policy.reviewIntervalDays}）`);
      assert(policy.candidates.length === 1, `candidates 筆數（實得 ${policy.candidates.length}）`);
      assert(
        policy.candidates[0]!.intentKind === 'travelToCity',
        '候選的 intentKind 應原樣讀出',
      );
      assert(
        policy.forcedFreeDurationDays.min === 2 && policy.forcedFreeDurationDays.max === 7,
        '強制自由期範圍應原樣讀出',
      );
      assert(
        String(policy.npcTravelRuleId) === String(FIXTURE.travelRule),
        'npcTravelRuleId 應取自 data',
      );
    },
  },
  {
    name: 'getActionChainTemplate / getMarketPolicy / getFreeActionRule / getNpcTravelRule 各自窄化到自己的 kind',
    run: () => {
      const reader = createNpcBehaviorDefinitionReader(registryFor(calmDefinitions(), PACK_CALM));

      const template = reader.getActionChainTemplate(FIXTURE.templateTravelNorth);
      assert(template.purpose === 'travel', `purpose（實得 ${template.purpose}）`);
      assert(template.nodes.length === 2, `節點數（實得 ${template.nodes.length}）`);
      assert(template.nodes[0]!.kind === 'travelToCity', '第 0 節 kind 應原樣讀出');

      const market = reader.getMarketPolicy(FIXTURE.marketPolicy);
      assert(
        market.maxTransactionsPerFreeCycle === 2,
        `交易上限（實得 ${market.maxTransactionsPerFreeCycle}）`,
      );
      assert(market.purchaseNeedRules.length === 1, '購買需求規則應原樣讀出');

      const freeAction = reader.getFreeActionRule(FIXTURE.restRule);
      assert(freeAction.kind === 'rest', `free action kind（實得 ${freeAction.kind}）`);

      const travel = reader.getNpcTravelRule(FIXTURE.travelRule);
      assert(travel.durationDays === 6, `NPC 旅行天數（實得 ${travel.durationDays}）`);
      assert(travel.eventPolicy === 'none', 'NPC 旅行不得帶事件池');
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined、不代填預設定義）',
    run: () => {
      const reader = createNpcBehaviorDefinitionReader(registryFor(calmDefinitions(), PACK_CALM));
      let threw = false;
      try {
        reader.getDecisionPolicy('definition:adventurer-decision-policy:absent' as never);
      } catch {
        threw = true;
      }
      assert(threw, '未知 id 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（decision-policy reader 不得取到 action-chain-template）',
    run: () => {
      const reader = createNpcBehaviorDefinitionReader(registryFor(calmDefinitions(), PACK_CALM));
      let threw = false;
      try {
        reader.getDecisionPolicy(FIXTURE.templateTravelNorth as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
    },
  },
  {
    name: '端到端：真 Reader 換進 npcDecisionDue，抵達日由內容的 durationDays 決定',
    run: () => {
      const calm = runWithPack(calmDefinitions(), PACK_CALM);
      assert(
        calm.toCityId === FIXTURE.cityNorth,
        `calm pack 的模板指向北城（實得 ${String(calm.toCityId)}）`,
      );
      // durationDays=6 來自真 Reader → 100 + 6。
      assert(calm.arrivalDay === 106, `抵達日應為 106（實得 ${calm.arrivalDay}）`);
      assert(calm.rearmDay === 130, `重排日應為 100 + 30（實得 ${String(calm.rearmDay)}）`);
    },
  },
  {
    name: '端到端資料驅動：同一支 Runtime + 同一個 policy ID，換成 bold pack 就換出不同決策',
    run: () => {
      const calm = runWithPack(calmDefinitions(), PACK_CALM);
      const bold = runWithPack(boldDefinitions(), PACK_BOLD);
      assert(
        calm.toCityId !== bold.toCityId,
        `兩份 pack 應選出不同目的地（calm=${String(calm.toCityId)}, bold=${String(bold.toCityId)}）`,
      );
      assert(bold.toCityId === FIXTURE.citySouth, 'bold pack 的模板指向南城');
      assert(
        calm.rearmDay !== bold.rearmDay,
        `複審週期也應不同（calm=${String(calm.rearmDay)}, bold=${String(bold.rearmDay)}）`,
      );
      assert(bold.rearmDay === 110, `bold 重排日應為 100 + 10（實得 ${String(bold.rearmDay)}）`);
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
    throw new Error(`npc-behavior-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
