// app/workflows/weapon-set-configuration.ts
// 武器組配置 Workflow 的驗證邏輯（05_inventory_module.md §1.2）。
//
// 為什麼需要 Workflow：`configureWeaponSet` 要同時檢查**兩個模組擁有的事實**——
//   * Progression：角色是否**學會**該技能。
//   * Combat 內容：技能 Definition 是否存在、它要求哪一隻手。
// Inventory 不得直接同步查 Progression（違反核心架構），所以驗證必須發生在擁有跨模組 Query 的組合層。
// 原本 `configureWeaponSet` 直接路由到 Inventory Handler，Inventory 只驗物品與手部合法性，
// `selectedSkillIds` **原樣存下**——不存在、已移除、未載入或未學會的技能 ID 都進得了武器組，之後戰鬥
// 選單 Query 會直接拋錯（複審 R14 #1）。
//
// Workflow 不擁有 Slice：驗證通過後仍由 Inventory Handler 寫入；驗證失敗則整筆拒絕（交易回滾，
// Loadout 不變）。

import type { CharacterId, SkillDefinitionId } from '../../contracts/core';
import type { CombatSkillDefinitionView } from '../../contracts/combat';
import type { ConfigureWeaponSet } from '../../contracts/inventory';

export const WEAPON_SET_CONFIGURATION_WORKFLOW = 'workflow:weapon-set-configuration';

// 驗證所需的跨模組讀取面。由組合層注入，Workflow 本身維持純函式。
export type WeaponSetValidationPorts = Readonly<{
  // 技能是否**學會**（Progression 擁有）。偽造／未學的 ID 一律 false。
  knows: (characterId: CharacterId, skillId: SkillDefinitionId) => boolean;
  // 技能 Definition；不存在／未載入時回 undefined（**不得拋錯**）。
  tryGetSkill: (skillId: SkillDefinitionId) => CombatSkillDefinitionView | undefined;
}>;

export type WeaponSetValidationRejection = Readonly<{
  code: string;
  details: Readonly<Record<string, string | number | boolean>>;
}>;

// 本次配置實際占用了哪幾隻手（由命令本身決定，不需再查 Inventory state）。
function occupiedHands(cmd: ConfigureWeaponSet): ReadonlySet<'mainHand' | 'offHand'> {
  const hands = new Set<'mainHand' | 'offHand'>();
  if (cmd.mainHandItemId !== undefined) hands.add('mainHand');
  if (cmd.offHandItemId !== undefined) hands.add('offHand');
  return hands;
}

// 依序檢查（順序即回報優先序）：Definition 存在 → 角色已學會 → 啟動手可用。
// 回傳 undefined 表示全部通過。
export function validateWeaponSetSkills(
  cmd: ConfigureWeaponSet,
  ports: WeaponSetValidationPorts,
): WeaponSetValidationRejection | undefined {
  const hands = occupiedHands(cmd);

  for (const skillId of cmd.selectedSkillIds) {
    if (skillId === undefined) continue;
    const id = skillId as SkillDefinitionId;

    // 1. Definition 是否存在。必須最先驗：後面幾項都要讀它，而 Reader 對未註冊 ID 會拋錯。
    const skill = ports.tryGetSkill(id);
    if (skill === undefined) {
      return { code: 'workflow/weapon-set-unknown-skill', details: { skillId: String(id) } };
    }

    // 2. 角色是否已學會（doc §1.2：技能知識屬 Progression）。
    if (!ports.knows(cmd.characterId, id)) {
      return {
        code: 'workflow/weapon-set-skill-not-learned',
        details: { skillId: String(id), characterId: String(cmd.characterId) },
      };
    }

    // 3. 啟動手必須真的有裝備。handless 不需要手；bothHands 需要兩手皆有。
    const hand = skill.activationHand;
    const handOk =
      hand === 'handless' ||
      (hand === 'bothHands' ? hands.has('mainHand') && hands.has('offHand') : hands.has(hand));
    if (!handOk) {
      return {
        code: 'workflow/weapon-set-activation-hand-unavailable',
        details: { skillId: String(id), activationHand: String(hand) },
      };
    }

    // 4.【待契約】技能的 `weaponRequirementIds` 目前**驗不了**：`EquipmentDefinition` 沒有對應的
    //    武器需求標記欄位，裝備這一側根本沒有可比對的資料（combat 與 combat-power 都只宣告了技能側）。
    //    要真的驗，得先在 inventory 契約補上裝備側的 requirement 標記，並由內容軌填資料——那會動到
    //    正在被改寫的內容檔，故不在此擅自新增。見 HANDOFF。
  }
  return undefined;
}
