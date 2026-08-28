// app/content/statistics-resolver-bridge.test.ts
// 證派生統計引擎端到端：真實內容 params → registry → StatisticsResolverPort bridge → BM 值。
// 這是 keystone 的證據——作者/BM 的數字真的算出 maxHealth、減傷、mastery 倍率。

import { resolve } from 'node:path';

import type { MasteryId, ResolverId, SecondaryAttributeId } from '../../contracts/core';
import type { PrimaryAttributes } from '../../contracts/progression';
import { loadContentFromDisk } from '../../platform/content-repository';
import { createProductionResolverRegistry } from './resolver-registrations';
import { createStatisticsResolverPort } from './statistics-resolver-bridge';

const CONTENT_ROOT = resolve(import.meta.dirname, '../../../content');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ATTRS: PrimaryAttributes = { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 };
const SEC = 'definition:secondary-attribute.core.x' as SecondaryAttributeId;

export function runTests(): void {
  const loaded = loadContentFromDisk(CONTENT_ROOT);
  if (!loaded.success) throw new Error('內容載入失敗');
  const registry = createProductionResolverRegistry(loaded.resolverBindings);
  const bridge = createStatisticsResolverPort(registry, loaded.registry);

  const final = (local: string, safeRaw: number, equippedWeight = 0): number =>
    bridge.resolveFinalSecondaryValue(`resolver:statistics.${local}` as ResolverId, {
      secondaryAttributeId: SEC,
      safeRaw,
      effectivePrimaryAttributes: ATTRS,
      ageDays: 0,
      equippedWeight,
    });

  // 生命上限 = 200 + safeRaw×20（BM）。safeRaw 10 → 400。
  assert(final('final.max-health', 10) === 400, `max-health 應 400，實得 ${final('final.max-health', 10)}`);
  // 魔力上限 = 120 + safeRaw×14。safeRaw 10 → 260。
  assert(final('final.max-mana', 10) === 260, `max-mana 應 260，實得 ${final('final.max-mana', 10)}`);
  // 分數直出（identity）。
  assert(final('final.identity', 37) === 37, 'identity 直出');
  // 一般減傷 raw/(raw+120)：raw=120 → 0.5。
  assert(Math.abs(final('final.mitigation', 120) - 0.5) < 1e-9, 'mitigation raw=120 → 0.5');
  // 格擋吸收 raw/(raw+80)：raw=80 → 0.5。
  assert(Math.abs(final('final.block-absorption', 80) - 0.5) < 1e-9, 'block-absorption raw=80 → 0.5');
  // 樂器減傷讀裝備總重（第一版 K=100）：weight=100 → 0.5。
  assert(Math.abs(final('final.instrument-mitigation', 0, 100) - 0.5) < 1e-9, 'instrument weight=100 → 0.5');

  // mastery 倍率：等級 5 → 1.25（BM masteryMultipliers）。
  const mc = bridge.resolveMasteryCoefficient('resolver:statistics.mastery-coefficient' as ResolverId, {
    secondaryAttributeId: SEC,
    masteryLevels: [{ masteryId: 'definition:mastery.core.x' as MasteryId, level: 5 }],
  });
  assert(mc === 1.25, `mastery Lv5 應 1.25，實得 ${mc}`);

  // 年齡修正（第一版空曲線）→ 零 delta。
  const age = bridge.resolveAgeModifier('resolver:statistics.age-modifier' as ResolverId, {
    ageDays: 12000,
    primaryAttributes: ATTRS,
  });
  assert(Object.keys(age).length === 0, `age 第一版應零 delta，實得 ${JSON.stringify(age)}`);
}
