import { balanceModel as sharedBalanceModel } from '../yunhua/yunhua_content.data.mjs';

const tierMeta = [
  { tier: 'I', rarity: '一般', scale: 1, priceScale: 1 },
  { tier: 'II', rarity: '精品', scale: 1.30, priceScale: 2.6 },
  { tier: 'III', rarity: '史詩', scale: 1.75, priceScale: 7 },
  { tier: 'IV', rarity: '傳說', scale: 2.25, priceScale: 22 },
  { tier: 'V', rarity: '神話', scale: 2.95, priceScale: 75 },
];
const stages = ['L0 自動', 'L3 自動', '基礎書 Lv.3', '高級書 Lv.6', '極品書 Lv.10'];
const stageIds = ['l0', 'l3', 'basic', 'advanced', 'master'];
const supportMxp = [48, 48, 72, 120, 200];
const delayKey = { 迅捷: 'quick', 標準: 'standard', 沉重: 'heavy', 施法: 'cast', 演奏: 'perform', 架勢: 'stance' };
const round = value => Math.round(value * 100) / 100;

export const ability = (condition, effect, limit = '每次行動 1 次。') => ({ condition, effect, limit });
export const damage = (multiplier, channel = 'physical') => ({ kind: 'damage', multiplier, channel });
export const counter = multiplier => ({ kind: 'counter', multiplier, channel: 'physical' });
export const heal = multiplier => ({ kind: 'heal', multiplier, channel: 'healing' });
export const support = { kind: 'none', multiplier: null, channel: null };
export const stats = (health, muscle, intelligence, reaction, coordination, charisma = 0) => ({ health, muscle, intelligence, reaction, coordination, charisma });
export const monsterSkill = (name, channel, multiplier, delay, effect) => ({ name, channel, multiplier, delay, effect });
export const floor = (label, grid, note) => ({ label, rows: grid.length, columns: grid[0].length, grid, note });

const attackProfile = (entry, threat) => {
  const multiplier = { 一般: 1, 菁英: 1.18, Boss: 1.42 }[threat];
  return {
    physicalBase: round((entry.muscle * 1.2 + entry.coordination * 0.45) * multiplier),
    magicBase: round((entry.intelligence * 1.25 + entry.coordination * 0.2) * multiplier),
    hitScore: round(entry.reaction * 0.4 + entry.coordination * 0.55 + entry.intelligence * 0.1),
  };
};

export const createCultureData = config => {
  const cultureMeta = { id: `culture.${config.key}`, version: '2026-08-14', ...config.meta };
  const balanceModel = {
    ...sharedBalanceModel,
    title: `${cultureMeta.name}第一輪共用平衡基準`,
    scope: `沿用雲華已確立的跨文化 HP、主屬、CTB、命中、減傷、控制抗性與 Mastery 基準；${cultureMeta.name}只以內容組合與合法效果建立文化差異。`,
    statusRules: config.statusRules,
  };

  const equipmentCatalog = Object.entries(Object.groupBy(config.equipment, entry => entry.type)).map(([title, entries]) => ({
    title,
    lines: entries.map(blueprint => tierMeta.map((meta, index) => ({
      id: `equipment.${config.key}.${blueprint.id}.${meta.tier.toLowerCase()}`,
      cultureId: cultureMeta.id,
      tier: meta.tier,
      rarity: meta.rarity,
      type: blueprint.type,
      requirement: blueprint.requirement,
      name: blueprint.names[index],
      weight: blueprint.weights[index],
      value: Math.round(blueprint.baseValue * meta.priceScale),
      coefficients: Object.fromEntries(Object.entries(blueprint.coefficients).map(([key, value]) => [key, round(value * meta.scale)])),
      ability: blueprint.abilities[index],
    }))),
  }));

  const skillCatalog = config.skillRoutes.map(route => ({
    route: route.name,
    rows: route.entries.map((entry, index) => {
      const [name, type, delayLabel, resolution, effect, limit = '無。'] = entry;
      const isDamage = resolution.kind === 'damage' || resolution.kind === 'counter';
      return {
        id: `skill.${config.key}.${route.id}.${stageIds[index]}`,
        cultureId: cultureMeta.id,
        route: route.name,
        requirement: route.requirement,
        stage: stages[index],
        name,
        type,
        actionKind: delayLabel === '施法' ? 'cast' : delayLabel === '演奏' ? 'perform' : type.includes('守勢') ? 'guard' : isDamage ? 'attack' : 'support',
        delay: balanceModel.delayProfiles[delayKey[delayLabel]],
        resolution,
        power: resolution.multiplier === null ? '無傷害' : `${resolution.kind === 'heal' ? '治療' : resolution.kind === 'counter' ? '反擊' : '傷害'}威力 ×${resolution.multiplier.toFixed(2)}`,
        effect,
        limit,
        masteryExperienceMode: isDamage ? 'damage' : 'fixedSupport',
        experience: isDamage ? `有效傷害比例 → ${route.name} Mastery` : `固定支援 MXP ${supportMxp[index]}`,
      };
    }),
  }));

  const makeMonster = entry => ({
    id: `monster.${config.key}.${entry.id}`,
    cultureId: cultureMeta.id,
    ...entry,
    attackProfile: attackProfile(entry.stats, entry.threat),
  });
  const monsterCatalog = {
    nonHuman: config.monsters.map(makeMonster),
    humanEncounters: config.humanEncounters.map(entry => ({ ...entry, id: `encounter.${config.key}.${entry.id}` })),
  };
  const itemCatalog = config.items;
  const materialCatalog = config.materials;
  const craftingCatalog = {
    equipmentRecipes: tierMeta.slice(0, 2).flatMap(meta => config.equipment.map(blueprint => ({
      id: `recipe.${config.key}.${blueprint.id}.${meta.tier.toLowerCase()}`,
      tier: meta.tier,
      output: `equipment.${config.key}.${blueprint.id}.${meta.tier.toLowerCase()}`,
      name: blueprint.names[meta.tier === 'I' ? 0 : 1],
      ingredientSlots: meta.tier === 'I' ? 1 : 2,
    }))),
    cuisine: config.cuisine,
    books: config.books,
  };
  const firstMapConfigs = config.mapConfigs;
  const firstMapLayouts = config.mapLayouts;

  const validationSummary = (() => {
    const equipmentLines = equipmentCatalog.flatMap(group => group.lines);
    const equipmentItems = equipmentLines.flat();
    const skills = skillCatalog.flatMap(route => route.rows);
    const mapPoolTotals = firstMapConfigs.flatMap(map => Object.entries(map.materialPools).map(([pool, rows]) => ({ map: map.name, pool, total: rows.reduce((sum, [, weight]) => sum + weight, 0) })));
    const errors = [];
    if (equipmentLines.length !== 18) errors.push(`裝備底模應為 18，實際 ${equipmentLines.length}`);
    if (equipmentItems.length !== 90) errors.push(`裝備條目應為 90，實際 ${equipmentItems.length}`);
    if (skills.length !== 80) errors.push(`技能應為 80，實際 ${skills.length}`);
    if (new Set(skills.map(skill => skill.id)).size !== skills.length) errors.push('技能 Definition ID 有重複');
    if (monsterCatalog.nonHuman.length !== 15) errors.push(`非人類怪物應為 15，實際 ${monsterCatalog.nonHuman.length}`);
    if (monsterCatalog.humanEncounters.length !== 5) errors.push(`人類 Encounter 應為 5，實際 ${monsterCatalog.humanEncounters.length}`);
    if (craftingCatalog.equipmentRecipes.filter(recipe => recipe.tier === 'I').length !== 18 || craftingCatalog.equipmentRecipes.filter(recipe => recipe.tier === 'II').length !== 18) errors.push('Tier I／II 裝備配方未各覆蓋 18 種底模');
    mapPoolTotals.filter(entry => entry.total !== 100).forEach(entry => errors.push(`${entry.map}／${entry.pool} 權重為 ${entry.total}`));
    firstMapLayouts.flatMap(map => map.floors).forEach(entry => {
      if (entry.grid.some(row => row.length !== entry.columns)) errors.push(`${entry.label} 格圖欄數不一致`);
      if (entry.grid.length !== entry.rows) errors.push(`${entry.label} 格圖列數不一致`);
    });
    return {
      ok: errors.length === 0,
      errors,
      counts: { equipmentLines: equipmentLines.length, equipmentItems: equipmentItems.length, skills: skills.length, nonHumanMonsters: monsterCatalog.nonHuman.length, humanEncounters: monsterCatalog.humanEncounters.length, maps: firstMapLayouts.length, floors: firstMapLayouts.reduce((sum, map) => sum + map.floors.length, 0), materials: materialCatalog.length },
      mapPoolTotals,
    };
  })();
  if (!validationSummary.ok) throw new Error(`${cultureMeta.name}內容資料驗證失敗：\n${validationSummary.errors.join('\n')}`);
  return { cultureMeta, balanceModel, equipmentCatalog, skillCatalog, monsterCatalog, itemCatalog, materialCatalog, craftingCatalog, firstMapConfigs, firstMapLayouts, validationSummary };
};
