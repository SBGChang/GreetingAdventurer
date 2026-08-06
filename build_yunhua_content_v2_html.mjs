import { writeFileSync } from 'node:fs';
import {
  attributes,
  balanceModel,
  equipmentCatalog,
  skillCatalog,
  monsterCatalog,
  consumables,
  craftingCatalog,
  firstMapConfigs,
  firstMapLayouts,
  weaponDpsReview,
} from './docs/03_content/yunhua/yunhua_content_v2.data.mjs';

const output = new URL('./docs/03_content/yunhua/yunhua_content_v2.html', import.meta.url);
const attrShort = { muscle: '肌', intelligence: '智', reaction: '反', coordination: '協', charisma: '魅' };
const attrClass = { muscle: 'muscle', intelligence: 'intelligence', reaction: 'reaction', coordination: 'coordination', charisma: 'charm' };
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fixed = number => Number(number).toFixed(2);
const formatNumber = number => Number(number).toLocaleString('zh-Hant-TW', { maximumFractionDigits: 2 });

const total = vector => Object.values(vector).reduce((sum, value) => sum + Number(value), 0);
const coefficientClass = (secondary, value) => {
  if (!value) return 'zero';
  const score = Math.abs(Number(value));
  const thresholds = /傷害/.test(secondary) ? [0.7, 1.5]
    : /減傷|吸收/.test(secondary) ? [0.08, 0.18]
      : [0.18, 0.42];
  return score < thresholds[0] ? 'weak' : score < thresholds[1] ? 'steady' : 'strong';
};
const coefficient = (secondary, value) => `<span class="number coeff ${coefficientClass(secondary, value)}">${value ? fixed(value) : '0'}</span>`;
const actionDelay = delay => `${esc(delay.label)}｜基礎 ${delay.base}｜${esc(delay.reductions)}｜最低 ${delay.minimum}`;
const ability = (condition, effect, limit) => `<div class="ability"><div><b>條件</b><span>${esc(condition)}</span></div><div><b>效果</b><span>${esc(effect)}</span></div><div><b>限制</b><span>${esc(limit)}</span></div></div>`;
const table = (headers, rows, classes = '') => `<div class="table-wrap"><table class="${classes}"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
const section = (id, title, content, note = '') => `<section id="${id}" data-content-section><h2>${esc(title)}</h2>${note ? `<p class="section-note">${esc(note)}</p>` : ''}${content}</section>`;

const renderBalance = () => {
  const formulaRows = balanceModel.formulas.map(([name, formula, note]) => `<tr><th>${esc(name)}</th><td class="formula">${esc(formula)}</td><td>${esc(note)}</td></tr>`).join('');
  const profileRows = Object.values(balanceModel.delayProfiles).map(profile => `<tr><td class="name">${esc(profile.label)}</td><td class="number">${profile.base}</td><td>${esc(profile.reductions)}</td><td class="number">${profile.minimum}</td></tr>`).join('');
  const statusRows = balanceModel.statusRules.map(([name, polarity, effect, duration, policy]) => `<tr><td class="name">${esc(name)}</td><td>${esc(polarity)}</td><td>${esc(effect)}</td><td class="number">${esc(duration)}</td><td>${esc(policy)}</td></tr>`).join('');
  const controlRows = balanceModel.controlResistanceRules.map(([rank, multiplier, policy]) => `<tr><td class="name">${esc(rank)}</td><td class="number">${esc(multiplier)}</td><td>${esc(policy)}</td></tr>`).join('');
  const bracketRows = balanceModel.primaryBrackets.map(row => `<tr>${row.map((value, index) => `<td class="${index === 0 ? 'name' : ''}">${esc(value)}</td>`).join('')}</tr>`).join('');
  const multiplierRows = balanceModel.masteryMultipliers.map((value, level) => `<tr><td class="number">${level}</td><td class="number">×${value.toFixed(2)}</td></tr>`).join('');
  const dpsRows = weaponDpsReview.rows.map(entry => `<tr><td class="name">${esc(entry.name)}<small>${esc(entry.route)}・${esc(entry.repeatableSkill)} ×${fixed(entry.skillPower)}</small></td><td class="number">${fixed(entry.rawDamage)}</td><td class="number">${fixed(entry.hitScore)}</td><td class="number">${fixed(entry.hitRate)}%</td><td class="number">${fixed(entry.actionDelay)}</td><td class="number">${fixed(entry.expectedDamage)}</td><td class="number total">${fixed(entry.expectedDamagePerCtb)}</td><td class="number">${fixed(entry.versusOneHandPercent)}%</td></tr>`).join('');
  const evasionRows = weaponDpsReview.evasionScenarios.map(scenario => `<tr><td class="number">${scenario.targetEvasionScore}</td>${scenario.ranking.slice(0, 4).map(entry => `<td>${esc(entry.route)} <span class="number">${fixed(entry.expectedDamagePerCtb)}</span></td>`).join('')}</tr>`).join('');
  const dpsScenario = weaponDpsReview.scenario;
  const dpsScenarioText = `情境：${dpsScenario.label}；使用 Tier ${dpsScenario.equipmentTier} 同品級裝備；肌／智／反／協均為 ${dpsScenario.attributes.muscle}；對應 Mastery Lv.${dpsScenario.masteryLevel}（×${balanceModel.masteryMultipliers[dpsScenario.masteryLevel].toFixed(2)}）；目標迴避分數 ${dpsScenario.targetEvasionScore}、一般減傷 raw ${dpsScenario.targetDamageReductionRaw}、未格擋。每條路線採自己的可重複 L0 單體技能、倍率與延遲；不計範圍、狀態、反擊、CTB 干擾、裝備觸發與副手防護。`;
  return `<style>.dps-table td small{display:block;margin-top:2px;color:var(--muted);font-weight:400}.dps-table th:nth-child(1){width:26%}.dps-table th:nth-child(n+2){width:10.57%}</style>${section('balance', balanceModel.title, `
    <p class="lead">${esc(balanceModel.scope)}</p>
    ${table('<th>項目</th><th>規則／公式</th><th>平衡意圖</th>', formulaRows, 'balance-table')}
    <div class="split">
      <div><h3>行動延遲模板</h3>${table('<th>類型</th><th>基礎</th><th>主屬減免</th><th>最低</th>', profileRows, 'compact')}</div>
      <div><h3>Mastery 傷害倍率</h3>${table('<th>Lv.</th><th>倍率</th>', multiplierRows, 'compact')}</div>
    </div>
    <h3>主屬性成長／敵人標尺</h3>
    ${table('<th>層級</th><th>推薦 Mastery</th><th>角色主要主屬</th><th>一般／Boss HP</th><th>用途</th>', bracketRows, 'compact')}
    <h3>第一版狀態規則</h3>
    ${table('<th>狀態</th><th>極性</th><th>效果</th><th>持續</th><th>重疊規則</th>', statusRows, 'compact')}
    <h3>CTB 控制抗性</h3>
    ${table('<th>威脅</th><th class="right">效果倍率</th><th>限制</th>', controlRows, 'compact')}
    <h3>${esc(weaponDpsReview.title)}</h3>
    <p class="section-note">${esc(dpsScenarioText)}</p>
    ${table('<th>武器</th><th class="right">傷害基礎</th><th class="right">命中分數</th><th class="right">命中率</th><th class="right">使用 CTB</th><th class="right">期望傷害</th><th class="right">期望傷害／CTB</th><th class="right">相對單手刀</th>', dpsRows, 'compact dps-table')}
    <h3>迴避敏感度｜前四名</h3>
    ${table('<th class="right">目標迴避</th><th>第 1</th><th>第 2</th><th>第 3</th><th>第 4</th>', evasionRows, 'compact')}
    <p class="section-note"><b>平衡不變量：</b>${esc(weaponDpsReview.invariant.highestName)}（${esc(weaponDpsReview.invariant.highestRoute)}）為最高，為單手刀的 ${fixed(weaponDpsReview.invariant.versusOneHandPercent)}%。${esc(weaponDpsReview.invariant.explanation)}</p>
  `)}`;
};

const renderEquipment = () => {
  const catalog = equipmentCatalog.map(category => {
    const lines = category.lines.map(line => {
      const rows = line.map(item => item.coefficients.map((row, index) => {
        const common = index === 0 ? `<td rowspan="${item.coefficients.length}" class="tier">${esc(item.tier)}</td><td rowspan="${item.coefficients.length}" class="rarity">${esc(item.rarity)}</td><td rowspan="${item.coefficients.length}" class="name">${esc(item.name)}</td><td rowspan="${item.coefficients.length}" class="number">${formatNumber(item.weight)}</td><td rowspan="${item.coefficients.length}" class="number">${formatNumber(item.value)}</td>` : '';
        const values = Object.entries(attrShort).map(([key]) => `<td class="number ${attrClass[key]}">${coefficient(row.secondary, row.values[key])}</td>`).join('');
        const abilityCell = index === 0 ? `<td rowspan="${item.coefficients.length}" class="ability-cell">${ability(item.ability.condition, item.ability.effect, item.ability.limit)}</td>` : '';
        return `<tr>${common}<td class="secondary">${esc(row.secondary)}</td>${values}<td class="number total">${fixed(total(row.values))}</td>${abilityCell}</tr>`;
      }).join('')).join('');
      return `<h4>${esc(line[0].requirement)}</h4>${table('<th>Tier</th><th>品級</th><th>名稱</th><th class="right">重量</th><th class="right">價值</th><th>副屬性</th><th class="right muscle">肌</th><th class="right intelligence">智</th><th class="right reaction">反</th><th class="right coordination">協</th><th class="right charm">魅</th><th class="right">Total</th><th>能力</th>', rows, 'equipment')}`;
    }).join('');
    return `<article class="category"><h3>${esc(category.title)}</h3><p>${esc(category.description)}</p>${lines}</article>`;
  }).join('');
  return section('equipment', '裝備與防具｜實際係數', catalog, '每一格都是副屬性的主屬係數；Total 是該副屬性的係數合計，而不是直接加到角色面板。數字顏色只表示該副屬性通道內的相對強度：灰＝低、藍＝中、橙＝高。');
};

const renderSkills = () => {
  const contents = skillCatalog.map(category => {
    const routes = Object.values(Object.groupBy(category.rows, skill => skill.route));
    const routeTables = routes.map(routeSkills => {
      const rows = routeSkills.map(skill => `<tr><td class="name">${esc(skill.name)}</td><td>${esc(skill.stage)}</td><td>${esc(skill.kind)}</td><td>${esc(skill.requirement)}</td><td class="delay">${actionDelay(skill.delay)}</td><td class="number">${esc(skill.power)}</td><td class="number">${esc(skill.experience)}</td><td class="ability-cell">${ability(skill.condition, skill.effect, skill.limit)}</td></tr>`).join('');
      return `<h4>${esc(routeSkills[0].route)}</h4>${table('<th>名稱</th><th>取得</th><th>種類</th><th>需求</th><th>使用延遲</th><th class="right">威力／效果</th><th class="right">MXP</th><th>能力</th>', rows, 'skill-table')}`;
    }).join('');
    return `<article class="category"><h3>${esc(category.title)}</h3><p>${esc(category.description)}</p>${routeTables}</article>`;
  }).join('');
  const styles = '<style>.skill-table th:nth-child(1){width:11%}.skill-table th:nth-child(2){width:10%}.skill-table th:nth-child(3){width:9%}.skill-table th:nth-child(4){width:12%}.skill-table th:nth-child(5){width:17%}.skill-table th:nth-child(6){width:9%}.skill-table th:nth-child(7){width:9%}.skill-table th:nth-child(8){width:23%}@media(max-width:1000px){.skill-table th:nth-child(1){width:11%}.skill-table th:nth-child(2){width:10%}.skill-table th:nth-child(3){width:9%}.skill-table th:nth-child(4){width:12%}.skill-table th:nth-child(5){width:16%}.skill-table th:nth-child(6){width:9%}.skill-table th:nth-child(7){width:9%}.skill-table th:nth-child(8){width:24%}}</style>';
  return `${styles}${section('skills', '技能、魔法與延遲', contents, '所有招式的延遲都使用同一組模板；無傷害增益、減益與治療才產生固定支援 MXP，並受同技能每戰最多 3 次限制。')}`;
};

const renderMonster = monster => {
  const stats = [['HP', monster.stats.health], ...Object.entries(attrShort).map(([key, label]) => [label, monster.stats[key]])]
    .map(([label, value]) => `<span><b>${esc(label)}</b><em>${formatNumber(value)}</em></span>`).join('');
  const skills = monster.skills.map(entry => `<div class="monster-skill"><div><b>${esc(entry.name)}</b><span>${esc(entry.kind)}｜${actionDelay(entry.delay)}</span></div><div class="number">${esc(entry.power)}${entry.estimatedRawDamage === null ? '' : `｜基礎約 ${fixed(entry.estimatedRawDamage)}`}</div><p>${esc(entry.effect)}<small>${esc(entry.limit)}</small></p></div>`).join('');
  return `<article class="monster-card"><header><span class="tag tier-${monster.tier.toLowerCase()}">Tier ${esc(monster.tier)}</span><span class="tag">${esc(monster.threat)}</span><span class="tag">${esc(monster.size)}</span><h4>${esc(monster.name)}</h4><p>${esc(monster.role)}</p></header><div class="monster-stats">${stats}</div><div class="monster-skills">${skills}</div><footer><b>自然攻擊</b>物 ${fixed(monster.attackProfile.physicalBase)}／魔 ${fixed(monster.attackProfile.magicBase)}／命中 ${fixed(monster.attackProfile.hitScore)}<br><b>掉落</b>${esc(monster.drops)}<br><b>遭遇</b>${esc(monster.encounter)}</footer></article>`;
};

const renderMonsters = () => `${section('monsters', '怪物｜六維與技能數值', `
  <article class="category"><h3>非人類怪物（文化綁定）</h3><p>不論被誰占領，非人類怪物與其素材仍採雲華文化池；Boss 一律 3×3，大型／中型與菁英、Boss 的關係不互相綁死。</p><div class="monster-grid">${monsterCatalog.nonHuman.map(renderMonster).join('')}</div></article>
  <article class="category"><h3>雲華人類 Encounter（占領國可替換）</h3><p>人類敵人才可依占領國改用其他文化的 Encounter Pool；此處是雲華未被占領時的候選。</p><div class="monster-grid">${monsterCatalog.humanYunhua.map(renderMonster).join('')}</div></article>
`)}`;

const simpleRows = values => values.map(row => `<tr>${row.map((entry, index) => `<td class="${index === 0 ? 'name' : ''}">${esc(entry)}</td>`).join('')}</tr>`).join('');
const groupedTables = (groups, headers, classes = 'compact') => groups.map(group => `<h4>${esc(group.title)}</h4>${table(headers, simpleRows(group.rows), classes)}`).join('');
const renderItems = () => section('items', '道具、一般物品與內容經濟', `
  <h3>戰鬥消耗品</h3>${table('<th>Tier</th><th>名稱</th><th>重量／價值</th><th>使用延遲</th><th>效果</th><th>來源與限制</th>', simpleRows(consumables.combat), 'compact items')}
  <h3>非戰鬥消耗品</h3>${table('<th>名稱</th><th>規格</th><th>使用</th><th>效果</th><th>限制</th>', simpleRows(consumables.nonCombat), 'compact')}
  <h3>一般物品（不使用道具）</h3>${groupedTables(consumables.general, '<th>名稱</th><th>級別</th><th class="right">重量</th><th class="right">價值</th><th>用途</th>')}
`, '戰鬥、非戰鬥消耗品都有實際使用延遲；一般物品不使用，但會進入探索、送貨、購買、城市永久庫存與住家布置的經濟循環。');

const renderCrafting = () => section('crafting', '素材、製作、料理與書籍', `
  <h3>素材與文化詞條</h3>${groupedTables(craftingCatalog.materials, '<th>名稱</th><th>級別</th><th>重量／價值</th><th>固定詞條方向</th><th>主要用途</th>')}
  <h3>工藝經濟基準</h3>${table('<th>項目</th><th>基準</th><th>說明</th>', simpleRows(craftingCatalog.economyRules), 'compact')}
  <h3>配方</h3>${groupedTables(craftingCatalog.recipes, '<th>名稱</th><th>規格</th><th>材料</th><th>產出規則</th>')}
  <h3>料理與餐館</h3>${table('<th>料理</th><th>規格</th><th>食材方向</th><th>FoodStatus</th><th>餐館／來源</th>', simpleRows(craftingCatalog.cuisine), 'compact')}
  <h3>技能書</h3>${groupedTables(craftingCatalog.books.skill, '<th>名稱</th><th>Mastery 門檻</th><th>取得</th><th>內容</th>')}
  <h3>製作書</h3>${groupedTables(craftingCatalog.books.crafting, '<th>名稱</th><th>Mastery 門檻</th><th>取得</th><th>內容</th>')}
  <h3>素材詞條表</h3>${table('<th>詞條</th><th>來源素材</th><th>可用成品</th><th>詞條方向</th>', simpleRows(craftingCatalog.affixes), 'compact')}
`, '裝備的品級（一般～神話）來自製作書／材料 Tier；製作品質（精良～鬼神）決定可成功裝入的詞條數。消耗品沒有前綴，只由製藥 Mastery 改變成功產量；料理沒有背包物品，直接形成 FoodStatus。');

const parseMapCell = cell => cell.split(',').map(Number);
const mapEdgeKey = (left, right) => [left, right].sort().join('|');
const mapMarkDefinitions = {
  treasure: { label: '寶箱偏好點', className: 'treasure' },
  event: { label: '事件偏好點', className: 'event' },
  large: { label: '大體型敵人偏好點', className: 'large' },
  trap: { label: '固定陷阱', className: 'trap' },
  resource: { label: '素材偏好／固定採集點', className: 'resource' },
};

const validateMapLayouts = () => {
  firstMapLayouts.forEach(layout => {
    let exits = 0;
    layout.floors.forEach(floor => {
      const roomsById = new Map();
      const roomsByCell = new Map();
      floor.rooms.forEach(room => {
        if (roomsById.has(room.id)) throw new Error(`${layout.name}／${floor.label}：重複房間 ID ${room.id}`);
        roomsById.set(room.id, room);
        const specialRoom = Boolean(room.entry || room.exit || room.stair || room.marks.includes('trap'));
        if (specialRoom && room.cells.length !== 1) throw new Error(`${layout.name}／${floor.label}：出入口、樓梯與陷阱必須是單格房間`);
        if (specialRoom && room.marks.some(mark => mark !== 'trap')) throw new Error(`${layout.name}／${floor.label}：特殊單格不可與其他內容偏好點共用`);
        if (room.marks.includes('resource') && room.marks.length !== 1) throw new Error(`${layout.name}／${floor.label}：固定採集點不可與其他內容偏好點共用`);
        if (room.exit) exits += 1;
        room.cells.forEach(cell => {
          const [row, column] = parseMapCell(cell);
          if (row < 1 || row > floor.rows || column < 1 || column > floor.columns) throw new Error(`${layout.name}／${floor.label}：格子 ${cell} 超出尺寸`);
          if (roomsByCell.has(cell)) throw new Error(`${layout.name}／${floor.label}：格子 ${cell} 被兩個房間共用`);
          roomsByCell.set(cell, room);
        });
      });
      floor.connections.forEach(connection => {
        const from = roomsById.get(connection.from);
        const to = roomsById.get(connection.to);
        if (!from || !to || !from.cells.includes(connection.fromCell) || !to.cells.includes(connection.toCell)) throw new Error(`${layout.name}／${floor.label}：連線端點未屬於指定房間`);
        const [fromRow, fromColumn] = parseMapCell(connection.fromCell);
        const [toRow, toColumn] = parseMapCell(connection.toCell);
        if (Math.abs(fromRow - toRow) + Math.abs(fromColumn - toColumn) !== 1) throw new Error(`${layout.name}／${floor.label}：連線端點必須相鄰`);
      });
    });
    if (exits < 1 || exits > 3) throw new Error(`${layout.name}：探索地圖出口必須為 1～3 個`);
  });
};

const validateMaterialPools = () => {
  firstMapConfigs.forEach(map => Object.entries(map.materialPools).forEach(([sourceKind, entries]) => {
    const weight = entries.reduce((sum, [, amount]) => sum + amount, 0);
    if (weight !== 100) throw new Error(`${map.name}／${sourceKind}：素材權重總和必須為 100，目前為 ${weight}`);
  }));
};

const validateContentBalance = () => {
  const canonicalAttributes = ['muscle', 'intelligence', 'reaction', 'coordination', 'charisma'];
  equipmentCatalog.flatMap(category => category.lines.flat()).forEach(item => item.coefficients.forEach(entry => {
    if (canonicalAttributes.some(attribute => !Object.hasOwn(entry.values, attribute))) throw new Error(`${item.name}／${entry.secondary}：缺少正式主屬性鍵`);
  }));

  const skills = skillCatalog.flatMap(category => category.rows);
  if (skills.length !== 80) throw new Error(`雲華技能應為 80 招，目前為 ${skills.length}`);
  skills.forEach(entry => {
    if (!entry.actionKind || !entry.resolution || !entry.masteryExperienceMode) throw new Error(`${entry.name}：缺少結構化技能欄位`);
    if (entry.masteryExperienceMode === 'fixedSupport' && ['damage', 'counter'].includes(entry.resolution.kind)) throw new Error(`${entry.name}：支援 MXP 不可搭配傷害結算`);
    if (['damage', 'counter', 'heal'].includes(entry.resolution.kind) && !Number.isFinite(entry.resolution.multiplier)) throw new Error(`${entry.name}：缺少數值倍率`);
    if (entry.route.includes('魔法') && entry.delay.id !== balanceModel.delayProfiles.cast.id) throw new Error(`${entry.name}：魔法必須使用施術延遲`);
    if (entry.route.includes('樂器') && entry.delay.id !== balanceModel.delayProfiles.perform.id) throw new Error(`${entry.name}：演奏必須使用演奏延遲`);
  });

  const monsters = [...monsterCatalog.nonHuman, ...monsterCatalog.humanYunhua];
  monsters.forEach(monster => {
    if (canonicalAttributes.some(attribute => !Object.hasOwn(monster.stats, attribute))) throw new Error(`${monster.name}：缺少正式主屬性鍵`);
    monster.skills.filter(entry => entry.resolution.kind === 'damage').forEach(entry => {
      if (!Number.isFinite(entry.resolution.multiplier) || !Number.isFinite(entry.estimatedRawDamage)) throw new Error(`${monster.name}／${entry.name}：傷害不可計算`);
    });
  });

  const tierOneRecipes = craftingCatalog.recipes.find(group => group.title === '裝備製作｜Tier I 一般')?.rows.length;
  const tierTwoRecipes = craftingCatalog.recipes.find(group => group.title === '裝備製作｜Tier II 精品')?.rows.length;
  if (tierOneRecipes !== 18 || tierTwoRecipes !== 18) throw new Error(`Tier I／II 裝備配方必須各覆蓋 18 種底模，目前為 ${tierOneRecipes}／${tierTwoRecipes}`);
  if (weaponDpsReview.rows[0]?.id !== 'glaive') throw new Error('雙手重刃必須在標準單體 DPS 夾具中最高');
};

const mapEdgeCoordinates = (row, column, rowDelta, columnDelta, size) => {
  if (rowDelta) {
    const y = (rowDelta > 0 ? row : row - 1) * size;
    return [(column - 1) * size, y, column * size, y];
  }
  const x = (columnDelta > 0 ? column : column - 1) * size;
  return [x, (row - 1) * size, x, row * size];
};
const mapLine = ([x1, y1, x2, y2], stroke, width = 3) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
const mapBoundary = (coordinates, connectionType) => {
  const [x1, y1, x2, y2] = coordinates;
  if (!connectionType) return mapLine(coordinates, 'var(--map-wall)');
  const vertical = x1 === x2;
  const midpoint = vertical ? (y1 + y2) / 2 : (x1 + x2) / 2;
  const gap = 12;
  const first = vertical ? [x1, y1, x2, midpoint - gap] : [x1, y1, midpoint - gap, y2];
  const second = vertical ? [x1, midpoint + gap, x2, y2] : [midpoint + gap, y1, x2, y2];
  const middle = vertical ? [x1, midpoint - gap, x2, midpoint + gap] : [midpoint - gap, y1, midpoint + gap, y2];
  return `${mapLine(first, 'var(--map-wall)')}${mapLine(second, 'var(--map-wall)')}${connectionType === 'door' ? mapLine(middle, 'var(--map-door)', 4) : ''}`;
};

const renderMapMarker = (mark, x, y, index) => {
  const definition = mapMarkDefinitions[mark];
  const markerX = x - index * 18;
  if (mark === 'resource') return `<rect class="map-marker map-marker-${definition.className}" x="${markerX - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${markerX} ${y})"><title>${esc(definition.label)}</title></rect>`;
  return `<circle class="map-marker map-marker-${definition.className}" cx="${markerX}" cy="${y}" r="6"><title>${esc(definition.label)}</title></circle>`;
};

const renderMapFloor = floor => {
  const size = floor.columns >= 8 ? 50 : 58;
  const width = floor.columns * size;
  const height = floor.rows * size;
  const roomsByCell = new Map();
  floor.rooms.forEach(room => room.cells.forEach(cell => roomsByCell.set(cell, room)));
  const connectionByEdge = new Map(floor.connections.map(connection => [mapEdgeKey(connection.fromCell, connection.toCell), connection.type]));
  const roomCells = floor.rooms.map(room => room.cells.map(cell => {
    const [row, column] = parseMapCell(cell);
    const fill = room.entry ? 'var(--map-entry)' : room.exit ? 'var(--map-exit)' : 'var(--map-room)';
    return `<rect x="${(column - 1) * size}" y="${(row - 1) * size}" width="${size}" height="${size}" fill="${fill}"/>`;
  }).join('')).join('');
  const directions = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const seenEdges = new Set();
  const walls = [...roomsByCell.entries()].map(([cell, room]) => {
    const [row, column] = parseMapCell(cell);
    return directions.map(([rowDelta, columnDelta]) => {
      const adjacent = `${row + rowDelta},${column + columnDelta}`;
      if (roomsByCell.get(adjacent) === room) return '';
      const edge = mapEdgeKey(cell, adjacent);
      if (seenEdges.has(edge)) return '';
      seenEdges.add(edge);
      return mapBoundary(mapEdgeCoordinates(row, column, rowDelta, columnDelta, size), connectionByEdge.get(edge));
    }).join('');
  }).join('');
  const symbols = floor.rooms.map(room => {
    const anchor = room.anchor || room.cells[0];
    const [row, column] = parseMapCell(anchor);
    const centerX = (column - 0.5) * size;
    const centerY = (row - 0.5) * size;
    const special = room.entry ? `<text class="map-special" x="${centerX}" y="${centerY + 6}">入</text>`
      : room.exit ? `<text class="map-special" x="${centerX}" y="${centerY + 6}">出</text>`
        : room.stair ? `<text class="map-stair" x="${centerX}" y="${centerY + 8}">${esc(room.stair === 'up' ? '↑' : '↓')}</text>` : '';
    const marks = room.marks.map((mark, index) => renderMapMarker(mark, centerX + size * 0.26, centerY - size * 0.26, index)).join('');
    return `${special}${marks}`;
  }).join('');
  return `<article class="map-floor"><h4>${esc(floor.label)}</h4><svg class="map-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(floor.label)} 格圖"><rect width="${width}" height="${height}" fill="var(--map-void)"/>${roomCells}${walls}${symbols}</svg><p>${esc(floor.note)}</p></article>`;
};

const mapLegend = `<div class="map-legend" aria-label="格圖圖例">
  <span><i class="legend-tile entry"></i>入口</span><span><i class="legend-tile exit"></i>出口</span><i class="legend-door"></i><span>紅門</span><i class="legend-stair">↑↓</i><span>同座標樓梯</span>
  <span><i class="legend-marker treasure"></i>寶箱偏好</span><span><i class="legend-marker event"></i>事件偏好</span><span><i class="legend-marker large"></i>大體型敵人偏好</span><span><i class="legend-marker trap"></i>固定陷阱</span><span><i class="legend-marker resource"></i>素材偏好／固定採集點</span>
</div>`;

const mapStyles = `<style>
:root{--map-void:#1e2530;--map-room:#fffdfa;--map-wall:#263544;--map-door:#bb4033;--map-entry:#b9dcfb;--map-exit:#f4b9b5;--map-treasure:#d89612;--map-event:#277fb4;--map-large:#2b9367;--map-trap:#c33c3b;--map-resource:#168f8b}.map-layout{margin:0 0 42px;padding:18px;border:1px solid var(--line);border-radius:12px;background:#fffaf4}.map-layout>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.map-layout>header h3{margin:0;color:#713121}.map-layout>header p{margin:0;color:var(--muted)}.map-layout-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px;margin-top:16px}.map-floor{margin:0;padding:12px;border:1px solid #dfd3c6;border-radius:9px;background:var(--sheet)}.map-floor h4{margin:0 0 8px}.map-floor p{min-height:3.1em;margin:9px 0 0;color:#66717b;font-size:.88rem}.map-svg{display:block;width:100%;max-width:400px;height:auto;margin:auto;border:1px solid #1e2530;background:var(--map-void)}.map-special,.map-stair{text-anchor:middle;font-weight:900;paint-order:stroke;stroke:#fffdfa;stroke-width:3px;stroke-linejoin:round}.map-special{fill:#25445b;font-size:17px}.map-stair{fill:#343f49;font-size:28px}.map-marker{stroke-width:2.4px;vector-effect:non-scaling-stroke}.map-marker-treasure{fill:#fff1a5;stroke:var(--map-treasure)}.map-marker-event{fill:#c9edff;stroke:var(--map-event)}.map-marker-large{fill:#c8f1db;stroke:var(--map-large)}.map-marker-trap{fill:#ffd1d0;stroke:var(--map-trap)}.map-marker-resource{fill:#bdeeed;stroke:var(--map-resource)}.map-legend{display:flex;gap:8px 14px;flex-wrap:wrap;margin:12px 0 20px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--sheet);color:#4f5c67;font-size:.9rem}.map-legend span{display:flex;align-items:center;gap:5px}.legend-tile{display:inline-block;width:15px;height:15px;border:1px solid #526170}.legend-tile.entry{background:var(--map-entry)}.legend-tile.exit{background:var(--map-exit)}.legend-door{align-self:center;display:inline-block;width:18px;border-top:4px solid var(--map-door)}.legend-stair{width:20px;color:#334452;font-weight:900;text-align:center}.legend-marker{display:inline-block;width:12px;height:12px;border:2px solid;border-radius:50%}.legend-marker.treasure{background:#fff1a5;border-color:var(--map-treasure)}.legend-marker.event{background:#c9edff;border-color:var(--map-event)}.legend-marker.large{background:#c8f1db;border-color:var(--map-large)}.legend-marker.trap{background:#ffd1d0;border-color:var(--map-trap)}.legend-marker.resource{background:#bdeeed;border-color:var(--map-resource);border-radius:1px;transform:rotate(45deg)}@media(max-width:640px){.map-layout{padding:10px}.map-layout-grid{grid-template-columns:1fr;gap:10px}.map-floor{padding:8px}.map-floor p{min-height:0}}</style>`;

const renderMapLayouts = () => `${mapStyles}<h3>格圖配置</h3><p class="section-note">黑色為不存在地塊；相鄰白格沒有內線時視為同一房間。白色缺口是通道，紅線是紅門。每個紅門、素材偏好點與其他固定內容皆已直接畫在圖上。</p>${mapLegend}${firstMapLayouts.map(layout => `<article class="map-layout"><header><h3>${esc(layout.name)}</h3><p>${esc(layout.city)}・${esc(layout.type)}</p></header><div class="map-layout-grid">${layout.floors.map(renderMapFloor).join('')}</div></article>`).join('')}`;

const renderMaps = () => {
  const configurationRows = firstMapConfigs.map(map => `<tr><td class="name">${esc(map.name)}</td><td>${esc(map.city)}</td><td>${esc(map.tier)}</td><td>${esc(map.kind)}</td><td>${esc(map.layout)}</td><td>${esc(map.entryExit)}</td><td>${esc(map.configuration)}</td></tr>`).join('');
  const materialTables = firstMapConfigs.map(map => {
    const sourceLabels = { gathering: '採集點', treasure: '寶箱' };
    const pools = Object.entries(map.materialPools).map(([sourceKind, entries]) => {
      const rows = entries.map(([name, weight]) => `<tr><td class="name">${esc(name)}</td><td class="number">${weight}</td></tr>`).join('');
      return `<h4>${esc(sourceLabels[sourceKind] ?? sourceKind)}</h4>${table('<th>素材</th><th class="right">權重</th>', rows, 'compact')}`;
    }).join('');
    return `<h3>${esc(map.name)}｜素材配置比重</h3>${pools}`;
  }).join('');
  return section('maps', '第一版三張探索地｜配置與素材權重', `
    <p class="lead">怪物不依地圖偏好種類：非人類一律從雲華文化池選取，人類則讀取目前佔領國文化池。地圖只定義地形、房間、入口出口、門、樓梯、陷阱與素材權重。</p>
    ${renderMapLayouts()}
    <h3>地圖資料設定</h3>${table('<th>地圖</th><th>對應城市</th><th>Tier</th><th>類型</th><th>版型</th><th>出入口</th><th>固定配置</th>', configurationRows, 'compact')}
    <p class="section-note">素材按來源分池，採集點只讀採集池、寶箱只讀寶箱池，每池權重各自合計 100；怪物素材只由 Monster 掉落資料決定，不參與地圖抽取。素材仍是全雲華文化可配置，不代表綁死於單一地圖。</p>
    ${materialTables}
  `);
};

validateMapLayouts();
validateMaterialPools();
validateContentBalance();

const navigation = [['all', '全部'], ['balance', '平衡基準'], ['equipment', '裝備'], ['skills', '技能'], ['monsters', '怪物'], ['items', '道具'], ['crafting', '製作'], ['maps', '地圖']]
  .map(([id, label]) => `<button type="button" class="filter-button" data-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('');
const filterStyles = '<style>nav.filters{display:flex;gap:7px;flex-wrap:wrap;margin:24px 0 5px}nav.filters .filter-button{appearance:none;padding:6px 12px;border:1px solid #d9c7ba;border-radius:99px;background:#fffaf4;color:#783827;font:inherit;cursor:pointer}nav.filters .filter-button[aria-pressed="true"]{border-color:#91442e;background:#91442e;color:#fff}section[data-content-section][hidden]{display:none}</style>';
const filterScript = `<script>document.addEventListener('DOMContentLoaded',()=>{const buttons=[...document.querySelectorAll('[data-filter]')];const sections=[...document.querySelectorAll('section[data-content-section]')];const select=id=>{const next=id==='all'?'all':id;sections.forEach(section=>{section.hidden=next!=='all'&&section.id!==next});buttons.forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.filter===next))})};buttons.forEach(button=>button.addEventListener('click',()=>select(button.getAttribute('aria-pressed')==='true'&&button.dataset.filter!=='all'?'all':button.dataset.filter)));select('all')});</script>`;

const page = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>雲華 V2｜內容與平衡審閱</title>
<style>
:root{--paper:#f4efe6;--sheet:#fffdfa;--ink:#1f3345;--muted:#697787;--line:#e1d8cd;--head:#f8ece2;--accent:#91442e;--soft:#fff8f0;--muscle:#c93f43;--intelligence:#6157c4;--reaction:#19815c;--coordination:#b47614;--charm:#ae4785}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif}main{width:min(100%,1600px);margin:auto;padding:38px 28px 80px}h1{margin:0;color:#54291f;font-size:2.3rem;letter-spacing:.06em}h2{margin:62px 0 16px;padding-bottom:9px;border-bottom:3px solid var(--accent);color:#682e22;font-size:1.62rem}h3{margin:34px 0 10px;color:#7f3929;font-size:1.17rem}h4{margin:24px 0 8px;color:#714735;font-size:1rem}.subtitle,.lead,.section-note{margin:10px 0 18px;color:#5d6872}.lead{padding:12px 15px;border-left:4px solid #bd7751;background:var(--soft)}nav{display:flex;gap:7px;flex-wrap:wrap;margin:24px 0 5px}nav a{padding:6px 12px;border:1px solid #d9c7ba;border-radius:99px;background:#fffaf4;color:#783827;text-decoration:none}.table-wrap{width:100%;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--sheet);margin:0 0 20px}table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}th,td{padding:9px 10px;vertical-align:top;text-align:left;overflow-wrap:anywhere;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}th{background:var(--head);color:#723322;font-weight:800}td{background:var(--sheet)}.right,.number{text-align:right;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}.name,.route{font-weight:800;color:#28445d}.tier,.rarity{font-weight:800;color:#a04831}.secondary{color:#914c3a;font-weight:700}.formula{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#315c78}.total{font-weight:800;color:#16344e}.muscle{color:var(--muscle)}.intelligence{color:var(--intelligence)}.reaction{color:var(--reaction)}.coordination{color:var(--coordination)}.charm{color:var(--charm)}.coeff.zero{color:#aab4bd}.coeff.weak{color:#8c9aa5}.coeff.steady{color:#256eaa}.coeff.strong{color:#c05b21}.ability-cell{padding:0}.ability>div{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;padding:8px 10px;text-align:left}.ability>div+div{border-top:1px solid var(--line)}.ability b{color:#963d29}.category{margin:0 0 44px}.category>p{margin:0 0 12px;color:var(--muted)}.equipment th:nth-child(1){width:3.5%}.equipment th:nth-child(2){width:4.5%}.equipment th:nth-child(3){width:7.5%}.equipment th:nth-child(4){width:4.5%}.equipment th:nth-child(5){width:5.5%}.equipment th:nth-child(6){width:7.5%}.equipment th:nth-child(7),.equipment th:nth-child(8),.equipment th:nth-child(9),.equipment th:nth-child(10),.equipment th:nth-child(11){width:4%}.equipment th:nth-child(12){width:4.5%}.equipment th:nth-child(13){width:38%}.skill-table th:nth-child(1){width:8%}.skill-table th:nth-child(2){width:8%}.skill-table th:nth-child(3){width:8%}.skill-table th:nth-child(4){width:7%}.skill-table th:nth-child(5){width:10%}.skill-table th:nth-child(6){width:15%}.skill-table th:nth-child(7){width:8%}.skill-table th:nth-child(8){width:8%}.skill-table th:nth-child(9){width:28%}.delay{color:#336b91}.split{display:grid;grid-template-columns:minmax(0,3fr) minmax(220px,1fr);gap:22px}.compact th,.compact td{padding:9px 11px}.monster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}.monster-card{border:1px solid var(--line);border-radius:10px;background:var(--sheet);overflow:hidden}.monster-card header{padding:14px 15px 10px;background:#fff8f1}.monster-card h4{margin:8px 0 0;color:#5b3025;font-size:1.1rem}.monster-card header p{margin:3px 0 0;color:var(--muted)}.tag{display:inline-block;margin:0 4px 4px 0;padding:2px 7px;border:1px solid #d8c5b4;border-radius:99px;color:#7f3f2e;background:#fffdfa;font-size:.78rem;font-weight:800}.tag.tier-ii{color:#376a99}.monster-stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.monster-stats span{display:flex;justify-content:space-between;padding:6px 9px;border-right:1px solid var(--line)}.monster-stats span:nth-child(3n){border-right:0}.monster-stats b{color:#7b4938}.monster-stats em{font-style:normal;font-variant-numeric:tabular-nums}.monster-skills{padding:8px 12px}.monster-skill{padding:8px 0;border-bottom:1px solid var(--line)}.monster-skill:last-child{border-bottom:0}.monster-skill>div:first-child{display:flex;justify-content:space-between;gap:8px}.monster-skill>div:first-child span{color:var(--muted);font-size:.82rem;text-align:right}.monster-skill p{margin:4px 0 0}.monster-skill small{display:block;color:#8b796e}.monster-card footer{padding:9px 13px;border-top:1px solid var(--line);background:#fffdf9;color:#5e6871}.monster-card footer b{margin-right:6px;color:#884330}.items th:nth-child(1){width:8%}.items th:nth-child(2){width:11%}.items th:nth-child(3){width:13%}.items th:nth-child(4){width:27%}.items th:nth-child(5){width:18%}.items th:nth-child(6){width:23%}@media(max-width:1000px){main{padding:28px 14px 60px}.equipment th:nth-child(1){width:4%}.equipment th:nth-child(2){width:5%}.equipment th:nth-child(3){width:8%}.equipment th:nth-child(4){width:5%}.equipment th:nth-child(5){width:6%}.equipment th:nth-child(6){width:8%}.equipment th:nth-child(7),.equipment th:nth-child(8),.equipment th:nth-child(9),.equipment th:nth-child(10),.equipment th:nth-child(11){width:4%}.equipment th:nth-child(12){width:5%}.equipment th:nth-child(13){width:34%}.skill-table th:nth-child(1){width:8%}.skill-table th:nth-child(2){width:8%}.skill-table th:nth-child(3){width:8%}.skill-table th:nth-child(4){width:7%}.skill-table th:nth-child(5){width:9%}.skill-table th:nth-child(6){width:14%}.skill-table th:nth-child(7){width:8%}.skill-table th:nth-child(8){width:8%}.skill-table th:nth-child(9){width:30%}}@media(max-width:640px){body{font-size:13px}main{padding:22px 8px 44px}h1{font-size:1.75rem}h2{font-size:1.35rem;margin-top:45px}th,td{padding:7px 4px}.ability>div{grid-template-columns:34px minmax(0,1fr);gap:4px;padding:7px 5px}.split{grid-template-columns:1fr}.monster-grid{grid-template-columns:1fr}.monster-skill>div:first-child{display:block}.monster-skill>div:first-child span{display:block;text-align:left}.equipment th:nth-child(1){width:5%}.equipment th:nth-child(2){width:5%}.equipment th:nth-child(3){width:8%}.equipment th:nth-child(4){width:5%}.equipment th:nth-child(5){width:6%}.equipment th:nth-child(6){width:8%}.equipment th:nth-child(7),.equipment th:nth-child(8),.equipment th:nth-child(9),.equipment th:nth-child(10),.equipment th:nth-child(11){width:4.1%}.equipment th:nth-child(12){width:5%}.equipment th:nth-child(13){width:32.5%}}
</style></head><body><main><h1>雲華 V2｜內容與平衡審閱</h1><p class="subtitle">2026-08-06・第一版可玩內容的數值基準。這是內容平衡閱讀頁，不是 Runtime Definition JSON；正式資料仍應依資料契約拆檔。</p>${filterStyles}<nav class="filters" aria-label="內容篩選">${navigation}</nav>${renderBalance()}${renderEquipment()}${renderSkills()}${renderMonsters()}${renderItems()}${renderCrafting()}${renderMaps()}</main>${filterScript}</body></html>`;

writeFileSync(output, page.replace(/[ \t]+(?=\n)/g, ''), 'utf8');
console.log(`Written: ${output.pathname}`);
