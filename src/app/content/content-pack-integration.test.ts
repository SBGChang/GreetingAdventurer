// app/content/content-pack-integration.test.ts
// 端到端證明：**磁碟上的正式 Content Pack**（`content/**`，純 JSON）→ ContentRepository →
// loadContent → Registry → 模組窄化 Reader → 模組純函式，算出真實結果。
//
// 這是整條資料鏈第一個真實消費者。在它之前，所有 reader 測試都用記憶體 fixture 餵自己造的
// Definition——那證明得了 adapter 的形狀，證明不了「作者寫下的內容真的驅動了遊戲」。
// 這裡刻意不建任何 fixture 定義：每一個數字都必須來自 `content/core/progression.json`。

import { resolve } from 'node:path';

import type { CharacterId, MasteryId } from '../../contracts/core';
import type { MasteryProgress } from '../../contracts/progression';
import { loadContentFromDisk } from '../../platform/content-repository';
import {
  createMasteryProgress,
  derivePrimaryAttributes,
  resolveLevel,
  createCharacterProgression,
} from '../../modules/progression/public';
import { createProgressionDefinitionReader } from './progression-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

// 以真實 ID 指名內容。這裡出現內容 ID 是測試在**斷言內容**，不是正式路徑在決定內容。
const ONE_HAND_WEAPON = 'mastery.core.one-hand-weapon' as MasteryId;
const TWO_HAND_STAFF = 'mastery.core.two-hand-staff' as MasteryId;
const QUEST_ESCORT = 'mastery.core.quest-escort' as MasteryId;

// 這筆是**執行期**角色 ID，不是內容 ID：測試只需要一個穩定的主體來掛熟練度進度。
const SUBJECT = 'character:content-pack-integration' as CharacterId;

type Case = Readonly<{ name: string; run: () => void }>;

const CASES: readonly Case[] = [
  {
    name: 'pack 載入：磁碟上的 core pack 編譯成 Registry',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      assert(loaded.success, `載入失敗：${loaded.success ? '' : JSON.stringify(loaded.diagnostics)}`);
      if (!loaded.success) return;
      assert(loaded.registry.size > 0, 'Registry 不得為空');
      // manifest identity 是存檔相容比對的基礎（§9）；它必須真的算出 hash，不是空字串。
      const identity = loaded.registry.getManifestIdentity();
      assert(identity.manifestHash.length === 8, `manifestHash 應為 8 位 hex，實得 "${identity.manifestHash}"`);
      assert(identity.packs.length === 1, `應有 1 個 pack，實得 ${identity.packs.length}`);
    },
  },
  {
    name: '窄化 Reader：真實 mastery 定義讀得出來，且 header 取自 registry',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('載入失敗');
      const reader = createProgressionDefinitionReader(loaded.registry);

      const def = reader.getMastery(ONE_HAND_WEAPON);
      assert(String(def.id) === String(ONE_HAND_WEAPON), 'id 應為 registry 權威值');
      assert(def.enabled === true, 'enabled 應取自 registry header');
      assert(def.schemaVersion === 1, `schemaVersion 應由 Compiler 蓋為 1，實得 ${def.schemaVersion}`);
      assert(String(def.packId) === 'pack:core', `packId 應為 pack:core，實得 ${String(def.packId)}`);
      // Lv.0 不給成長、Lv.1 起才給——這是作者資料的形狀，不是程式的假設。
      assert(
        def.primaryAttributeGainsByLevel.length === 11,
        `gains 應為 Lv.0…Lv.10 共 11 筆，實得 ${def.primaryAttributeGainsByLevel.length}`,
      );
    },
  },
  {
    name: '真實曲線驅動等級：門檻取自 mastery_experience_economy_v1 的累積 MXP',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('載入失敗');
      const reader = createProgressionDefinitionReader(loaded.registry);
      const curve = reader.getMasteryCurve(reader.getMastery(ONE_HAND_WEAPON).curveId);

      // 門檻邊界逐點驗：差 1 點就不該升級。這證明的是「等級由資料推導」，而不是程式內建級距。
      assert(resolveLevel(curve, 0) === 0, 'MXP 0 → Lv.0');
      assert(resolveLevel(curve, 199_999) === 0, 'MXP 199,999 → 仍 Lv.0');
      assert(resolveLevel(curve, 200_000) === 1, 'MXP 200,000 → Lv.1');
      assert(resolveLevel(curve, 4_199_999) === 5, 'MXP 4,199,999 → Lv.5');
      assert(resolveLevel(curve, 4_200_000) === 6, 'MXP 4,200,000 → Lv.6');
      assert(resolveLevel(curve, 24_000_000) === 10, 'MXP 24,000,000 → Lv.10');
      assert(resolveLevel(curve, 99_000_000) === 10, '滿級後不再升級（門檻用盡）');
    },
  },
  {
    name: '真實配比驅動主屬：GDD 的 ×N 表逐屬算得出來',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('載入失敗');
      const reader = createProgressionDefinitionReader(loaded.registry);

      // 單手武器（肌 ×2、反 ×1、協 ×2）Lv.5 + 雙手法杖（智 ×4、協 ×1）Lv.3。
      const masteries: Record<MasteryId, MasteryProgress> = {
        [ONE_HAND_WEAPON]: { ...createMasteryProgress(ONE_HAND_WEAPON), level: 5 },
        [TWO_HAND_STAFF]: { ...createMasteryProgress(TWO_HAND_STAFF), level: 3 },
      } as Record<MasteryId, MasteryProgress>;
      const progression = { ...createCharacterProgression(SUBJECT), masteries };

      const attributes = derivePrimaryAttributes(progression, reader);
      assert(attributes.muscle === 10, `肌力應為 2×5=10，實得 ${attributes.muscle}`);
      assert(attributes.reaction === 5, `反應應為 1×5=5，實得 ${attributes.reaction}`);
      assert(attributes.coordination === 13, `協調應為 2×5 + 1×3 = 13，實得 ${attributes.coordination}`);
      assert(attributes.intelligence === 12, `智力應為 4×3=12，實得 ${attributes.intelligence}`);
      assert(attributes.charisma === 0, `魅力應為 0，實得 ${attributes.charisma}`);
    },
  },
  {
    name: '任務熟練度不給主屬（作者判讀的空配比，不是缺資料）',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('載入失敗');
      const reader = createProgressionDefinitionReader(loaded.registry);

      // GDD 的配比表不涵蓋任務／行動熟練度。作者層以「全空 gains」明確表達「不走主屬管道」，
      // 而不是漏掉這幾筆定義。釘住它：定義存在、可讀、且貢獻為 0。
      const def = reader.getMastery(QUEST_ESCORT);
      assert(def.primaryAttributeGainsByLevel.length === 11, 'gains 陣列長度仍為 11（存在但為空物件）');

      const masteries = {
        [QUEST_ESCORT]: { ...createMasteryProgress(QUEST_ESCORT), level: 10 },
      } as Record<MasteryId, MasteryProgress>;
      const attributes = derivePrimaryAttributes({ ...createCharacterProgression(SUBJECT), masteries }, reader);
      const total =
        attributes.muscle +
        attributes.intelligence +
        attributes.reaction +
        attributes.coordination +
        attributes.charisma;
      assert(total === 0, `任務熟練度 Lv.10 的主屬貢獻應為 0，實得 ${total}`);
    },
  },
  {
    name: '交流熟練度效益定義存在且指向 mastery.core.social',
    run: () => {
      const loaded = loadContentFromDisk(CONTENT_ROOT);
      if (!loaded.success) throw new Error('載入失敗');
      const reader = createProgressionDefinitionReader(loaded.registry);
      const benefits = reader.listSocialMasteryBenefits();
      assert(benefits.length === 1, `應有 1 筆交流效益定義，實得 ${benefits.length}`);
      const only = benefits[0];
      if (only === undefined) throw new Error('listSocialMasteryBenefits 回傳空陣列');
      assert(
        String(only.masteryId) === 'mastery.core.social',
        `masteryId 應指向 mastery.core.social，實得 ${String(only.masteryId)}`,
      );
      assert(only.inviteSuccessBonusGainsByLevel.length === 10, '邀請成功加成應為 10 級');
    },
  },
];

export type ContentPackIntegrationResult = Readonly<{ name: string; pass: boolean; error?: string }>;

export function runTestResults(): readonly ContentPackIntegrationResult[] {
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
    const lines = failed.map((r) => `  - ${r.name}: ${r.error ?? 'unknown'}`).join('\n');
    throw new Error(`content-pack integration tests failed (${failed.length}/${results.length}):\n${lines}`);
  }
}
