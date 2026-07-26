import { writeFileSync } from 'node:fs';
import { monsterSystem, yunhuaCulturalRoster, yunhuaHumanOccupierRoster } from './docs/03_content/yunhua/yunhua_monsters_v1.data.mjs';

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const rankClass = (rank) => ({ '一般':'normal', '菁英':'elite', 'BOSS':'boss' }[rank] || 'normal');
const statRow = (stats) => `
  <table class="stats" aria-label="六屬性">
    <thead><tr><th>生命</th><th>肌</th><th>智</th><th>反</th><th>協</th><th>魅</th></tr></thead>
    <tbody><tr><td>${stats.hp}</td><td>${stats.muscle}</td><td>${stats.intelligence}</td><td>${stats.reaction}</td><td>${stats.coordination}</td><td>${stats.charm}</td></tr></tbody>
  </table>`;
const skillsTable = (skills) => `
  <table class="skills">
    <colgroup><col class="skill-name"><col class="coeff"><col class="delay"><col class="effect"><col class="limit"></colgroup>
    <thead><tr><th>技能</th><th>係數</th><th>使用延遲</th><th>效果</th><th>限制</th></tr></thead>
    <tbody>${skills.map(item => `<tr>
      <td><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.type)}</span></td>
      <td>${escapeHtml(item.coefficient)}</td>
      <td>${escapeHtml(item.delay)}</td>
      <td>${escapeHtml(item.effect)}</td>
      <td>${escapeHtml(item.limit)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
const monsterCard = (item) => `<article class="monster-card ${rankClass(item.rank)}">
  <header>
    <span class="rank ${rankClass(item.rank)}">${escapeHtml(item.rank)}</span>
    <div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.kind)}｜${escapeHtml(item.size)}｜${escapeHtml(item.role)}</p></div>
    <span class="skill-count">${item.skills.length} 招</span>
  </header>
  ${statRow(item.stats)}
  ${skillsTable(item.skills)}
  <p class="drops"><b>產物</b>${escapeHtml(item.drops)}</p>
</article>`;
const rosterSection = (roster, human = false) => `<section class="roster ${human ? 'human' : ''}">
  <div class="section-heading"><div><h2>${escapeHtml(roster.culture ? `${roster.culture}｜非人類怪物池` : roster.title)}</h2><p>${escapeHtml(roster.description || roster.note)}</p></div></div>
  <div class="monster-grid">${roster.monsters.map(monsterCard).join('')}</div>
</section>`;

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(monsterSystem.title)}</title>
  <style>
    :root { --paper:#f5f1e9; --sheet:#fffdf9; --ink:#243442; --muted:#66737d; --line:#d9d0c5; --accent:#93462f; --normal:#61778a; --elite:#9c6c24; --large:#a3473c; --blue:#3d8fd0; --green:#35965d; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif; }
    main { width:min(100%, 1480px); margin:0 auto; padding:44px 28px 80px; }
    h1,h2,h3,p { margin:0; }
    h1 { color:#562d22; font-size:2rem; }
    h2 { color:#6b3326; font-size:1.35rem; }
    h3 { color:#243442; font-size:1.18rem; }
    .lead { color:var(--muted); margin-top:8px; }
    .overview { display:grid; grid-template-columns:minmax(300px, .95fr) minmax(360px, 1.05fr); gap:20px; margin:28px 0 10px; }
    .panel { border:1px solid var(--line); border-radius:10px; background:var(--sheet); overflow:hidden; }
    .panel h2 { padding:12px 16px; border-bottom:1px solid var(--line); background:#f8ede3; font-size:1rem; }
    .attribute-list { display:grid; grid-template-columns:repeat(3, 1fr); margin:0; }
    .attribute-list div { min-width:0; padding:10px 12px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
    .attribute-list div:nth-child(3n) { border-right:0; }
    .attribute-list div:nth-last-child(-n+3) { border-bottom:0; }
    .attribute-list dt { color:#803e2d; font-weight:700; }
    .attribute-list dd { margin:2px 0 0; color:var(--muted); font-size:.88rem; }
    .rule-list { margin:0; padding:10px 30px 12px; color:var(--ink); }
    .rule-list li { margin:4px 0; }
    .balance { display:grid; grid-template-columns:repeat(3, 1fr); margin:18px 0 46px; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--sheet); }
    .balance div { padding:12px 16px; border-right:1px solid var(--line); }
    .balance div:last-child { border-right:0; }
    .balance b { display:block; color:#803e2d; margin-bottom:3px; }
    .balance span { color:var(--muted); font-size:.92rem; }
    .roster { margin-top:48px; }
    .section-heading { display:flex; align-items:baseline; justify-content:space-between; gap:24px; padding-bottom:10px; border-bottom:3px solid var(--accent); margin-bottom:18px; }
    .section-heading p { max-width:780px; color:var(--muted); text-align:right; }
    .monster-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:20px; align-items:start; }
    .monster-card { min-width:0; border:1px solid var(--line); border-top:4px solid var(--normal); border-radius:10px; overflow:hidden; background:var(--sheet); }
    .monster-card.elite { border-top-color:var(--elite); }
    .monster-card.boss { border-top-color:var(--large); }
    .monster-card > header { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:start; gap:10px; padding:14px 14px 12px; }
    .monster-card header p { color:var(--muted); font-size:.9rem; margin-top:2px; }
    .rank,.skill-count { white-space:nowrap; font-size:.85rem; font-weight:700; }
    .rank { padding:3px 7px; border-radius:4px; color:#fff; background:var(--normal); }
    .rank.elite { background:var(--elite); }.rank.boss { background:var(--large); }
    .skill-count { color:var(--muted); padding-top:3px; }
    table { width:100%; border-spacing:0; table-layout:fixed; }
    th,td { border-top:1px solid var(--line); overflow-wrap:anywhere; vertical-align:top; }
    .stats th { padding:7px 10px 3px; color:#803e2d; font-weight:700; text-align:right; background:#f8ede3; }
    .stats td { padding:3px 10px 8px; color:#243442; text-align:right; font-variant-numeric:tabular-nums; }
    .stats th:not(:last-child),.stats td:not(:last-child) { border-right:1px solid var(--line); }
    .skills { margin-top:12px; }
    .skills th { padding:8px 10px; background:#f8ede3; color:#803e2d; font-weight:700; text-align:left; }
    .skills td { padding:9px 10px; text-align:left; }
    .skills th:not(:last-child),.skills td:not(:last-child) { border-right:1px solid var(--line); }
    .skills td:first-child strong { display:block; color:#243442; }
    .skills td:first-child span { display:block; color:var(--muted); font-size:.82rem; margin-top:2px; }
    .skills .skill-name { width:18%; }.skills .coeff { width:22%; }.skills .delay { width:20%; }.skills .effect { width:26%; }.skills .limit { width:14%; }
    .drops { padding:10px 14px 12px; color:var(--muted); }
    .drops b { color:#803e2d; margin-right:12px; }
    .human .section-heading { border-bottom-color:#456b8e; }
    @media (max-width:980px) { .overview,.monster-grid { grid-template-columns:1fr; }.section-heading { display:block; }.section-heading p { text-align:left; margin-top:4px; }.balance { grid-template-columns:1fr; }.balance div { border-right:0; border-bottom:1px solid var(--line); }.balance div:last-child { border-bottom:0; } }
    @media (max-width:620px) { main { padding:28px 14px 56px; }.attribute-list { grid-template-columns:repeat(2, 1fr); }.attribute-list div:nth-child(3n) { border-right:1px solid var(--line); }.attribute-list div:nth-child(2n) { border-right:0; }.attribute-list div:nth-last-child(-n+3) { border-bottom:1px solid var(--line); }.attribute-list div:nth-last-child(-n+2) { border-bottom:0; }.monster-card > header { grid-template-columns:auto minmax(0,1fr); }.skill-count { grid-column:2; padding-top:0; }.skills { font-size:.88rem; }.skills th,.skills td { padding:7px 6px; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(monsterSystem.title)}</h1>
    <p class="lead">${escapeHtml(monsterSystem.scope)}</p>
    <div class="overview">
      <section class="panel"><h2>六屬性</h2><dl class="attribute-list">${monsterSystem.stats.map(([name, detail]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(detail)}</dd></div>`).join('')}</dl></section>
      <section class="panel"><h2>編寫規則</h2><ul class="rule-list">${monsterSystem.rules.map(rule => `<li>${escapeHtml(rule)}</li>`).join('')}</ul></section>
    </div>
    <section class="balance">${monsterSystem.balance.map(([rank, detail]) => `<div><b>${escapeHtml(rank)}</b><span>${escapeHtml(detail)}</span></div>`).join('')}</section>
    ${rosterSection(yunhuaCulturalRoster)}
    ${rosterSection(yunhuaHumanOccupierRoster, true)}
  </main>
</body>
</html>`;

writeFileSync(new URL('./docs/03_content/yunhua/yunhua_monsters_v1.html', import.meta.url), html.replace(/[ \t]+(?=\n)/g, ''), 'utf8');
