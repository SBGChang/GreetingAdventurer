// scripts/check-contract-duplicates.ts
// 守門：同一個型別名不得在兩份以上的模組契約各自「宣告」。
//
// 背景：contracts 之間曾出現多份**影子契約**——同名型別在擁有者是 RuntimeId、在使用者卻被
// 宣告成 DefinitionId；或欄位少了一半。因為跨模組訊息以 unknown 傳遞、且部分 Port 尚無實作，
// 這些差異 tsc 抓不到，要等真正接線才炸。此檢查讓「重新宣告別人的型別」在提交前就失敗。
//
// 判定方式：只看 `export type NAME =` / `export interface NAME` 這類**宣告**；
// `export type { NAME }`（re-export）與 `import type { NAME }` 是正確的引用方式，不計入。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTRACTS = 'src/contracts';

// ── 既有債務基準線（ratchet）──────────────────────────────────────────────
//
// 這些是 Wave A 契約發包時各自宣告出來的影子型別，**尚未**收斂。此檢查的作用是
// 「不准再長出新的」：清單以外的重複會讓驗證失敗，清單本身必須逐步歸零、不得加項。
//
// 每一筆的擁有者裁定（收斂時 import + re-export，不要各自宣告）：
//   inventory 擁有：CharacterEquipmentLoadoutView / EquipmentDefinition /
//                   EquipmentCoefficientChannelId / EquipmentSkillEffectRef /
//                   ConsumeCombatSequenceRetrySupply（inventory 是 handler）
//   economy 擁有：  MoneyValue / CreateEconomyAccountCommand / GrantCurrencyCommand /
//                   TransferCurrencyCommand
//   city 擁有：     FacilityKind（team 目前放寬成 string，最不相容）
//   combat-sequence 擁有：CombatAttackMasteryEarnedPayload /
//                   CombatDefenseMasteryEarnedPayload / CombatSupportMasteryEarnedPayload
//   npc-behavior 擁有：NpcStopPolicyId
//   team 擁有：     PlayerInteractionOpenedEvent（但三個模組都發此事件，應收成單一聯集）
//   ContentEventInstance：內容/事件模組尚不存在；暫由 dungeon 擁有（其形狀較完整）
const KNOWN_DUPLICATES = new Set<string>([
  'CharacterEquipmentLoadoutView',
  'CombatAttackMasteryEarnedPayload',
  'CombatDefenseMasteryEarnedPayload',
  'CombatSupportMasteryEarnedPayload',
  'ConsumeCombatSequenceRetrySupply',
  'ContentEventInstance',
  'CreateEconomyAccountCommand',
  'EquipmentCoefficientChannelId',
  'EquipmentDefinition',
  'EquipmentSkillEffectRef',
  'FacilityKind',
  'GrantCurrencyCommand',
  'MoneyValue',
  'NpcStopPolicyId',
  'PlayerInteractionOpenedEvent',
  'TransferCurrencyCommand',
]);

const DECL = /^export (?:type|interface) ([A-Z]\w*)\s*(?:=|\{|<)/gm;

export type DuplicateFinding = Readonly<{ name: string; files: readonly string[] }>;

export function findDuplicateContractDeclarations(): readonly DuplicateFinding[] {
  const byName = new Map<string, string[]>();

  for (const dir of readdirSync(CONTRACTS)) {
    const file = join(CONTRACTS, dir, 'index.ts');
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(DECL)) {
      const name = m[1]!;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(dir);
    }
  }

  const out: DuplicateFinding[] = [];
  for (const [name, files] of byName) {
    if (files.length > 1) {
      out.push({ name, files });
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function runTests(): void {
  const findings = findDuplicateContractDeclarations();
  const added = findings.filter((f) => !KNOWN_DUPLICATES.has(f.name));
  const converged = [...KNOWN_DUPLICATES].filter((n) => !findings.some((f) => f.name === n));

  if (added.length > 0) {
    const lines = added.map((f) => `  - ${f.name} 同時宣告於: ${f.files.join(', ')}`).join('\n');
    throw new Error(
      `新增了 ${added.length} 筆契約重複宣告（型別應由擁有者宣告，其餘 import + re-export）:\n${lines}`,
    );
  }
  if (converged.length > 0) {
    // 收斂完成後必須把名字從基準線移除，否則清單會失去「必須歸零」的意義。
    throw new Error(`以下重複已收斂，請從 KNOWN_DUPLICATES 移除：${converged.join(', ')}`);
  }
}

// 供報表使用：目前尚未收斂的重複數。
export function remainingDuplicateCount(): number {
  return findDuplicateContractDeclarations().length;
}
