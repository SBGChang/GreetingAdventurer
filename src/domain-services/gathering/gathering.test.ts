// domain-services/gathering/gathering.test.ts
// 自足式單元測試（無 node:test / console / DOM 全域）。runTests() 任一失敗即 throw。
//
// 覆蓋：採集者選擇（含不消耗 RNG 的穩定 tie-break）、加權抽選與產量的資料驅動、
// RNG 決定性與 cursor 逐次前進、逐人抽取的子 Stream 隔離、每一種 typed rejection，
// 以及 GrantGatheringMasteryExperience 的冪等（直接驅動 progression 的真 handler）。

import type {
  CharacterId,
  MasteryCurveId,
  MasteryId,
  RngCursor,
} from '../../contracts/core';
import { deterministicRng } from '../../kernel';
import type {
  GatheringResolution,
  GatheringResolverInput,
  MasteryLevel,
} from '../../contracts/gathering';
import { GatheringRejectionCode } from '../../contracts/gathering';
import type { ProgressionDefinitionReader } from '../../contracts/progression';
import {
  createInitialProgressionState,
  gatheringGrantKey,
  handleGrantGatheringMasteryExperience,
} from '../../modules/progression/public';

import {
  GatheringResolutionError,
  createGatheringResolver,
  participantSubStreamId,
  resolveGathering,
  selectGatheringContributor,
  toGrantGatheringMasteryExperience,
  validateGatheringDestination,
  validateGatheringInput,
} from './gathering';
import {
  BASE_STREAM_ID,
  FIXTURE,
  baseRngContext,
  enemyDropSource,
  gatheringRule,
  mapNodeSource,
  perParticipantPolicy,
  resolutionRequest,
  resolverInput,
  sharedResultPolicy,
  travelResourceSource,
} from './fixtures';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function resolved(input: GatheringResolverInput): GatheringResolution {
  const outcome = resolveGathering(input, deterministicRng);
  if (!outcome.ok) throw new Error(`expected accept, got ${outcome.rejection.code}`);
  return outcome.step.value;
}

function nextCursorOf(input: GatheringResolverInput): number {
  const outcome = resolveGathering(input, deterministicRng);
  if (!outcome.ok) throw new Error(`expected accept, got ${outcome.rejection.code}`);
  return outcome.step.nextCursor as number;
}

function rejectionOf(input: GatheringResolverInput): string {
  const outcome = resolveGathering(input, deterministicRng);
  if (outcome.ok) throw new Error('expected rejection, got accept');
  return outcome.rejection.code;
}

function levels(entries: readonly (readonly [CharacterId, MasteryLevel])[]): Record<
  CharacterId,
  MasteryLevel
> {
  const out: Record<CharacterId, MasteryLevel> = {};
  for (const [id, level] of entries) out[id] = level;
  return out;
}

// ── progression 真 handler 需要的最小 Definition Reader ────────────────────
const CURVE_ID = 'definition:mastery-curve:linear' as MasteryCurveId;

function progressionReader(): ProgressionDefinitionReader {
  const partial = {
    getMastery: (id: MasteryId) => ({
      id,
      schemaVersion: 1,
      packId: FIXTURE.packId,
      enabled: true,
      curveId: CURVE_ID,
      primaryAttributeGainsByLevel: [],
      automaticKnowledgeUnlocks: [],
    }),
    getMasteryCurve: (id: MasteryCurveId) => ({
      id,
      schemaVersion: 1,
      packId: FIXTURE.packId,
      enabled: true,
      maxLevel: 10,
      cumulativeExperienceThresholds: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    }),
    getExperienceAwardRule: (id: typeof FIXTURE.experienceAwardRuleId) => ({
      id,
      schemaVersion: 1,
      packId: FIXTURE.packId,
      enabled: true,
      masteryId: FIXTURE.masteryId,
      baseExperience: 12,
    }),
  };
  return partial as unknown as ProgressionDefinitionReader;
}

const cases: readonly Readonly<{ name: string; run: () => void }>[] = [
  // ── 採集者選擇 ───────────────────────────────────────────────────────────
  {
    name: '採集者＝熟練度最高者，且與輸入順序無關',
    run: () => {
      const a = resolved(resolverInput());
      assert(
        a.contributorCharacterId === FIXTURE.charB,
        `應選 charB（實得 ${String(a.contributorCharacterId)}）`,
      );
      const b = resolved(
        resolverInput({ participantCharacterIds: [FIXTURE.charB, FIXTURE.charC, FIXTURE.charA] }),
      );
      assert(b.contributorCharacterId === FIXTURE.charB, '換順序仍應選 charB');
      assert(a.masteryLevelUsed === 9, `masteryLevelUsed 應為 9（實得 ${a.masteryLevelUsed}）`);
    },
  },
  {
    name: '同級時以 CharacterId 穩定選出，且不消耗 RNG（cursor 前進數只等於抽選次數）',
    run: () => {
      const input = resolverInput({
        masteryLevels: levels([
          [FIXTURE.charA, 4],
          [FIXTURE.charB, 4],
          [FIXTURE.charC, 4],
        ]),
      });
      const r = resolved(input);
      assert(
        r.contributorCharacterId === FIXTURE.charA,
        `同級應取字典序最小的 charA（實得 ${String(r.contributorCharacterId)}）`,
      );
      // Lv.4 → 抽 2 種，因此 cursor 只前進 2；選採集者本身沒有多花一次抽取。
      assert(nextCursorOf(input) === 2, `nextCursor 應為 2（實得 ${nextCursorOf(input)}）`);
      assert(r.yields.length === 2, `Lv.4 應抽 2 種（實得 ${r.yields.length}）`);
    },
  },
  {
    name: 'selectGatheringContributor 對空清單回 undefined（不假造採集者）',
    run: () => {
      assert(selectGatheringContributor([]) === undefined, '空清單應回 undefined');
    },
  },
  {
    name: '採集者必屬來源提供的參與者快照（doc §7 不變量 4）',
    run: () => {
      const input = resolverInput();
      const r = resolved(input);
      assert(
        input.participantCharacterIds.includes(r.contributorCharacterId),
        '採集者不在參與者名單內',
      );
      assert(
        r.participantCharacterIds !== input.participantCharacterIds,
        'Resolution 不應與輸入共用同一個陣列參考（避免呼叫端被就地改寫）',
      );
    },
  },

  // ── 產量與權重都是資料 ───────────────────────────────────────────────────
  {
    name: '種類數與數量由 Mastery 分段查表決定（Lv.0 / Lv.4 / Lv.9 三段各不同）',
    run: () => {
      const at = (level: MasteryLevel): GatheringResolution =>
        resolved(
          resolverInput({
            participantCharacterIds: [FIXTURE.charA],
            masteryLevels: levels([[FIXTURE.charA, level]]),
          }),
        );
      const lv0 = at(0);
      const lv4 = at(4);
      const lv9 = at(9);
      assert(lv0.yields.length === 1, `Lv.0 應抽 1 種（實得 ${lv0.yields.length}）`);
      assert(lv4.yields.length === 2, `Lv.4 應抽 2 種（實得 ${lv4.yields.length}）`);
      assert(lv9.yields.length === 3, `Lv.9 應抽 3 種（實得 ${lv9.yields.length}）`);
      assert(lv0.yields[0]?.quantity === 1, 'Lv.0 每種 1 個');
      assert(lv9.yields[0]?.quantity === 2, 'Lv.9 每種 2 個');
    },
  },
  {
    name: '同一次抽選不重複素材（種類互斥）',
    run: () => {
      const r = resolved(
        resolverInput({
          participantCharacterIds: [FIXTURE.charA],
          masteryLevels: levels([[FIXTURE.charA, 9]]),
        }),
      );
      const ids = r.yields.map((y) => String(y.itemDefinitionId));
      assert(new Set(ids).size === ids.length, `素材重複：${ids.join(',')}`);
    },
  },
  {
    name: '權重真的被使用：高權重素材出現次數明顯多於低權重素材',
    run: () => {
      let heavy = 0;
      let light = 0;
      for (let cursor = 0; cursor < 200; cursor += 1) {
        const r = resolved(
          resolverInput({
            participantCharacterIds: [FIXTURE.charA],
            masteryLevels: levels([[FIXTURE.charA, 0]]),
            rngContext: baseRngContext(cursor),
          }),
        );
        const picked = String(r.yields[0]?.itemDefinitionId);
        if (picked === String(FIXTURE.itemHerb)) heavy += 1;
        if (picked === String(FIXTURE.itemRoot)) light += 1;
      }
      assert(heavy > light, `權重 40 的素材（${heavy}）應多於權重 10 的素材（${light}）`);
      assert(light > 0, '權重 10 的素材不應完全抽不到');
    },
  },

  // ── RNG 紀律 ─────────────────────────────────────────────────────────────
  {
    name: '決定性：同 cursor 同結果；不同 cursor 得到不同抽選',
    run: () => {
      const input = resolverInput();
      const first = JSON.stringify(resolved(input));
      const second = JSON.stringify(resolved(input));
      assert(first === second, '同輸入同 cursor 必須完全相同');

      const shifted = JSON.stringify(resolved(resolverInput({ rngContext: baseRngContext(7) })));
      assert(shifted !== first, 'cursor 不同時抽選不應完全相同（否則 cursor 沒被使用）');
    },
  },
  {
    name: 'cursor 逐次前進且不重用 cursor 0：nextCursor = 起點 + 抽選次數',
    run: () => {
      const oneDraw = resolverInput({
        participantCharacterIds: [FIXTURE.charA],
        masteryLevels: levels([[FIXTURE.charA, 0]]),
      });
      assert(nextCursorOf(oneDraw) === 1, `1 次抽選應到 cursor 1（實得 ${nextCursorOf(oneDraw)}）`);
      const threeDraws = resolverInput({
        participantCharacterIds: [FIXTURE.charA],
        masteryLevels: levels([[FIXTURE.charA, 9]]),
      });
      assert(
        nextCursorOf(threeDraws) === 3,
        `3 次抽選應到 cursor 3（實得 ${nextCursorOf(threeDraws)}）`,
      );
      const fromFive = resolverInput({
        participantCharacterIds: [FIXTURE.charA],
        masteryLevels: levels([[FIXTURE.charA, 9]]),
        rngContext: baseRngContext(5),
      });
      assert(nextCursorOf(fromFive) === 8, `自 cursor 5 起三次應到 8（實得 ${nextCursorOf(fromFive)}）`);
    },
  },
  {
    name: '三次抽選各自用不同 cursor（逐次前進，不是重複同一個 cursor 0）',
    run: () => {
      // 手動以 cursor 0/1/2 各抽一次單種產物，序列應與一次抽三種的順序一致。
      const single = (cursor: number): string =>
        String(
          resolved(
            resolverInput({
              participantCharacterIds: [FIXTURE.charA],
              masteryLevels: levels([[FIXTURE.charA, 0]]),
              rngContext: baseRngContext(cursor),
            }),
          ).yields[0]?.itemDefinitionId,
        );
      const triple = resolved(
        resolverInput({
          participantCharacterIds: [FIXTURE.charA],
          masteryLevels: levels([[FIXTURE.charA, 9]]),
        }),
      ).yields.map((y) => String(y.itemDefinitionId));
      // 第一筆必然相同（同 cursor 0、同完整素材池）。
      assert(triple[0] === single(0), `第一次抽選應等於 cursor 0 的抽選（${String(triple[0])} vs ${single(0)}）`);
      // 若三次都重用 cursor 0，三筆會是同一素材——上一個測試已排除重複，這裡再釘「不是同一個 cursor」。
      assert(
        new Set([single(0), single(1), single(2)]).size > 1,
        'cursor 0/1/2 的抽選不應全部相同（否則 cursor 未生效）',
      );
    },
  },
  {
    name: 'participantSubStreamId 由基礎 Stream 追加 CharacterId 派生，各角色互不相同',
    run: () => {
      const a = String(participantSubStreamId(BASE_STREAM_ID, FIXTURE.charA));
      const b = String(participantSubStreamId(BASE_STREAM_ID, FIXTURE.charB));
      assert(a === `${String(BASE_STREAM_ID)}:${String(FIXTURE.charA)}`, `子 Stream 命名不符：${a}`);
      assert(a !== b, '不同角色的子 Stream 必須不同');
    },
  },

  // ── 逐人抽取（旅行資源）─────────────────────────────────────────────────
  {
    name: 'perParticipant：每位參與者各一份、共同成果為空、基礎 Stream 不前進',
    run: () => {
      const input = resolverInput({
        source: travelResourceSource(),
        destinationPolicy: perParticipantPolicy(),
      });
      const outcome = resolveGathering(input, deterministicRng);
      assert(outcome.ok, 'perParticipant 應被接受');
      if (!outcome.ok) return;
      const r = outcome.step.value;
      assert(r.yields.length === 0, `共同成果應為空（實得 ${r.yields.length}）`);
      assert(r.individualYields?.length === 3, `應有 3 份個人產物（實得 ${r.individualYields?.length}）`);
      assert(
        (outcome.step.nextCursor as number) === (input.rngContext.cursor as number),
        '子 Stream 不得推進基礎 Stream 的 cursor',
      );
      // 全隊以最高採集等級為基準：三人皆抽 3 種、每種 2 個。
      for (const bundle of r.individualYields ?? []) {
        assert(bundle.yields.length === 3, `每人應抽 3 種（實得 ${bundle.yields.length}）`);
        assert(bundle.yields.every((y) => y.quantity === 2), '每種應為 2 個（依最高等級）');
      }
      const recipients = (r.individualYields ?? []).map((b) => String(b.recipientCharacterId));
      assert(
        recipients.join(',') === [FIXTURE.charA, FIXTURE.charB, FIXTURE.charC].map(String).join(','),
        `收件者應為 CharacterId 穩定序（實得 ${recipients.join(',')}）`,
      );
      // 只有最高採集者取得 MXP（doc §7 不變量 6）。
      assert(r.contributorCharacterId === FIXTURE.charB, '最高採集者仍為 charB');
    },
  },
  {
    name: 'perParticipant 的各人抽選彼此獨立（子 Stream 隔離，不是同一份複製）',
    run: () => {
      const input = resolverInput({
        source: travelResourceSource(),
        destinationPolicy: perParticipantPolicy(),
        masteryLevels: levels([
          [FIXTURE.charA, 4],
          [FIXTURE.charB, 4],
          [FIXTURE.charC, 4],
        ]),
      });
      const r = resolved(input);
      const signatures = (r.individualYields ?? []).map((b) =>
        b.yields.map((y) => String(y.itemDefinitionId)).join('|'),
      );
      assert(signatures.length === 3, '應有三份簽章');
      assert(new Set(signatures).size > 1, `三人抽選不應完全相同：${signatures.join(' / ')}`);
    },
  },

  // ── 來源種類 ─────────────────────────────────────────────────────────────
  {
    name: 'enemyDrop 來源可解析，gatheringRuleId 取自來源自帶的 ID',
    run: () => {
      const r = resolved(
        resolverInput({ source: enemyDropSource(), destinationPolicy: sharedResultPolicy() }),
      );
      assert(String(r.gatheringRuleId) === String(FIXTURE.ruleId), 'gatheringRuleId 應為來源自帶值');
      assert(r.source.kind === 'enemyDrop', 'source 應原樣帶回');
    },
  },
  {
    name: 'mapNode 來源沒有自帶 ruleId，改取傳入 Rule 的 ID',
    run: () => {
      const r = resolved(resolverInput({ source: mapNodeSource() }));
      assert(String(r.gatheringRuleId) === String(FIXTURE.ruleId), 'gatheringRuleId 應取自 Rule');
    },
  },

  // ── typed rejection：一種一案 ────────────────────────────────────────────
  {
    name: 'rejection：Rule 未啟用',
    run: () => {
      const code = rejectionOf(resolverInput({ rule: gatheringRule({ enabled: false }) }));
      assert(code === GatheringRejectionCode.RuleDisabled, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：目的政策未啟用',
    run: () => {
      const code = rejectionOf(
        resolverInput({ destinationPolicy: sharedResultPolicy({ enabled: false }) }),
      );
      assert(code === GatheringRejectionCode.DestinationPolicyDisabled, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：目的政策自我矛盾（共同成果卻指向個人背包）',
    run: () => {
      const code = rejectionOf(
        resolverInput({
          destinationPolicy: sharedResultPolicy({ destinationKind: 'participantCharacterBags' }),
        }),
      );
      assert(code === GatheringRejectionCode.DestinationPolicyMismatch, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：無參與者',
    run: () => {
      const code = rejectionOf(resolverInput({ participantCharacterIds: [] }));
      assert(code === GatheringRejectionCode.NoParticipants, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：缺某位參與者的熟練度（不得當成 Lv.0）',
    run: () => {
      const code = rejectionOf(
        resolverInput({
          masteryLevels: levels([
            [FIXTURE.charA, 4],
            [FIXTURE.charB, 9],
          ]),
        }),
      );
      assert(code === GatheringRejectionCode.MasteryLevelMissing, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：熟練度超出 Lv.0～10 結構域',
    run: () => {
      const code = rejectionOf(
        resolverInput({
          participantCharacterIds: [FIXTURE.charA],
          masteryLevels: levels([[FIXTURE.charA, 11]]),
        }),
      );
      assert(code === GatheringRejectionCode.MasteryLevelOutOfRange, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：來源自帶的 ruleId 與傳入 Rule 不一致',
    run: () => {
      const code = rejectionOf(
        resolverInput({ source: travelResourceSource(FIXTURE.otherRuleId) }),
      );
      assert(code === GatheringRejectionCode.SourceRuleMismatch, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：地圖採集點缺 dungeonInteractionMinutes（doc §2 驗證 1）',
    run: () => {
      const rule = gatheringRule();
      const withoutMinutes: typeof rule = { ...rule };
      delete (withoutMinutes as { dungeonInteractionMinutes?: number }).dungeonInteractionMinutes;
      const code = rejectionOf(resolverInput({ rule: withoutMinutes }));
      assert(code === GatheringRejectionCode.MapInteractionMinutesMissing, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：NPC 可採但 pointCost 非正數（doc §2 驗證 4）',
    run: () => {
      const code = rejectionOf(
        resolverInput({
          rule: gatheringRule({
            npcPolicy: { eligible: true, pointCost: 0, resolverId: FIXTURE.npcResolverId },
          }),
        }),
      );
      assert(code === GatheringRejectionCode.NpcPolicyInvalid, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：素材池為空',
    run: () => {
      const base = gatheringRule();
      const code = rejectionOf(
        resolverInput({ rule: gatheringRule({ yieldParams: { ...base.yieldParams, pool: [] } }) }),
      );
      assert(code === GatheringRejectionCode.MaterialPoolEmpty, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：素材池權重非正數',
    run: () => {
      const base = gatheringRule();
      const code = rejectionOf(
        resolverInput({
          rule: gatheringRule({
            yieldParams: {
              ...base.yieldParams,
              pool: [{ itemDefinitionId: FIXTURE.itemHerb, weight: 0 }],
            },
          }),
        }),
      );
      assert(code === GatheringRejectionCode.MaterialPoolWeightInvalid, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：種類數超過素材池筆數',
    run: () => {
      const base = gatheringRule();
      const code = rejectionOf(
        resolverInput({
          rule: gatheringRule({
            yieldParams: {
              ...base.yieldParams,
              distinctEntryCount: { entries: [], aboveMaxValue: 9 },
            },
          }),
        }),
      );
      assert(code === GatheringRejectionCode.DistinctEntryCountInvalid, `實得 ${code}`);
    },
  },
  {
    name: 'rejection：產量非正整數（有種類卻 0 個 / 小數）',
    run: () => {
      const base = gatheringRule();
      const zero = rejectionOf(
        resolverInput({
          rule: gatheringRule({
            yieldParams: { ...base.yieldParams, quantityPerEntry: { entries: [], aboveMaxValue: 0 } },
          }),
        }),
      );
      assert(zero === GatheringRejectionCode.QuantityInvalid, `0 個應被拒（實得 ${zero}）`);
      const fractional = rejectionOf(
        resolverInput({
          rule: gatheringRule({
            yieldParams: {
              ...base.yieldParams,
              quantityPerEntry: { entries: [], aboveMaxValue: 1.5 },
            },
          }),
        }),
      );
      assert(fractional === GatheringRejectionCode.QuantityInvalid, `小數應被拒（實得 ${fractional}）`);
    },
  },
  {
    name: 'validateGatheringInput 可獨立呼叫：合法時回排序後的參與者等級',
    run: () => {
      const v = validateGatheringInput(resolverInput());
      assert(v.ok, '合法輸入應通過');
      if (!v.ok) return;
      const ids = v.participants.map((p) => String(p.characterId));
      assert(
        ids.join(',') === [FIXTURE.charA, FIXTURE.charB, FIXTURE.charC].map(String).join(','),
        `參與者應為穩定序（實得 ${ids.join(',')}）`,
      );
    },
  },

  // ── 目的地與政策一致性（GatheringDestinationRef）────────────────────────
  {
    name: 'validateGatheringDestination：政策與目的地一致時通過',
    run: () => {
      assert(
        validateGatheringDestination(resolutionRequest(), sharedResultPolicy()) === undefined,
        '一致的請求不應被拒',
      );
      const bags = resolutionRequest({
        destinationPolicyId: FIXTURE.perParticipantPolicyId,
        destination: {
          kind: 'participantCharacterBags',
          characterIds: [FIXTURE.charA, FIXTURE.charB, FIXTURE.charC],
        },
      });
      assert(
        validateGatheringDestination(bags, perParticipantPolicy()) === undefined,
        '逐人背包且收件者齊全時不應被拒',
      );
    },
  },
  {
    name: 'validateGatheringDestination：政策 ID 對不上 / kind 對不上 / 收件者對不上各自拒絕',
    run: () => {
      const wrongPolicyId = validateGatheringDestination(
        resolutionRequest({ destinationPolicyId: FIXTURE.perParticipantPolicyId }),
        sharedResultPolicy(),
      );
      assert(
        wrongPolicyId?.code === GatheringRejectionCode.DestinationPolicyIdMismatch,
        `政策 ID 不符（實得 ${String(wrongPolicyId?.code)}）`,
      );

      const wrongKind = validateGatheringDestination(
        resolutionRequest({
          destinationPolicyId: FIXTURE.perParticipantPolicyId,
          destination: { kind: 'characterBag', characterId: FIXTURE.charA },
        }),
        perParticipantPolicy(),
      );
      assert(
        wrongKind?.code === GatheringRejectionCode.DestinationKindMismatch,
        `目的地種類不符（實得 ${String(wrongKind?.code)}）`,
      );

      const wrongRecipients = validateGatheringDestination(
        resolutionRequest({
          destinationPolicyId: FIXTURE.perParticipantPolicyId,
          destination: { kind: 'participantCharacterBags', characterIds: [FIXTURE.charA] },
        }),
        perParticipantPolicy(),
      );
      assert(
        wrongRecipients?.code === GatheringRejectionCode.DestinationRecipientsMismatch,
        `收件者不符（實得 ${String(wrongRecipients?.code)}）`,
      );
    },
  },

  // ── 契約介面實作 ─────────────────────────────────────────────────────────
  {
    name: 'createGatheringResolver().resolve 正常回傳 RngStep；資料不合法時拋 GatheringResolutionError',
    run: () => {
      const resolver = createGatheringResolver();
      const step = resolver.resolve(resolverInput(), deterministicRng);
      assert(step.value.contributorCharacterId === FIXTURE.charB, 'resolve 應回傳 Resolution');
      assert((step.nextCursor as number) === 3, `Lv.9 應前進 3（實得 ${step.nextCursor as number}）`);

      let caught: unknown;
      try {
        resolver.resolve(resolverInput({ participantCharacterIds: [] }), deterministicRng);
      } catch (e) {
        caught = e;
      }
      assert(caught instanceof GatheringResolutionError, '應拋 GatheringResolutionError');
      if (caught instanceof GatheringResolutionError) {
        assert(
          caught.rejection.code === GatheringRejectionCode.NoParticipants,
          `拋出的 rejection 應保留 code（實得 ${caught.rejection.code}）`,
        );
      }
    },
  },

  // ── GrantGatheringMasteryExperience 與冪等 ───────────────────────────────
  {
    name: 'toGrantGatheringMasteryExperience 只產出 contributor 一筆，欄位對齊 progression 的冪等 key',
    run: () => {
      const r = resolved(resolverInput());
      const cmd = toGrantGatheringMasteryExperience(r);
      assert(cmd.contributorCharacterId === FIXTURE.charB, 'contributor 應為最高採集者');
      assert(String(cmd.masteryId) === String(FIXTURE.masteryId), 'masteryId 應取自 Rule');
      assert(
        String(cmd.experienceAwardRuleId) === String(FIXTURE.experienceAwardRuleId),
        'experienceAwardRuleId 應取自 Rule（不由此處重算經驗）',
      );
      const key = gatheringGrantKey(
        cmd.resolutionId,
        cmd.contributorCharacterId,
        cmd.masteryId,
      );
      assert(
        key === `${String(FIXTURE.resolutionId)}|${String(FIXTURE.charB)}|${String(FIXTURE.masteryId)}`,
        `冪等 key 形狀不符：${key}`,
      );
    },
  },
  {
    name: 'perParticipant 時仍只有一筆 MXP 命令（其他獨立抽取者不重複取得）',
    run: () => {
      const r = resolved(
        resolverInput({
          source: travelResourceSource(),
          destinationPolicy: perParticipantPolicy(),
        }),
      );
      const cmd = toGrantGatheringMasteryExperience(r);
      assert(cmd.contributorCharacterId === FIXTURE.charB, '只有最高採集者取得 MXP');
      assert((r.individualYields?.length ?? 0) === 3, '仍有三份個人產物');
    },
  },
  {
    name: '冪等：同一 Resolution 重播送進 progression 真 handler，第二次不再發經驗',
    run: () => {
      const reader = progressionReader();
      const cmd = toGrantGatheringMasteryExperience(resolved(resolverInput()));

      const first = handleGrantGatheringMasteryExperience(
        createInitialProgressionState(),
        cmd,
        reader,
      );
      const progress = first.nextSlice.characterProgress[FIXTURE.charB];
      const granted = progress?.masteries[FIXTURE.masteryId]?.experience;
      assert(granted === 12, `第一次應入帳 12 點（實得 ${String(granted)}）`);
      assert(first.outgoingMessages.length > 0, '第一次應發出事件');

      // 重播：同一 resolutionId + contributor + mastery。
      const second = handleGrantGatheringMasteryExperience(first.nextSlice, cmd, reader);
      assert(second.nextSlice === first.nextSlice, '重播應回傳同一份 slice（冪等 no-op）');
      assert(second.outgoingMessages.length === 0, '重播不應再發事件');

      // 另一次採集（不同 resolutionId）仍會入帳——證明上面的 no-op 是冪等而非固定失效。
      const otherResolution = resolved(resolverInput({ resolutionId: FIXTURE.otherResolutionId }));
      const third = handleGrantGatheringMasteryExperience(
        first.nextSlice,
        toGrantGatheringMasteryExperience(otherResolution),
        reader,
      );
      const afterThird =
        third.nextSlice.characterProgress[FIXTURE.charB]?.masteries[FIXTURE.masteryId]?.experience;
      assert(afterThird === 24, `不同 resolution 應再入帳（實得 ${String(afterThird)}）`);
    },
  },
  {
    name: '重播的 Resolution 完全相同（決定性 → 同一把冪等 key）',
    run: () => {
      const a = resolved(resolverInput());
      const b = resolved(resolverInput());
      assert(JSON.stringify(a) === JSON.stringify(b), '同 resolutionId 重播必須得到相同 Resolution');
      const keyA = gatheringGrantKey(a.resolutionId, a.contributorCharacterId, a.masteryId);
      const keyB = gatheringGrantKey(b.resolutionId, b.contributorCharacterId, b.masteryId);
      assert(keyA === keyB, '重播的冪等 key 必須相同');
    },
  },
];

export type GatheringTestResult = Readonly<{ name: string; passed: boolean; error?: string }>;

export function runTestsVerbose(): readonly GatheringTestResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, passed: true };
    } catch (err) {
      return {
        name: c.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function runTests(): void {
  const results = runTestsVerbose();
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed.map((f) => `  - ${f.name}: ${f.error ?? 'failed'}`).join('\n');
    throw new Error(
      `gathering service: ${failed.length}/${results.length} tests failed\n${detail}`,
    );
  }
}

// 未使用的匯入守衛：RngCursor 型別只在斷言中以 as number 讀出，此處保留型別引用。
export type UnusedCursorGuard = RngCursor;
