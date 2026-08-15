import { writeFileSync } from 'node:fs';
import { renderMapFloor, mapLegend, mapStyles } from './docs/03_content/shared/map_render.mjs';
const cultureKey = process.argv[2] ?? 'vildun';
const {
  cultureMeta,
  balanceModel,
  equipmentCatalog,
  skillCatalog,
  monsterCatalog,
  itemCatalog,
  materialCatalog,
  craftingCatalog,
  firstMapConfigs,
  firstMapLayouts,
  validationSummary,
} = await import(`./docs/03_content/${cultureKey}/${cultureKey}_content.data.mjs`);

const output = new URL(`./docs/03_content/${cultureKey}/${cultureKey}_content.html`, import.meta.url);
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fixed = value => Number(value).toFixed(2);
const formatNumber = value => Number(value).toLocaleString('zh-Hant-TW', { maximumFractionDigits: 2 });
const table = (headers, rows, classes = '') => `<div class="table-wrap"><table class="${classes}"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const section = (id, title, content, note = '') => `<section id="${id}" data-content-section><h2>${esc(title)}</h2>${note ? `<p class="section-note">${esc(note)}</p>` : ''}${content}</section>`;
const ability = entry => `<div class="ability"><div><b>條件</b><span>${esc(entry.condition)}</span></div><div><b>效果</b><span>${esc(entry.effect)}</span></div><div><b>限制</b><span>${esc(entry.limit)}</span></div></div>`;

const renderBalance = () => {
  const formulaRows = balanceModel.formulas.map(([name, formula, note]) => [`<b class="name">${esc(name)}</b>`, `<span class="formula">${esc(formula)}</span>`, esc(note)]);
  const delayRows = Object.values(balanceModel.delayProfiles).map(profile => [`<b class="name">${esc(profile.label)}</b>`, `<span class="number">${profile.base}</span>`, esc(profile.reductions), `<span class="number">${profile.minimum}</span>`]);
  const statusRows = balanceModel.statusRules.map(([name, polarity, effect, duration, policy]) => [`<b class="name">${esc(name)}</b>`, esc(polarity), esc(effect), esc(duration), esc(policy)]);
  const controlRows = balanceModel.controlResistanceRules.map(([rank, multiplier, policy]) => [`<b class="name">${esc(rank)}</b>`, `<span class="number">${esc(multiplier)}</span>`, esc(policy)]);
  const countLabels = {
    equipmentLines: '裝備底模', equipmentItems: 'Tier 裝備', skills: '技能', nonHumanMonsters: '非人類怪物',
    humanEncounters: '人類 Encounter', maps: '探索地', floors: '地圖樓層', materials: '素材',
  };
  const validationRows = Object.entries(validationSummary.counts).map(([key, value]) => [`<b class="name">${esc(countLabels[key] ?? key)}</b>`, `<span class="number">${value}</span>`, '通過']);
  return section('balance', balanceModel.title, `
    <p class="lead">${esc(balanceModel.scope)}</p>
    ${table(['項目', '規則／公式', '平衡意圖'], formulaRows, 'balance-table')}
    <div class="split">
      <div><h3>行動延遲模板</h3>${table(['類型', '基礎', '主屬減免', '最低'], delayRows, 'compact')}</div>
      <div><h3>內容覆蓋驗證</h3>${table(['內容', '數量', '結果'], validationRows, 'compact')}</div>
    </div>
    <h3>第一版狀態規則</h3>${table(['狀態', '極性', '效果', '持續', '重疊規則'], statusRows, 'compact')}
    <h3>CTB 控制抗性</h3>${table(['威脅', '效果倍率', '限制'], controlRows, 'compact')}
  `);
};

const attributeMeta = {
  muscle: ['肌', 'muscle'], intelligence: ['智', 'intelligence'], reaction: ['反', 'reaction'], coordination: ['協', 'coordination'], charisma: ['魅', 'charm'],
};
const coefficientKeys = {
  physicalDamageMuscle: ['物理傷害', 'muscle'], physicalDamageCoordination: ['物理傷害', 'coordination'],
  magicDamageIntelligence: ['魔法傷害', 'intelligence'],
  instrumentDamageIntelligence: ['樂器傷害', 'intelligence'], instrumentDamageCoordination: ['樂器傷害', 'coordination'], instrumentDamageCharisma: ['樂器傷害', 'charisma'],
  hitReaction: ['命中', 'reaction'], hitCoordination: ['命中', 'coordination'],
  magicHitIntelligence: ['魔法命中', 'intelligence'], magicHitReaction: ['魔法命中', 'reaction'],
  evasionReaction: ['迴避', 'reaction'], evasionCoordination: ['迴避', 'coordination'],
  predictionIntelligence: ['預判', 'intelligence'], predictionReaction: ['預判', 'reaction'],
  blockReaction: ['格擋', 'reaction'], blockCoordination: ['格擋', 'coordination'],
  normalDrMuscle: ['一般減傷 raw', 'muscle'], magicDrIntelligence: ['魔法減傷 raw', 'intelligence'], blockAbsorbMuscle: ['格擋吸收 raw', 'muscle'],
};
const coefficientRows = item => {
  const rows = new Map();
  Object.entries(item.coefficients).forEach(([key, value]) => {
    const definition = coefficientKeys[key];
    if (!definition) throw new Error(`${item.name}：未知係數鍵 ${key}`);
    const [secondary, attribute] = definition;
    if (!rows.has(secondary)) rows.set(secondary, { muscle: 0, intelligence: 0, reaction: 0, coordination: 0, charisma: 0 });
    rows.get(secondary)[attribute] = value;
  });
  return [...rows].map(([secondary, values]) => ({ secondary, values }));
};
const coefficientClass = (secondary, value) => {
  if (!value) return 'zero';
  const score = Math.abs(Number(value));
  const thresholds = /傷害/.test(secondary) ? [0.7, 1.5] : /減傷|吸收/.test(secondary) ? [0.08, 0.18] : [0.18, 0.42];
  return score < thresholds[0] ? 'weak' : score < thresholds[1] ? 'steady' : 'strong';
};
const coefficient = (secondary, value) => `<span class="number coeff ${coefficientClass(secondary, value)}">${value ? fixed(value) : '0'}</span>`;

const renderEquipment = () => {
  const groups = equipmentCatalog.map(group => {
    const lines = group.lines.map(line => {
      const rows = line.flatMap(item => {
        const coefficients = coefficientRows(item);
        return coefficients.map((entry, index) => {
          const common = index === 0 ? `<td rowspan="${coefficients.length}" class="tier">${esc(item.tier)}</td><td rowspan="${coefficients.length}" class="rarity">${esc(item.rarity)}</td><td rowspan="${coefficients.length}" class="name">${esc(item.name)}</td><td rowspan="${coefficients.length}" class="number">${formatNumber(item.weight)}</td><td rowspan="${coefficients.length}" class="number">${formatNumber(item.value)}</td>` : '';
          const values = Object.entries(attributeMeta).map(([key, [, className]]) => `<td class="number ${className}">${coefficient(entry.secondary, entry.values[key])}</td>`).join('');
          const total = Object.values(entry.values).reduce((sum, value) => sum + value, 0);
          const abilityCell = index === 0 ? `<td rowspan="${coefficients.length}" class="ability-cell">${ability(item.ability)}</td>` : '';
          return [common, `<td class="secondary">${esc(entry.secondary)}</td>`, values, `<td class="number total">${fixed(total)}</td>`, abilityCell].join('');
        });
      });
      return `<h4>${esc(line[0].requirement)}</h4><div class="table-wrap"><table class="equipment"><thead><tr><th>Tier</th><th>品級</th><th>名稱</th><th class="right">重量</th><th class="right">價值</th><th>副屬性</th>${Object.values(attributeMeta).map(([label, className]) => `<th class="right ${className}">${label}</th>`).join('')}<th class="right">Total</th><th>能力</th></tr></thead><tbody>${rows.map(row => `<tr>${row}</tr>`).join('')}</tbody></table></div>`;
    }).join('');
    return `<article class="category"><h3>${esc(group.title)}</h3><p>每一格是獨立 Equipment Definition；同路線依 Tier 提升白板係數、價值與具名能力。</p>${lines}</article>`;
  }).join('');
  return section('equipment', '裝備與防具｜實際係數', groups, '每一列都是副屬性的五主屬係數；Total 是該副屬性的係數合計，不是直接加到角色面板。灰＝低、藍＝中、橙＝高。');
};

const renderSkills = () => {
  const routes = skillCatalog.map(route => {
    const rows = route.rows.map(skill => [
      `<b class="name">${esc(skill.name)}</b>`, esc(skill.stage), esc(skill.type), esc(skill.requirement),
      `<span class="delay">${esc(skill.delay.label)}｜基礎 ${skill.delay.base}｜${esc(skill.delay.reductions)}｜最低 ${skill.delay.minimum}</span>`,
      `<span class="number">${esc(skill.power)}</span>`, `<span class="number">${esc(skill.experience)}</span>`,
      ability({ condition: skill.actionKind === 'guard' ? '自身／守勢合法條件。' : skill.actionKind === 'cast' ? '法杖與合法目標。' : skill.actionKind === 'perform' ? '樂器與合法目標。' : '技能指定的合法目標。', effect: skill.effect, limit: skill.limit }),
    ]);
    return `<h4>${esc(route.route)}</h4>${table(['名稱', '取得', '種類', '需求', '使用延遲', '威力／效果', 'MXP', '能力'], rows, 'skill-table')}`;
  }).join('');
  return section('skills', '技能、魔法與延遲', `<article class="category"><h3>武技、盾技、文化技藝與魔法</h3><p>每條路線固定五招；無普通攻擊、主動位移、推拉或擊退。</p>${routes}</article>`, '所有招式共用同一組延遲模板；無傷害增益、減益與治療使用固定支援 MXP。');
};

const statLabels = { health: 'HP', muscle: '肌', intelligence: '智', reaction: '反', coordination: '協', charisma: '魅' };
const renderMonster = monster => {
  const stats = Object.entries(monster.stats).map(([key, value]) => `<span><b>${statLabels[key]}</b><em>${formatNumber(value)}</em></span>`).join('');
  const skills = monster.skills.map(skill => `<div class="monster-skill"><div><b>${esc(skill.name)}</b><span>${esc(skill.delay)}｜${skill.multiplier === null ? '無傷害' : `${esc(skill.channel)} ×${fixed(skill.multiplier)}`}</span></div><p>${esc(skill.effect)}</p></div>`).join('');
  return `<article class="monster-card"><header><span class="tag tier-${monster.tier.toLowerCase()}">Tier ${esc(monster.tier)}</span><span class="tag">${esc(monster.threat)}</span><span class="tag">${esc(monster.size)}</span><h4>${esc(monster.name)}</h4><p>${esc(monster.role)}</p></header><div class="monster-stats">${stats}</div><div class="monster-skills">${skills}</div><footer><b>自然攻擊</b>物 ${fixed(monster.attackProfile.physicalBase)}／魔 ${fixed(monster.attackProfile.magicBase)}／命中 ${fixed(monster.attackProfile.hitScore)}<br><b>掉落</b>${esc(monster.drops)}</footer></article>`;
};
const renderMonsters = () => section('monsters', '怪物｜六維與技能數值', `
  <article class="category"><h3>非人類怪物（文化綁定）</h3><p>不論被誰占領，非人類怪物與素材仍使用${esc(cultureMeta.name)}文化池；Boss 一律大型 3×3。</p><div class="monster-grid">${monsterCatalog.nonHuman.map(renderMonster).join('')}</div></article>
  <article class="category"><h3>${esc(cultureMeta.name)}人類 Encounter（占領國可替換）</h3><p>人類敵人才依目前占領國切換文化池；此處是${esc(cultureMeta.name)}控制時的候選。</p>${table(['Tier', '威脅', '名稱', '成員', '定位', '掉落'], monsterCatalog.humanEncounters.map(entry => [esc(entry.tier), esc(entry.threat), `<b class="name">${esc(entry.name)}</b><small>${esc(entry.id)}</small>`, esc(entry.members), esc(entry.role), esc(entry.drops)]), 'compact')}</article>
`);

const renderItems = () => section('items', '道具、一般物品與內容經濟', `
  <h3>戰鬥消耗品</h3>${table(['Tier', '名稱', '重量／價值', '使用延遲', '效果', '來源與限制'], itemCatalog.combat.map(row => row.map(esc)), 'compact items')}
  <h3>非戰鬥消耗品</h3>${table(['名稱', '規格', '使用', '效果', '限制'], itemCatalog.nonCombat.map(row => row.map(esc)), 'compact')}
  <h3>一般物品（不使用道具）</h3>${itemCatalog.general.map(group => `<h4>${esc(group.title)}</h4>${table(['名稱', '級別', '重量', '價值', '用途'], group.rows.map(row => row.map(esc)), 'compact')}`).join('')}
`, '消耗品有實際使用延遲或合法 Workflow；一般物品不直接使用，但會進入探索、送貨、購買與城市永久庫存。');

const renderCrafting = () => section('crafting', '素材、製作、料理與書籍', `
  <h3>素材與文化詞條</h3>${table(['名稱', '級別', '固定詞條方向', '主要用途'], materialCatalog.map(row => row.map(esc)), 'compact')}
  <h3>裝備配方覆蓋</h3>${table(['Tier', '配方數', '每筆 Ingredient Slot', '產出規則'], ['I', 'II'].map(tier => {
    const recipes = craftingCatalog.equipmentRecipes.filter(recipe => recipe.tier === tier);
    return [esc(tier), `<span class="number">${recipes.length}</span>`, `<span class="number">${recipes[0].ingredientSlots}</span>`, tier === 'I' ? '一般品級／一份素材' : '精品品級／兩份素材'];
  }), 'compact')}
  <h3>料理與餐館</h3>${table(['料理', '規格', '食材方向', 'FoodStatus', '餐館／來源'], craftingCatalog.cuisine.map(row => row.map(esc)), 'compact')}
  <h3>技能書與製作書</h3>${table(['書籍層級', 'Mastery 門檻', '取得', '內容'], craftingCatalog.books.map(row => row.map(esc)), 'compact')}
`, '裝備品級與製作品質分離；消耗品沒有品質前綴，料理直接形成 FoodStatus。');

const renderMaps = () => section('maps', '第一版三張探索地｜配置與素材權重', `
  <p class="lead">怪物不依地圖偏好種類：非人類一律從${esc(cultureMeta.name)}文化池選取，人類則讀取目前占領國文化池。地圖只定義地形、固定空間、陷阱與素材權重。</p>
  ${mapStyles}<h3>格圖配置</h3><p class="section-note">黑色為不存在地塊；相鄰白格沒有內線時視為同一房間。白色缺口是通道，紅線是紅門。每個紅門、素材偏好點與其他固定內容皆已直接畫在圖上。</p>${mapLegend}
  ${firstMapLayouts.map(layout => `<article class="map-layout"><header><h3>${esc(layout.name)}</h3><p>${esc(layout.city)}・${esc(layout.type)}</p></header><div class="map-layout-grid">${layout.floors.map(renderMapFloor).join('')}</div></article>`).join('')}
  <h3>地圖資料設定</h3>${table(['地圖', '對應城市', 'Tier', '類型', '版型', '出入口', '固定配置'], firstMapConfigs.map(map => [esc(map.name), esc(map.city), esc(map.tier), esc(map.kind), esc(map.layout), '1 個正式入口／1 個正式出口', '格圖所示固定空間與內容偏好']), 'compact')}
  <p class="section-note">採集點與寶箱分池，各池權重分別合計 100；怪物素材只由 Monster Definition 的掉落資料決定。</p>
  ${firstMapConfigs.map(map => `<h3>${esc(map.name)}｜素材配置比重</h3>${Object.entries(map.materialPools).map(([kind, rows]) => `<h4>${kind === 'gathering' ? '採集點' : '寶箱'}</h4>${table(['素材', '權重'], rows.map(([name, weight]) => [esc(name), `<span class="number">${weight}</span>`]), 'compact')}`).join('')}`).join('')}
`);

const navigation = [['all', '全部'], ['balance', '平衡基準'], ['equipment', '裝備'], ['skills', '技能'], ['monsters', '怪物'], ['items', '道具'], ['crafting', '製作'], ['maps', '地圖']]
  .map(([id, label]) => `<button type="button" class="filter-button" data-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('');
const filterStyles = '<style>nav.filters{display:flex;gap:7px;flex-wrap:wrap;margin:24px 0 5px}nav.filters .filter-button{appearance:none;padding:6px 12px;border:1px solid #d9c7ba;border-radius:99px;background:#fffaf4;color:#783827;font:inherit;cursor:pointer}nav.filters .filter-button[aria-pressed="true"]{border-color:#91442e;background:#91442e;color:#fff}section[data-content-section][hidden]{display:none}</style>';
const filterScript = `<script>document.addEventListener('DOMContentLoaded',()=>{const buttons=[...document.querySelectorAll('[data-filter]')];const sections=[...document.querySelectorAll('section[data-content-section]')];const select=id=>{const next=id==='all'?'all':id;sections.forEach(section=>{section.hidden=next!=='all'&&section.id!==next});buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===next)))};buttons.forEach(button=>button.addEventListener('click',()=>select(button.getAttribute('aria-pressed')==='true'&&button.dataset.filter!=='all'?'all':button.dataset.filter)));select('all')});</script>`;

const page = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(cultureMeta.name)}｜內容與平衡審閱</title>
<style>
:root{--paper:#f4efe6;--sheet:#fffdfa;--ink:#1f3345;--muted:#697787;--line:#e1d8cd;--head:#f8ece2;--accent:#91442e;--soft:#fff8f0;--muscle:#c93f43;--intelligence:#6157c4;--reaction:#19815c;--coordination:#b47614;--charm:#ae4785;--map-void:#1e2530;--map-room:#fffdfa;--map-wall:#263544;--map-entry:#b9dcfb;--map-exit:#f4b9b5;--map-treasure:#d89612;--map-event:#277fb4;--map-large:#2b9367;--map-trap:#c33c3b;--map-resource:#168f8b}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif}main{width:min(100%,1600px);margin:auto;padding:38px 28px 80px}h1{margin:0;color:#54291f;font-size:2.3rem;letter-spacing:.06em}h2{margin:62px 0 16px;padding-bottom:9px;border-bottom:3px solid var(--accent);color:#682e22;font-size:1.62rem}h3{margin:34px 0 10px;color:#7f3929;font-size:1.17rem}h4{margin:24px 0 8px;color:#714735;font-size:1rem}.subtitle,.lead,.section-note{margin:10px 0 18px;color:#5d6872}.lead{padding:12px 15px;border-left:4px solid #bd7751;background:var(--soft)}.table-wrap{width:100%;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--sheet);margin:0 0 20px}table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}th,td{padding:9px 10px;vertical-align:top;text-align:left;overflow-wrap:anywhere;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}th{background:var(--head);color:#723322;font-weight:800}td{background:var(--sheet)}.right,.number{text-align:right;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums}.name{font-weight:800;color:#28445d}.tier,.rarity{font-weight:800;color:#a04831}.secondary{color:#914c3a;font-weight:700}.formula{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#315c78}.total{font-weight:800;color:#16344e}.muscle{color:var(--muscle)}.intelligence{color:var(--intelligence)}.reaction{color:var(--reaction)}.coordination{color:var(--coordination)}.charm{color:var(--charm)}.coeff.zero{color:#aab4bd}.coeff.weak{color:#8c9aa5}.coeff.steady{color:#256eaa}.coeff.strong{color:#c05b21}.ability-cell{padding:0}.ability>div{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;padding:8px 10px;text-align:left}.ability>div+div{border-top:1px solid var(--line)}.ability b{color:#963d29}.category{margin:0 0 44px}.category>p{margin:0 0 12px;color:var(--muted)}.equipment th:nth-child(1){width:3.5%}.equipment th:nth-child(2){width:4.5%}.equipment th:nth-child(3){width:7.5%}.equipment th:nth-child(4){width:4.5%}.equipment th:nth-child(5){width:5.5%}.equipment th:nth-child(6){width:7.5%}.equipment th:nth-child(n+7):nth-child(-n+11){width:4%}.equipment th:nth-child(12){width:4.5%}.equipment th:nth-child(13){width:38%}.skill-table th:nth-child(1){width:11%}.skill-table th:nth-child(2){width:10%}.skill-table th:nth-child(3){width:9%}.skill-table th:nth-child(4){width:12%}.skill-table th:nth-child(5){width:17%}.skill-table th:nth-child(6){width:9%}.skill-table th:nth-child(7){width:9%}.skill-table th:nth-child(8){width:23%}.delay{color:#336b91}.split{display:grid;grid-template-columns:minmax(0,3fr) minmax(220px,1fr);gap:22px}.compact th,.compact td{padding:9px 11px}.monster-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}.monster-card{border:1px solid var(--line);border-radius:10px;background:var(--sheet);overflow:hidden}.monster-card header{padding:14px 15px 10px;background:#fff8f1}.monster-card h4{margin:8px 0 0;color:#5b3025;font-size:1.1rem}.monster-card header p{margin:3px 0 0;color:var(--muted)}.tag{display:inline-block;margin:0 4px 4px 0;padding:2px 7px;border:1px solid #d8c5b4;border-radius:99px;color:#7f3f2e;background:#fffdfa;font-size:.78rem;font-weight:800}.tag.tier-ii{color:#376a99}.monster-stats{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.monster-stats span{display:flex;justify-content:space-between;padding:6px 9px;border-right:1px solid var(--line)}.monster-stats span:nth-child(3n){border-right:0}.monster-stats b{color:#7b4938}.monster-stats em{font-style:normal;font-variant-numeric:tabular-nums}.monster-skills{padding:8px 12px}.monster-skill{padding:8px 0;border-bottom:1px solid var(--line)}.monster-skill:last-child{border-bottom:0}.monster-skill>div:first-child{display:flex;justify-content:space-between;gap:8px}.monster-skill>div:first-child span{color:var(--muted);font-size:.82rem;text-align:right}.monster-skill p{margin:4px 0 0}.monster-card footer{padding:9px 13px;border-top:1px solid var(--line);background:#fffdf9;color:#5e6871}.monster-card footer b{margin-right:6px;color:#884330}.map-layout{margin:0 0 42px;padding:18px;border:1px solid var(--line);border-radius:12px;background:#fffaf4}.map-layout>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.map-layout>header h3{margin:0;color:#713121}.map-layout>header p{margin:0;color:var(--muted)}.map-layout-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px;margin-top:16px}.map-floor{margin:0;padding:12px;border:1px solid #dfd3c6;border-radius:9px;background:var(--sheet)}.map-floor h4{margin:0 0 8px}.map-floor p{min-height:3.1em;margin:9px 0 0;color:#66717b;font-size:.88rem}.map-svg{display:block;width:100%;max-width:400px;height:auto;margin:auto;border:1px solid #1e2530;background:var(--map-void)}.map-special,.map-stair{text-anchor:middle;font-weight:900;paint-order:stroke;stroke:#fffdfa;stroke-width:3px;stroke-linejoin:round}.map-special{fill:#25445b;font-size:17px}.map-stair{fill:#343f49;font-size:25px}.map-marker{stroke-width:2.4px;vector-effect:non-scaling-stroke}.map-marker-treasure{fill:#fff1a5;stroke:var(--map-treasure)}.map-marker-event{fill:#c9edff;stroke:var(--map-event)}.map-marker-large{fill:#c8f1db;stroke:var(--map-large)}.map-marker-trap{fill:#ffd1d0;stroke:var(--map-trap)}.map-marker-resource{fill:#bdeeed;stroke:var(--map-resource)}.map-legend{display:flex;gap:8px 14px;flex-wrap:wrap;margin:12px 0 20px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--sheet);color:#4f5c67;font-size:.9rem}.map-legend span{display:flex;align-items:center;gap:5px}.legend-tile{display:inline-block;width:15px;height:15px;border:1px solid #526170}.legend-tile.entry{background:var(--map-entry)}.legend-tile.exit{background:var(--map-exit)}.legend-stair{width:20px;color:#334452;font-weight:900;text-align:center}.legend-marker{display:inline-block;width:12px;height:12px;border:2px solid;border-radius:50%}.legend-marker.treasure{background:#fff1a5;border-color:var(--map-treasure)}.legend-marker.event{background:#c9edff;border-color:var(--map-event)}.legend-marker.large{background:#c8f1db;border-color:var(--map-large)}.legend-marker.trap{background:#ffd1d0;border-color:var(--map-trap)}.legend-marker.resource{background:#bdeeed;border-color:var(--map-resource);border-radius:1px;transform:rotate(45deg)}@media(max-width:1000px){main{padding:28px 14px 60px}.equipment th:nth-child(13){width:34%}}@media(max-width:640px){body{font-size:13px}main{padding:22px 8px 44px}h1{font-size:1.75rem}h2{font-size:1.35rem;margin-top:45px}th,td{padding:7px 4px}.ability>div{grid-template-columns:34px minmax(0,1fr);gap:4px;padding:7px 5px}.split{grid-template-columns:1fr}.monster-grid{grid-template-columns:1fr}.monster-skill>div:first-child{display:block}.monster-skill>div:first-child span{display:block;text-align:left}.map-layout{padding:10px}.map-layout-grid{grid-template-columns:1fr;gap:10px}.map-floor{padding:8px}.map-floor p{min-height:0}.equipment th:nth-child(13){width:32.5%}}
</style></head><body><main><h1>${esc(cultureMeta.name)}｜內容與平衡審閱</h1><p class="subtitle">${esc(cultureMeta.version)}・第一版可玩內容的數值基準。這是內容平衡閱讀頁，不是 Runtime Definition JSON；正式資料仍應依資料契約拆檔。</p>${filterStyles}<nav class="filters" aria-label="內容篩選">${navigation}</nav>${renderBalance()}${renderEquipment()}${renderSkills()}${renderMonsters()}${renderItems()}${renderCrafting()}${renderMaps()}</main>${filterScript}</body></html>`;

writeFileSync(output, page.replace(/[ \t]+(?=\n)/g, ''), 'utf8');
console.log(`Written: ${output.pathname}`);
