// app/content/gathering-reader.test.ts
// 證明 data-runtime → GatheringDefinitionReader 的 adapter 路徑：
//   1. 由記憶體內 content pack 建 DefinitionRegistry → createGatheringDefinitionReader，
//      兩個 getter 各自回傳正確定義；未知 id 與跨 kind 存取明確拋錯。
//   2. 端到端——真 reader 讀出的 Rule 與目的政策直接餵進真 GatheringResolver，
//      種類數／產量／素材全部來自 registry 的資料。證明 adapter 不只型別對，還真的驅動解析。

import type { ContentDefinition, ContentManifestIdentity, DefinitionRegistry } from '../../data-runtime';
import { createDefinitionRegistry } from '../../data-runtime';
import { deterministicRng } from '../../kernel';
import { resolveGathering } from '../../domain-services/gathering/public';
import {
  FIXTURE,
  baseRngContext,
  gatheringRule,
  mapNodeSource,
  perParticipantPolicy,
  sharedResultPolicy,
  travelResourceSource,
} from '../../domain-services/gathering/fixtures';

import { GATHERING_DEFINITION_KINDS, createGatheringDefinitionReader } from './gathering-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function def(id: string, kind: string, data: Record<string, unknown>): ContentDefinition {
  return {
    id: id as ContentDefinition['id'],
    kind,
    schemaVersion: 1,
    packId: FIXTURE.packId,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: data as ContentDefinition['data'],
  };
}

const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-gathering',
  manifestHash: 'gathering',
  packs: [{ packId: FIXTURE.packId, version: '0.0.0', hash: 'gathering' }],
};

// 以 fixture 的「假內容」當作 pack 資料：Reader 必須把它原樣投影成領域 View。
function gatheringDefinitions(): readonly ContentDefinition[] {
  const rule = gatheringRule();
  const shared = sharedResultPolicy();
  const perParticipant = perParticipantPolicy();
  return [
    def(rule.id, GATHERING_DEFINITION_KINDS.rule, {
      masteryId: rule.masteryId,
      sourceTier: rule.sourceTier,
      yieldResolverId: rule.yieldResolverId,
      yieldParams: rule.yieldParams,
      experienceAwardRuleId: rule.experienceAwardRuleId,
      dungeonInteractionMinutes: rule.dungeonInteractionMinutes,
      npcPolicy: rule.npcPolicy,
    }),
    def(shared.id, GATHERING_DEFINITION_KINDS.destinationPolicy, {
      yieldScope: shared.yieldScope,
      destinationKind: shared.destinationKind,
    }),
    def(perParticipant.id, GATHERING_DEFINITION_KINDS.destinationPolicy, {
      yieldScope: perParticipant.yieldScope,
      destinationKind: perParticipant.destinationKind,
    }),
  ];
}

function registry(): DefinitionRegistry {
  return createDefinitionRegistry(gatheringDefinitions(), IDENTITY);
}

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'getGatheringRule 投影出領域定義（header 取自 registry，領域欄位取自 data）',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      const rule = reader.getGatheringRule(FIXTURE.ruleId);
      assert(String(rule.id) === String(FIXTURE.ruleId), 'id 應為 registry 權威值');
      assert(rule.enabled === true, 'enabled 應取自 registry header');
      assert(String(rule.packId) === String(FIXTURE.packId), 'packId 應取自 registry header');
      assert(rule.sourceTier === 'I', `sourceTier（實得 ${rule.sourceTier}）`);
      assert(String(rule.masteryId) === String(FIXTURE.masteryId), 'masteryId 應取自 data');
      assert(rule.dungeonInteractionMinutes === 15, `迷宮互動分鐘（實得 ${String(rule.dungeonInteractionMinutes)}）`);
      assert(rule.yieldParams.pool.length === 4, `素材池應有 4 筆（實得 ${rule.yieldParams.pool.length}）`);
      assert(
        rule.yieldParams.distinctEntryCount.aboveMaxValue === 3,
        '種類數查表的 aboveMaxValue 應取自 data',
      );
      assert(rule.npcPolicy?.eligible === true, 'npcPolicy 應取自 data');
    },
  },
  {
    name: 'getGatheringDestinationPolicy 兩份政策各自讀出',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      const shared = reader.getGatheringDestinationPolicy(FIXTURE.sharedPolicyId);
      assert(shared.yieldScope === 'sharedResult', `yieldScope（實得 ${shared.yieldScope}）`);
      assert(shared.destinationKind === 'assetDistribution', `destinationKind（實得 ${shared.destinationKind}）`);
      const bags = reader.getGatheringDestinationPolicy(FIXTURE.perParticipantPolicyId);
      assert(bags.yieldScope === 'perParticipant', `yieldScope（實得 ${bags.yieldScope}）`);
      assert(bags.destinationKind === 'participantCharacterBags', `destinationKind（實得 ${bags.destinationKind}）`);
    },
  },
  {
    name: '未知 id 明確拋錯（不靜默回 undefined、不給預設 Rule）',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      let threw = false;
      try {
        reader.getGatheringRule(FIXTURE.otherRuleId);
      } catch {
        threw = true;
      }
      assert(threw, '未知 gatheringRuleId 應拋錯');
    },
  },
  {
    name: '跨 kind 存取明確拋錯（rule reader 不得取到 destination-policy 定義）',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      let threw = false;
      try {
        reader.getGatheringRule(FIXTURE.sharedPolicyId as never);
      } catch {
        threw = true;
      }
      assert(threw, '跨 kind 存取應拋錯');
      let threwReverse = false;
      try {
        reader.getGatheringDestinationPolicy(FIXTURE.ruleId as never);
      } catch {
        threwReverse = true;
      }
      assert(threwReverse, '反向跨 kind 存取也應拋錯');
    },
  },
  {
    name: '端到端：registry → reader → 真 Resolver，共同成果由資料決定',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      const outcome = resolveGathering(
        {
          resolutionId: FIXTURE.resolutionId,
          source: mapNodeSource(),
          teamId: FIXTURE.teamId,
          participantCharacterIds: [FIXTURE.charA, FIXTURE.charB],
          rule: reader.getGatheringRule(FIXTURE.ruleId),
          destinationPolicy: reader.getGatheringDestinationPolicy(FIXTURE.sharedPolicyId),
          masteryLevels: { [FIXTURE.charA]: 4, [FIXTURE.charB]: 9 },
          rngContext: baseRngContext(),
        },
        deterministicRng,
      );
      assert(outcome.ok, '端到端解析應成功');
      if (!outcome.ok) return;
      const r = outcome.step.value;
      assert(r.contributorCharacterId === FIXTURE.charB, '採集者應為 Lv.9 的 charB');
      assert(r.yields.length === 3, `Lv.9 應抽 3 種（實得 ${r.yields.length}）`);
      assert(r.yields.every((y) => y.quantity === 2), 'Lv.9 每種 2 個（來自 registry 的查表資料）');
      assert((outcome.step.nextCursor as number) === 3, 'cursor 應前進 3 次');
      assert(r.individualYields === undefined, '共同成果不應產生個人分配');
    },
  },
  {
    name: '端到端：逐人抽取政策由 registry 決定（不是程式依 source.kind 分支）',
    run: () => {
      const reader = createGatheringDefinitionReader(registry());
      const outcome = resolveGathering(
        {
          resolutionId: FIXTURE.resolutionId,
          source: travelResourceSource(),
          teamId: FIXTURE.teamId,
          participantCharacterIds: [FIXTURE.charA, FIXTURE.charB],
          rule: reader.getGatheringRule(FIXTURE.ruleId),
          destinationPolicy: reader.getGatheringDestinationPolicy(FIXTURE.perParticipantPolicyId),
          masteryLevels: { [FIXTURE.charA]: 4, [FIXTURE.charB]: 9 },
          rngContext: baseRngContext(),
        },
        deterministicRng,
      );
      assert(outcome.ok, '端到端逐人抽取應成功');
      if (!outcome.ok) return;
      assert(outcome.step.value.yields.length === 0, '共同成果應為空');
      assert(outcome.step.value.individualYields?.length === 2, '應有兩份個人產物');
    },
  },
];

export type ReaderTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

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
    throw new Error(`gathering-reader tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
