// docs/03_content/shared/map_render.mjs
// 房間拓樸格圖的共用 SVG 渲染。四國共用同一份實作。
//
// 關鍵在 `walls`：牆只畫在「兩個**不同**房間之間」的邊界，同房間的相鄰格之間不畫線——多格房間因此
// 在視覺上自然合併，L／T／凹形都畫得出來。有連線的邊界則在中央留缺口（通道）或補一條紅線（紅門）。
// 舊的字元格渲染對**每一格**都描邊，等於宣告所有房間都是 1×1，違反 01_map_module.md §94（複審 R12 #3）。

import { parseMapCell, mapEdgeKey } from './map_model.mjs';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const mapMarkDefinitions = {
  treasure: { label: '寶箱偏好點', className: 'treasure' },
  event: { label: '事件偏好點', className: 'event' },
  large: { label: '大體型敵人偏好點', className: 'large' },
  trap: { label: '固定陷阱', className: 'trap' },
  resource: { label: '素材偏好／固定採集點', className: 'resource' },
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
        // `room.stair` 本身就是 '↑' 或 '↓'，直接畫。原本比對的是字串 'up'，而資料與驗證器用的是箭號，
        // 於是**每一座**樓梯都落到 else 分支被畫成 ↓——四國全圖 0 個 ↑（複審 R13 #3）。
        // 這個判斷是從雲華的舊 renderer 原樣抄過來的，抽共用時沒發現它一直是錯的。
        : room.stair ? `<text class="map-stair" x="${centerX}" y="${centerY + 8}">${esc(room.stair === 'up' ? '↑' : room.stair === 'down' ? '↓' : room.stair)}</text>` : '';
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

export { renderMapFloor, mapLegend, mapStyles };
