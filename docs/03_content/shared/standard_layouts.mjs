// docs/03_content/shared/standard_layouts.mjs
// 維爾冬／奧瑞恩／薩菲爾共用的三種版型骨架（房間拓樸 + 連線 + 樓梯鏈）。
//
// 為什麼共用：這三國原本就使用**完全相同**的字元格版型，只是名稱與註記不同。與其把同一份拓樸抄三次
// 再各自漂移，不如把它明確化為一組通過驗證的骨架，由各文化提供樓層標籤與註記。
// room id 只是內部識別（連線靠它接），渲染只畫 entry/exit/stair/marks，不顯示 id——所以三國共用 id
// 不影響閱讀版呈現。
//
// **待內容**：三國的國家迷宮目前共用同一份拓樸。要讓各國迷宮在地形上真正不同，需要各自重畫房間與連線
// （見 HANDOFF）；本檔先確保「格式表達得出多格房間／通道／紅門」與「樓梯鏈正確」。
//
// 規則對應 docs/00_core/architecture/01_map_module.md §94–101，由 map_model.mjs 的驗證器把關。

import { mapCell, mapConnection, mapFloor, mapRoom } from './map_model.mjs';

// ── A：8×8 單層野外 ─────────────────────────────────────────────────────────
// 入口在北，出口在南；含 L 形西坡、凹形中央獵原、2×2 大型敵人偏好與兩道紅門。
export const wildernessLayout = ({ name, city, type, label, note }) => ({
  name, city, type,
  floors: [
    mapFloor(label, 8, 8, [
      mapRoom('entry', [mapCell(1, 3)], { entry: true }),
      mapRoom('northRidge', [mapCell(1, 4), mapCell(1, 5), mapCell(2, 4), mapCell(2, 5)], { anchor: mapCell(1, 4) }),
      mapRoom('northSpring', [mapCell(2, 6)], { marks: ['resource'] }),
      // L 形西坡：跨兩列並向西凸出。
      mapRoom('westSlope', [mapCell(2, 2), mapCell(2, 3), mapCell(3, 1), mapCell(3, 2), mapCell(3, 3)], { marks: ['treasure'], anchor: mapCell(3, 2) }),
      mapRoom('westQuarry', [mapCell(4, 1), mapCell(4, 2)], { marks: ['resource'], anchor: mapCell(4, 2) }),
      mapRoom('eastCliff', [mapCell(3, 6), mapCell(3, 7), mapCell(3, 8)], { anchor: mapCell(3, 7) }),
      // 大型敵人偏好：L 形但外接矩形 2×2，符合 §99。
      mapRoom('beastRange', [mapCell(4, 7), mapCell(4, 8), mapCell(5, 8)], { marks: ['large'], anchor: mapCell(4, 7) }),
      // 凹形中央空地。
      mapRoom('centralField', [mapCell(4, 3), mapCell(4, 4), mapCell(4, 5), mapCell(4, 6), mapCell(5, 4), mapCell(5, 5)], { anchor: mapCell(4, 4) }),
      mapRoom('iceCrack', [mapCell(5, 3)], { marks: ['trap'] }),
      mapRoom('westVale', [mapCell(5, 1), mapCell(5, 2), mapCell(6, 1), mapCell(6, 2)], { anchor: mapCell(6, 1) }),
      mapRoom('riteClearing', [mapCell(6, 3), mapCell(6, 4), mapCell(6, 5)], { marks: ['event'], anchor: mapCell(6, 4) }),
      mapRoom('eastTrail', [mapCell(6, 6), mapCell(6, 7), mapCell(7, 7), mapCell(7, 8)], { anchor: mapCell(6, 7) }),
      mapRoom('cache', [mapCell(7, 4)], { marks: ['treasure'] }),
      mapRoom('southTrailWest', [mapCell(7, 2), mapCell(7, 3)], { anchor: mapCell(7, 3) }),
      mapRoom('southTrailEast', [mapCell(7, 5), mapCell(7, 6)], { anchor: mapCell(7, 5) }),
      mapRoom('exitPass', [mapCell(8, 4), mapCell(8, 5), mapCell(8, 6)], { anchor: mapCell(8, 5) }),
      mapRoom('exit', [mapCell(8, 7)], { exit: true }),
    ], [
      mapConnection('entry', 'northRidge', mapCell(1, 3), mapCell(1, 4)),
      mapConnection('northRidge', 'westSlope', mapCell(2, 4), mapCell(2, 3)),
      mapConnection('northRidge', 'northSpring', mapCell(2, 5), mapCell(2, 6)),
      mapConnection('northSpring', 'eastCliff', mapCell(2, 6), mapCell(3, 6)),
      mapConnection('westSlope', 'westQuarry', mapCell(3, 1), mapCell(4, 1)),
      // 紅門：西坡（寶箱偏好）守著通往中央的捷徑。
      mapConnection('westSlope', 'centralField', mapCell(3, 3), mapCell(4, 3), 'door'),
      mapConnection('westQuarry', 'centralField', mapCell(4, 2), mapCell(4, 3)),
      mapConnection('eastCliff', 'beastRange', mapCell(3, 7), mapCell(4, 7)),
      mapConnection('beastRange', 'centralField', mapCell(4, 7), mapCell(4, 6)),
      mapConnection('centralField', 'iceCrack', mapCell(5, 4), mapCell(5, 3)),
      mapConnection('centralField', 'riteClearing', mapCell(5, 4), mapCell(6, 4)),
      mapConnection('iceCrack', 'westVale', mapCell(5, 3), mapCell(5, 2)),
      mapConnection('westVale', 'southTrailWest', mapCell(6, 2), mapCell(7, 2)),
      mapConnection('riteClearing', 'eastTrail', mapCell(6, 5), mapCell(6, 6)),
      mapConnection('southTrailWest', 'cache', mapCell(7, 3), mapCell(7, 4)),
      mapConnection('cache', 'southTrailEast', mapCell(7, 4), mapCell(7, 5)),
      mapConnection('southTrailEast', 'eastTrail', mapCell(7, 6), mapCell(7, 7)),
      // 紅門：藏匿處（寶箱偏好）守著直達出口的近路。
      mapConnection('cache', 'exitPass', mapCell(7, 4), mapCell(8, 4), 'door'),
      mapConnection('eastTrail', 'exit', mapCell(7, 7), mapCell(8, 7)),
      mapConnection('exitPass', 'exit', mapCell(8, 6), mapCell(8, 7)),
    ], note),
  ],
});

// ── B：5×5 地上＋地下各一層 ─────────────────────────────────────────────────
// 樓梯固定在 (3,3)：地上 ↓、地下 ↑ 同座標（§97）。
export const twoFloorLayout = ({ name, city, type, floors }) => ({
  name, city, type,
  floors: [
    mapFloor(floors[0].label, 5, 5, [
      mapRoom('entry', [mapCell(1, 2)], { entry: true }),
      mapRoom('foreHall', [mapCell(1, 3), mapCell(2, 2), mapCell(2, 3)], { anchor: mapCell(2, 3) }),
      mapRoom('westHold', [mapCell(2, 1), mapCell(3, 1)], { anchor: mapCell(2, 1) }),
      mapRoom('surfaceVein', [mapCell(2, 4)], { marks: ['resource'] }),
      mapRoom('collapsedDeck', [mapCell(3, 2)], { marks: ['trap'] }),
      mapRoom('stairDown', [mapCell(3, 3)], { stair: '↓' }),
      mapRoom('eastGangway', [mapCell(3, 4), mapCell(3, 5), mapCell(4, 5)], { anchor: mapCell(3, 5) }),
      mapRoom('holdChamber', [mapCell(4, 3), mapCell(4, 4)], { marks: ['treasure'], anchor: mapCell(4, 4) }),
      mapRoom('westStep', [mapCell(4, 2)], {}),
      mapRoom('southWalk', [mapCell(5, 3), mapCell(5, 4)], { anchor: mapCell(5, 4) }),
      mapRoom('exit', [mapCell(5, 5)], { exit: true }),
    ], [
      mapConnection('entry', 'foreHall', mapCell(1, 2), mapCell(1, 3)),
      mapConnection('foreHall', 'westHold', mapCell(2, 2), mapCell(2, 1)),
      mapConnection('foreHall', 'surfaceVein', mapCell(2, 3), mapCell(2, 4)),
      mapConnection('westHold', 'collapsedDeck', mapCell(3, 1), mapCell(3, 2)),
      mapConnection('collapsedDeck', 'stairDown', mapCell(3, 2), mapCell(3, 3)),
      mapConnection('stairDown', 'eastGangway', mapCell(3, 3), mapCell(3, 4)),
      // 紅門：貨艙（寶箱偏好）需付探索成本才進得去。
      mapConnection('eastGangway', 'holdChamber', mapCell(4, 5), mapCell(4, 4), 'door'),
      mapConnection('holdChamber', 'westStep', mapCell(4, 3), mapCell(4, 2)),
      mapConnection('holdChamber', 'southWalk', mapCell(4, 3), mapCell(5, 3)),
      mapConnection('southWalk', 'exit', mapCell(5, 4), mapCell(5, 5)),
    ], floors[0].note),
    mapFloor(floors[1].label, 5, 5, [
      mapRoom('upperCave', [mapCell(1, 3), mapCell(2, 2), mapCell(2, 3), mapCell(2, 4)], { anchor: mapCell(2, 3) }),
      mapRoom('westDrift', [mapCell(3, 1)], {}),
      mapRoom('deepVein', [mapCell(3, 2)], { marks: ['resource'] }),
      mapRoom('stairUp', [mapCell(3, 3)], { stair: '↑' }),
      mapRoom('eastDrift', [mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
      // 2×2 外接矩形，符合 §99 的大型敵人偏好。
      mapRoom('beastDen', [mapCell(4, 1), mapCell(4, 2), mapCell(5, 2)], { marks: ['large'], anchor: mapCell(4, 2) }),
      mapRoom('sunkenCargo', [mapCell(4, 3), mapCell(4, 4)], { marks: ['event'], anchor: mapCell(4, 3) }),
    ], [
      mapConnection('upperCave', 'deepVein', mapCell(2, 2), mapCell(3, 2)),
      mapConnection('upperCave', 'stairUp', mapCell(2, 3), mapCell(3, 3)),
      mapConnection('upperCave', 'eastDrift', mapCell(2, 4), mapCell(3, 4)),
      mapConnection('stairUp', 'eastDrift', mapCell(3, 3), mapCell(3, 4)),
      mapConnection('deepVein', 'westDrift', mapCell(3, 2), mapCell(3, 1)),
      mapConnection('westDrift', 'beastDen', mapCell(3, 1), mapCell(4, 1)),
      // 紅門：獸窟（大型敵人偏好）守著沉貨事件房。
      mapConnection('beastDen', 'sunkenCargo', mapCell(4, 2), mapCell(4, 3), 'door'),
      mapConnection('eastDrift', 'sunkenCargo', mapCell(3, 4), mapCell(4, 4)),
    ], floors[1].note),
  ],
});

// ── C：6×6 六層國家迷宮 ─────────────────────────────────────────────────────
// 樓梯鏈：中間層各有**兩座** 1×1 樓梯房（§98 功能互斥，一房只能一個方向），
// 上下相接的兩層共用同一座標（§97）。P=(2,5)、Q=(5,2) 交替：
//   F1 ↓P ／ F2 ↑P ↓Q ／ F3 ↑Q ↓P ／ F4 ↑P ↓Q ／ F5 ↑Q ↓P ／ F6 ↑P
// 最上層無 ↑、最底層無 ↓，且每一對相鄰樓層的座標集合完全相同。
const P = mapCell(2, 5);
const Q = mapCell(5, 2);

const nationalFloors = [
  // F1：入口層。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('entry', [mapCell(1, 3)], { entry: true }),
    mapRoom('gateHall', [mapCell(2, 2), mapCell(2, 3), mapCell(3, 2), mapCell(3, 3)], { anchor: mapCell(2, 3) }),
    mapRoom('eastWalk', [mapCell(2, 4), mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
    mapRoom('stairDown', [P], { stair: '↓' }),
    mapRoom('oathVein', [mapCell(4, 2), mapCell(5, 2)], { marks: ['resource'], anchor: mapCell(4, 2) }),
    mapRoom('courtyard', [mapCell(4, 3), mapCell(4, 4), mapCell(5, 3), mapCell(5, 4)], { marks: ['treasure'], anchor: mapCell(4, 4) }),
    mapRoom('splitStone', [mapCell(4, 5)], { marks: ['trap'] }),
    mapRoom('southWalk', [mapCell(5, 5)], {}),
  ], [
    mapConnection('entry', 'gateHall', mapCell(1, 3), mapCell(2, 3)),
    mapConnection('gateHall', 'eastWalk', mapCell(2, 3), mapCell(2, 4)),
    mapConnection('eastWalk', 'stairDown', mapCell(2, 4), P),
    mapConnection('gateHall', 'oathVein', mapCell(3, 2), mapCell(4, 2)),
    mapConnection('gateHall', 'courtyard', mapCell(3, 3), mapCell(4, 3), 'door'),
    mapConnection('eastWalk', 'splitStone', mapCell(3, 5), mapCell(4, 5)),
    mapConnection('courtyard', 'splitStone', mapCell(4, 4), mapCell(4, 5)),
    mapConnection('courtyard', 'southWalk', mapCell(5, 4), mapCell(5, 5)),
    mapConnection('oathVein', 'courtyard', mapCell(5, 2), mapCell(5, 3)),
  ], note),
  // F2：↑P ↓Q。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('stairUp', [P], { stair: '↑' }),
    mapRoom('eastWalk', [mapCell(2, 4), mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
    mapRoom('lectureHall', [mapCell(2, 2), mapCell(2, 3), mapCell(3, 2), mapCell(3, 3)], { marks: ['event'], anchor: mapCell(2, 3) }),
    mapRoom('ringWalk', [mapCell(4, 3), mapCell(4, 4), mapCell(4, 5), mapCell(5, 4), mapCell(5, 5)], { marks: ['treasure'], anchor: mapCell(4, 4) }),
    mapRoom('wardTrap', [mapCell(4, 2)], { marks: ['trap'] }),
    mapRoom('southWalk', [mapCell(5, 3)], {}),
    mapRoom('stairDown', [Q], { stair: '↓' }),
  ], [
    mapConnection('stairUp', 'eastWalk', P, mapCell(2, 4)),
    mapConnection('eastWalk', 'lectureHall', mapCell(2, 4), mapCell(2, 3)),
    mapConnection('lectureHall', 'wardTrap', mapCell(3, 2), mapCell(4, 2)),
    mapConnection('wardTrap', 'stairDown', mapCell(4, 2), Q),
    mapConnection('eastWalk', 'ringWalk', mapCell(3, 4), mapCell(4, 4), 'door'),
    mapConnection('ringWalk', 'southWalk', mapCell(4, 3), mapCell(5, 3)),
    mapConnection('southWalk', 'stairDown', mapCell(5, 3), Q),
  ], note),
  // F3：↑Q ↓P。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('stairDown', [P], { stair: '↓' }),
    mapRoom('eastWalk', [mapCell(2, 4), mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
    mapRoom('library', [mapCell(2, 2), mapCell(2, 3), mapCell(3, 2), mapCell(3, 3)], { marks: ['treasure'], anchor: mapCell(2, 3) }),
    mapRoom('dustVein', [mapCell(4, 5), mapCell(5, 5)], { marks: ['resource'], anchor: mapCell(4, 5) }),
    mapRoom('greatChamber', [mapCell(4, 2), mapCell(4, 3), mapCell(4, 4), mapCell(5, 3), mapCell(5, 4)], { marks: ['large'], anchor: mapCell(4, 3) }),
    mapRoom('stairUp', [Q], { stair: '↑' }),
  ], [
    mapConnection('stairDown', 'eastWalk', P, mapCell(2, 4)),
    mapConnection('eastWalk', 'library', mapCell(2, 4), mapCell(2, 3)),
    mapConnection('library', 'greatChamber', mapCell(3, 2), mapCell(4, 2)),
    mapConnection('greatChamber', 'stairUp', mapCell(4, 2), Q),
    mapConnection('eastWalk', 'dustVein', mapCell(3, 5), mapCell(4, 5)),
    mapConnection('greatChamber', 'dustVein', mapCell(4, 4), mapCell(4, 5), 'door'),
  ], note),
  // F4：↑P ↓Q。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('stairUp', [P], { stair: '↑' }),
    mapRoom('terrace', [mapCell(2, 2), mapCell(2, 3), mapCell(2, 4)], { anchor: mapCell(2, 3) }),
    mapRoom('riteRoom', [mapCell(3, 2), mapCell(3, 3), mapCell(3, 4)], { marks: ['event'], anchor: mapCell(3, 3) }),
    mapRoom('eastWalk', [mapCell(3, 5), mapCell(4, 5), mapCell(5, 5)], { anchor: mapCell(4, 5) }),
    mapRoom('vault', [mapCell(4, 3), mapCell(4, 4)], { marks: ['treasure'], anchor: mapCell(4, 4) }),
    mapRoom('sealTrap', [mapCell(4, 2)], { marks: ['trap'] }),
    mapRoom('southWalk', [mapCell(5, 3), mapCell(5, 4)], { anchor: mapCell(5, 4) }),
    mapRoom('stairDown', [Q], { stair: '↓' }),
  ], [
    mapConnection('stairUp', 'terrace', P, mapCell(2, 4)),
    mapConnection('terrace', 'riteRoom', mapCell(2, 3), mapCell(3, 3)),
    mapConnection('riteRoom', 'sealTrap', mapCell(3, 2), mapCell(4, 2)),
    mapConnection('sealTrap', 'stairDown', mapCell(4, 2), Q),
    mapConnection('riteRoom', 'eastWalk', mapCell(3, 4), mapCell(3, 5)),
    mapConnection('riteRoom', 'vault', mapCell(3, 3), mapCell(4, 3), 'door'),
    mapConnection('eastWalk', 'vault', mapCell(4, 5), mapCell(4, 4)),
    mapConnection('vault', 'southWalk', mapCell(4, 4), mapCell(5, 4)),
    mapConnection('southWalk', 'stairDown', mapCell(5, 3), Q),
  ], note),
  // F5：↑Q ↓P。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('stairDown', [P], { stair: '↓' }),
    mapRoom('eastWalk', [mapCell(2, 4), mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
    mapRoom('workshop', [mapCell(2, 2), mapCell(2, 3), mapCell(3, 2), mapCell(3, 3)], { marks: ['large'], anchor: mapCell(2, 3) }),
    mapRoom('chimeVein', [mapCell(4, 5), mapCell(5, 5)], { marks: ['resource'], anchor: mapCell(4, 5) }),
    mapRoom('longHall', [mapCell(4, 2), mapCell(4, 3), mapCell(4, 4), mapCell(5, 3), mapCell(5, 4)], { anchor: mapCell(4, 3) }),
    mapRoom('stairUp', [Q], { stair: '↑' }),
  ], [
    mapConnection('stairDown', 'eastWalk', P, mapCell(2, 4)),
    mapConnection('eastWalk', 'workshop', mapCell(2, 4), mapCell(2, 3)),
    mapConnection('workshop', 'longHall', mapCell(3, 2), mapCell(4, 2), 'door'),
    mapConnection('longHall', 'stairUp', mapCell(4, 2), Q),
    mapConnection('eastWalk', 'chimeVein', mapCell(3, 5), mapCell(4, 5)),
    mapConnection('longHall', 'chimeVein', mapCell(4, 4), mapCell(4, 5)),
  ], note),
  // F6：最深層，↑P、無 ↓，唯一正式出口。
  (label, note) => mapFloor(label, 6, 6, [
    mapRoom('stairUp', [P], { stair: '↑' }),
    mapRoom('eastWalk', [mapCell(2, 4), mapCell(3, 4), mapCell(3, 5)], { anchor: mapCell(3, 4) }),
    mapRoom('coreVault', [mapCell(2, 2), mapCell(2, 3)], { marks: ['treasure'], anchor: mapCell(2, 3) }),
    mapRoom('bossSeat', [mapCell(3, 2), mapCell(3, 3), mapCell(4, 2), mapCell(4, 3)], { marks: ['large'], anchor: mapCell(3, 3) }),
    mapRoom('southWalkWest', [mapCell(5, 2), mapCell(5, 3)], { anchor: mapCell(5, 3) }),
    mapRoom('southWalk', [mapCell(4, 4), mapCell(4, 5), mapCell(5, 4)], { anchor: mapCell(4, 5) }),
    mapRoom('exit', [mapCell(5, 5)], { exit: true }),
  ], [
    mapConnection('stairUp', 'eastWalk', P, mapCell(2, 4)),
    mapConnection('eastWalk', 'coreVault', mapCell(2, 4), mapCell(2, 3)),
    mapConnection('coreVault', 'bossSeat', mapCell(2, 3), mapCell(3, 3), 'door'),
    mapConnection('bossSeat', 'southWalkWest', mapCell(4, 3), mapCell(5, 3)),
    mapConnection('southWalkWest', 'southWalk', mapCell(5, 3), mapCell(5, 4)),
    mapConnection('eastWalk', 'southWalk', mapCell(3, 4), mapCell(4, 4)),
    mapConnection('southWalk', 'exit', mapCell(5, 4), mapCell(5, 5)),
  ], note),
];

export const nationalDungeonLayout = ({ name, city, type, floors }) => ({
  name, city, type,
  floors: nationalFloors.map((build, index) => build(floors[index].label, floors[index].note)),
});
