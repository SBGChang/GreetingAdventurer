// docs/03_content/shared/map_model.mjs
// 地圖版型的共用資料模型與驗證器。
//
// 為什麼不是字元格：字元格一格一個符號，表達不出 01_map_module.md §94 的「房間可為 L、T、凹形等多格
// 形狀；合併房間是一個移動節點」，也表達不出通道與紅門（§95、GDD §158：格與格之間必須有通道或紅門才能
// 通行）。用字元格畫出來的圖，每一格都有完整邊框＝所有房間都是 1×1，違反既定地圖規則。
//
// 正確模型（與雲華一致）：一層 = 房間清單 + 連線清單。
//   * 房間擁有一組格座標，形狀任意（L/T/凹皆可），是**一個**移動節點與**一個**內容槽。
//   * 連線是房間之間的通行關係：`open`＝通道，`door`＝紅門。沒有連線就不可通行。
//   * 牆只畫在「不同房間之間」的邊界上——同房間的相鄰格之間沒有內線，視覺上自然合併成多格房間。
//
// 這裡不放渲染，只放模型與驗證；渲染在各文化的 build_*.mjs（共用同一份 renderMapFloor）。

// 獨立於 content_factory：後者 import 雲華資料，雲華若再 import 回來會形成循環。
// 這支不 import 任何內容檔，因此四個文化都能安全引用。

export const mapCell = (row, column) => `${row},${column}`;

export const mapRect = (rowStart, columnStart, rowEnd, columnEnd) => {
  const cells = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) cells.push(mapCell(row, column));
  }
  return cells;
};

export const mapRoom = (id, cells, options = {}) => ({ id, cells, marks: [], ...options });
export const mapConnection = (from, to, fromCell, toCell, type = 'open') => ({ from, to, fromCell, toCell, type });
export const mapFloor = (label, rows, columns, rooms, connections, note) => ({ label, rows, columns, rooms, connections, note });

export const parseMapCell = cell => cell.split(',').map(Number);
export const mapEdgeKey = (a, b) => [a, b].sort().join('|');

// ── 驗證器 ──────────────────────────────────────────────────────────────────
//
// 對應 docs/00_core/architecture/01_map_module.md §94–101：
//   §97  上下樓梯使用相同的列、行座標。
//   §98  入口、出口、樓梯與固定陷阱皆是互斥的 1×1 功能房間，且不得成為內容生成位置。
//   §99  大型敵人偏好房間至少 2×2；事件偏好房間至少由兩格構成。
//   §96  每扇紅門至少一側房間應具有寶箱、事件或大型體型敵人的內容偏好。
//   §101 採集點占用房間唯一內容槽：同房間不得再有其他內容偏好。
//   §95  通道與紅門只可連接合法房間；無連結的房間不可通行。

const FUNCTIONAL = ['entry', 'exit', 'stair', 'trap'];

// 封閉值域。開放字串會被 Renderer 靜默誤解：未知 mark 讓它去查不存在的標記定義（可能直接拋錯），
// 未知連線種類會被當成「有缺口但不是紅門」的通道，等於把資料語意悄悄改寫（複審 R14 #4）。
export const MAP_MARKS = ['treasure', 'event', 'large', 'trap', 'resource'];
export const MAP_CONNECTION_TYPES = ['open', 'door'];
export const MAP_STAIR_DIRECTIONS = ['↑', '↓'];

// 房間身上有哪些互斥功能（trap 以 marks 表示，其餘是旗標）。
const functionsOf = room => {
  const found = [];
  if (room.entry) found.push('entry');
  if (room.exit) found.push('exit');
  if (room.stair) found.push('stair');
  if (room.marks.includes('trap')) found.push('trap');
  return found;
};

const boundingBox = cells => {
  const coords = cells.map(parseMapCell);
  const rows = coords.map(([row]) => row);
  const columns = coords.map(([, column]) => column);
  return {
    height: Math.max(...rows) - Math.min(...rows) + 1,
    width: Math.max(...columns) - Math.min(...columns) + 1,
  };
};

const areAdjacent = (a, b) => {
  const [rowA, columnA] = parseMapCell(a);
  const [rowB, columnB] = parseMapCell(b);
  return Math.abs(rowA - rowB) + Math.abs(columnA - columnB) === 1;
};

// 單層檢查。
// 房間自身必須是**一塊相連的區域**。房間＝一個移動節點（§94），格與格之間零成本；若把兩塊互不相鄰的
// 區域寫成同一個房間，等於在地圖兩端開了一條免費傳送（複審 R13 #5）。
const isContiguous = cells => {
  if (cells.length <= 1) return true;
  const remaining = new Set(cells);
  const start = cells[0];
  remaining.delete(start);
  const queue = [start];
  while (queue.length > 0) {
    const [row, column] = parseMapCell(queue.shift());
    for (const [rowDelta, columnDelta] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const neighbour = mapCell(row + rowDelta, column + columnDelta);
      if (remaining.has(neighbour)) { remaining.delete(neighbour); queue.push(neighbour); }
    }
  }
  return remaining.size === 0;
};

const validateFloor = (floor, layoutName, errors) => {
  const where = `${layoutName}／${floor.label}`;
  const owner = new Map();

  // 房間 ID 必須唯一：連線是用 id 指名的，重複 id 會讓 `roomById` 只留下最後一筆，
  // 前面同名房間的連線全部悄悄接到錯的房間上。
  const seenIds = new Set();
  floor.rooms.forEach(room => {
    if (seenIds.has(room.id)) errors.push(`${where}：房間 ID「${room.id}」重複`);
    seenIds.add(room.id);
  });

  floor.rooms.forEach(room => {
    if (room.cells.length === 0) errors.push(`${where}：房間「${room.id}」沒有任何格`);
    if (new Set(room.cells).size !== room.cells.length) errors.push(`${where}：房間「${room.id}」有重複的格`);
    if (!isContiguous(room.cells)) {
      errors.push(`${where}：房間「${room.id}」的格並非相連的一塊（§94：一個房間是一個移動節點）`);
    }
    room.cells.forEach(cell => {
      const [row, column] = parseMapCell(cell);
      if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || column < 1 || row > floor.rows || column > floor.columns) {
        errors.push(`${where}：房間「${room.id}」的格 (${cell}) 超出 ${floor.rows}×${floor.columns} 範圍`);
      }
      if (owner.has(cell)) errors.push(`${where}：格 (${cell}) 同時屬於「${owner.get(cell)}」與「${room.id}」`);
      owner.set(cell, room.id);
    });

    // 封閉值域：未知的 mark / 樓梯方向不得通過。
    room.marks.forEach(mark => {
      if (!MAP_MARKS.includes(mark)) {
        errors.push(`${where}：房間「${room.id}」的 mark「${String(mark)}」不是合法值（${MAP_MARKS.join('／')}）`);
      }
    });
    if (room.stair !== undefined && !MAP_STAIR_DIRECTIONS.includes(room.stair)) {
      errors.push(`${where}：房間「${room.id}」的 stair「${String(room.stair)}」不是合法值（↑／↓）`);
    }
    // anchor 只是圖示對齊點，但必須真的落在這個房間裡——否則符號會被畫到別的房間或圖外。
    if (room.anchor !== undefined && !room.cells.includes(room.anchor)) {
      errors.push(`${where}：房間「${room.id}」的 anchor (${room.anchor}) 不屬於該房間的格`);
    }

    // §98：互斥的 1×1 功能房間，且不得是內容生成位置。
    const functions = functionsOf(room);
    if (functions.length > 1) {
      errors.push(`${where}：房間「${room.id}」同時是 ${functions.join('／')}，功能房間必須互斥（§98）`);
    }
    if (functions.length === 1) {
      if (room.cells.length !== 1) {
        errors.push(`${where}：功能房間「${room.id}」（${functions[0]}）占 ${room.cells.length} 格，必須為 1×1（§98）`);
      }
      const contentMarks = room.marks.filter(mark => mark !== 'trap');
      if (contentMarks.length > 0) {
        errors.push(`${where}：功能房間「${room.id}」不得帶內容偏好（${contentMarks.join('／')}，§98）`);
      }
    }

    // §99：大型敵人偏好房間至少 2×2；事件偏好房間至少 2 格。
    if (room.marks.includes('large')) {
      const { height, width } = boundingBox(room.cells);
      if (height < 2 || width < 2) {
        errors.push(`${where}：大型敵人偏好房間「${room.id}」為 ${height}×${width}，長寬皆須至少 2 格（§99）`);
      }
    }
    if (room.marks.includes('event') && room.cells.length < 2) {
      errors.push(`${where}：事件偏好房間「${room.id}」只有 1 格，至少須由 2 格構成（§99）`);
    }

    // §101：採集點占用唯一內容槽。
    if (room.marks.includes('resource')) {
      const others = room.marks.filter(mark => mark !== 'resource' && mark !== 'trap');
      if (others.length > 0) {
        errors.push(`${where}：採集點房間「${room.id}」不得再有其他內容偏好（${others.join('／')}，§101）`);
      }
    }
  });

  // 連線：兩端房間存在、端點格屬於該房間、且兩格正交相鄰。
  const roomById = new Map(floor.rooms.map(room => [room.id, room]));
  floor.connections.forEach(connection => {
    const from = roomById.get(connection.from);
    const to = roomById.get(connection.to);
    if (from === undefined || to === undefined) {
      errors.push(`${where}：連線 ${connection.from}→${connection.to} 指向不存在的房間`);
      return;
    }
    if (!from.cells.includes(connection.fromCell)) errors.push(`${where}：連線端點 (${connection.fromCell}) 不屬於「${connection.from}」`);
    if (!to.cells.includes(connection.toCell)) errors.push(`${where}：連線端點 (${connection.toCell}) 不屬於「${connection.to}」`);
    if (!MAP_CONNECTION_TYPES.includes(connection.type)) {
      errors.push(
        `${where}：連線 ${connection.from}→${connection.to} 的 type「${String(connection.type)}」不是合法值（open／door）`,
      );
    }
    if (!areAdjacent(connection.fromCell, connection.toCell)) {
      errors.push(`${where}：連線 ${connection.from}→${connection.to} 的兩端 (${connection.fromCell})(${connection.toCell}) 並非正交相鄰`);
    }
    // §96：每扇紅門至少一側房間具有寶箱／事件／大型敵人偏好。
    if (connection.type === 'door') {
      const guarded = [...from.marks, ...to.marks].some(mark => ['treasure', 'event', 'large'].includes(mark));
      if (!guarded) errors.push(`${where}：紅門 ${connection.from}→${connection.to} 兩側都沒有寶箱／事件／大型敵人偏好（§96）`);
    }
  });

  // §95：無連結的房間不可通行——全層必須連通（樓層之間才靠樓梯）。
  if (floor.rooms.length > 0) {
    const adjacency = new Map(floor.rooms.map(room => [room.id, []]));
    floor.connections.forEach(connection => {
      adjacency.get(connection.from)?.push(connection.to);
      adjacency.get(connection.to)?.push(connection.from);
    });
    const start = (floor.rooms.find(room => room.entry) ?? floor.rooms.find(room => room.stair) ?? floor.rooms[0]).id;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      for (const next of adjacency.get(queue.shift()) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const orphans = floor.rooms.filter(room => !seen.has(room.id)).map(room => room.id);
    if (orphans.length > 0) errors.push(`${where}：房間 ${orphans.join('、')} 沒有連到本層其餘部分（§95）`);
  }
};

// 整張地圖（跨層）檢查。
const validateLayout = (layout, errors) => {
  const allRooms = layout.floors.flatMap(floor => floor.rooms);
  const entries = allRooms.filter(room => room.entry);
  const exits = allRooms.filter(room => room.exit);
  if (entries.length !== 1) errors.push(`${layout.name}：正式入口應恰為 1 個，實際 ${entries.length}`);
  // GDD §164：每個探索地圖合計配置 **1～3 個出口**；出口可位於不同樓層，但皆計入同一張圖的出口數。
  // 原本寫死「恰 1 個」，合法的雙出口地圖會被誤拒（複審 R13 #4）。
  if (exits.length < 1 || exits.length > 3) {
    errors.push(`${layout.name}：正式出口應為 1～3 個（GDD §164），實際 ${exits.length}`);
  }

  layout.floors.forEach(floor => validateFloor(floor, layout.name, errors));

  // §97：上下樓梯使用相同的列、行座標。相鄰兩層之間，下行樓梯座標集合須與下一層的上行樓梯座標集合相同。
  for (let index = 0; index < layout.floors.length - 1; index += 1) {
    const upper = layout.floors[index];
    const lower = layout.floors[index + 1];
    const down = upper.rooms.filter(room => room.stair === '↓').map(room => room.cells[0]).sort();
    const up = lower.rooms.filter(room => room.stair === '↑').map(room => room.cells[0]).sort();
    if (down.length === 0) {
      errors.push(`${layout.name}：${upper.label} 沒有下行樓梯，無法連到 ${lower.label}（§97）`);
    }
    if (up.length === 0) {
      errors.push(`${layout.name}：${lower.label} 沒有上行樓梯，無法回到 ${upper.label}（§97）`);
    }
    if (down.join('|') !== up.join('|')) {
      errors.push(
        `${layout.name}：${upper.label} 下行樓梯 [${down.join(' ')}] 與 ${lower.label} 上行樓梯 [${up.join(' ')}] 座標不一致（§97）`,
      );
    }
  }
  // 最底層不得留下無處可去的下行樓梯；最上層同理。
  const first = layout.floors[0];
  const last = layout.floors[layout.floors.length - 1];
  if (layout.floors.length > 1) {
    if (first.rooms.some(room => room.stair === '↑')) errors.push(`${layout.name}：${first.label} 是最上層，不得有上行樓梯`);
    if (last.rooms.some(room => room.stair === '↓')) errors.push(`${layout.name}：${last.label} 是最底層，不得有下行樓梯`);
  }
};

export const validateMapLayouts = layouts => {
  const errors = [];
  layouts.forEach(layout => validateLayout(layout, errors));
  return errors;
};
