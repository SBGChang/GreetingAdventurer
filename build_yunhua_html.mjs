import { readFileSync, writeFileSync } from 'node:fs';

const yunhuaDirectory = new URL('./docs/03_content/yunhua/', import.meta.url);
const source = readFileSync(new URL('yunhua_catalog_v1.md', yunhuaDirectory), 'utf8').split(/\r?\n/);
const attributes = ['肌', '智', '反', '協', '魅'];
const attributeClass = { 肌: 'str', 智: 'int', 反: 'ref', 協: 'coord', 魅: 'cha' };
const esc = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const rowFields = line => line.trim().split('|').slice(1, -1).map(value => value.trim());

const thresholdFor = stat => {
  if (/(物傷|魔傷|樂器傷害)/.test(stat)) return [1.20, 3.20];
  if (/(命中|迴避|預判|格擋：)/.test(stat)) return [0.20, 0.60];
  if (/(減傷|格擋吸收|魔減)/.test(stat)) return [0.08, 0.25];
  return [0.20, 0.60];
};

const colouredValue = (value, stat) => {
  const numeric = Number(value);
  if (!numeric) return '<span class="zero">0</span>';
  const [low, high] = thresholdFor(stat);
  const strength = numeric < low ? 'low' : numeric < high ? 'mid' : 'high';
  return `<span class="mult ${strength}">${numeric.toFixed(2)}</span>`;
};

const coefficientRows = value => value.split('；').map(part => {
  const [stat, formula = ''] = part.trim().split('：');
  const values = Object.fromEntries(attributes.map(attribute => [attribute, 0]));
  for (const match of formula.matchAll(/(肌|智|反|協|魅)(\d+(?:\.\d+)?)/g)) values[match[1]] = Number(match[2]);
  return { stat, values, total: attributes.reduce((sum, attribute) => sum + values[attribute], 0) };
});

const ability = (condition, effect, limit) => `
  <td class="ability">
    <div class="ability-row"><b>條件</b><span>${esc(condition)}</span></div>
    <div class="ability-row"><b>效果</b><span>${esc(effect)}</span></div>
    <div class="ability-row"><b>限制</b><span>${esc(limit)}</span></div>
  </td>`;

const htmlTable = (classes, colgroup, headings, body) => `
  <div class="table-wrap">
    <table class="data ${classes}">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${headings}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;

const equipmentTable = rows => {
  const headings = [
    '<th>品級</th>', '<th>名稱</th>', '<th>副屬性</th>',
    ...attributes.map(attribute => `<th class="numeric ${attributeClass[attribute]}">${attribute}</th>`),
    '<th class="numeric">Total</th>', '<th>能力</th>',
  ].join('');
  const body = rows.map(row => {
    const [grade, name, formula, condition, effect, limit] = row;
    const coefficients = coefficientRows(formula);
    return coefficients.map((entry, index) => {
      const shared = index === 0
        ? `<td rowspan="${coefficients.length}" class="grade">${esc(grade)}</td><td rowspan="${coefficients.length}" class="name">${esc(name)}</td>`
        : '';
      const values = attributes.map(attribute => `<td class="numeric value">${colouredValue(entry.values[attribute], entry.stat)}</td>`).join('');
      const rules = index === 0 ? ability(condition, effect, limit).replace('<td ', `<td rowspan="${coefficients.length}" `) : '';
      return `<tr>${shared}<td class="stat">${esc(entry.stat)}</td>${values}<td class="numeric total">${entry.total.toFixed(2)}</td>${rules}</tr>`;
    }).join('');
  }).join('');
  return htmlTable(
    'equipment',
    '<col class="c-grade"><col class="c-name"><col class="c-stat"><col class="c-number"><col class="c-number"><col class="c-number"><col class="c-number"><col class="c-number"><col class="c-total"><col class="c-ability">',
    headings,
    body,
  );
};

const actionTable = (headers, rows) => {
  const index = Object.fromEntries(headers.map((value, position) => [value, position]));
  const stageHeader = headers[0];
  const headings = [
    `<th>${esc(stageHeader)}</th>`, '<th>名稱</th>', '<th class="numeric">基礎</th>',
    ...attributes.map(attribute => `<th class="numeric ${attributeClass[attribute]}">${attribute}</th>`),
    '<th class="numeric">最低</th>', '<th>能力</th>',
  ].join('');
  const body = rows.map(row => {
    const basicCells = [
      `<td class="grade">${esc(row[index[stageHeader]])}</td>`,
      `<td class="name">${esc(row[index.名稱])}</td>`,
      `<td class="numeric">${esc(row[index.基礎])}</td>`,
      ...attributes.map(attribute => `<td class="numeric delay-value">${esc(row[index[attribute]])}</td>`),
      `<td class="numeric">${esc(row[index.最低])}</td>`,
    ].join('');
    return `<tr>${basicCells}${ability(row[index.條件], row[index.效果], row[index.限制])}</tr>`;
  }).join('');
  return htmlTable(
    'action',
    '<col class="a-stage"><col class="a-name"><col class="a-base"><col class="a-attribute"><col class="a-attribute"><col class="a-attribute"><col class="a-attribute"><col class="a-attribute"><col class="a-min"><col class="a-ability">',
    headings,
    body,
  );
};

const timedItemTable = (headers, rows) => {
  const index = Object.fromEntries(headers.map((value, position) => [value, position]));
  const headings = `<th>${esc(headers[0])}</th><th>名稱</th><th class="numeric">使用時間</th><th>能力</th>`;
  const body = rows.map(row => `<tr>
    <td class="grade">${esc(row[0])}</td>
    <td class="name">${esc(row[index.名稱])}</td>
    <td class="numeric time">${esc(row[index.使用時間])}</td>
    ${ability(row[index.條件], row[index.效果], row[index.限制])}
  </tr>`).join('');
  return htmlTable('timed-item', '<col class="t-stage"><col class="t-name"><col class="t-time"><col class="t-ability">', headings, body);
};

const normalTable = (headers, rows) => {
  const headings = headers.map(header => `<th>${esc(header)}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map((value, index) => `<td class="${index === 0 ? 'item-kind' : ''}">${esc(value)}</td>`).join('')}</tr>`).join('');
  const columns = headers.map((_, index) => `<col class="n-${index}">`).join('');
  return htmlTable(`ordinary ordinary-${headers.length}`, columns, headings, body);
};

const parseTable = start => {
  const headers = rowFields(source[start]);
  const rows = [];
  let cursor = start + 2;
  while (source[cursor]?.startsWith('|')) {
    rows.push(rowFields(source[cursor]));
    cursor += 1;
  }
  return { headers, rows, next: cursor };
};

let body = '';
for (let cursor = 0; cursor < source.length; cursor += 1) {
  const line = source[cursor];
  if (line.startsWith('# ')) body += `<h1>${esc(line.slice(2))}</h1>`;
  else if (line.startsWith('## ')) body += `<h2>${esc(line.slice(3))}</h2>`;
  else if (line.startsWith('### ')) body += `<h3>${esc(line.slice(4))}</h3>`;
  else if (line.startsWith('#### ')) body += `<h4>${esc(line.slice(5))}</h4>`;
  else if (line.startsWith('> ')) body += `<p class="note">${esc(line.slice(2))}</p>`;
  else if (line.startsWith('|') && source[cursor + 1]?.startsWith('|---')) {
    const table = parseTable(cursor);
    if (table.headers.includes('係數')) body += equipmentTable(table.rows);
    else if (table.headers.includes('基礎') && table.headers.includes('最低')) body += actionTable(table.headers, table.rows);
    else if (table.headers.includes('使用時間')) body += timedItemTable(table.headers, table.rows);
    else body += normalTable(table.headers, table.rows);
    cursor = table.next - 1;
  }
}

const page = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>雲華內容目錄｜重整版</title>
  <style>
    :root { --paper:#f5f1e9; --sheet:#fffdf9; --line:#e3dacf; --head:#f9eee5; --ink:#203246; --accent:#93462f; --muted:#7c8995; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif; }
    main { width:min(100%, 1360px); margin:0 auto; padding:44px 28px 80px; }
    h1 { margin:0 0 26px; font-size:2.25rem; letter-spacing:.04em; color:#51291f; }
    h2 { margin:54px 0 16px; padding:0 0 9px; border-bottom:3px solid var(--accent); font-size:1.55rem; color:#642f23; }
    h3 { margin:32px 0 10px; color:#823e2b; font-size:1.12rem; }
    h4 { margin:24px 0 8px; color:#74513a; font-size:1rem; }
    .note { margin:0 0 13px; padding:10px 14px; border-left:4px solid #bb7650; background:#fff8ef; color:#63564d; }
    .table-wrap { width:100%; margin:0 0 24px; overflow:hidden; border:1px solid var(--line); border-radius:10px; background:var(--sheet); }
    table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; }
    th, td { padding:10px 12px; vertical-align:top; text-align:left; overflow-wrap:anywhere; border-right:1px solid var(--line); border-bottom:1px solid var(--line); }
    th:last-child, td:last-child { border-right:0; }
    tbody tr:last-child td { border-bottom:0; }
    th { background:var(--head); color:#713321; font-weight:800; white-space:normal; }
    td { background:var(--sheet); }
    .numeric { text-align:right; white-space:nowrap; overflow-wrap:normal; font-variant-numeric:tabular-nums; }
    .grade, .item-kind { color:#a04831; font-weight:800; }
    .name { color:#263f57; }
    .stat { color:#94503e; font-weight:700; }
    .total { color:#172e45; font-weight:800; }
    .zero { color:#aab2b8; }
    .str { color:#c23b40; } .int { color:#6554bc; } .ref { color:#18875f; } .coord { color:#b87413; } .cha { color:#b64589; }
    .mult.low { color:#8e9aa5; } .mult.mid { color:#286da3; } .mult.high { color:#bf551e; }
    .delay-value { color:#2e719a; }
    .time { color:#2e719a; }
    .ability { padding:0; text-align:left; border-left:1px solid var(--line); }
    .ability-row { display:grid; grid-template-columns:44px minmax(0,1fr); gap:8px; padding:9px 11px; text-align:left; }
    .ability-row + .ability-row { border-top:1px solid var(--line); }
    .ability-row b { color:#963d2a; font-weight:800; }
    .equipment .c-grade { width:5%; } .equipment .c-name { width:8%; } .equipment .c-stat { width:8%; }
    .equipment .c-number { width:5.2%; } .equipment .c-total { width:5.6%; } .equipment .c-ability { width:47.4%; }
    .equipment td { padding:9px 10px; }
    .equipment .numeric { padding-right:12px; }
    .equipment .total, .equipment th:nth-child(9) { border-right:0; }
    .action .a-stage { width:7%; } .action .a-name { width:9%; } .action .a-base { width:5.5%; }
    .action .a-attribute { width:4.7%; } .action .a-min { width:5.5%; } .action .a-ability { width:49.5%; }
    .action td:nth-child(9), .action th:nth-child(9) { border-right:0; }
    .timed-item .t-stage { width:9%; } .timed-item .t-name { width:13%; } .timed-item .t-time { width:12%; } .timed-item .t-ability { width:66%; }
    .timed-item td:nth-child(3), .timed-item th:nth-child(3) { border-right:0; }
    .ordinary-4 .n-0 { width:14%; } .ordinary-4 .n-1 { width:21%; } .ordinary-4 .n-2 { width:30%; } .ordinary-4 .n-3 { width:35%; }
    .ordinary-5 .n-0 { width:10%; } .ordinary-5 .n-1 { width:15%; } .ordinary-5 .n-2 { width:20%; } .ordinary-5 .n-3 { width:20%; } .ordinary-5 .n-4 { width:35%; }
    @media (max-width:800px) {
      main { padding:28px 12px 56px; }
      body { font-size:14px; }
      th, td { padding:8px 6px; }
      .ability-row { grid-template-columns:38px minmax(0,1fr); gap:5px; padding:8px 6px; }
      .equipment .c-grade { width:7%; } .equipment .c-name { width:10%; } .equipment .c-stat { width:9%; }
      .equipment .c-number { width:5%; } .equipment .c-total { width:6%; } .equipment .c-ability { width:43%; }
      .action .a-stage { width:8%; } .action .a-name { width:10%; } .action .a-base { width:6%; }
      .action .a-attribute { width:4.8%; } .action .a-min { width:6%; } .action .a-ability { width:46%; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;

writeFileSync(new URL('yunhua_catalog_v1.html', yunhuaDirectory), page.replace(/[ \t]+(?=\n)/g, ''), 'utf8');
