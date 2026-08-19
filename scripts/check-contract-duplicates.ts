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
//   economy 擁有：  MoneyValue
//   city 擁有：     FacilityKind（team 目前放寬成 string，最不相容）
//   npc-behavior 擁有：NpcStopPolicyId
//   ContentEventInstance：內容/事件模組尚不存在；暫由 dungeon 擁有（其形狀較完整）
//
// 已收斂（前輪移除）：economy 的 CreateEconomyAccountCommand / GrantCurrencyCommand /
//   TransferCurrencyCommand、combat-sequence 的三個 *MasteryEarnedPayload、team 的
//   PlayerInteractionOpenedEvent —— distribution / combat 的重複宣告已改為 import 擁有者型別。
//
// 已收斂（Wave D 移除，基準線 9 → 6）：`CharacterEquipmentLoadoutView`、`EquipmentDefinition`、
//   `EquipmentCoefficientChannelId`。三者原本是 contracts/statistics 為了不相依 inventory 而
//   宣告的 `Readonly<Record<string, unknown>>` 佔位型別。derived-statistics 服務實作時把它們
//   換成 import inventory 的真實型別——用 unknown 袋子讀裝備係數，必然要在讀取端補一個
//   `as unknown as`，那正是規範 §7 點名的「用轉型掩蓋契約缺口」。
const KNOWN_DUPLICATES = new Set<string>([
  'ConsumeCombatSequenceRetrySupply',
  'ContentEventInstance',
  'EquipmentSkillEffectRef',
  'FacilityKind',
  'MoneyValue',
  'NpcStopPolicyId',
]);

const DECL = /^export (?:type|interface) ([A-Z]\w*)\s*(?:=|\{|<)/gm;

// ── 訊息判別欄（discriminant）碰撞守門 ──────────────────────────────────────
//
// 名稱守門抓不到的另一種影子契約：兩份契約各自**宣告**一個 payload 型別、名稱不同、卻帶**同一個**
// `type: 'X'` 判別字面值。組進 GameCommand/GameInternalCommand/GameDomainEvent 聯集時，同一
// discriminant 對到兩套不相容 payload → 判別式縮窄選錯或被迫轉型，且 tsc 在跨模組以 unknown 傳遞時
// 看不到。（例：distribution 曾以 {toCharacterId,location} 宣告 `type:'TransferItem'`，與 inventory 的
// {to,reason,newOwnerCharacterId} 撞。）
//
// 只算**宣告**位置的 `type: 'X'`（payload 型別本體的判別欄，形如 `type: 'X';`），**不**算聯集裡的
// 引用 `({ type: 'X' } & Foo)`——後者是「引用擁有者型別」的正確樣式（B.5），同 discriminant 同 payload。
// 判別方式：union 引用一定以 `({` 起頭夾住 `type`，宣告不會。
const DISCRIMINANT = /(\(\{\s*)?type: '([A-Za-z]\w*)'/g;

// 目前**無**跨契約的 discriminant 宣告碰撞（10 筆已於本輪全部收斂）。基準線保持空；長出新的即失敗。
const KNOWN_DISCRIMINANT_DUPLICATES = new Set<string>([]);

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

// 找出「跨 2 份以上契約、在宣告位置帶同一 `type: 'X'` 判別字面值」的碰撞（見 DISCRIMINANT 註解）。
export function findDuplicateDiscriminantDeclarations(): readonly DuplicateFinding[] {
  const byDiscriminant = new Map<string, Set<string>>();

  for (const dir of readdirSync(CONTRACTS)) {
    const file = join(CONTRACTS, dir, 'index.ts');
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(DISCRIMINANT)) {
      if (m[1] !== undefined) continue; // `({ type: 'X' } & Foo)` 聯集引用，非宣告——略過
      const value = m[2]!;
      if (!byDiscriminant.has(value)) byDiscriminant.set(value, new Set());
      byDiscriminant.get(value)!.add(dir);
    }
  }

  const out: DuplicateFinding[] = [];
  for (const [name, files] of byDiscriminant) {
    if (files.size > 1) out.push({ name, files: [...files].sort() });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function checkRatchet(
  findings: readonly DuplicateFinding[],
  baseline: ReadonlySet<string>,
  kind: string,
  addedHint: string,
): void {
  const added = findings.filter((f) => !baseline.has(f.name));
  const converged = [...baseline].filter((n) => !findings.some((f) => f.name === n));
  if (added.length > 0) {
    const lines = added.map((f) => `  - ${f.name}: ${f.files.join(', ')}`).join('\n');
    throw new Error(`新增了 ${added.length} 筆${kind}（${addedHint}）:\n${lines}`);
  }
  if (converged.length > 0) {
    throw new Error(`以下${kind}已收斂，請從基準線移除：${converged.join(', ')}`);
  }
}

export function runTests(): void {
  checkRatchet(
    findDuplicateContractDeclarations(),
    KNOWN_DUPLICATES,
    '契約重複宣告',
    '型別應由擁有者宣告，其餘 import + re-export',
  );
  checkRatchet(
    findDuplicateDiscriminantDeclarations(),
    KNOWN_DISCRIMINANT_DUPLICATES,
    '訊息判別欄碰撞',
    '同 discriminant 應對單一 payload；外送/共發改引用擁有者型別',
  );
}

// 供報表使用：目前尚未收斂的重複數。
export function remainingDuplicateCount(): number {
  return findDuplicateContractDeclarations().length;
}
