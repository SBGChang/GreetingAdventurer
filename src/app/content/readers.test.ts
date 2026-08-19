// app/content/readers.test.ts
// 其餘 6 個模組 reader adapter 的證明（dungeon 另有自己的端到端測試）。通用投影 domainDefinitionView
// 已由 dungeon-reader.test 端到端證過，故此處聚焦每個 reader 的接線：
//   - header 由 registry 權威投影（id / enabled 隨便一筆定義都應正確帶出）；
//   - 未知 id / 跨 kind 存取明確拋錯；
//   - 3 個非「直套」getter（map getGatheringMapView、progression listSocialMasteryBenefits、
//     combat getSkillView）各自的投影/list 行為正確。

import type { ContentPackId, DefinitionId } from '../../contracts/core';
import {
  createDefinitionRegistry,
  type ContentDefinition,
  type ContentManifestIdentity,
  type DefinitionRegistry,
} from '../../data-runtime';

import { createItemDefinitionReader, INVENTORY_DEFINITION_KINDS } from './inventory-reader';
import { createCharacterDefinitionReader, CHARACTER_DEFINITION_KINDS } from './character-reader';
import { createTeamDefinitionReader, TEAM_DEFINITION_KINDS } from './team-reader';
import { createMapDefinitionReader, MAP_DEFINITION_KINDS } from './map-reader';
import { createProgressionDefinitionReader, PROGRESSION_DEFINITION_KINDS } from './progression-reader';
import { createCombatDefinitionReader, COMBAT_DEFINITION_KINDS } from './combat-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const PACK = 'pack:readers-test' as ContentPackId;
const IDENTITY: ContentManifestIdentity = {
  manifestVersion: '0.0.0-test',
  manifestHash: 'test',
  packs: [{ packId: PACK, version: '0.0.0', hash: 'test' }],
};

// `loadContent` 把**整筆作者 JSON**（含 header 欄位）放進 `data`，Registry 的 header 欄位只是它的
// 索引副本。原本這個 helper 把 kind 只放在 header、`data` 留空，於是投影出來的 View 沒有 `kind`
// 欄位——而 `ItemDefinition.kind` 是 inventory 真正用來判別裝備／書籍的欄位。Fixture 因此比真實
// pack 寬鬆，遮掉了「kind 是否投影得出來」這件事。這裡改成與載入器一致：kind 同時進 data。
function def(id: string, kind: string, data: Record<string, unknown> = {}): ContentDefinition {
  return {
    id: id as DefinitionId,
    kind,
    schemaVersion: 1,
    packId: PACK,
    enabled: true,
    sourcePath: `mem://${kind}/${id}`,
    data: { ...data, kind } as ContentDefinition['data'],
  };
}

function reg(defs: readonly ContentDefinition[]): DefinitionRegistry {
  return createDefinitionRegistry(defs, IDENTITY);
}

function threw(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

export type ReadersTestResult = Readonly<{ name: string; pass: boolean; error?: string }>;

const CASES: readonly Readonly<{ name: string; run: () => void }>[] = [
  {
    name: 'inventory：getItem 解得出全部六種 ItemKind；未知 id 拋錯',
    run: () => {
      // 原本這個案例 authored 一筆 `kind: 'item'` 的定義——那個 kind 不存在於 ItemKind，
      // 真實 Content Pack 永遠不會產生它。改以真的 kind 逐一驗證：裝備、消耗品、素材、書籍
      // 都必須經 getItem 解得出來（system.ts 以 getItem(id).kind 判別裝備，queries.ts 判別書籍）。
      for (const kind of INVENTORY_DEFINITION_KINDS.itemKinds) {
        const id = `definition:item:${kind}`;
        const reader = createItemDefinitionReader(reg([def(id, kind)]));
        const item = reader.getItem(id as never);
        assert(String(item.id) === id, `id 應為 registry 權威值（kind=${kind}）`);
        assert(item.kind === kind, `kind 應保留作者值（kind=${kind}）`);
        assert(item.enabled === true, `enabled 應取自 registry header（kind=${kind}）`);
        assert(threw(() => reader.getItem('definition:item:absent' as never)), '未知 id 應拋錯');
      }
    },
  },
  {
    name: 'character：getArchetype 投影 header',
    run: () => {
      const reader = createCharacterDefinitionReader(
        reg([def('definition:archetype:knight', CHARACTER_DEFINITION_KINDS.archetype)]),
      );
      const a = reader.getArchetype('definition:archetype:knight' as never);
      assert(String(a.id) === 'definition:archetype:knight', 'id 投影');
      assert(a.enabled === true, 'enabled 投影');
    },
  },
  {
    name: 'team：getRecruitmentRule 投影 header',
    run: () => {
      const reader = createTeamDefinitionReader(
        reg([def('definition:recruitment-rule:base', TEAM_DEFINITION_KINDS.recruitmentRule)]),
      );
      const r = reader.getRecruitmentRule('definition:recruitment-rule:base' as never);
      assert(String(r.id) === 'definition:recruitment-rule:base', 'id 投影');
    },
  },
  {
    name: 'map：getMapTemplate 投影 header；getGatheringMapView 投影 { ruleId, npcPolicy }',
    run: () => {
      const reader = createMapDefinitionReader(
        reg([
          def('definition:map-template:cave', MAP_DEFINITION_KINDS.template),
          def('definition:gathering-rule:herb', MAP_DEFINITION_KINDS.gatheringRule, {
            npcPolicy: { eligible: false },
          }),
        ]),
      );
      const t = reader.getMapTemplate('definition:map-template:cave' as never);
      assert(String(t.id) === 'definition:map-template:cave', 'template id 投影');
      const view = reader.getGatheringMapView('definition:gathering-rule:herb' as never);
      assert(String(view.ruleId) === 'definition:gathering-rule:herb', 'gathering view 應原樣帶回 ruleId');
      assert(view.npcPolicy?.eligible === false, 'gathering view 應投影 npcPolicy');
    },
  },
  {
    name: 'progression：getMastery 投影 header；listSocialMasteryBenefits 用 list() 回整個 kind',
    run: () => {
      const reader = createProgressionDefinitionReader(
        reg([
          def('definition:mastery:sword', PROGRESSION_DEFINITION_KINDS.mastery),
          def('definition:social-mastery-benefit:a', PROGRESSION_DEFINITION_KINDS.socialMasteryBenefit),
          def('definition:social-mastery-benefit:b', PROGRESSION_DEFINITION_KINDS.socialMasteryBenefit),
        ]),
      );
      const m = reader.getMastery('definition:mastery:sword' as never);
      assert(String(m.id) === 'definition:mastery:sword', 'mastery id 投影');
      const benefits = reader.listSocialMasteryBenefits();
      assert(benefits.length === 2, `listSocialMasteryBenefits 應回 2 筆（實得 ${benefits.length}）`);
    },
  },
  {
    name: 'combat：getCombatRule 投影 header；getSkillView 用 skillId（←def.id）而非 header',
    run: () => {
      const reader = createCombatDefinitionReader(
        reg([
          def('definition:combat-rule:base', COMBAT_DEFINITION_KINDS.combatRule),
          def('definition:combat-skill:slash', COMBAT_DEFINITION_KINDS.skill, {
            actionKind: 'attack',
          }),
        ]),
      );
      const rule = reader.getCombatRule('definition:combat-rule:base' as never);
      assert(String(rule.id) === 'definition:combat-rule:base', 'combat rule id 投影');
      const view = reader.getSkillView('definition:combat-skill:slash' as never);
      assert(String(view.skillId) === 'definition:combat-skill:slash', 'skillView 的 skillId 應為 def.id');
    },
  },
  {
    name: '跨 kind 存取拋錯（item reader 不得取到規則定義；equipment reader 不得取到書籍）',
    run: () => {
      // 書籍**是**物品，所以 getItem 取到書是正確的（queries.ts 就以此判別書籍）。
      // 真正該擋的是拿非物品的 kind 去問物品 reader，以及拿書籍去問裝備 reader。
      const ruleReg = reg([
        def('definition:rule:use-delay', INVENTORY_DEFINITION_KINDS.useDelayRule),
        def('definition:book:tome', INVENTORY_DEFINITION_KINDS.book),
      ]);
      const reader = createItemDefinitionReader(ruleReg);
      assert(
        threw(() => reader.getItem('definition:rule:use-delay' as never)),
        'use-delay-rule 不是物品，getItem 應拋錯',
      );
      assert(
        reader.getItem('definition:book:tome' as never).kind === 'book',
        '書籍是物品，getItem 應取得且 kind 為 book',
      );
      assert(
        threw(() => reader.getEquipment('definition:book:tome' as never)),
        '書籍不是裝備，getEquipment 應拋錯',
      );
    },
  },
];

export function runTestResults(): readonly ReadersTestResult[] {
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
    throw new Error(`readers tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
