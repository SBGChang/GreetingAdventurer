// app/workflows/weapon-set-configuration.test.ts
// 武器組配置 Workflow 的驗證測試（複審 R14 #1）。
// 自足式：無外部框架、無 node/DOM 全域。runTests() 於任一案例失敗時 throw。

import type { CharacterId, SkillDefinitionId, WeaponSetId } from '../../contracts/core';
import type { CombatSkillDefinitionView } from '../../contracts/combat';
import type { ConfigureWeaponSet } from '../../contracts/inventory';
import { validateWeaponSetSkills, type WeaponSetValidationPorts } from './weapon-set-configuration';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CHARACTER = 'runtime:character:hero' as CharacterId;
const WS0 = 'runtime:weapon-set:ws0' as WeaponSetId;
const SWORD = 'runtime:item-instance:sword' as ConfigureWeaponSet['mainHandItemId'];
const SHIELD = 'runtime:item-instance:shield' as ConfigureWeaponSet['offHandItemId'];

const MAIN_HAND_SKILL = 'definition:skill:slash' as SkillDefinitionId;
const OFF_HAND_SKILL = 'definition:skill:bash' as SkillDefinitionId;
const BOTH_HANDS_SKILL = 'definition:skill:cleave' as SkillDefinitionId;
const HANDLESS_SKILL = 'definition:skill:chant' as SkillDefinitionId;
const GHOST_SKILL = 'definition:skill:removed-by-a-content-update' as SkillDefinitionId;

const skillView = (
  skillId: SkillDefinitionId,
  activationHand: CombatSkillDefinitionView['activationHand'],
): CombatSkillDefinitionView =>
  ({
    skillId,
    activationHand,
    weaponRequirementIds: [],
    actionKind: 'attack',
    masteryExperienceMode: 'damage',
    techniqueIds: [],
    targeting: {},
    actionDelayRuleId: 'definition:action-delay-rule:standard',
    effectIds: [],
  }) as unknown as CombatSkillDefinitionView;

const KNOWN_SKILLS: Readonly<Record<string, CombatSkillDefinitionView>> = {
  [MAIN_HAND_SKILL]: skillView(MAIN_HAND_SKILL, 'mainHand'),
  [OFF_HAND_SKILL]: skillView(OFF_HAND_SKILL, 'offHand'),
  [BOTH_HANDS_SKILL]: skillView(BOTH_HANDS_SKILL, 'bothHands'),
  [HANDLESS_SKILL]: skillView(HANDLESS_SKILL, 'handless'),
};

// 預設：全部技能都存在且都學會。各案例只覆蓋自己要驗的那一項。
function ports(overrides: Partial<WeaponSetValidationPorts> = {}): WeaponSetValidationPorts {
  return {
    tryGetSkill: (id) => KNOWN_SKILLS[id],
    knows: () => true,
    ...overrides,
  };
}

function command(
  selectedSkillIds: ConfigureWeaponSet['selectedSkillIds'],
  hands: Partial<Pick<ConfigureWeaponSet, 'mainHandItemId' | 'offHandItemId'>> = { mainHandItemId: SWORD },
): ConfigureWeaponSet {
  return {
    type: 'configureWeaponSet',
    characterId: CHARACTER,
    weaponSetId: WS0,
    selectedSkillIds,
    ...hands,
  } as ConfigureWeaponSet;
}

type Case = Readonly<{ name: string; run: () => void }>;

const cases: readonly Case[] = [
  {
    name: '不存在的技能 ID → 拒絕（Definition 未載入／已被內容更新移除）',
    run: () => {
      const r = validateWeaponSetSkills(command([GHOST_SKILL, undefined, undefined]), ports());
      assert(r?.code === 'workflow/weapon-set-unknown-skill', `應回報未知技能（實得 ${String(r?.code)}）`);
      assert(r?.details.skillId === String(GHOST_SKILL), '拒絕訊息應指出是哪個技能');
    },
  },
  {
    name: '尚未學會的技能 → 拒絕',
    run: () => {
      const r = validateWeaponSetSkills(
        command([MAIN_HAND_SKILL, undefined, undefined]),
        ports({ knows: () => false }),
      );
      assert(r?.code === 'workflow/weapon-set-skill-not-learned', `應回報未學會（實得 ${String(r?.code)}）`);
    },
  },
  {
    name: '啟動手沒有裝備 → 拒絕（副手技能配在只有主手的組）',
    run: () => {
      const r = validateWeaponSetSkills(
        command([OFF_HAND_SKILL, undefined, undefined], { mainHandItemId: SWORD }),
        ports(),
      );
      assert(
        r?.code === 'workflow/weapon-set-activation-hand-unavailable',
        `應回報啟動手不可用（實得 ${String(r?.code)}）`,
      );
    },
  },
  {
    name: '雙手技能只裝一手 → 拒絕；兩手皆裝 → 通過',
    run: () => {
      const oneHand = validateWeaponSetSkills(
        command([BOTH_HANDS_SKILL, undefined, undefined], { mainHandItemId: SWORD }),
        ports(),
      );
      assert(oneHand?.code === 'workflow/weapon-set-activation-hand-unavailable', '只裝一手應拒絕');
      const twoHands = validateWeaponSetSkills(
        command([BOTH_HANDS_SKILL, undefined, undefined], { mainHandItemId: SWORD, offHandItemId: SHIELD }),
        ports(),
      );
      assert(twoHands === undefined, '兩手皆裝應通過');
    },
  },
  {
    name: 'handless 技能不需要任何手 → 空手組也通過',
    run: () => {
      const r = validateWeaponSetSkills(command([HANDLESS_SKILL, undefined, undefined], {}), ports());
      assert(r === undefined, `空手組的 handless 技能應通過（實得 ${String(r?.code)}）`);
    },
  },
  {
    name: '合法配置（已學會 + 啟動手可用）→ 通過',
    run: () => {
      const r = validateWeaponSetSkills(
        command([MAIN_HAND_SKILL, OFF_HAND_SKILL, undefined], { mainHandItemId: SWORD, offHandItemId: SHIELD }),
        ports(),
      );
      assert(r === undefined, `合法配置不應被拒（實得 ${String(r?.code)}）`);
    },
  },
  {
    name: '未填的技能欄位（undefined）一律略過，不當成非法',
    run: () => {
      const r = validateWeaponSetSkills(command([undefined, undefined, undefined], {}), ports());
      assert(r === undefined, '三個空欄位應通過');
    },
  },
  {
    name: '驗證順序：Definition 不存在時先報未知技能，不先報未學會',
    run: () => {
      // 兩者皆不成立時，必須回報「不存在」——否則呼叫端會被導向錯誤的修法。
      const r = validateWeaponSetSkills(
        command([GHOST_SKILL, undefined, undefined]),
        ports({ knows: () => false }),
      );
      assert(r?.code === 'workflow/weapon-set-unknown-skill', `應優先回報未知技能（實得 ${String(r?.code)}）`);
    },
  },
];

export function runTestResults(): ReadonlyArray<{ name: string; ok: boolean; error?: string }> {
  return cases.map((c) => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (error) {
      return { name: c.name, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export function runTests(): void {
  const failed = runTestResults().filter((r) => !r.ok);
  if (failed.length > 0) {
    const lines = failed.map((f) => `  - ${f.name}: ${f.error}`).join('\n');
    throw new Error(`weapon-set-configuration workflow tests failed (${failed.length}):\n${lines}`);
  }
}
